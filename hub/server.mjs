// CamWatch hub: recording, motion detection, push alerts, PTZ, talk-back and an authenticated
// front door for the app. Zero npm dependencies; needs Node 22+ and ffmpeg on PATH.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

// Config comes from a JSON file and/or env (HUB_TOKEN, HUB_CAMERAS as a JSON array); env wins.
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(process.env.CONFIG || './hub/config.json', 'utf8'));
} catch (e) {
  if (!process.env.HUB_TOKEN) throw e;
}
if (process.env.HUB_TOKEN) cfg.token = process.env.HUB_TOKEN;
if (process.env.HUB_CAMERAS) cfg.cameras = JSON.parse(process.env.HUB_CAMERAS);
const PORT = cfg.port ?? 8080;
const DATA = path.resolve(cfg.dataDir ?? './data');
const GO2RTC = cfg.go2rtcUrl ?? 'http://127.0.0.1:1984';
const RTSP = cfg.go2rtcRtsp ?? 'rtsp://127.0.0.1:8554';
const SELF = `http://127.0.0.1:${PORT}`; // how go2rtc (same host) reaches this hub
const TOKEN = cfg.token;
const SEG = cfg.segmentSeconds ?? 60;
const RETENTION_MS = (cfg.retentionDays ?? 7) * 86400_000;
const QUIET_MS = (cfg.motionQuietSeconds ?? 10) * 1000;
const COOLDOWN_MS = (cfg.notifyCooldownSeconds ?? 60) * 1000;
const PRE_POST_MS = 10_000;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const cameras = cfg.cameras ?? [];

if (!TOKEN || TOKEN.length < 16) {
  console.error('config.token must be set to a random string of at least 16 characters');
  process.exit(1);
}
for (const c of cameras) if (!/^[\w-]+$/.test(c.id)) throw new Error(`bad camera id: ${c.id}`);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const dir = (...p) => {
  const d = path.join(DATA, ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
for (const d of ['rec', 'thumbs', 'talk']) dir(d);
for (const c of cameras) dir('rec', c.id);

// ---------- persistence ----------
const eventsFile = path.join(DATA, 'events.jsonl');
const devicesFile = path.join(DATA, 'devices.json');
let events = [];
try {
  events = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(-1000);
} catch {}
let devices = [];
try {
  devices = JSON.parse(fs.readFileSync(devicesFile, 'utf8'));
} catch {}
const saveDevices = () => fs.writeFileSync(devicesFile, JSON.stringify(devices));

// ---------- ffmpeg supervision ----------
function supervise(name, args, onLine, onStart) {
  const run = () => {
    onStart?.();
    let restarted = false;
    const again = () => {
      if (restarted) return;
      restarted = true;
      setTimeout(run, 5000);
    };
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    p.stderr.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (onLine) onLine(line, p);
        else if (line.trim()) log(`[${name}]`, line.trim());
      }
    });
    p.on('error', e => {
      log(`[${name}] ffmpeg error: ${e.message}`);
      again();
    });
    p.on('close', code => {
      log(`[${name}] ffmpeg exited (${code}); restarting in 5s`);
      again();
    });
  };
  run();
}

// ---------- recording ----------
const SEG_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.mp4$/;
const parseStart = n => {
  const m = SEG_RE.exec(n);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
};
const dayKey = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function listSegments(id) {
  let names = [];
  try {
    names = fs.readdirSync(path.join(DATA, 'rec', id));
  } catch {}
  return names.filter(n => SEG_RE.test(n)).sort().map(name => ({ name, start: parseStart(name) }));
}

for (const c of cameras) {
  if ((c.record ?? 'motion') === 'off') continue;
  supervise(`rec:${c.id}`, [
    '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', `${RTSP}/${c.stream}`,
    '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac',
    '-f', 'segment', '-segment_time', String(SEG), '-segment_atclocktime', '1', '-reset_timestamps', '1',
    '-strftime', '1', '-segment_format_options', 'movflags=+faststart',
    path.join(DATA, 'rec', c.id, '%Y%m%d-%H%M%S.mp4'),
  ]);
}

