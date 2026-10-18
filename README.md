# CamWatch

Replacement for the Yi app. Cameras (RTSP/ONVIF) -> **go2rtc** (RTSP to HLS) -> **hub** (record, motion, push, PTZ, talk, auth) -> **Expo app**.

## Server setup (home PC/server or VPS with Docker)

1. `cp go2rtc/go2rtc.example.yaml go2rtc/go2rtc.yaml` and put in your cameras' RTSP URLs.
2. `cp hub/config.example.json hub/config.json`. Set `token` to a long random string and list your cameras
   (`record`: `motion` | `continuous` | `off`; `ptz` and `talk` are optional). Set `TZ` in `docker-compose.yml`.
3. `docker compose up -d --build`. The hub listens on port 8080; go2rtc is bound to localhost only.

**Remote access:** put the hub behind HTTPS (Caddy/nginx/Cloudflare Tunnel) or reach it over Tailscale.
The token travels in the URL path, so do not expose port 8080 over plain http to the internet.

## App

`npm install`, then `npm start`. In **Settings** enter the hub address and token.

Push notifications need a development build (not Expo Go on Android) and an EAS project id:
`npx eas init`, then `npx eas build --profile development`.

## Feature notes / things to verify with your cameras

- **Motion** uses ffmpeg scene-change detection on the stream (2 fps, 320 px wide). Tune `motionThreshold` per camera
  (lower = more sensitive, default 0.01); set `motionStream` to a low-res substream to save CPU.
- **Recording** writes 60 s MP4 segments. In `motion` mode, segments with no motion (+/-10 s) are deleted; all
  segments are removed after `retentionDays`.
- **PTZ:** `onvif` sends ContinuousMove/Stop (camera ONVIF auth must be off, and `profile` must match your camera's
  profile token). `http` calls the URLs you list; the example yi-hack URLs are placeholders to check against your firmware.
- **Talk** uploads a clip and asks go2rtc to play it to the camera's backchannel. This only works if the camera/firmware
  exposes an RTSP backchannel (speaker). Set `"talk": false` on cameras that cannot do it.
