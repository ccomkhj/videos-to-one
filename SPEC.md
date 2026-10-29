# videos-to-one — Product & Technical Spec (v1)

> Status: **agreed**. M0–M4 done; M0 results are in [docs/spike-ios-upload.md](docs/spike-ios-upload.md).
> Scope agreed in a Q&A session on 2026-10-29; the decision log is at the end.

## 1. Goal

Pick a handful of videos on your phone, send them to your own computer over Wi-Fi,
and get back **one long video**: clips joined in recording order, each one labelled
in the corner with **where and when** it was filmed. Allow **only minimal editing**:
cutting away the parts you don't want.

The product is the comfort of that flow. Every feature below is measured against
"does this keep the interface as simple as possible?"

### Principles

1. **Sensible defaults, almost no settings.** The default output needs zero decisions.
2. **Cutting is the only editing tool**, plus quarter-turn rotation for sideways clips.
   No speed, filters, crop, or effects.
3. **Local and private.** Runs on your own computer, with no cloud and no accounts.
   The only outbound call is the optional place-name lookup.
4. **Any phone.** Tuned for iPhone files, but it works with any phone video that
   ffmpeg can read.

## 2. Scope

### v1 (in scope)

| Area | What v1 does |
|---|---|
| Upload | From the phone's browser over Wi-Fi; from the laptop's browser (file picker and **drag-and-drop zone**). |
| Ordering | Auto-sorted by recording time; drag to reorder. |
| Overlay | Bottom-left **place name + date**, shown for the first few seconds of each clip. Missing fields are omitted. |
| Editing | Per clip: **trim start/end** and **split + remove middle parts**. |
| Transitions | Fixed **0.5 s crossfade** (video + audio) between clips. Not configurable. |
| Audio | Original audio, **loudness-normalized** per clip. |
| Title card | **Optional** one-line title at the start (text field at export; empty = no card). |
| Export | Choose aspect ratio (16:9 / 9:16 / 1:1), fill style (blur / black bars), and quality preset; see a summary of the inputs when they're mixed. |
| Output | Download on whichever device you're using. A copy is also saved to the output folder on the computer. |
| Preview | Per-clip preview in the editor (cuts applied). No full-timeline preview. |
| Session | **One working session at a time.** It survives a page reload or app restart, and "Start over" clears it. |

### Explicit non-goals

- Filters, color grading, speed changes / slow motion, crop, or free-angle rotation.
- Overlay styling options (font, color, position, size).
- Accounts, auth, multiple users, or LAN access protection (**decided: no protection**).
- Cloud/remote hosting.
- Multiple saved projects or project history.
- A full-timeline preview render.
- A native mobile app.

### Possible later (not v1, but don't design them out)

- Background music track.
- Still photos as short clips (with the same overlay).
- Manual place/date entry for clips that have no metadata.

## 3. How it's used

### Install and run (Docker)

```bash
docker run --rm -p 8080:8080 \
  -v ~/Videos/videos-to-one:/data \
  -e TZ=Europe/Berlin \
  -e PUBLIC_HOST=192.168.1.23 \
  ghcr.io/ccomkhj/videos-to-one
```

- Open `http://localhost:8080` on the computer. That page shows a **QR code** for the phone.
- `PUBLIC_HOST` is the computer's LAN IP. Docker can't discover it from inside the container,
  so it's passed in. If it isn't set, the laptop UI explains how to find it and the phone
  types the URL by hand.
- `TZ` is the fallback timezone for clips that store neither a UTC offset nor GPS (§5.2).

### Typical flow

1. Start the container and open the laptop page, which shows the QR code.
2. Scan the QR code with the phone, tap **Add videos**, and pick the clips. Uploads show
   per-file progress.
3. Clips appear in recording order with a thumbnail, date, place, and duration.
4. Optionally tap a clip to cut parts away, or drag to reorder. This works on the
   phone or the laptop, and both see the same session live.
5. Tap **Export**, adjust the options if wanted, and tap **Render** to see progress and
   then a **Download** button.

**Expected batch size:** 5–20 clips, under 10 minutes in total. v1 is designed and tested for this.

## 4. User interface

A single-page, responsive web app. It is touch-first on the phone and has the same
layout with a drop zone and QR code on the laptop.

### 4.1 Clips screen (home)

