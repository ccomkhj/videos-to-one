# Spike M0: what survives an iPhone upload?

> Status: **to do on a real iPhone.** This file is the checklist; fill in the tables.
> Risk R1 in [SPEC.md](../SPEC.md#8-risks-and-spikes).

## Why

iOS Safari's photo picker may re-encode videos and/or strip GPS and the original creation
date. If it does, the main feature (place + date overlay) breaks for the main use case. The
agreed fallback is the laptop drop zone (AirDrop → drag in).

## Setup

- iPhone model: ______  iOS version: ______
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

## Conclusion

- Which path to recommend in the UI:
- Does the clip-row hint need different wording?
- Anything to change in SPEC §5.2 (metadata preference order)?
