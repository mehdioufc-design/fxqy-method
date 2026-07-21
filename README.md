# FXQY Method

## Public accounts and feedback

The current web version supports public signup and login. The first person to sign up becomes the administrator; later signups receive standard creator accounts. Each account has separate settings, uploads, processing history, exports, and storage records. New users complete a short preferences setup before entering the workspace.

Passwords are hashed with bcrypt. Sessions use random server-side tokens stored in SQLite and HTTP-only, SameSite cookies. Login attempts are rate limited. The floating **Feedback** button is available throughout the signed-in site and also opens after a successful export download or settings save. The administrator receives a **Feedback** navigation item with a private inbox for bug reports and suggestions.

For a real public deployment, place the application behind an HTTPS reverse proxy, set `APP_ORIGIN` to the exact public HTTPS URL, set `APP_HOST=0.0.0.0`, `ALLOW_NETWORK_BIND=true`, `TRUST_PROXY=true`, and list the public hostname in `ALLOWED_HOSTS`. Do not expose the development server directly. Public video processing requires substantial disk, CPU/GPU capacity, upload limits, backups, monitoring, and an abuse-prevention policy appropriate to the expected audience.

FXQY Method is a web application for analysing video and creating standards-compliant MP4 exports with FFmpeg. It provides an actual 60 FPS TikTok-oriented export, a separately labelled 120 FPS editing master, 1080p and 1440p (2K) resolution ceilings, and a verified lossless-remux path.

It runs locally by default. It does not upload to TikTok, sign in to TikTok, scrape TikTok, use cloud storage, run analytics, or contact an advertising service.

> **Important:** This is a media-preparation tool, not a reach or moderation tool. TikTok controls playback transcodes, distribution, and moderation. A valid upload can still be recompressed, downscaled, frame-rate converted, rejected, or distributed differently.

The application displays this statement in full:

> “This tool prepares standards-compliant video files. TikTok controls its own transcoding, distribution and moderation systems. No application can guarantee 4K/120 FPS playback, prevent recompression, prevent reduced distribution or guarantee protection from account restrictions. Follow TikTok’s current rules and upload normal, original content.”

## What is included

- Direct local access with no account, password, passcode, registration, or secret setup.
- Drag-and-drop and file-picker uploads streamed to private local storage.
- FFprobe analysis of media structure, cadence, colour, rotation, timestamps, audio, bitrate, and MP4 atom order.
- Three visible export choices built from validated options rather than raw shell text.
- A database-backed local processing worker with progress, recent FFmpeg status, cancellation, timeout handling, recovery, and cleanup.
- Output verification before publication, including an FFprobe check and a complete decode validation.
- Local source/output previews, downloads, export deletion, job history, settings, diagnostics, and storage management.
- Quality-first resolution and frame-method controls, optional optical-flow interpolation, comparison preview, and caption-safe guides. Colour/detail effects remain neutral so the output stays faithful to the source.
- Runtime detection for NVIDIA NVENC, Intel Quick Sync, AMD AMF, and Apple VideoToolbox, with CPU fallback.
- SQLite persistence, Docker support, and no third-party media transfer.

## Architecture

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| Browser | Next.js/React/TypeScript UI | Upload, analysis, settings, preview, progress, history, downloads, and storage controls |
| Web server | Next.js Node runtime | Localhost host/origin checks, upload streaming, private range responses, and validated job creation |
| Database | `better-sqlite3` | Local media records, jobs, exports, settings, and maintenance lock |
| Worker | `worker/worker.ts` | Claims queued jobs, detects capabilities, runs FFmpeg, reports progress, verifies results, publishes exports, and cleans temporary workspaces |
| Media tools | FFmpeg and FFprobe | Probe, filter, encode/remux, hash, decode validation, and MP4 fast-start output |
| Storage | Local filesystem under `DATA_ROOT` | Source media, verified exports, temporary job directories, and the SQLite database |

The web process and worker are intentionally started together by `npm run dev` and `npm run start`. Do not replace those commands with a bare `next dev` or `next start`, because queued processing requires the worker.

### Processing flow

1. The server streams the request body into a generated private filename, enforces the configured byte ceiling, checks free space, calculates SHA-256, and never trusts the original filename as a path.
2. FFprobe must find a readable video stream. The application records detailed analysis and deletes an invalid upload.
3. The owner selects a preset. The server validates every option against a finite schema before creating a job.
4. A worker claims the job from SQLite, creates a private attempt directory, and launches FFmpeg with an argument array and `shell: false`.
5. FFmpeg progress is parsed into live status. Cancellation first asks FFmpeg to stop cleanly and then terminates it if necessary.
6. The candidate is probed, checked against the preset invariants, fully decoded, hashed, and only then moved into the exports directory.
7. Failed, timed-out, cancelled, and unpublished attempts are removed. Stale job directories are checked by the cleanup scheduler.

