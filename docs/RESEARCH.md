# Research: standards-compliant TikTok video preparation

Last reviewed: 21 July 2026

## Scope and research boundaries

This note records the public research used to design TikTok Optimizer's media pipeline. It examines the ideas publicly associated with the **Haze Method** or **Haze TikTok Quality Optimizer**, then checks those ideas against FFmpeg documentation, documented QuickTime/ISO Base Media File Format behaviour, W3C media requirements, TikTok's public developer documentation, and published research.

Only publicly accessible pages and documents were consulted. No private Haze service, account, endpoint, repository, or other restricted system was accessed or probed. No proprietary source code, product text, branding, interface, visual design, or implementation was copied. The application is an original implementation based on FFmpeg, FFprobe, and documented media-container behaviour.

This research is not an endorsement of Haze and does not attempt to reproduce its proprietary mechanisms. In particular, TikTok Optimizer does not fabricate media samples, falsify frame rates, exploit parser behaviour, or claim to bypass TikTok's processing.

## Executive conclusion

The public Haze descriptions combine two very different categories of ideas:

1. **Ordinary media-engineering practices** such as stream-copy remuxing, MP4 fast-start, compatible codecs, consistent timestamps, and CFR conversion. These are useful when applied conservatively and validated after processing.
2. **Unverified platform-bypass claims** involving fake sample entries, metadata-only frame-rate changes, special "quality" signalling, and predictions that TikTok will skip recompression. These claims are not supported by public TikTok documentation or by the MP4 specifications reviewed here and are rejected by this project.

Fast-start can improve progressive playback. Remuxing can avoid an unnecessary lossy encode. Correct timing and colour metadata can prevent real playback problems. None of those operations can create genuine visual detail, create native high-frame-rate motion, control TikTok distribution, or guarantee that TikTok will preserve an uploaded stream.

## What Haze publicly describes

