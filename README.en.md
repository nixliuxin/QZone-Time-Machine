<p align="right">
  <strong>English</strong> ·
  <a href="README.md">简体中文</a>
</p>

<p align="center">
  <img src="assets/Qzone-logo.png" alt="QZone Time Machine" width="200">
</p>

<h1 align="center">QZone Time Machine</h1>
<p align="center"><code>QZone-Time-Machine</code></p>

<p align="center">
  <strong>Archive memories, preserve emotions</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/pnpm-monorepo-F69220?style=flat-square" alt="pnpm">
  <img src="https://img.shields.io/badge/no--server-local--only-8B5CF6?style=flat-square" alt="No Server">
</p>

<p align="center">
  Back up your QQ Zone memories before they disappear.<br>
  QR code login, one-click backup, offline browsing — no server required.
</p>

---

## Features

- **Zero-Server Architecture** — Runs entirely on your machine, never uploads data anywhere
- **Local QR Code Login** — Authenticates via local Chromium with QQ's official login page; credentials stay on your device
- **Open Source & Transparent** — Fully auditable code, no telemetry or tracking
- **Complete Backup** — 10 modules fully collected
- **Original Quality** — Downloads images and videos at their highest available resolution
- **Resumable** — Interrupted backups continue where they left off
- **Smart Rate Limiting** — Automatic retry with exponential backoff
- **Offline Viewer** — Double-click `index.html` to browse locally, no internet or server required
- **Portable Output** — Standard JSON files with relative media paths
- **QQ Emoji Archival** — Automatically downloads all referenced QQ emojis locally for full offline access

---

## Supported Modules

| Module | Content | Additional Info |
|--------|---------|-----------------|
| **Messages** | Text, images, video, audio | Comments, geolocation, source device, forward count |
| **Blogs** | Full content (rich text/images) | Category tags, original/repost flag, comments |
| **Private Diaries** | Full content | Owner-only entries |
| **Albums** | Original resolution photos & video | Album description, EXIF, capture/upload time, POI, comments |
| **Videos** | Video files | Description, comments |
| **Message Board** | Full board messages | Replies, media attachments |
| **Friends** | Friend list | Groups, remarks, friendship date |
| **Favorites** | Favorited content | Source info |
| **Shares** | Shared content | Source, comments |
| **Visitors** | Visit records | Visitor info, visit content summary |

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Build everything (CLI + viewer)
pnpm build

# Step 1: Log in (scan QR code with mobile QQ)
pnpm cli -- login

# Step 2: Back up a user
pnpm cli -- backup 123456789 -n "Nickname"

# Convert legacy backups (QZoneExport format)
pnpm cli -- convert ./old-backup ./output
```

## Output Structure

Each backed-up user produces a self-contained directory:

```
{qq_number}_{name}/
├── index.html              ← Double-click to browse offline
├── data/                   JSON data files
│   ├── user.json
│   ├── messages.json
│   ├── blogs.json
│   ├── boards.json
│   ├── videos.json
│   ├── diaries.json
│   ├── friends.json
│   ├── favorites.json
│   ├── shares.json
│   ├── visitors.json
│   └── photos/
│       ├── albums.json     Album index
│       └── {albumId}.json  Photos for each album
└── media/                  Downloaded images & videos
    ├── messages/images/
    ├── blogs/images/
    ├── albums/photos/{class}/{album}/
    ├── albums/covers/
    ├── emoji/              QQ emojis (localized)
    └── videos/videos/
```

## Offline Viewer

After backup, a React SPA is automatically embedded into `index.html`:

- Light/dark mode toggle
- Click images to zoom, navigate with arrow keys
- Album EXIF info panel
- Inline video playback
- Full board/blog rendering with comments, avatars, and links
- Data completeness report
- Traditional pagination with keyboard shortcuts

## Architecture

```
QZone-Time-Machine (pnpm monorepo)
├── packages/cli          TypeScript CLI + CommonJS engine
│   ├── src/index.ts      Entry point (login / backup / convert)
│   ├── src/convert.ts    Legacy data migration
│   └── engine/           Battle-tested JS collection engine (via createRequire)
└── packages/viewer       React + Vite SPA
    ├── Single-file bundle (vite-plugin-singlefile)
    └── Embedded in index.html for file:// protocol support
```

## Requirements

- Node.js 18+
- pnpm 9+
- Chromium / Chrome (for QR code login)

## Acknowledgements

This project was inspired by and built upon the work of:

- [QZoneExport](https://github.com/ShunCai/QZoneExport) — QQ Zone data export browser extension
- [QzonePhoto](https://github.com/11273/QzonePhoto) — QQ Zone photo downloader

## Disclaimer

### Security & Privacy
- This tool uses a **zero-server architecture** — runs entirely locally, never uploads any data
- Login uses QQ's official QR scan page via local Chromium; credentials are stored only in local `cookies.json`
- Intended for backing up **your own** QQ Zone data only; do not use to access others' data without authorization

### Copyright
- QQ Zone, QQ, and related trademarks belong to Tencent Holdings Ltd.
- QQ Zone logo copyright belongs to Tencent ([source](https://zh.wikipedia.org/wiki/File:Qzone-logo.png))
- This tool is not affiliated with Tencent

### Warranty
- Provided "as is" without warranty of any kind, express or implied
- Users assume all responsibility for consequences of using this tool
- QQ Zone APIs may change at any time; long-term availability is not guaranteed

## License

[MIT](LICENSE) (c) 2026 Nix Liu Xin