## Export choices

### Actual 60 FPS file — recommended for TikTok

- Select **1080p** or **1440p (2K)** as a maximum output size. Larger sources are downscaled; smaller sources are never enlarged.
- The source display aspect ratio, including anamorphic sample-aspect information, is retained without stretching or forced 9:16 cropping.
- The output has a real constant 60 FPS timeline. A lower-rate source repeats frames without claiming extra native motion; a higher-rate or variable source is sampled into 60 FPS and may drop excess frames.
- H.264 High Profile, `yuv420p`, a level selected from the resolved frame size/rate, progressive scan, clean rotation, explicit BT.709 limited-range tags, and `+faststart` MP4.
- Quality-first CPU encoding uses CRF 14. Hardware VBR targets scale with the real output size: approximately 12 Mbit/s for small media, 24 Mbit/s up to 1080p, and 36 Mbit/s above 1080p, with higher validated maximum rates.
- AAC-LC stereo, 48 kHz, 256 kbit/s.
- HDR sources are tone-mapped to BT.709 SDR. Known non-BT.709 SDR is converted rather than merely relabelled.

TikTok's published Content Posting API restrictions currently state a maximum of 60 FPS. This choice stays within that documented frame-rate range, but TikTok may still recompress, resize, reject, or otherwise process the upload.

### 120 FPS master

- Select **1080p** or **1440p (2K)** as a maximum size; this mode also never enlarges a smaller source.
- The encoded stream and MP4 timeline both honestly report constant 120 FPS. The application never stores 120 FPS frames under false 60 FPS metadata.
- A measured native 120 FPS source keeps its real cadence. Sources above 120 FPS are conformed down to 120 without claiming native capture.
- **Duplicate — faster:** repeats lower-rate source frames. The file is actually CFR120, but motion does not become natively smoother.
- **Optical flow — CPU-heavy:** uses FFmpeg `minterpolate` to create synthetic intermediate frames. It is offered only when the installed FFmpeg exposes that filter. Tail padding plus an exact trim preserves the source duration, but warping or ghosting can still occur around cuts and difficult motion.
- Quality-first CPU encoding uses CRF 14 for H.264 or CRF 15 for HEVC. Hardware VBR targets scale from approximately 24/18 Mbit/s for small H.264/HEVC media to 72/54 Mbit/s at 1440p.
- AAC-LC stereo, 48 kHz, 256 kbit/s, progressive scan, explicit colour tags, two-second keyframes, and fast-start MP4.

This is an editing or experimental master, not the recommended TikTok upload file. Reducing a 4K source to 1080p or 1440p does not make 120 FPS part of TikTok's documented supported range; TikTok may reject it or convert it to a lower cadence.

### Lossless Remux

The remux preset uses `-c copy`; it does not resize, filter, change cadence, fix interlacing, render rotation, or transcode audio. It is offered only when conservative checks pass, including:

- H.264 `yuv420p`, or compatible H.264/HEVC MP4 video.
- Progressive, even dimensions, clean zero rotation, constant cadence, and a measured frame rate in the conservative upload range.
- AAC audio when audio is present.
- No critical missing/non-monotonic timestamps or material audio/video duration mismatch.

It copies only the selected media streams, removes nonessential global metadata and chapters, safely shifts a benign shared negative start, writes `moov` before media data with `+faststart`, and uses the `hvc1` tag for HEVC. The worker verifies encoded packet-payload stream hashes and timing/stream invariants so a supposed lossless remux is not published if encoded media changed.

A remux cannot resize, generate frames, repair pixels, change cadence, remove interlacing, convert an incompatible codec, render rotation into pixels, or repair broken packet timing. When blocked, use the encoded 60 FPS export or the separately labelled 120 FPS master. Resizing and frame generation always require re-encoding, so they cannot also be lossless stream-copy operations.

## Analysis and warnings

The analysis panel reports:

- coded/display resolution, display aspect ratio, sample aspect ratio, duration, and file size;
- average/nominal/measured frame rate and constant, variable, or indeterminate cadence;
- video codec, profile, level, bitrate, pixel format, field order, and stream count;
- colour primaries, transfer characteristic, matrix/space, range, and HDR detection;
- audio codec, sample rate, channels, bitrate, and audio/video duration difference;
- rotation/display matrix metadata;
- missing PTS/DTS, non-monotonic DTS, non-positive packet durations, and negative starts;
- MP4 `ftyp`, `moov`, and `mdat` structure, fragmentation, and whether the file is already fast-start/web optimised;
- remux eligibility, blockers, safe fixes, and estimated output size.

Warnings cover VFR/indeterminate cadence, suspicious nominal-versus-measured FPS, unsupported codecs, unusual pixel formats, interlacing, timestamp errors, missing colour tags, HDR conversion needs, low resolution, very low bitrate, unusual rotation, large projected files, fragmented/non-fast-start MP4, extra streams, and audio/video duration mismatch.

Analysis is diagnostic, not proof that a platform will accept or preserve a file.

## Regular Windows installer (recommended)

Download `FXQY-Method-v1.9-Windows-Installer.msi`, double-click it, and follow the normal Windows installer. The final screen asks whether to launch FXQY Method and selects that option by default. Setup creates normal Desktop and Start Menu shortcuts and adds FXQY Method to **Settings > Apps > Installed apps**, where it can be repaired or uninstalled later.

The installer includes its own Node.js runtime, FFmpeg, FFprobe, and desktop host. It needs no Command Prompt, PowerShell, npm commands, or separate media tools. The app opens in its own embedded WebView2 desktop window—not a browser tab—and automatically chooses an available private loopback port. Its database, uploads, and exports stay under `%LOCALAPPDATA%\FXQY Method\Data`. Accounts and settings are stored only in that local database. Video processing runs on that computer using a supported local GPU encoder when available, with a CPU fallback; videos are not sent to an FXQY Method processing server.

Encoded exports preserve the source video's display aspect ratio automatically. Colour and detail adjustments are neutral so the export remains faithful to the original; the actual 60 FPS mode performs only the compatibility conversions it needs.

Because this personal build is not code-signed, Windows may show an **Unknown publisher** or Microsoft Defender SmartScreen notice. Confirm that the file came from your own trusted project build; if SmartScreen appears, choose **More info**, then **Run anyway**.

## Requirements for running from source

- A 64-bit Windows, macOS, or Linux host.
- Node.js **22.13.0 or newer** and npm. The lockfile is authoritative.
- **FFmpeg and FFprobe must be installed and executable** for native runs. The Docker image installs the Debian FFmpeg package inside the image.
- SQLite needs no separate server; it is embedded through `better-sqlite3`.
- Sufficient local disk space. The default upload ceiling is 20 GiB and the default minimum-free-space reserve is 5 GiB. A 1440p optical-flow 120 FPS job can require far more time and space than the source.
- Optional: a supported GPU, current vendor driver, and an FFmpeg build containing the corresponding encoder.
- If `better-sqlite3` cannot use a prebuilt binary, Python 3 and native C/C++ build tools are required during `npm ci`.

Confirm the core tools:

```text
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## Installation

### Windows source/developer installation

The Setup executable above is the normal end-user installation method. These older script-based steps are only a fallback for developers running the source tree:

1. Extract the source release ZIP to a normal folder such as `Documents\FXQY Method`.
2. Double-click `INSTALL-WINDOWS.cmd`. It checks for Node.js and FFmpeg, offers their standard WinGet packages when missing, installs locked dependencies, and creates the production build.
3. If prerequisites were installed, close the installer and run it once more so the refreshed `PATH` is available.
4. Open the new **FXQY Method** desktop shortcut. It starts the local worker and opens a standalone desktop window without browser tabs or an address bar. `START-TIKTOK-OPTIMIZER.cmd` does the same thing in a source checkout.

No `.env` file, account, username, password, passcode, database command, or secret is required. In this source-only method, keep the small server command window open while using the desktop app; press `Ctrl+C` in it to stop the app and processing worker. The regular MSI installation instead runs the worker invisibly and closes it when the desktop window closes. It uses the Microsoft WebView2 Runtime built into current Windows installations; if that runtime has been removed, repair Microsoft Edge WebView2 Runtime and reopen FXQY Method.

### Windows 10/11

PowerShell examples:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Gyan.FFmpeg -e
```