- Primary button **Add videos** (`<input type="file" accept="video/*" multiple>`).
- Laptop only: a drag-and-drop zone and a "Connect your phone" card (QR code + URL).
- The clip list shows one row per clip:
  - thumbnail · place · date · duration (kept / original if cut)
  - drag handle (touch and mouse) and delete
  - status while processing: uploading % → analyzing → ready, or an error
  - a hint icon when location or date is missing (see §8, risk R1)
  - **↻ Looks sideways** with **Rotate** / **Keep** when detection suggests a turn (§5.8)
- A banner "N clips look rotated — **Fix all**" applies every open suggestion at once.
- **Sort by date** action: re-applies chronological order after manual drags.
- **Export** button (sticky at the bottom on phones).
- An overflow menu with **Start over**, which asks for confirmation and clears the session.

### 4.2 Clip editor (tap a clip)

- A video player using a lightweight **proxy** of the clip, a filmstrip timeline, and a playhead.
- **Trim handles** at both ends of the timeline, large enough for thumbs.
- **Split at playhead** divides the timeline into segments. Tapping a segment toggles
  **Remove / Restore**. Removed segments are shaded and skipped during playback.
- **Reset** restores the full clip. **Done** returns to the list.
- **⟲ / ⟳** turn the clip 90° and save at once. The preview turns the proxy with CSS;
  the filmstrip is regenerated, and the render applies the turn (§5.8).
- The minimum kept segment is 1.0 s, so crossfades have room. Edits snap to 0.1 s
  granularity; the render is frame-accurate.

### 4.3 Export sheet

- **Input summary**, shown when the clips differ, for example:
  "6 landscape · 3 portrait · 1 square — 8 HDR, 2 SDR — 30 fps ×8, 60 fps ×2".
  When all clips match, it shows a single line such as "All landscape, 4K, 30 fps".
- **Aspect:** 16:9 / 9:16 / 1:1. Default: the orientation with the most total duration.
- **Fill:** Blur (default) / Black bars, for clips that don't match the aspect.
- **Quality:** *Compatible 1080p* (default) / *Original quality*. See §5.7.
- **Title:** optional text field.
- **Render** shows a progress bar with ETA and a **Cancel** button, then **Download**.

## 5. Behaviour details

### 5.1 Supported inputs

- Any file that ffprobe can read with at least one video stream. It is tested against
  iPhone `.mov` (HEVC/H.264, SDR/HDR) and Android-style `.mp4` (H.264/HEVC) with standard
  metadata.
- Rotation (display matrix) is applied automatically.
- Clips without an audio track get silence, so the audio track stays continuous.
- Variable frame rate is normalized to the output frame rate.
- iPhone slow-motion clips (120/240 fps) play at normal speed. The slow-motion
  effect from the Photos app is not reproduced, because speed is a non-goal.

### 5.2 Metadata extraction

From `ffprobe -show_format -show_streams` tags, in order of preference.

**Recording time**

1. `com.apple.quicktime.creationdate`: iPhone, local time **with** UTC offset, for example
   `2026-10-29T14:32:10+0900`.
2. `creation_time` (UTC), converted to the **local time where recorded**, using the
   timezone looked up from GPS (offline, e.g. the `geo-tz` package).
3. `creation_time`, converted using the container's `TZ`.
4. The browser's `File.lastModified`, sent with the upload. This is the least reliable
   source and is used only if nothing else exists.
5. Otherwise there is no date.

**Location**

1. `com.apple.quicktime.location.ISO6709`, iPhone, e.g. `+35.6595+139.7005+040.000/`.
2. `location` / `location-eng`, the standard MP4 `©xyz` tag used by most Android phones.
3. Otherwise there is no location.

**Known quirk:** some Android phones write local time into `creation_time` as if it
were UTC. This can't be detected reliably, so v1 accepts it and documents it.

### 5.3 Place names (reverse geocoding)

- Online lookup via **OpenStreetMap Nominatim**, following its usage policy: at most
  1 request/s, a descriptive `User-Agent`, and cached results.
- Results are cached on disk, keyed by coordinates rounded to about 100 m, so re-exports
  and nearby clips don't trigger new lookups.
- Label: `<locality>, <country>`, where locality is the first available of city → town →
  village → municipality → county → state. Example: "Kyoto, Japan".