The public [Haze optimizer page](https://hazeis.me/tiktok60) describes a pipeline that begins with an FFmpeg fast-start remux and then modifies MP4 sample and chunk tables. It claims that inserted dummy samples and altered offsets can influence a platform's ingestion decision. The [Haze portfolio](https://hazeis.me/) separately refers to edit-list patching and "quality" flag optimisation. Its [Chrome Web Store listing](https://chromewebstore.google.com/detail/haze-video-quality-optimi/gedohbknhnnjlamppdffclmbmeifdaco) advertises local processing and resolutions and frame rates up to 4K/120 FPS.

Those are vendor descriptions, not independently established facts about TikTok. No public TikTok specification reviewed for this project documents a sample-count trick, an "already optimised" MP4 flag, or an instruction for bypassing transcoding. The public pages also do not establish that a 120 FPS input will be delivered by TikTok at 120 FPS.

The current [Haze platform](https://hazemethod.xyz/) warns users about VFR and unsupported encodings and recommends creating a web-optimised CFR file when playback is laggy. That advice is consistent with normal compatibility engineering. The same site labels some 64-bit MP4 structures unsupported by its browser patcher; that is a limitation of that implementation, not evidence that 64-bit MP4 offsets are invalid. Apple's [`stco`/`co64` documentation](https://developer.apple.com/documentation/quicktime-file-format/chunk_offset_atom) explicitly defines the 64-bit chunk-offset form for large files.

### Assessment of the public claims

| Publicly described idea | Standards-based assessment | Decision in TikTok Optimizer |
| --- | --- | --- |
| FFmpeg stream-copy remux | A documented way to repackage compatible encoded packets without decoding and encoding them again. | Accepted when probe and validation checks pass. |
| MP4 fast-start | A documented reordering pass that places the movie index near the start for progressive playback. | Accepted as web/container optimisation. |
| CFR preparation for troublesome VFR sources | A real compatibility conversion, but it requires honest frame timing and normally a video encode. | Accepted as an explicit re-encode mode. |
| Editing `elst` to produce special smoothness | Edit lists map movie time to media time; they do not create source frames or a hardware-quality mode. | Automatic muxer-safe normalisation only; custom binary patching rejected. |
| Inserting fake entries in `stsz`, `stsc`, `stco`, or `co64` | Sample tables are references to real encoded samples and byte ranges. Fabricated entries can make the structure inconsistent or point decoders at invalid data. | Rejected. |
| Changing metadata to advertise a higher FPS | A label cannot create images between source frames. FFmpeg warns that mismatched stream-copy rate signalling may produce invalid output. | Rejected. |
| Making TikTok believe a file has already been processed | No corresponding public TikTok contract or independently verified mechanism was found. | Rejected. |
| Guaranteed original-quality, no-compression, or account-safety results | Upload processing and moderation remain under TikTok's control. | Rejected; the UI states this limitation plainly. |

## MP4 structure and fast-start

MP4 is based on a hierarchy of boxes, also commonly called atoms. A typical non-fragmented file contains:

- `ftyp`, which declares the file's brands and broad compatibility;
- `moov`, which holds track descriptions, timing, codec configuration, and indexes; and
- one or more `mdat` boxes containing encoded media bytes.

Apple's [`moov` documentation](https://developer.apple.com/documentation/quicktime-file-format/movie_atoms) explains that movie metadata references media samples rather than containing the samples themselves. Apple's [`mdat` documentation](https://developer.apple.com/documentation/quicktime-file-format/movie_data_atom) explains that the bytes in `mdat` are interpreted through the metadata in `moov`.

For a conventional MP4 written in one pass, `moov` is often completed at the end because the muxer does not know all sample locations and durations until encoding finishes. FFmpeg's [`movflags=+faststart` documentation](https://ffmpeg.org/ffmpeg-formats.html) describes a second pass that moves the index to the beginning. A client can then read the track index before downloading the entire media payload, improving progressive-start behaviour.

Fast-start does **not** modify decoded pixels, increase bitrate, sharpen detail, add frames, or instruct TikTok to preserve the stream. It is lossless container maintenance. Because chunk offsets are absolute file offsets, moving or changing the size of `moov` requires every affected `stco` or `co64` entry to be recalculated correctly.

## Sample tables, timing, and edit lists

The sample table under `moov/trak/mdia/minf/stbl` is a connected index. Important boxes include:

- `stsd`: describes how samples are decoded, including the codec sample entry and codec configuration;
- `stts`: maps decode time to sample number using runs of sample counts and durations;
- `ctts`: records composition offsets when presentation order differs from decode order, as with B-frames;
- `stsz`: records the encoded byte size of every sample, or a common size where applicable;
- `stsc`: maps samples to chunks;
- `stco` or `co64`: records the file offset of each chunk; and
- `stss`: identifies genuine sync samples or random-access/keyframe points.

Apple's [sample lookup walkthrough](https://developer.apple.com/documentation/quicktime-file-format/using_sample_atoms) shows how a reader combines timing, sample-to-chunk, chunk-offset, and sample-size tables to find a frame. The [`stts` reference](https://developer.apple.com/documentation/quicktime-file-format/time-to-sample_atom) documents the time-to-sample mapping, and the [`stss` reference](https://developer.apple.com/documentation/quicktime-file-format/sync_sample_atom) documents actual random-access samples.

These tables must agree with one another and with the encoded byte ranges in `mdat`. Adding a nominal sample count without adding a valid codec access unit, correct duration, size, chunk mapping, offset, and dependency information does not add a playable frame. The [W3C ISO BMFF byte-stream note](https://www.w3.org/TR/mse-byte-stream-format-isobmff/) requires media data to contain all referenced samples and defines malformed or incomplete references as an append error in its processing model.

`edts/elst` is outside the sample table and maps the movie timeline to portions of a track's media timeline. It can express a leading empty edit, a trim, a repeat, or a playback-rate mapping. Apple's [edit-list examples](https://developer.apple.com/documentation/quicktime-file-format/playing_with_edit_lists) demonstrate those timeline effects. An edit list is therefore important for valid timing and audio encoder delay, but it is not an image-quality flag and cannot create native motion samples.

## Constant and variable frame rate

Frame rate is a consequence of frame timestamps and durations, not just a displayed number:

- In a CFR stream, presentation intervals are consistently spaced, subject to the rational time base and normal timestamp rounding.
- In a VFR stream, frame intervals vary. VFR is valid media, but some upload and playback paths are more reliable with CFR.

FFprobe's `r_frame_rate` and `avg_frame_rate` values are useful signals but are not, by themselves, proof of CFR. A robust analyser should inspect packet or frame PTS values and durations, account for the time base, and flag material disagreement between nominal rates, average rate, frame count, and observed timestamps. In an MP4, multiple meaningful duration runs in `stts` are another VFR signal.

FFmpeg's [`fps` filter](https://ffmpeg.org/ffmpeg-filters.html) converts to a requested CFR by dropping or duplicating decoded frames as necessary. Its interpolation filters can synthesize intermediate frames. Both are honest pixel-domain operations and require video encoding. Duplication increases temporal sampling but not unique motion information; interpolation creates estimated frames and can introduce artifacts around occlusion, fast cuts, fine patterns, and motion blur.

FFmpeg's [`-r` and `-fps_mode` documentation](https://ffmpeg.org/ffmpeg.html) is particularly important: CFR encoding may duplicate or drop frames, while applying a rate during stream copy merely signals a rate to the muxer and may create an invalid file if it conflicts with packet timestamps. TikTok Optimizer therefore never uses metadata-only rate inflation. A 120 FPS output derived from a lower-rate source is labelled either **duplicated** or **interpolated**, never native.

## Keyframes and GOP structure

Keyframes are properties of the encoded bitstream. In inter-frame codecs, a real random-access point must be independently decodable according to the codec's rules. The MP4 `stss` table identifies those existing points; changing the table cannot turn a dependent P- or B-frame into an IDR frame.

Reasonable GOP lengths can improve seeking, decoder recovery, and segmentation. Creating a requested keyframe cadence requires re-encoding with validated encoder options. A stream-copy remux may preserve the existing keyframes and rebuild an accurate index, but it cannot create new ones. TikTok Optimizer consequently treats keyframe placement as an encode setting rather than a metadata patch.

## Stream-copy benefits and limitations

FFmpeg's [transcoding and stream-copy documentation](https://ffmpeg.org/ffmpeg.html) states that stream copy passes selected encoded packets to a new muxer without decoding and encoding them. It is fast and avoids generational image or audio loss. It is the right operation when the elementary streams are already compatible and only the container needs safe maintenance.

Stream copy cannot perform operations that need decoded frames or samples, including:

- scaling or cropping;
- changing pixel format or scan type;
- changing real frame cadence;
- motion interpolation;
- denoising, debanding, sharpening, or colour correction;
- HDR-to-SDR tone mapping;
- creating a different keyframe cadence; or
- audio resampling, mixing, or loudness normalisation.

It also cannot make an unsupported codec, profile, level, pixel format, audio format, or timing pattern universally compatible merely by placing it in MP4. FFmpeg notes that stream copy can fail when information required by the target container is unavailable. TikTok Optimizer offers lossless remux only after checking the source streams, timing, rotation, colour description, durations, target-container support, and file structure. The remuxed result is probed and decode-tested before it is marked complete.

"Lossless remux" means no lossy media re-encoding. It does not mean that every byte of the whole file remains identical: the container headers, indexes, interleaving, metadata, and potentially codec framing are rebuilt by the muxer.

## Colour metadata and HDR

Correct colour handling requires both correct pixel values and correct signalling. Apple's [`colr` documentation](https://developer.apple.com/documentation/quicktime-file-format/color_parameter_atom) describes the primaries, transfer characteristic, and matrix identifiers used to interpret stored image values. Related information may also be present in codec-level VUI or HDR metadata.

Safe behaviour is to preserve known, internally consistent source colour information during a remux and to carry the intended output tags during an encode. Blindly stripping every metadata structure can remove information needed for correct display. Conversely, assigning a BT.709 label to BT.2020/PQ pixels does not convert them; it misdescribes them. FFmpeg's [`colorspace` filter documentation](https://ffmpeg.org/ffmpeg-filters.html) distinguishes conversion from signalling and requires known input properties for a correct transform.

HDR-to-SDR requires an explicit colour transform and tone-mapping policy, followed by encoding and correct SDR tags. It cannot be accomplished by deleting HDR tags or relabelling the stream. Conservative defaults should preserve highlights, shadow detail, neutral colour, and skin tones rather than adding excessive saturation or contrast.

## Why metadata modification can cause lag or failure

Metadata is operational data for a media parser, not harmless decoration. Unsafe modifications can cause:

- chunk offsets that point into the wrong byte range after `moov` changes size;
- sample sizes or counts that do not match the encoded payload;
- a sample-to-chunk map that disagrees with offsets or sizes;
- timing tables with non-monotonic, missing, overlapping, or implausible timestamps;
- edit lists that shift video relative to audio or expose encoder-delay samples;
- sync-sample entries that mark dependent frames as seek points;
- composition offsets that present B-frames at the wrong time;
- codec configuration that disagrees with the actual bitstream;
- lost or contradictory rotation and colour information; and
- audio and video timelines with materially different end times.

Different parsers tolerate different defects. A desktop software decoder may conceal a malformed table that a mobile hardware decoder, browser, or upload validator rejects. Symptoms can include failed upload, a black first frame, frozen or uneven motion, long seek delay, decoder stalls, truncated playback, colour shifts, and A/V drift. For this reason, TikTok Optimizer delegates MP4 rewriting to FFmpeg's muxer, never injects invented samples, and validates the completed output rather than trusting a successful process exit alone.

## TikTok's public compatibility baseline

TikTok's current [Content Posting API Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide) gives the clearest public first-party compatibility baseline available during this research. For that API it lists:

- MP4 as the recommended container, with MOV and WebM also accepted;
- H.264 as the recommended video codec, with H.265, VP8, and VP9 also listed;
- a frame-rate range from 23 through 60 FPS;
- a minimum of 360 pixels and maximum of 4096 pixels on each picture dimension; and
- a maximum file size of 4 GB.

Those limits describe the Content Posting API and should not be presented as an exhaustive contract for every version of TikTok's consumer applications. Nevertheless, the documented 60 FPS ceiling is strong reason not to describe a 120 FPS master as a safe TikTok upload. TikTok Optimizer's 120 FPS mode is an archival/editing master, and its interface warns that TikTok may reduce its frame rate or resolution.

The public API documentation describes an upload entering TikTok's posting process and exposes failures for invalid formats, picture sizes, and frame rates, but it does not promise elementary-stream passthrough or document a way to disable transcoding. Therefore no local optimiser can truthfully guarantee that TikTok will preserve a resolution, bitrate, frame cadence, codec, or colour rendition.

### Private-first versus public playback

TikTok's public [post-status documentation](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status) describes asynchronous post processing and its posting API supports per-post visibility, but it does not document a private-versus-public encoder setting or a quality entitlement for private posts. Multiple community reports describe the same observable symptom—a sharp private preview followed by a lower-resolution or lower-frame-rate public rendition ([example one](https://www.reddit.com/r/Tiktokhelp/comments/169pfic), [example two](https://www.reddit.com/r/Tiktokhelp/comments/1efb6fl))—but these reports cannot establish whether the cause is a new transcode, completion of a public delivery ladder, adaptive-bitrate selection, caching, device settings, or another platform decision.

The application therefore treats the symptom as credible and the cause as unverified. It recommends source-matched 30/60 FPS, controlled 1080p downscaling for larger sources, zero-based CFR timestamps, closed two-second GOPs, H.264 High/yuv420p, BT.709 limited range, AAC-LC, and ordinary non-fragmented fast-start MP4. These choices minimise avoidable conversion work; they do not bypass TikTok processing. If a creator observes the problem, the repeatable test is direct-public versus private-then-public using the same original, clip types and waiting interval, assessed after processing from another account/device on a strong connection.

## Evidence and uncertainty around TikTok recompression

There is credible evidence that TikTok transcodes uploaded media, but exact output is an evolving platform decision:

- Xu et al.'s research paper, [*Transcoded Video Restoration by Temporal Spatial Auxiliary Network*](https://arxiv.org/abs/2112.07948), discusses TikTok among video services whose delivered media has passed through device, editing, and server encoding stages.
- A 2025 [University of Colorado Denver thesis](https://artsandmedia.ucdenver.edu/docs/librariesprovider27/alma-mater/waddell_thesis_fall2025.pdf) compared native files with 90 TikTok-processed exports produced across three phones and several controlled scene types. Every tested derivative had changed encoding characteristics, and outcomes varied by device, including changes to bitrate, resolution, frame rate, codec/GOP structure, audio, and metadata.

The thesis is a bounded experiment, not a universal TikTok specification. It covered particular devices, app/server versions, private posts, and a particular download path. Platform behaviour can vary by region, account, source complexity, upload route, device, network, application version, and later server changes. The correct product statement is therefore that TikTok **may recompress, downscale, or reduce frame rate**, not that one fixed transform always occurs.

Likewise, no processing preset can guarantee 4K or 120 FPS playback, prevent recompression, preserve a particular bitrate, prevent reduced distribution, or protect an account from moderation. Video preparation and recommendation/moderation are separate systems.

## Adopted and rejected engineering policy

TikTok Optimizer adopts the following ideas:

- analyse actual media with FFprobe rather than trusting extensions;
- prefer compatible H.264/AAC MP4 with honest CFR timing for the safest export;
- use FFmpeg's muxer and `+faststart` for ordinary web-optimised MP4 output;
- remux only when the existing streams already meet the selected target;
- re-encode when scaling, frame-cadence conversion, pixel-format conversion, tone mapping, enhancement, audio processing, or GOP control is required;
- preserve or deliberately convert colour information;
- distinguish native, duplicated, and interpolated frames;
- verify timestamps, durations, structure, and decodability after every job; and
- describe TikTok outcomes as uncertain and outside the application's control.

The project explicitly rejects:

- fake sample or frame injection;
- false frame-rate, resolution, bitrate, codec, or colour claims;
- binary patches intended to confuse upload parsers;
- exploitation of undocumented TikTok behaviour;
- invented "already processed" or quality flags;
- automatic TikTok login, upload, scraping, or account interaction;
- engagement or recommendation manipulation; and
- promises of zero compression, undetectable uploads, reach improvement, or protection from shadow bans and account restrictions.

The resulting pipeline is intentionally conventional: create internally consistent, standards-compliant files; preserve source quality where possible; disclose every material transformation; and leave upload, transcoding, distribution, and moderation decisions to TikTok.
