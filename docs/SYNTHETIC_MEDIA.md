# Synthetic media test guide

These fixtures exercise TikTok Optimizer without copyrighted footage. They are intentionally tiny and visually simple so that parsing, cadence, colour-tag, remux, cancellation, and verification behaviour can be tested quickly.

They are not subjective quality benchmarks. In particular, an HDR-tagged test pattern is not camera-quality HDR, and a synthetic 120 FPS source says nothing about the motion quality of a real camera or game capture.

## Prerequisites

Run from the repository root with working FFmpeg/FFprobe binaries:

```text
ffmpeg -version
ffprobe -version
npm run diagnostics
```

Create an ignored workspace:

PowerShell:

```powershell
New-Item -ItemType Directory -Force work/synthetic-media | Out-Null
```

macOS/Linux:

```bash
mkdir -p work/synthetic-media
```

All commands below overwrite only named fixtures in `work/synthetic-media`.

## 1. Compatible 30 FPS CFR MP4

```text
ffmpeg -hide_banner -y -f lavfi -i "testsrc2=size=360x640:rate=30:duration=2" -f lavfi -i "sine=frequency=1000:sample_rate=48000:duration=2" -map 0:v:0 -map 1:a:0 -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -profile:v high -c:a aac -b:a 96k -ar 48000 -ac 2 -shortest -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart "work/synthetic-media/cfr-30.mp4"
```

Expected analysis: H.264 High, `yuv420p`, AAC 48 kHz, constant 30 FPS, BT.709 tags, progressive scan, portrait display, no rotation, and web optimised. It should be eligible for remux when all packet checks pass.

## 2. Compatible 60 FPS CFR MP4

```text
ffmpeg -hide_banner -y -f lavfi -i "testsrc2=size=360x640:rate=60:duration=2" -f lavfi -i "sine=frequency=750:sample_rate=48000:duration=2" -map 0:v:0 -map 1:a:0 -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -profile:v high -c:a aac -b:a 96k -ar 48000 -ac 2 -shortest -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart "work/synthetic-media/cfr-60.mp4"
```

Expected analysis: constant 60 FPS and otherwise similar to the 30 FPS fixture. The actual 60 FPS export should not need source-moment synthesis; it must not enlarge this low-resolution fixture.

## 3. Measured native 120 FPS source

```text
ffmpeg -hide_banner -y -f lavfi -i "testsrc2=size=360x640:rate=120:duration=1" -f lavfi -i "sine=frequency=500:sample_rate=48000:duration=1" -map 0:v:0 -map 1:a:0 -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p -profile:v high -c:a aac -b:a 96k -ar 48000 -ac 2 -shortest -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart "work/synthetic-media/native-120.mp4"
```

Expected analysis: measured constant 120 FPS. The 120 FPS master should select **Native** and avoid duplication/optical flow for this source. This synthetic encode contains 120 distinct generated test-pattern frames per second; it is not an FPS metadata edit.

## 4. Variable-frame-rate fixture

This starts from a 60 FPS clock, keeps alternating frames in the first second, and keeps every frame in the second second while preserving timestamps:

```text
ffmpeg -hide_banner -y -f lavfi -i "testsrc2=size=360x640:rate=60:duration=2" -vf "select='if(lt(t,1),not(mod(n,2)),1)',setpts=PTS-STARTPTS" -fps_mode vfr -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -an -movflags +faststart "work/synthetic-media/vfr.mp4"
```

Expected analysis: variable cadence or a clear nominal/measured inconsistency. Lossless Remux should be blocked because remuxing cannot turn VFR into CFR; the 60 FPS export should perform an honest CFR conversion.

Inspect the packet durations directly if needed:

```text
ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,duration_time -of csv=p=0 "work/synthetic-media/vfr.mp4"
```

## 5. Non-fast-start MP4

Repackage the CFR source without `+faststart`. Ordinary MP4 writing places `moov` after the media payload:

```text
ffmpeg -hide_banner -y -i "work/synthetic-media/cfr-30.mp4" -map 0:v:0 -map 0:a:0 -c copy "work/synthetic-media/moov-last.mp4"
```

Expected analysis: not web optimised. Lossless Remux should be eligible and its verified output should place `moov` before `mdat` without changing the encoded streams.

## 6. Rotation-metadata fixture

```text
ffmpeg -hide_banner -y -i "work/synthetic-media/cfr-30.mp4" -map 0 -c copy -metadata:s:v:0 rotate=90 "work/synthetic-media/rotated-90.mp4"
```