- Language: English (`accept-language=en`), changeable via `PLACE_LANGUAGE`.
- If there is no network or the lookup fails, the place is left out. A clip can't fail
  because of the lookup.
- `GEOCODER=off` disables the lookup entirely, for fully offline use.

### 5.4 Overlay

- Position: **bottom-left of the output canvas**, not of the clip, so it's consistent
  with blur fill or bars. The margin is about 4% of the canvas's short side.
- Style: **white text with a subtle drop shadow**, two lines:
  - line 1: place (slightly larger)
  - line 2: date, formatted `29 Oct 2026` (date only)
- Missing fields are omitted: no GPS shows the date only, no date shows the place
  only, and with neither there is no overlay.
- Always on: there is no switch to disable it.
- Timing: shown on the **first kept segment of each clip**, for 4 s (or the segment length
  if shorter), with a 0.3 s fade in and a 0.5 s fade out. It is not repeated after a
  middle cut.
- The date is the clip's local recording date (§5.2).
- Fonts: bundled **Noto Sans** plus **Noto Sans CJK**, so non-Latin place names render.

### 5.5 Ordering

- By default clips are sorted by recording time. Clips without a date go to the end,
  in upload order.
- Dragging sets a manual order. Clips uploaded after that are appended at the end,
  sorted chronologically among themselves. **Sort by date** re-sorts everything.

### 5.6 Editing model

Each clip stores a list of **keep ranges** (`[{start, end}]` in seconds of the source).

- No edits: one range covering the whole clip.
- Trim: moves the first range's start and the last range's end.
- Split: divides a range at the playhead. Remove drops a range, and Restore brings it back.

The renderer sees only an ordered list of segments (clip × keep range). Because
everything is re-encoded to burn in the overlay anyway, cuts are frame-accurate and
need no keyframe snapping.

### 5.7 Output

**Canvas sizes**

| Aspect | Compatible | Original quality |
|---|---|---|
| 16:9 | 1920×1080 | up to 3840×2160 (largest input, capped) |
| 9:16 | 1080×1920 | up to 2160×3840 |
| 1:1 | 1080×1080 | up to 2160×2160 |

**Fill**

- *Blur*: the clip is fitted inside the canvas over a scaled-to-cover, blurred, slightly
  darkened copy of itself.
- *Black bars*: plain letterbox or pillarbox bars.

**Frame rate:** the frame rate with the most total duration among the inputs, snapped
to 24/25/30/50/60 and capped at 60.

**Presets**

| | Compatible 1080p (default) | Original quality |
|---|---|---|
| Video | H.264 High, 8-bit, BT.709 SDR, CRF ~20 | HEVC (`hvc1` tag), 10-bit, CRF ~20 |
| HDR inputs | tone-mapped to SDR | **kept as HDR (HLG)** if every clip is HDR; otherwise all are tone-mapped to SDR |
| Audio | AAC 192 kb/s, 48 kHz stereo | AAC 256 kb/s, 48 kHz stereo |
| Container | MP4, `+faststart` | MP4, `+faststart` |

**Crossfades:** 0.5 s `xfade` (fade) and `acrossfade` between consecutive segments,
including between the title card and the first clip. Each crossfade shortens the total
duration by 0.5 s. Middle cuts within a clip use the same crossfade.

**Loudness:** each clip is measured over its kept parts, and one linear gain is applied
to all of its segments. Target −16 LUFS integrated, −1.5 dBTP. Removing a middle
part of a clip therefore doesn't change that clip's volume much.

**Title card** (only when a title is entered)

- 3 s, white title centered on black.
- A second, smaller line shows the clips' date range (e.g. `12 – 18 Oct 2026`) and is
  omitted if no dates are known.
- Silent audio, no corner overlay. It crossfades into the first clip.

**Filename and location:** `<title or date range or "videos-to-one">_<YYYYMMDD-HHMM>.mp4`,
written to `/data/output/` and offered as a download.

### 5.8 Rotation and sideways suggestions

Some phone clips are recorded with the wrong display matrix (e.g. a landscape scene
filmed as portrait), so the automatic rotation (§5.1) shows them sideways. The phone's
own orientation metadata agrees with the wrong matrix, so it can't catch this.

