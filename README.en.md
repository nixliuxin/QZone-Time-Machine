<p align="right">
  <strong>English</strong> ·
  <a href="README.md">简体中文</a>
</p>

<p align="center">
  <img src="assets/Qzone-logo.png" alt="QQ Zone" width="200">
</p>

<h1 align="center">QZone-Tools</h1>

<p align="center">
  Back up your QQ Zone memories — messages, blogs, photos, videos, and more — before they disappear.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/pnpm-monorepo-F69220?style=flat-square" alt="pnpm">
</p>

---

## Features

- **QR Code Login** — Scan with mobile QQ, no password needed
- **Complete Backup** — Messages, blogs, diaries, photos, videos, boards, friends, favorites, shares, visitors
- **Original Quality** — Downloads images and videos at their highest available resolution
- **Resumable** — Interrupted backups continue where they left off
- **Smart Rate Limiting** — Automatic retry with exponential backoff
- **Offline Viewer** — Double-click `index.html` to browse locally, no internet or server required
- **Portable Output** — Standard JSON files with relative media paths

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

# Convert legacy backups (old qzone-export-batch format)
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
    └── videos/videos/
```

## Offline Viewer

After backup, a React SPA is automatically embedded into `index.html`:

- Light/dark mode toggle
- Click images to zoom, navigate with arrow keys
- Album hover shows metadata
- Inline video playback
- Full message board/blog rendering with comments
- Breadcrumb navigation
- Paginated long lists

## Architecture

```
QZone-Tools (pnpm monorepo)
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

- This tool runs entirely locally and does not upload your data to any third-party servers
- Login credentials are stored only in local `auth.json`
- This tool is intended for backing up **your own** QQ Zone data only
- QQ Zone and QQ are trademarks of Tencent Holdings Ltd.
- QQ Zone logo copyright belongs to Tencent ([source](https://zh.wikipedia.org/wiki/File:Qzone-logo.png))
- This tool is not affiliated with Tencent
- Provided "as is" without warranty of any kind
- QQ Zone APIs may change at any time; long-term availability is not guaranteed

## License

[MIT](LICENSE) (c) 2026 Nix Liu Xin