// ---------- motion detection ----------
const motion = {}; // camera id -> { active, lastHit, lastNotify, startedAt }
const eventOf = id => motion[id]?.active;

function startMotion(c) {
  const st = (motion[c.id] = { active: null, lastHit: 0, lastNotify: 0, startedAt: Date.now() });
  const threshold = c.motionThreshold ?? 0.01;
  const src = `${RTSP}/${c.motionStream ?? c.stream}`;
  supervise(
    `motion:${c.id}`,
    [
      '-hide_banner', '-loglevel', 'info', '-rtsp_transport', 'tcp', '-i', src, '-an',
      '-vf', `fps=2,scale=320:-1,select=gt(scene\\,${threshold}),showinfo`, '-f', 'null', '-',
    ],
    line => {
      if (!line.includes('Parsed_showinfo')) return;
      const now = Date.now();
      if (now - st.startedAt < 8000) return; // first frames always score as "changed"
      onMotion(c, st, now);
    },
    () => (st.startedAt = Date.now()),
  );
}

function onMotion(c, st, now) {
  st.lastHit = now;
  if (st.active) {
    st.active.end = now;
    return;
  }
  const ev = (st.active = { id: crypto.randomBytes(6).toString('hex'), camera: c.id, start: now, end: now, thumb: null });
  snapshot(c, ev);
  if (now - st.lastNotify > COOLDOWN_MS) {
    st.lastNotify = now;
    push(`Motion: ${c.name}`, 'Motion detected', { cameraId: c.id, eventId: ev.id });
  }
  log(`motion start ${c.id} ${ev.id}`);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, st] of Object.entries(motion)) {
    if (st.active && now - st.lastHit > QUIET_MS) {
      const ev = st.active;
      st.active = null;
      events.push(ev);
      fs.appendFileSync(eventsFile, JSON.stringify(ev) + '\n');
      log(`motion end ${id} ${ev.id} (${Math.round((ev.end - ev.start) / 1000)}s)`);
    }
  }
}, 2000);

function snapshot(c, ev) {
  const file = `${ev.id}.jpg`;
  const p = spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', `${RTSP}/${c.stream}`,
    '-frames:v', '1', '-q:v', '4', '-y', path.join(DATA, 'thumbs', file),
  ], { stdio: 'ignore' });
  p.on('error', () => {});
  p.on('close', code => {
    if (code === 0) ev.thumb = file;
  });
}

for (const c of cameras) {
  if (c.motion !== false) startMotion(c);
}

// ---------- retention / motion-only pruning ----------
function prune() {
  const now = Date.now();
  for (const c of cameras) {
    const mode = c.record ?? 'motion';
    const evs = [...events.filter(e => e.camera === c.id), ...(eventOf(c.id) ? [eventOf(c.id)] : [])];
    for (const s of listSegments(c.id)) {
      const end = s.start + SEG * 1000;
      let drop = s.start < now - RETENTION_MS;
      if (!drop && mode === 'motion' && c.motion !== false && end < now - 120_000) {
        drop = !evs.some(e => e.start <= end + PRE_POST_MS && e.end >= s.start - PRE_POST_MS);
      }
      if (drop) fs.rm(path.join(DATA, 'rec', c.id, s.name), () => {});
    }
  }
  for (const f of fs.readdirSync(path.join(DATA, 'thumbs'))) {
    const p = path.join(DATA, 'thumbs', f);
    try {
      if (fs.statSync(p).mtimeMs < now - RETENTION_MS) fs.rmSync(p);
    } catch {}
  }
}
setInterval(prune, 60_000);

// ---------- push notifications (Expo push service) ----------
async function push(title, body, data) {
  if (!devices.length) return;
  try {
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(devices.map(to => ({ to, title, body, data, sound: 'default', channelId: 'motion', priority: 'high' }))),
    });
    const j = await r.json();
    const tickets = j.data ?? [];
    const dead = devices.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
    if (dead.length) {
      devices = devices.filter(d => !dead.includes(d));
      saveDevices();
    }
  } catch (e) {
    log('push failed:', e.message);
  }
}