- **Manual rotation:** each clip stores `rotate` (0/90/180/270, clockwise), applied after
  the display matrix. Rotated clips count in their new orientation for the default
  aspect, the input summary, and the Original-quality canvas.
- **Detection** runs after a clip is ready, one clip at a time, so it never delays editing.
  Six frames are sampled from the SDR proxy at the middle of each sixth of the clip.
  1. **Faces** (UltraFace RFB-320): each frame is turned 0/90/180/270 and counted per
     turn when it has a face with score ≥ 0.9. Faces decide when the top turn has
     ≥ 2 frames and at least twice the count of any other turn.
  2. Otherwise an **orientation CNN** (EfficientNetV2, 4 classes) decides: suggest a turn
     only if its mean probability is ≥ 0.7 and ≥ 4 of 6 frames agree; otherwise none.
- The result is only a suggestion. **Keep** dismisses it; it is never applied silently.
- Models (~82 MB, MIT) are downloaded by `npm run models` and baked into the Docker
  image. Without them, or with `ORIENTATION=off`, detection is skipped and manual
  rotation still works. Clips already in the session when the app starts are checked.

Measured on 45 iPhone clips: about 0.9 s per clip on an M-series Mac; 3 clips flagged,
all genuinely sideways, no false positives.

## 6. Architecture

### 6.1 Stack

TypeScript end to end, as an npm-workspaces monorepo:

```
server/   Node 22 + Fastify: REST + SSE API, session store, job runner, ffmpeg pipeline
web/      React + Vite SPA (dnd-kit for touch drag-and-drop, qrcode for the QR card)
shared/   Types shared by server and web (Session, Clip, KeepRange, ExportOptions, events)
fonts/    Noto Sans, Noto Sans CJK
Dockerfile
```

ffmpeg and ffprobe run as child processes (`spawn`, with `-progress pipe:1` for progress).
The Docker image needs an ffmpeg build with `libx264`, `libx265`, `libfreetype` (drawtext),
and `libzimg` (zscale for HDR tone-mapping). Debian bookworm's ffmpeg package or a
static build both work; this gets verified in the Docker milestone.

### 6.2 Data layout (`/data` volume)

```
/data/session/session.json            the single working session (clips, order, keep ranges)
/data/session/clips/<id>/original.*   uploaded file, untouched
/data/session/clips/<id>/proxy.mp4    720p H.264 SDR, 1 s GOP, for fast seeking in the editor
/data/session/clips/<id>/strip.jpg    filmstrip thumbnails for the timeline (rotated)
/data/session/render/                 temporary intermediates, deleted after render
/data/output/*.mp4                    finished videos (kept by "Start over")
/data/cache/geocode.json              reverse-geocoding cache
```

