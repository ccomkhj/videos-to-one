# videos-to-one

Pick a handful of videos on your phone, send them to your own computer over Wi-Fi, and get
back **one long video**: clips joined in recording order, each labelled in the corner with
**where and when** it was filmed. The only editing tool is cutting.

Everything runs on your computer. No cloud, no accounts. The only outbound call is the
optional place-name lookup (OpenStreetMap Nominatim). See [SPEC.md](SPEC.md) for the full design.

## Run it

You need [Docker](https://docs.docker.com/get-docker/). Replace `192.168.1.23` with your
computer's LAN IP address (how to find it is below) and `Europe/Berlin` with your timezone.

**macOS / Linux**

```bash
docker run --rm -p 8080:8080 \
  -v ~/Videos/videos-to-one:/data \
  -e TZ=Europe/Berlin \
  -e PUBLIC_HOST=192.168.1.23 \
  ghcr.io/ccomkhj/videos-to-one
```

**Windows (PowerShell)**

```powershell
docker run --rm -p 8080:8080 `
  -v "$env:USERPROFILE\Videos\videos-to-one:/data" `
  -e TZ=Europe/Berlin `
  -e PUBLIC_HOST=192.168.1.23 `
  ghcr.io/ccomkhj/videos-to-one
```

Then open <http://localhost:8080> on the computer. It shows a QR code: scan it with the phone
(on the same Wi-Fi), tap **Add videos**, and pick your clips.

Finished videos are downloaded to whichever device you're using, and a copy is saved in
`output/` inside the folder you mounted (e.g. `~/Videos/videos-to-one/output`).

**Finding the LAN IP**

- macOS: System Settings → Wi-Fi → Details → IP address (or `ipconfig getifaddr en0`)
- Windows: `ipconfig`, then look for "IPv4 Address"
- Linux: `hostname -I`

If `PUBLIC_HOST` isn't set, everything still works; type `http://<ip>:8080` on the phone by hand.

## Tips

- **iPhone uploads from Safari may lose the location or original date.** Clips without them
  show a hint. For those, AirDrop the clips to the computer and drag them into the browser
  window there: the original files keep all metadata.
  The Photos picker also re-encodes HDR clips to SDR H.264. Location and date survive it, but
  if you want HDR or the best quality kept, use the AirDrop route for every clip.
- Keep the phone's screen on while uploading. iOS pauses uploads in the background; failed
  uploads can be retried, and clips that already arrived are kept.
- *Compatible 1080p* is the default and the fastest. *Original quality* (HEVC, up to 4K, HDR
  kept when every clip is HDR) is much slower without a hardware encoder (see below).

## Faster renders (hardware encoding)

The final encode uses a hardware encoder when one is available and passes a quick test at
startup; otherwise software. The server log shows which one it picked
(`Final encoder: …`) and the time of each render.

- **macOS:** Docker Desktop can't reach the Mac's encoder. For VideoToolbox, run the app
  natively (see Development below). On an M4, a 17 min export went from 29 min to 7 min.
- **Linux, Intel/AMD GPU (VAAPI):** add `--device /dev/dri` to `docker run`.
- **Linux, NVIDIA (NVENC):** install the NVIDIA Container Toolkit and add
  `--gpus all -e NVIDIA_DRIVER_CAPABILITIES=video,compute,utility`.

The Linux GPU paths aren't tested on real hardware yet; if the log says `software`, the
image's ffmpeg couldn't use the GPU. Set `ENCODER=software` to turn this off.

## Security

There is **no password**. Anyone on the same Wi-Fi network can open the app while it runs.
Stop the container when you're done, and be careful on hotel or café Wi-Fi.

## Configuration

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

Known quirk: some Android phones write local time into `creation_time` as if it were UTC.
This can't be detected reliably, so those clips may show a date that is off around midnight.

## Development

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