// ---------- PTZ ----------
const ONVIF_NS = 'http://www.onvif.org/ver20/ptz/wsdl';
const soap = body =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>${body}</s:Body></s:Envelope>`;
const VEL = { left: [-0.5, 0], right: [0.5, 0], up: [0, 0.5], down: [0, -0.5] };

async function ptz(c, dir, ms) {
  const p = c.ptz;
  if (!p) throw new Error('PTZ not configured for this camera');
  if (p.type === 'http') {
    const url = p.urls?.[dir];
    if (!url) throw new Error(`no PTZ url for "${dir}"`);
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (ms && dir !== 'stop' && p.urls.stop) setTimeout(() => fetch(p.urls.stop).catch(() => {}), ms);
    return;
  }
  // ONVIF
  const send = body =>
    fetch(p.url, { method: 'POST', headers: { 'content-type': 'application/soap+xml' }, body: soap(body), signal: AbortSignal.timeout(5000) });
  const stop = () =>
    send(`<Stop xmlns="${ONVIF_NS}"><ProfileToken>${p.profile ?? 'Profile_1'}</ProfileToken><PanTilt>true</PanTilt><Zoom>true</Zoom></Stop>`);
  if (dir === 'stop') return void (await stop());
  const [x, y] = VEL[dir];
  await send(
    `<ContinuousMove xmlns="${ONVIF_NS}"><ProfileToken>${p.profile ?? 'Profile_1'}</ProfileToken><Velocity><PanTilt x="${x}" y="${y}" xmlns="http://www.onvif.org/ver10/schema"/></Velocity></ContinuousMove>`,
  );
  setTimeout(() => stop().catch(() => {}), ms ?? 400);
}

// ---------- HTTP ----------
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const tokenOk = t => crypto.timingSafeEqual(hash(t), hash(TOKEN));
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const fail = (res, code, msg) => json(res, code, { error: msg });
const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', d => {
      n += d.length;
      if (n > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

function sendFile(req, res, file, type) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return fail(res, 404, 'not found');
  }
  const base = { 'content-type': type, 'accept-ranges': 'bytes' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (!m) {
    res.writeHead(200, { ...base, 'content-length': st.size });
    return fs.createReadStream(file).pipe(res);
  }
  let start = m[1] ? +m[1] : 0;
  let end = m[2] ? +m[2] : st.size - 1;
  if (!m[1] && m[2]) start = Math.max(0, st.size - +m[2]);
  end = Math.min(end, st.size - 1);
  if (start > end) {
    res.writeHead(416, { 'content-range': `bytes */${st.size}` });
    return res.end();
  }
  res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}

const PROXY_OK = [/^\/api\/stream\.m3u8$/, /^\/api\/hls\//, /^\/api\/frame\.jpeg$/];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = url.pathname;
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

    // go2rtc fetches talk-back audio from here over loopback; the filename is an unguessable random id
    let m = /^\/talk\/([a-f0-9]{24}\.m4a)$/.exec(p);
    if (m && loopback) return sendFile(req, res, path.join(DATA, 'talk', m[1]), 'audio/mp4');

    let authed = false;
    const t = /^\/t\/([^/]+)(\/.*)$/.exec(p);
    if (t) {
      authed = tokenOk(t[1]);
      p = t[2];
    } else {
      authed = tokenOk((req.headers.authorization ?? '').replace(/^Bearer /i, ''));
    }
    if (p === '/health') return json(res, 200, { ok: true });
    if (!authed) return fail(res, 401, 'unauthorized');

    const cam = id => cameras.find(c => c.id === id);

    if (p === '/api/cameras') {
      return json(res, 200, cameras.map(c => ({
        id: c.id, name: c.name ?? c.id, stream: c.stream, ptz: !!c.ptz, talk: c.talk !== false, record: c.record ?? 'motion',
      })));
    }

    if (p === '/api/events') {
      const only = url.searchParams.get('camera');
      const limit = Math.min(+(url.searchParams.get('limit') ?? 100), 500);
      const all = [...events, ...Object.values(motion).map(s => s.active).filter(Boolean)];
      const list = all.filter(e => !only || e.camera === only).sort((a, b) => b.start - a.start).slice(0, limit);
      return json(res, 200, list.map(e => ({ ...e, thumbUrl: e.thumb ? `/media/thumb/${e.thumb}` : null })));
    }

    if ((m = /^\/api\/recordings\/([\w-]+)$/.exec(p))) {
      const c = cam(m[1]);
      if (!c) return fail(res, 404, 'unknown camera');
      const segs = listSegments(c.id);
      const done = segs.slice(0, -1).map((s, i) => ({
        name: s.name,
        start: s.start,
        duration: Math.min(SEG, Math.round((segs[i + 1].start - s.start) / 1000)),
        url: `/media/rec/${c.id}/${s.name}`,
      }));
      const date = url.searchParams.get('date');
      return json(res, 200, {
        days: [...new Set(done.map(s => dayKey(s.start)))].sort(),
        segments: date ? done.filter(s => dayKey(s.start) === date) : [],
      });
    }

    if ((m = /^\/media\/rec\/([\w-]+)\/(\d{8}-\d{6}\.mp4)$/.exec(p))) {
      return sendFile(req, res, path.join(DATA, 'rec', m[1], m[2]), 'video/mp4');
    }
    if ((m = /^\/media\/thumb\/([\w-]+\.jpg)$/.exec(p))) {
      return sendFile(req, res, path.join(DATA, 'thumbs', m[1]), 'image/jpeg');
    }

    if ((m = /^\/api\/ptz\/([\w-]+)$/.exec(p)) && req.method === 'POST') {
      const c = cam(m[1]);
      if (!c) return fail(res, 404, 'unknown camera');
      const { dir: d, ms } = JSON.parse((await readBody(req, 1024)).toString() || '{}');
      if (!['up', 'down', 'left', 'right', 'stop'].includes(d)) return fail(res, 400, 'bad direction');
      try {
        await ptz(c, d, ms);
        return json(res, 200, { ok: true });
      } catch (e) {
        return fail(res, 502, e.message);
      }
    }

    if ((m = /^\/api\/talk\/([\w-]+)$/.exec(p)) && req.method === 'POST') {
      const c = cam(m[1]);
      if (!c) return fail(res, 404, 'unknown camera');
      const audio = await readBody(req, 5_000_000);
      const name = `${crypto.randomBytes(12).toString('hex')}.m4a`;
      const file = path.join(DATA, 'talk', name);
      fs.writeFileSync(file, audio);
      setTimeout(() => fs.rm(file, () => {}), 120_000);
      const src = `ffmpeg:${SELF}/talk/${name}#audio=pcma#input=file`;
      const r = await fetch(`${GO2RTC}/api/streams?dst=${encodeURIComponent(c.stream)}&src=${encodeURIComponent(src)}`, { method: 'POST' });
      if (!r.ok) return fail(res, 502, `go2rtc: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/devices' && req.method === 'POST') {
      const { token } = JSON.parse((await readBody(req, 1024)).toString() || '{}');
      if (typeof token !== 'string' || !/^Expo(nent)?PushToken\[.+\]$/.test(token)) return fail(res, 400, 'bad token');
      if (!devices.includes(token)) {
        devices.push(token);
        saveDevices();
      }
      return json(res, 200, { ok: true });
    }

    if (p.startsWith('/go2rtc/')) {
      const rest = p.slice('/go2rtc'.length);
      if (!PROXY_OK.some(re => re.test(rest))) return fail(res, 403, 'forbidden');
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      const r = await fetch(GO2RTC + rest + url.search, { signal: ac.signal });
      const headers = {};
      for (const h of ['content-type', 'cache-control']) if (r.headers.get(h)) headers[h] = r.headers.get(h);
      res.writeHead(r.status, headers);
      if (!r.body) return res.end();
      return Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
    }

    fail(res, 404, 'not found');
  } catch (e) {
    if (!res.headersSent) fail(res, 500, e.message);
    else res.destroy();
  }
});

server.listen(PORT, () => log(`hub listening on :${PORT}, ${cameras.length} camera(s), data in ${DATA}`));