### 6.3 API sketch

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/session` | Current session state |
| POST | `/api/clips` | Upload one file (multipart, streamed to disk), returns a clip record |
| DELETE | `/api/clips/:id` | Remove a clip |
| PATCH | `/api/clips/:id` | Any of `{segments, rotate, dismissSuggestion: true}`; a rotate regenerates the filmstrip |
| PUT | `/api/order` | Set clip order (`{ids}`), or `{sort: "date"}` |
| POST | `/api/session/reset` | Start over |
| GET | `/api/clips/:id/proxy.mp4`, `/strip.jpg` | Editor media (HTTP range requests supported) |
| POST | `/api/export` | Start a render with `{aspect, fill, preset, title}` |
| POST | `/api/export/cancel` | Cancel the render |
| GET | `/api/export/latest` | Download the last output |
| GET | `/api/events` | SSE: clip status, session changes, render progress |
| GET | `/api/info` | Phone URL for the QR code (from `PUBLIC_HOST`), version |

- Both devices subscribe to `/api/events`, so an upload from the phone appears on the
  laptop immediately. Concurrent edits are last-write-wins, which is fine for a single user.
- The web client uploads files 2 at a time, with per-file progress and per-file retry.
  Uploads aren't resumable within a file, which is acceptable at v1 batch sizes.
- Only one render runs at a time.

### 6.4 Processing pipeline

**On upload:** stream to disk, then run ffprobe and extract metadata (§5.2). After that,
look up the timezone (offline) and place name (cached or online), and generate the proxy
and filmstrip. The clip is marked ready when this finishes; it is then queued for
sideways detection (§5.8).

**On export**

1. **Plan.** Build the ordered list of segments, then compute the canvas, frame rate, HDR
   handling, per-clip loudness gain, and xfade offsets.
2. **Normalize each segment** into a high-quality intermediate file. This step decodes
   with `-ss/-to`, auto-rotates, applies the manual rotation, tone-maps if needed, applies the fps, adds blur fill or
   bars, sets the SAR, draws the overlay text on the clip's first segment, and
   resamples the audio and applies the clip's gain (or adds silence).
3. **Title card**, if a title was entered, is rendered the same way.
4. **Assemble.** Chain `xfade` and `acrossfade` across the intermediates, encode with the
   chosen preset, and write the MP4 with `+faststart`. This final encode uses a hardware
   encoder when the OS has one that passes a test encode at startup: VideoToolbox on
   macOS, NVENC (NVIDIA) or VAAPI (Intel/AMD, `/dev/dri`) on Linux. Otherwise, and if
   the hardware encode fails on the real job, it uses software x264/x265. Intermediates
   are always software x264, so the overlay and fill look the same everywhere.
5. **Clean up** the intermediates and emit the final event with the download link.

Rendering each segment separately gives meaningful progress, keeps each ffmpeg call
simple, and isolates failures. The cost is one extra high-quality generation; for v1
that's acceptable, and it can be revisited if quality suffers.

## 7. Configuration

All configuration is through environment variables. There is no settings UI.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` | Session, outputs, cache |
| `PUBLIC_HOST` | (unset) | LAN IP/hostname used in the QR code |
| `TZ` | `UTC` | Fallback timezone (§5.2) |
| `GEOCODER` | `nominatim` | `nominatim` or `off` |
| `PLACE_LANGUAGE` | `en` | Language for place names |
| `ENCODER` | `auto` | Final encoder: `auto`, `software`, `videotoolbox`, `nvenc` or `vaapi` (§6.4 step 4) |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | VAAPI render node |
| `ORIENTATION` | `on` | `off` skips sideways detection (§5.8) |
| `MODELS_DIR` | `<repo>/models` (`/app/models` in Docker) | ONNX models for detection |

## 8. Risks and spikes

| # | Risk | Mitigation |
|---|---|---|
| **R1** | **iOS Safari's photo picker may re-encode videos and/or strip GPS and the original creation date.** This would break the main feature for the main use case. | **Spike first (M0)**: upload test clips from a real iPhone via Safari, through the Photos picker and through "Choose File" → Files, and record which tags survive and whether the codec changed. **Agreed fallback: the laptop drop zone.** AirDrop the clips to the computer, then drag them in, which keeps the original files and metadata. When a phone upload lacks location or the original date, the clip row shows a hint pointing to this. |
| R2 | Software-only encoding in Docker (no VideoToolbox/GPU on Docker Desktop for Mac): 4K HEVC exports can take several times the video's length. | Compatible 1080p is the default. Show an ETA. Keep the 4K preset clearly labelled as slow. Use a hardware encoder for the final encode when one works (§6.4 step 4): run natively on macOS for VideoToolbox, or pass the GPU into Docker on Linux. Measured on an M4 with 17 min of 1080p iPhone clips, Original quality: 29 min with x265, 7 min with VideoToolbox (file ~25% larger). |
| R3 | HDR edge cases: Dolby Vision metadata is dropped, tone-mapping can look flat, and HDR and SDR clips get mixed. | Use the HLG base layer, apply a single well-tested tone-map chain (zscale + tonemap), and include HDR iPhone fixtures in tests. |
| R4 | Nominatim is unavailable or rate-limited. | 1 req/s queue, on-disk cache, and graceful omission of the place. |
| R5 | iOS pauses uploads when the screen locks or Safari goes to the background. | Per-file retry and a tip to keep the screen on during upload. Clips that already uploaded are kept. |
| R6 | No access protection on the LAN (decided). Anyone on the same Wi-Fi can open the app. | Documented in the README: stop the container when done, and be careful on hotel or café Wi-Fi. |
| R7 | Disk usage: originals, proxies, and intermediates come to about 2× the input size. | Delete intermediates after the render. "Start over" clears the session. |
| R8 | Android metadata varies, and there's no Android test device. | Synthetic fixtures with standard tags (`creation_time`, `location`) and public sample files. |

