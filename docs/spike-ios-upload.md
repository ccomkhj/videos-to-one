# Spike M0: what survives an iPhone upload?

> Status: **done** (2026-10-29). Paths A and C tested on an iPhone 16e; path B skipped
> (assumed to behave like C, since Files keeps the original). See the runs below.
> Risk R1 in [SPEC.md](../SPEC.md#8-risks-and-spikes).

## Why

iOS Safari's photo picker may re-encode videos and/or strip GPS and the original creation
date. If it does, the main feature (place + date overlay) breaks for the main use case. The
agreed fallback is the laptop drop zone (AirDrop → drag in).

## Setup

- iPhone model: iPhone 16e  iOS version: 26.6
- Computer running videos-to-one (`docker run …`, see README), phone on the same Wi-Fi.
- Record 4 test clips with Location Services **on**:
  1. landscape, HDR on (default camera settings)
  2. portrait, HDR off (Settings → Camera → Record Video → HDR Video off)
  3. 4K 60 fps
  4. slow-motion
- And one clip with Location Services **off** for Camera.
- Note each clip's real date/time and place.

## Procedure

For each clip and each upload path:

1. Upload via the app.
2. On the computer, inspect the stored file:
   `ffprobe -v error -show_format -show_streams <DATA_DIR>/session/clips/<id>/original.*`
3. Compare with the original (AirDrop it to the computer and run the same `ffprobe`).

Upload paths:

- **A** Safari → Add videos → **Photo Library**
- **B** Safari → Add videos → **Choose File** → Files app (after "Save to Files" from Photos)
- **C** AirDrop to the computer → drag into the laptop page (expected to be lossless)

## Results

| Clip | Path | Codec same? | Resolution/fps same? | `com.apple.quicktime.creationdate` | `…location.ISO6709` | `creation_time` | Overlay shown in app |
|---|---|---|---|---|---|---|---|
| 1 landscape HDR | A | | | | | | |
| 1 landscape HDR | B | | | | | | |
| 1 landscape HDR | C | | | | | | |
| 2 portrait SDR | A | | | | | | |
| … | | | | | | | |

Also note: does the picker show a "Compressing…" step? Is "Most Compatible" vs "High
Efficiency" (Settings → Camera → Formats) relevant? Does Settings → Photos → "Transfer to
Mac or PC: Keep Originals" change anything?

## Run 1 — 2026-10-29, path A (Photo Library), 45 real trip clips

iPhone 16e, iOS 26.6. Clips were filmed 26–29 Oct 2026 in Hamburg, Gdańsk and Sopot and
uploaded through Safari → Photo Library to a local dev server (confirmed by the tester;
the picker also lower-cases the extension to `.mov`).

What arrived, on all 45 of 45 clips:

| Field | Result |
|---|---|
| `com.apple.quicktime.creationdate` | **kept**, with the correct UTC offset (`+0100`, after the 25 Oct DST change) |
| `com.apple.quicktime.location.ISO6709` | **kept** (plus `location.accuracy.horizontal`) |
| make / model / software | kept |
| format and stream `creation_time` | **rewritten to the upload time** (e.g. `18:14Z` on 29 Oct for a clip shot at 11:53 local) |
| Video | H.264 High, 1920×1080 stored (rotation in the display matrix), ~15 Mbps, SDR bt709, 24/30 fps and variable rate |
| Audio | AAC stereo plus an Apple APAC (spatial audio) track |
| Other streams | 6 × `mebx` timed-metadata tracks |
| App result | every clip got `recordedAt.source = quicktime` and a place name; no hints shown |

Reading:

- Path A **keeps the metadata the overlay needs**, so R1's worst case (GPS/date stripped)
  did not happen on this device/iOS.
- The file is **rewritten** (new `creation_time` on every track), so it isn't a byte-for-byte
  copy, and Run 2 shows the video is **re-encoded**: HEVC 10-bit HDR → H.264 8-bit SDR.
- `creation_time` must never be preferred over the QuickTime tag for iPhone uploads, which
  is already the order in SPEC §5.2.
- The render takes `0:a:0` (AAC); the APAC track is ignored. Fine.

## Run 2 — 2026-10-29, path C (from the Mac, drag in), 1 clip

Same iPhone 16e, clip IMG_0187 filmed 1 Apr 2026 in Hamburg (iOS 26.2 at the time), dragged
into the laptop page as the original `.MOV`. It's a different clip from Run 1, so the
comparison is per device, not per file.

| Field | Path C (original) | Path A (Run 1) |
|---|---|---|
| Video | **HEVC Main 10, HLG (`arib-std-b67`), bt2020, Dolby Vision config**, ~8.3 Mbps | H.264 High 8-bit, SDR bt709, ~15 Mbps |
| `creationdate` / `ISO6709` | kept | kept |
| `creation_time` | recording time (09:39Z, matches `creationdate` 11:39+0200) | upload time |
| Audio / `mebx` tracks | AAC + APAC, 6 × `mebx` | same |
| App result | `source = quicktime`, place "Hamburg, Germany", `hdr = true` | `source = quicktime`, place found, `hdr = false` |

Reading: this phone records HEVC HLG HDR by default, so path A's H.264 SDR at about twice the
bitrate is iOS transcoding (and tone-mapping) on export, not the camera setting.

## Conclusion

- **Metadata (R1): no problem on path A.** Place and date survive the Photos picker, so the
  phone flow works for the main feature as designed.
- **Quality: path A loses HDR and adds a generation of compression.** The *Original quality*
  preset can only keep HDR for clips that came in through path B/C. For *Compatible 1080p*
  (the default) the difference is minor.
- Which path to recommend in the UI: keep the phone (path A) as the main flow. Keep the
  AirDrop → drag-in hint for clips without place/date, and mention it as the way to keep
  HDR/original quality (README tip already says this for metadata; worth a line on quality).
- Does the clip-row hint need different wording? No.
- Anything to change in SPEC §5.2 (metadata preference order)? No. QuickTime tags come first
  and `creation_time` is unreliable on path A, as expected.
- Path B not tested.