Close and reopen PowerShell, then verify all four commands shown above. FFmpeg itself publishes source code; its [official download page](https://ffmpeg.org/download.html) links to current Windows builds if the package-manager build is unsuitable. Add the selected build's `bin` directory to `PATH`, or configure absolute `FFMPEG_PATH` and `FFPROBE_PATH` values.

If native dependency compilation is required, install Python 3 and Visual Studio Build Tools with the Desktop development with C++ workload.

From the project directory:

```powershell
npm ci
```

If a restrictive PowerShell execution policy blocks `npm.ps1`, use the signed command shim explicitly (for example, `npm.cmd ci` and `npm.cmd run dev`) rather than weakening the machine-wide policy.

### macOS

Install the prerequisites with Homebrew, or use signed installers from the Node and FFmpeg project pages:

```bash
brew install node@22
brew install ffmpeg
brew link --overwrite --force node@22
npm ci
```

On Apple hardware, the application probes VideoToolbox at runtime. Merely seeing the encoder in `ffmpeg -encoders` is not enough; the in-app Diagnostics test must succeed.

### Linux

Install Node 22 or newer from the [official Node.js downloads](https://nodejs.org/en/download) or a trusted distribution/version manager. On Debian/Ubuntu, install the native prerequisites with:

```bash
sudo apt update
sudo apt install -y ffmpeg build-essential python3
node --version
ffmpeg -version
ffprobe -version
npm ci
```

If the distribution's Node package is older than 22.13.0, do not use it for this application. Install a current Node 22+ build first.

## Environment configuration

No environment file is required for a normal localhost installation. The application creates its SQLite database and local workspace automatically on first launch. Copy `.env.example` to `.env.local` only when you want to change paths, limits, or processing settings.

Optional localhost `.env.local`:

```dotenv
APP_ORIGIN=http://127.0.0.1:3000
APP_HOST=127.0.0.1
APP_PORT=3000
```

### Environment reference

| Variable | Default / constraint | Purpose |
| --- | --- | --- |
| `APP_ORIGIN` | `http://127.0.0.1:3000` | Exact application origin: scheme, host, and optional port only. Loopback aliases (`localhost`, `127.0.0.1`, and `::1`) are accepted on the same port. |
| `ALLOWED_HOSTS` | `APP_ORIGIN` host | Comma-separated additional `host[:port]` values accepted by host/origin checks. |
| `APP_HOST` | `127.0.0.1` | Network interface used by the combined web/worker runner. |
| `APP_PORT` | `3000` | TCP port, 1–65535. Keep it aligned with `APP_ORIGIN`. |
| `ALLOW_NETWORK_BIND` | false | Must be exactly `true` before the runner accepts a non-loopback bind. |
| `ALLOW_INSECURE_HTTP` | false | Allows a non-loopback HTTP origin in production. Use only on an isolated trusted network; TLS is preferred. |
| `TRUST_PROXY` | false | Trust forwarded client/host information. Enable only behind a trusted proxy that overwrites those headers and blocks direct access. |
| `DATA_ROOT` | `<project>/.data` (`DATA_DIR` is an alias) | Parent for the default database, media, and temporary paths. |
| `DATABASE_PATH` | `<DATA_ROOT>/tiktok-optimizer.sqlite` | Absolute or relative local SQLite path. |
| `MEDIA_ROOT` | `<DATA_ROOT>/media` | Private upload/export/preview root. |
| `TEMP_ROOT` | `<DATA_ROOT>/tmp` | Private worker attempt directories. |
| `MAX_UPLOAD_BYTES` | 20 GiB; 1 MiB–1 TiB | Hard environment ceiling. A lower limit can be selected in Settings. |
| `MIN_FREE_BYTES` | 5 GiB; 128 MiB–10 TiB | Disk reserve enforced in storage/workspace checks. |
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg executable name or absolute path. |
| `FFPROBE_PATH` | `ffprobe` | FFprobe executable name or absolute path. |
| `JOB_TIMEOUT_MINUTES` | 360; 5–2880 | Maximum processing duration before cancellation and cleanup. |
| `PROCESS_CONCURRENCY` | 1; 1–4 | Local worker slots. More slots multiply CPU/GPU, memory, and disk pressure. |
| `RETENTION_HOURS` | 168; 1–8760 | Initial stale temporary-workspace retention setting. Later changes are made in Settings/Storage. |

Byte limits are integer bytes, not values such as `20GB`. For example, 8 GiB is `8589934592`.

## First-run database setup

There is no account or database setup command. SQLite tables, indexes, settings, and the local workspace are created automatically on first access. There is no database server, migration service, password, or Prisma command to run. The database defaults to `.data/tiktok-optimizer.sqlite` and uses WAL, foreign keys, a busy timeout, secure deletion, and restrictive file permissions where the operating system supports them.

## Development

After installing Node.js, FFmpeg, and project dependencies:

```text
npm run diagnostics
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The development server and one or more local worker slots start together. Stop both with `Ctrl+C`.

Recommended pre-commit checks:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

## Native production run

Keep the service on loopback unless a private network design is in place.

PowerShell:

```powershell
$env:NODE_ENV = "production"
npm ci
npm run build
npm run start
```

POSIX shell:

```bash
export NODE_ENV=production
npm ci
npm run build
npm run start
```

`npm run start` starts both the Next.js production server and the processing worker. Use a service manager that restarts the entire command if either child exits. Run the service under a dedicated, unprivileged operating-system account with write access only to the application data paths and necessary GPU devices.

## Docker

Docker is the easiest isolated CPU deployment. The included Compose configuration:

- builds on Node 22;
- installs FFmpeg/FFprobe in the runtime image;
- runs as the unprivileged `node` user with all Linux capabilities dropped and `no-new-privileges`;
- stores all state in the `optimizer-data` named volume;
- publishes port 3000 on host loopback only.

Start it directly; no `.env`, owner account, or secret is required:

```text
docker compose build
docker compose up -d
docker compose logs -f optimizer
```

Useful operations:

```text
docker compose exec optimizer npm run diagnostics
docker compose exec optimizer npm run cleanup
docker compose stop optimizer
docker compose start optimizer
docker compose down
```

`docker compose down` retains the named data volume. Do not add `-v` unless permanent deletion of all application data is intentional and a backup is no longer required.

### Docker and GPUs

The stock Compose file does not grant a GPU device to the container, and the Debian FFmpeg package in the image may not contain every vendor encoder. CPU fallback is therefore the expected portable Docker path.

For NVIDIA on Linux, install the current driver and [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html), then add a Compose override such as `compose.gpu.yml`:

```yaml
services:
  optimizer:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

Start with both files:

```text
docker compose -f docker-compose.yml -f compose.gpu.yml up -d --build
docker compose -f docker-compose.yml -f compose.gpu.yml exec optimizer npm run diagnostics
```

GPU reservation only exposes the device. The image's FFmpeg must still list and successfully exercise `h264_nvenc`/`hevc_nvenc`. See Docker's [Compose GPU documentation](https://docs.docker.com/compose/how-tos/gpu-support/) for host prerequisites. Intel/AMD Linux devices commonly require `/dev/dri` passthrough and `video`/`render` group permissions, plus an FFmpeg build with the desired encoder. VideoToolbox is a native macOS facility and is unavailable in this Linux container. AMF is usually simplest in a native Windows FFmpeg build.

## Hardware acceleration

The application does not trust an encoder name alone. Diagnostics performs a tiny real encode for every compiled candidate, and **Fast Hardware** chooses the first successful encoder for the selected codec in this order: NVENC, Quick Sync, AMF, VideoToolbox. If none works but the CPU encoder does, the job falls back to CPU and records a disclosure.

| Backend | Host preparation | FFmpeg names to verify |
| --- | --- | --- |
| NVIDIA NVENC | Current NVIDIA driver; FFmpeg built with NVENC support | `h264_nvenc`, `hevc_nvenc` |
| Intel Quick Sync | Current Intel graphics/media driver; FFmpeg built with QSV; Linux device permissions when applicable | `h264_qsv`, `hevc_qsv` |
| AMD AMF | Current AMD Radeon driver; an AMF-enabled FFmpeg build, typically on Windows | `h264_amf`, `hevc_amf` |
| Apple VideoToolbox | Native macOS; an FFmpeg build exposing VideoToolbox | `h264_videotoolbox`, `hevc_videotoolbox` |
| CPU | FFmpeg with x264/x265 | `libx264`, `libx265` |

Inspect the compiled list:

```text
ffmpeg -hide_banner -encoders
npm run diagnostics
```

On Windows, filter the first output with `findstr /i "nvenc qsv amf videotoolbox libx264 libx265"`; on macOS/Linux, use `grep -E "nvenc|qsv|amf|videotoolbox|libx26"`.

- **Fast Hardware** prioritises usable hardware and speed.
- **Balanced** uses the CPU encoder's medium preset for repeatable quality.
- **Maximum CPU Quality** uses the CPU encoder's slow preset. Optical-flow 1440p/120 can still take many hours.

Hardware output can differ from CPU output at the same nominal bitrate. Run Diagnostics after driver, FFmpeg, container, or device-permission changes.

## Private network deployment

### Default posture

The native runner binds to `127.0.0.1` and refuses non-loopback binding unless `ALLOW_NETWORK_BIND=true`. Docker Compose also publishes only `127.0.0.1:3000`. Do not port-forward this service from an internet router and do not publish port 3000 directly.

### Trusted home LAN

Because this edition has no login, anyone who can reach its port can use it and access its locally managed files. Keep it on localhost. If you deliberately enable LAN access, put it behind a private VPN or an authenticated TLS reverse proxy and restrict the host firewall.

```dotenv
NODE_ENV=production
APP_HOST=0.0.0.0
APP_PORT=3000
ALLOW_NETWORK_BIND=true
APP_ORIGIN=http://192.168.1.50:3000
ALLOWED_HOSTS=192.168.1.50:3000
ALLOW_INSECURE_HTTP=true
```

Restrict the host firewall to the exact trusted subnet. `ALLOW_INSECURE_HTTP` weakens transport security; it does not add encryption or make a public deployment safe.

### Authenticated TLS reverse proxy

The safer pattern is:

1. Keep FXQY Method reachable only at `127.0.0.1:3000` (or the Compose loopback port).
2. Terminate TLS at Caddy, nginx, or a private identity-aware/VPN gateway.
3. Require the proxy/VPN's authentication or device policy; the app itself has no login.
4. Forward the original `Host`, set `X-Forwarded-Proto: https`, overwrite (do not append untrusted) client forwarding headers, and prevent direct access to the upstream port.
5. Set `APP_ORIGIN` to the exact HTTPS URL and set `ALLOWED_HOSTS` accordingly. HTTPS origins enable HSTS.
6. Set `TRUST_PROXY=true` only when the proxy is trusted, overwrites forwarding headers, and is the sole route to the app.
7. Configure the proxy's request-size and read/write timeouts for the intended upload ceiling and long downloads. Disable request buffering if the proxy otherwise writes a second full upload to disk.

Example environment:

```dotenv
NODE_ENV=production
APP_HOST=127.0.0.1
APP_PORT=3000
APP_ORIGIN=https://optimizer.home.example
ALLOWED_HOSTS=optimizer.home.example
TRUST_PROXY=true
```

Minimal nginx location (certificate and authentication/VPN policy are deployment-specific):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_request_buffering off;
    client_max_body_size 20G;
    proxy_read_timeout 21600s;
    proxy_send_timeout 21600s;
}
```

Do not set `TRUST_PROXY=true` when clients can connect directly or can control forwarded headers.

## Privacy and security model

- No account, password, passcode, registration, session token, or authentication secret is used.
- The native runner binds to `127.0.0.1` by default and refuses non-loopback binding unless explicitly overridden.
- API reads require an allowed host; mutating requests additionally require an exact same-origin check.
- Security headers deny framing and object embedding, restrict browser capabilities and content sources, disable referrer leakage, and add HSTS for HTTPS origins.
- API records belong to the single local workspace. Private file responses revalidate contained paths, reject symlinks, set private/no-store headers, and support bounded range requests for preview.
- Upload validity comes from FFprobe, not an extension or browser MIME type. Uploads use generated IDs, path containment, streaming size checks, safe permissions, and free-space checks.
- FFmpeg/FFprobe run without a command shell, from allowlisted/validated arguments, with a restricted inherited environment and bounded timeouts.
- Only verified candidates are published. Failures expose privacy-safe messages rather than raw private paths or command lines.
- No analytics, ads, third-party video storage, TikTok login, TikTok upload, scraping, recommendation manipulation, or platform-parser exploitation.

This is application-layer hardening, not a substitute for OS patching, disk encryption, backups, firewalling, TLS, and a dedicated least-privilege service account.

## Storage, retention, cancellation, and deletion

Default layout:

```text
.data/
├── tiktok-optimizer.sqlite
├── tiktok-optimizer.sqlite-wal   # present while WAL has content
├── tiktok-optimizer.sqlite-shm   # present while SQLite is active
├── media/
│   ├── uploads/
│   ├── exports/
│   └── previews/
├── .trash/
└── tmp/
```

Directories and files are created with restrictive permissions where supported, and storage roots/symlink targets are validated.

- Each job's attempt directory is removed immediately after success, failure, timeout, or cancellation.
- The worker periodically cleans expired known files and stale job workspaces. The stale-workspace age is controlled by the owner retention setting, bounded so active/recoverable jobs are not removed.
- Completed outputs are retained indefinitely by default. Set an output-retention period in Settings to expire future outputs automatically, or delete individual exports manually.
- Uploaded sources remain private local assets until **Delete all files and history** removes them. The temporary-workspace setting is not a promise to delete source uploads.
- Cancellation is cooperative first and forced after a short grace period. A cancelled job does not publish a partial export.
- `npm run cleanup` performs the same bounded cleanup check manually; it does not indiscriminately erase the data root.
- **Delete all files and history** requires the exact phrase `DELETE ALL FILES`. It requests cancellation of active jobs, waits for them to stop, deletes known sources/exports/temp files, removes media/job/export history, and compacts the private database. It retains saved settings.

Delete-all is intentionally irreversible from the application. Take a backup first if the media or history matters.

## Testing

Run the complete automated suite:

```text
npm test
```

The repository's Vitest coverage exercises localhost access boundaries, upload and filename validation, FFprobe/MP4 parsing, command generation, cadence decisions, remux eligibility, colour/timing invariants, worker failure/cancellation/cleanup paths, and storage limits. Individual test files use generated fixtures or synthetic metadata; they do not require copyrighted footage.

Run static and production checks separately:

```text
npm run lint
npm run typecheck
npm run build
```

The optional real-media integration command requires working FFmpeg/FFprobe and generates small test-pattern clips:

```text
npm run test:media
```

See [Synthetic media test guide](docs/SYNTHETIC_MEDIA.md) for reproducible manual CFR, VFR, 120 FPS, remux, rotation, and unusual-filename fixtures. Synthetic patterns validate pipeline behaviour, not subjective quality or GPU driver stability.

## Diagnostics

Use either **System diagnostics** in the local UI or:

```text
npm run diagnostics
```

The report tests FFmpeg and FFprobe versions, SQLite quick-check/foreign keys/WAL mode, data-path writability, free space, CPU encoders, real hardware-encoder execution, and required optional filters (`zscale`, `tonemap`, `minterpolate`, `loudnorm`, `hqdn3d`, `deband`, and `bwdif`). It also reports the local-access posture without emitting private media paths.

Run it after installing FFmpeg, changing paths, changing a GPU driver, moving into a container, or changing service-account permissions.

## Backup and restore

The database and media files must be captured consistently.

### Native

1. Stop `npm run dev`/`npm run start` so both the web process and worker exit.
2. Copy the entire `DATA_ROOT`, not only the main `.sqlite` file. This includes media and any SQLite `-wal`/`-shm` files that remain.
3. Protect the backup like the original: it contains private video, hashes, history, and settings.
4. Restore only while the application is stopped, to an empty target owned by the service account.
5. Start the application and run `npm run diagnostics` before processing new jobs.

### Docker Compose

Keep the stopped container so `docker compose cp` can read its named volume:

```text
docker compose stop optimizer
docker compose cp optimizer:/data ./backup/tiktok-optimizer-data
docker compose start optimizer
```

For restore, stop the service, make a separate copy of the current volume first, copy the saved contents back into `/data`, preserve ownership for UID/GID used by the image's `node` user, then start and run Diagnostics. Volume tooling and ownership differ across Docker hosts; test recovery before relying on a backup plan.

## Updating

1. Read release notes/diffs and back up `DATA_ROOT` or the Docker volume.
2. Stop the combined service.
3. Update the source checkout without deleting `.env.local`, `.env`, or data.
4. Native: run `npm ci`, `npm test`, `npm run build`, then `npm run start`.
5. Docker: run `docker compose build --pull`, then `docker compose up -d`.
6. Run Diagnostics and process a short synthetic clip before a valuable long job.

Do not downgrade a live database without restoring the matching backup and application revision.

## Troubleshooting

### `ffmpeg` or `ffprobe` is not recognised / not found

Install both tools, restart the shell/service, and verify their versions. If they are not on `PATH`, set absolute `FFMPEG_PATH` and `FFPROBE_PATH` values. In a service manager, remember that the service account often has a smaller `PATH` than an interactive terminal.

### No validated encoder is available

Run Diagnostics. The selected codec needs `libx264`/`libx265` or a runtime-working hardware encoder. Install a fuller FFmpeg build or choose H.264 when HEVC is unavailable. An encoder printed by `ffmpeg -encoders` can still fail because of a driver, device permission, session, or container passthrough problem.

### Hardware encoder is listed but Fast Hardware falls back to CPU

The tiny runtime encode failed. Update the vendor driver, check GPU/device permissions, verify that a display/session restriction is not blocking the backend, and inspect the Diagnostics warning. In Docker, confirm both device passthrough and encoder support inside the container.

### HDR conversion says a filter is missing

The FFmpeg build lacks `zscale` and/or `tonemap`. Install a build containing those filters. Do not work around it by relabelling HDR pixels as BT.709.

### Optical-flow 120 FPS is unavailable or extremely slow

The FFmpeg build must provide `minterpolate`. This filter is computationally expensive, especially at 4K. Test a short section, use one worker slot, ensure substantial free disk space, and increase `JOB_TIMEOUT_MINUTES` only after checking that processing is making progress.

### Lossless Remux is disabled

Read the analysis blockers. VFR, interlacing, rotation, incompatible codecs/pixel formats/audio, out-of-range cadence, critical timestamps, odd dimensions, and material A/V mismatch require re-encoding. A remux changes container organisation, not encoded video properties.

### Upload rejected as invalid media

The server relies on FFprobe rather than the filename. Confirm the source opens locally, contains a video stream, is not still being copied, and fits the byte limit. Inspect free disk space and run Diagnostics. Raw FFprobe paths/errors are intentionally not shown in browser messages.

### Insufficient disk space / projected output is huge

Free space must cover the source, output, temporary work, and the configured reserve. High-bitrate 1440p/120 output can grow rapidly. Delete unneeded exports/sources, lower concurrency, use HEVC where appropriate, or move `DATA_ROOT` to a larger private disk. Do not lower `MIN_FREE_BYTES` below a safe OS/filesystem margin.

### Job remains queued

The worker is not running, maintenance is active, or every worker slot is busy. Start with `npm run dev`/`npm run start` rather than `next` directly, review the terminal, and run Diagnostics. A combined process restart recovers abandoned leases.

### Job was cancelled or the service stopped

The worker removes its unpublished candidate and records a privacy-safe terminal state. Abandoned jobs are recovered through bounded leases on restart. Re-submit after correcting the underlying issue; partial files are never offered as completed exports.

### Reverse proxy gives host, origin, 413, or timeout errors

Make `APP_ORIGIN`, browser URL, `Host`, forwarded scheme, and `ALLOWED_HOSTS` agree exactly. Ensure the proxy accepts the configured upload size and long-running streams. Enable `TRUST_PROXY` only after forwarded headers are overwritten by a trusted, non-bypassable proxy.

## Known limitations

- TikTok's current transcoding, upload limits, playback resolution/frame rate, moderation, and distribution are outside this application's control and may change.
- Upscaling cannot recreate missing source detail. Duplication does not add motion samples; optical flow guesses them and can produce artefacts.
- Browser previews are convenience views and are not colour-managed mastering monitors. Caption guides are visual guidance, not a platform guarantee.
- HDR preservation depends on source metadata, HEVC support, display/player support, and the exact FFmpeg build. TikTok may still convert it to SDR.
- Hardware acceleration is platform-, driver-, FFmpeg-build-, container-, and permission-dependent. CPU fallback can be very slow.
- This no-login edition is designed for one trusted person on localhost, not multi-user access, public hosting, clustering, or shared network filesystems.
- Source uploads are not automatically sent anywhere, but they remain on local storage until explicitly deleted. Backups are likewise your responsibility.

## Script reference

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Next development mode and the processing worker on localhost by default |
| `npm run build` | Create the Next.js production build |
| `npm run start` | Start the production web server and worker |
| `npm run lint` | Run ESLint with zero warnings allowed |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:media` | Run real FFmpeg synthetic-media integration tests |
| `npm run diagnostics` | Emit privacy-safe system/media capability diagnostics as JSON |
| `npm run cleanup` | Safely check expired known files and stale job workspaces |

## Research and standards posture

The media pipeline was designed after reviewing public descriptions of the processing concept sometimes called the Haze Method, then checking the underlying claims against public FFmpeg, ISO Base Media File Format, browser/media, and TikTok developer documentation. The implementation is original and standards-oriented: fast-start remuxing, truthful sample timing, conservative compatibility, explicit colour handling, and re-encoding only when container changes cannot solve the problem.

It does not copy proprietary Haze code, branding, text, or design; scrape private systems; inject fake samples; falsify media properties; exploit parser bugs; or promise zero compression, undetectable uploads, reach, or protection from restrictions.

See [Engineering research and source notes](docs/RESEARCH.md) for the detailed findings and primary-source links.