## 9. Testing

- **Unit:** metadata parsing (ffprobe JSON fixtures for iPhone, Android-style files, and
  files with missing tags), timezone and date resolution, keep-range operations, segment
  planning and xfade offset math, place-label formatting.
- **Filter-graph snapshot tests:** the ffmpeg arguments generated for representative plans.
- **Integration:** generate synthetic clips with ffmpeg (`testsrc2` + `sine`, with metadata
  injected via `-metadata` / `-movflags use_metadata_tags`, portrait and landscape, with
  and without audio), run a full export, and assert duration, resolution, streams, and
  that the output plays.
- **Real-device fixtures:** iPhone sample clips from the maintainer (model and iOS
  version noted). They should cover portrait, landscape, HDR on and off, 60 fps, a
  slow-motion clip, and a clip recorded with Location Services off.
- **Manual:** the end-to-end flow on iPhone Safari over Wi-Fi and in a desktop browser.

## 10. Milestones

| | Milestone | Done when |
|---|---|---|
| **M0** | iOS upload spike | `docs/spike-ios-upload.md` records what metadata survives each upload path on a real iPhone. |
| M1 | Ingest | Upload, probe, metadata, timezone, geocoding, proxy and filmstrip, session store, and SSE all work through the API. |
| M2 | Render | Segment normalization, overlay, loudness, crossfades, title card, both presets, progress, and cancel all work through the API. |
| M3 | UI | Clips screen, uploads, drag reorder, clip editor, export sheet, download, laptop drop zone, and QR card all work. |
| M4 | Packaging | Dockerfile with ffmpeg and fonts, published image, and a README with run commands for macOS, Linux, and Windows. |

## 11. Resolved details (defaults accepted 2026-10-29)

| # | Question | Decision |
|---|---|---|
| Q1 | Language of place names: English or the local language (e.g. 京都市 vs Kyoto)? | English, changeable via `PLACE_LANGUAGE` |
| Q2 | How precise the place should be: city or neighbourhood / landmark? | `City, Country` |
| Q3 | Date format? | `29 Oct 2026` |
| Q4 | Middle cuts within a clip: crossfade (like between clips) or hard cut? | Crossfade, for consistency |
| Q5 | Title card background: black or a blurred first frame? Show the date range under the title? | Black; yes, show the date range |
| Q6 | Overlay on/off switch at export, or always on? | Always on |
| Q7 | Original quality with all-HDR inputs: keep HDR, or always SDR for simplicity? | Keep HLG HDR when every clip is HDR |
| Q8 | Output filename scheme? | `<title or date range>_<YYYYMMDD-HHMM>.mp4` |

## 12. Decision log (from the 2026-10-29 Q&A)

| Topic | Decision |
|---|---|
| Audience and deployment | Just me: a local app on my computer, reached by the phone over Wi-Fi |
| Processing | On the computer (server side) with ffmpeg |
| Upload path | Mobile web browser (+ laptop drop zone as the iOS metadata fallback) |
| Stack | TypeScript end to end |
| Packaging | Docker |
| Ordering | By recording time, plus drag to reorder |
| Mixed orientation | Chosen per export (16:9 / 9:16 / 1:1, blur or bars), with an input summary when inputs differ |
| Quality | Preset dropdown: Compatible 1080p (default) / Original quality |
| Location label | Place name via online lookup (Nominatim) |
| Time label | Date only, in local time where recorded |
| Overlay timing | First few seconds of each clip; missing fields omitted |
| Overlay look | Bottom-left, white text with a shadow, not configurable |
| Cutting | Trim start/end + split and remove middle parts |
| Edit device | Both phone and laptop (responsive, shared live session) |
| Transitions | Always a short crossfade (0.5 s) |
| Audio | Original + loudness normalization |
| Output delivery | Download on the current device, with a copy in the output folder |
| Persistence | One session at a time |
| Batch size | Small: 5–20 clips, under 10 minutes |
| LAN protection | None |
| Preview | Per-clip only |
| v1 extras | Title card only (music and photos maybe later) |
| Out of scope | Filters, speed, crop |
| Rotation (2026-10-29) | Manual 90° turns per clip, plus suggestions from a face detector with an orientation-CNN fallback; never applied automatically |
| Test devices | iPhone (Android via synthetic fixtures) |
