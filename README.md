# CamWatch

Camera viewer for RTSP/ONVIF cameras (built and tested around Tapo). Cameras -> **go2rtc** (RTSP to HLS) ->
**hub** (record, motion, push, PTZ, talk, auth) -> **Expo app**.

> Yi cameras (including the newer YI IoT line) have no local video and are not supported.

## Server setup (home PC/server or VPS with Docker)

1. `cp go2rtc/go2rtc.example.yaml go2rtc/go2rtc.yaml` and put in your cameras' RTSP URLs.
2. `cp hub/config.example.json hub/config.json`. Set `token` to a long random string and list your cameras
   (`record`: `motion` | `continuous` | `off`; `ptz` and `talk` are optional). Set `TZ` in `docker-compose.yml`.
3. `docker compose up -d --build`. The hub listens on port 8080; go2rtc is bound to localhost only.

**Remote access:** put the hub behind HTTPS (Caddy/nginx/Cloudflare Tunnel) or reach it over Tailscale.
The token travels in the URL path, so do not expose port 8080 over plain http to the internet.

### VPS deployment (Traefik + Tailscale)

[deploy/camwatch.vps.yml](deploy/camwatch.vps.yml) runs Tailscale, go2rtc and the hub, behind an existing Traefik.
It is configured entirely through environment variables:

| Variable | Meaning |
| --- | --- |
| `TS_AUTHKEY` | Tailscale auth key (only needed on first start) |
| `HUB_TOKEN` | Access token the app uses |
| `HUB_CAMERAS` | Compact JSON array of cameras (same fields as `hub/config.example.json`) |
| `GO2RTC_STREAMS` | `name=src1\|src2;name2=src` where each source is an RTSP URL (or `tapo://...`) as seen from the home LAN |
| `HUB_CODE_URL`, `HUB_CODE_SHA256` | Raw URL of `hub/server.mjs` pinned to a commit, and its sha256 |

The home network is reached through a Tailscale subnet router (a PC/Pi/NAS at home advertising your LAN).

## Tapo cameras

1. In the Tapo app: Camera settings > Advanced settings > **Camera Account**: create a username and password.
   These are used for RTSP (`rtsp://USER:PASS@IP:554/stream1` high quality, `/stream2` low quality) and ONVIF.
2. Give each camera a fixed IP (DHCP reservation in your router).
3. Pan/tilt models (C210, C225 and similar): set `ptz` to `onvif` with `url` `http://IP:2020/onvif/service`, the
   same camera account as `username`/`password`, and `profile` `profile_1` (check yours if PTZ does nothing).
4. Talk-back: add a second source `tapo://TPLINK-CLOUD-PASSWORD@IP` to the stream. Only models with a speaker support it.
5. Use the low-quality stream as `motionStream` so motion detection costs little CPU.

## App

`npm install`, then `npm start`. In **Settings** enter the hub address and token.

Push notifications need a development build (not Expo Go on Android) and an EAS project id:
`npx eas init`, then `npx eas build --profile development`.

## Feature notes / things to verify with your cameras

- **Motion** uses ffmpeg scene-change detection on the stream (2 fps, 320 px wide). Tune `motionThreshold` per camera
  (lower = more sensitive, default 0.01); set `motionStream` to a low-res substream to save CPU.
- **Recording** writes 60 s MP4 segments. In `motion` mode, segments with no motion (+/-10 s) are deleted; all
  segments are removed after `retentionDays`.
- **PTZ:** `onvif` sends ContinuousMove/Stop, with an optional WS-Security login (`username`/`password`). `profile`
  must match your camera's profile token. `http` calls the URLs you list.
- **Talk** uploads a clip and asks go2rtc to play it to the camera's backchannel. This only works if the camera
  exposes one. Set `"talk": false` on cameras that cannot do it.