Expected analysis on FFmpeg builds that write a display matrix for `rotate`: a 90-degree rotation warning. Lossless Remux should be blocked because a clean orientation requires rendering the transform during re-encoding. Encoded 60/120 outputs should produce zero rotation metadata with the intended display orientation.

If the local FFmpeg build ignores the rotation tag during stream copy, verify with:

```text
ffprobe -v error -select_streams v:0 -show_entries stream_tags=rotate:stream_side_data=rotation -of json "work/synthetic-media/rotated-90.mp4"
```

Treat the fixture as unavailable when neither field is present.

## 7. HDR-tagged 10-bit HEVC fixture

This is a colour-path test, not graded HDR imagery:

```text
ffmpeg -hide_banner -y -f lavfi -i "testsrc2=size=360x640:rate=30:duration=1" -vf format=yuv420p10le -c:v libx265 -preset ultrafast -crf 30 -pix_fmt yuv420p10le -tag:v hvc1 -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc -an -movflags +faststart "work/synthetic-media/hdr-tagged-hevc.mp4"
```

Expected analysis: HEVC Main 10/10-bit with BT.2020/PQ metadata and an HDR warning. The 60 FPS export should require usable `zscale`/`tonemap` filters and disclose BT.709 SDR tone mapping. The 120 FPS master may preserve supported 10-bit HDR through HEVC. H.264 must not be described as preserving this HDR source.

## 8. Low-resolution/low-bitrate warning fixture

```text
ffmpeg -hide_banner -y -f lavfi -i "testsrc2=size=180x320:rate=30:duration=2" -c:v libx264 -preset ultrafast -b:v 120k -maxrate 120k -bufsize 240k -pix_fmt yuv420p -an -movflags +faststart "work/synthetic-media/low-resolution-low-bitrate.mp4"
```

Expected analysis: low-resolution and/or unusually low-bitrate warnings. The optimizer should retain the smaller source dimensions rather than enlarging them because an upscale cannot recover absent detail.

## 9. Unusual filename

PowerShell:

```powershell
Copy-Item -LiteralPath "work/synthetic-media/cfr-30.mp4" -Destination "work/synthetic-media/odd [brackets] # café clip.mp4"
```

macOS/Linux:

```bash
cp "work/synthetic-media/cfr-30.mp4" "work/synthetic-media/odd [brackets] # café clip.mp4"
```

Expected behaviour: upload, probe, encode/remux, preview, and download succeed without treating the display name as a filesystem path or shell text. Storage uses generated identifiers.

## Verification checklist in the UI

For each fixture that the local FFmpeg build can create:

1. Upload through drag-and-drop and through the file picker.
2. Compare the analysis fields with the expectations above.
3. Confirm warnings are explanatory and do not promise a platform outcome.
4. Verify Lossless Remux is offered only for compatible CFR media.
5. Process a short actual-60 export; confirm it does not enlarge a smaller source and is H.264 High, `yuv420p`, AAC 48 kHz, CFR60, BT.709, progressive, zero-rotation, and web optimised.
6. Process `native-120.mp4` with Native 120. Process a lower-FPS source separately with Duplicate and, when available, Optical flow; confirm the completion disclosures distinguish all three.
7. Cancel one processing job and confirm it reaches Cancelled, publishes no export, and returns temporary storage to its previous level after cleanup.
8. Delete an individual export and verify its authenticated download URL no longer serves it.
9. Use **Delete all files and history** only after these fixtures are expendable; confirm the owner/settings remain but sources, exports, temp files, and history are gone.

## Automated checks

The normal suite uses deterministic parsers/models and synthetic records:

```text
npm test
```

When FFmpeg and FFprobe are installed, run the real-media integration file:

```text
npm run test:media
```

Also run the release gates:

```text
npm run lint
npm run typecheck
npm run build
```

If an integration test is skipped because an encoder/filter is not present, Diagnostics should report the same unavailable capability. A missing optional hardware encoder is not a test failure when CPU fallback is available; a missing FFmpeg/FFprobe installation is an unmet runtime prerequisite.

## Cleanup

The `work/` directory is Git-ignored. After confirming the path, remove only this fixture directory.

PowerShell:

```powershell
Remove-Item -LiteralPath "work/synthetic-media" -Recurse -Force
```

macOS/Linux:

```bash
rm -rf -- "work/synthetic-media"
```
