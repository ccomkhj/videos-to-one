# videos-to-one

Send clips from your phone to your own computer over Wi-Fi and get back **one video**, each
clip labelled with **where and when** it was filmed.

https://github.com/user-attachments/assets/f2e8094a-90da-4092-9d4f-9c37e2e71360

<sub>Demo recorded with [product-demo](https://github.com/ccomkhj/product-demo).</sub>

## Quick start

You need [Docker](https://docs.docker.com/get-docker/). Replace `192.168.1.23` with your
computer's LAN IP and `Europe/Berlin` with your timezone.

```bash
docker run --rm -p 8080:8080 \
  -v ~/Videos/videos-to-one:/data \
  -e TZ=Europe/Berlin \
  -e PUBLIC_HOST=192.168.1.23 \
  ghcr.io/ccomkhj/videos-to-one
```

Open <http://localhost:8080> on the computer and scan the QR code with your phone (same Wi-Fi).
Tap **Add videos**, pick your clips, cut if you like, and export. The finished video downloads
to your device, and a copy lands in `output/` inside the mounted folder.

- **Automatic captions:** place and date come from each clip's metadata; clips are joined in recording order.
- **Local and private:** runs on your computer, no cloud, no accounts. The only outbound call is the optional place-name lookup (OpenStreetMap Nominatim; `GEOCODER=off` to disable).
- **Cut is the only edit:** trim or drop parts of clips; nothing else to learn.

### Without Docker

With Node 22+ and ffmpeg on `PATH` (see Development for the ffmpeg build needed):

```bash
npm install
npm run build
TZ=Europe/Berlin PUBLIC_HOST=192.168.1.23 DATA_DIR=~/Videos/videos-to-one npm start
```

On a Mac this is the faster route: it can use the VideoToolbox hardware encoder.

<details>
<summary><b>Windows, finding the LAN IP, and tips</b></summary>

**Windows (PowerShell)**

```powershell
docker run --rm -p 8080:8080 `
  -v "$env:USERPROFILE\Videos\videos-to-one:/data" `
  -e TZ=Europe/Berlin `
  -e PUBLIC_HOST=192.168.1.23 `
  ghcr.io/ccomkhj/videos-to-one
```

**Finding the LAN IP**

- macOS: System Settings → Wi-Fi → Details → IP address (or `ipconfig getifaddr en0`)
- Windows: `ipconfig`, then look for "IPv4 Address"
- Linux: `hostname -I`

If `PUBLIC_HOST` isn't set, everything still works; type `http://<ip>:8080` on the phone by hand.

**Tips**

- **iPhone uploads from Safari may lose the location or original date.** Clips without them
  show a hint. For those, AirDrop the clips to the computer and drag them into the browser
  window there: the original files keep all metadata.
  The Photos picker also re-encodes HDR clips to SDR H.264. Location and date survive it, but
  if you want HDR or the best quality kept, use the AirDrop route for every clip.
- Keep the phone's screen on while uploading. iOS pauses uploads in the background; failed
  uploads can be retried, and clips that already arrived are kept.
- *Compatible 1080p* is the default and the fastest. *Original quality* (HEVC, up to 4K, HDR
  kept when every clip is HDR) is much slower without a hardware encoder (see below).
- Some Android phones write local time as UTC, so those clips may show a date off around midnight.

</details>

<details>
<summary><b>Faster renders (hardware encoding)</b></summary>

The final encode uses a hardware encoder when one is available and passes a quick test at
startup; otherwise software. The server log shows which one it picked
(`Final encoder: …`) and the time of each render.

- **macOS:** Docker Desktop can't reach the Mac's encoder. For VideoToolbox, run the app
  natively (see Development). On an M4, a 17 min export went from 29 min to 7 min.
- **Linux, Intel/AMD GPU (VAAPI):** add `--device /dev/dri` to `docker run`.
- **Linux, NVIDIA (NVENC):** install the NVIDIA Container Toolkit and add
  `--gpus all -e NVIDIA_DRIVER_CAPABILITIES=video,compute,utility`.

The Linux GPU paths aren't tested on real hardware yet; if the log says `software`, the
image's ffmpeg couldn't use the GPU. Set `ENCODER=software` to turn this off.

</details>

<details>
<summary><b>Configuration</b></summary>

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` | Session, outputs, cache |
| `PUBLIC_HOST` | (unset) | LAN IP/hostname used in the QR code |
| `TZ` | `UTC` | Fallback timezone for clips with neither a UTC offset nor GPS |
| `GEOCODER` | `nominatim` | `nominatim`, or `off` for fully offline use |
| `PLACE_LANGUAGE` | `en` | Language for place names |
| `ENCODER` | `auto` | Final encoder: `auto`, `software`, `videotoolbox`, `nvenc` or `vaapi` |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | VAAPI render node |
| `ORIENTATION` | `on` | `off` turns off "looks sideways" suggestions (manual rotate still works) |
| `MODELS_DIR` | `<repo>/models` | Where `npm run models` puts the detection models |

</details>

<details>
<summary><b>Development</b></summary>

Requires Node 22+ and ffmpeg/ffprobe (with libx264, libx265, libfreetype, libzimg) on `PATH`.
On macOS, Homebrew's `ffmpeg` lacks libfreetype (renders fail with "No such filter:
'drawtext'"); use `brew install ffmpeg-full` and put `/opt/homebrew/opt/ffmpeg-full/bin`
first on `PATH`. There are no Linux font paths on macOS either, so also set e.g.
`FONT_LATIN=/System/Library/Fonts/Supplemental/Arial.ttf`. Korean/Japanese/Chinese text uses
macOS's Arial Unicode automatically (override with `FONT_CJK`).

```bash
npm install
npm run models      # sideways-clip detection models (~82 MB, into models/); optional
npm test            # unit + snapshot + end-to-end tests (real ffmpeg, synthetic clips)
npm run typecheck
DATA_DIR=.data npm run dev   # API on :8080, Vite dev server on :5173 (proxies /api)
npm run build && DATA_DIR=.data npm start   # production: web app served on :8080
```

Layout: `shared/` (types, cut-list and ordering logic used by both sides), `server/`
(Fastify API, session store, ffmpeg pipeline), `web/` (React UI).
See [SPEC.md](SPEC.md) for the full design.

</details>
