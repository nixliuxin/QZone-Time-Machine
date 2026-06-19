# QZone-Time-Machine — Project Conventions

This file is auto-loaded by Cursor when the agent works anywhere inside
this repository. It defines project-wide rules, layout, and pipeline.

For format-specific knowledge, see `.cursor/rules/`:

- `english-only.mdc` — language policy
- `no-cursor-attribution.mdc` — commit hygiene
- `versioning.mdc` — SemVer policy

## What this repo is

Open-source monorepo for **QZone-Time-Machine** — a toolkit that backs up QQ Zone
(QQ 空间) data and provides an offline viewer. Ships a CLI application
(`packages/cli`) and a React single-page viewer (`packages/viewer`).

## Repo layout

| Path | Role |
|---|---|
| `packages/cli/engine/` | QZone API + collectors (CJS JavaScript) |
| `packages/cli/engine/api/` | QZone REST API wrappers (one file per module) |
| `packages/cli/engine/collectors/` | Module data collectors (messages, blogs, photos, etc.) |
| `packages/cli/engine/client.js` | HTTP client with retry, JSONP parsing, rate-limit detection |
| `packages/cli/engine/session.js` | Cookie management, g_tk calculation, UIN extraction |
| `packages/cli/engine/progress.js` | Checkpoint/resume state persistence |
| `packages/cli/engine/downloader.js` | Concurrent file downloader with validation |
| `packages/cli/engine/qr-login.js` | Puppeteer-based QR code login flow |
| `packages/cli/engine/reconcile.js` | Repair synthetic ids in converted-legacy data (blogs/boards/albums) by matching live lists; promotes real id, retains synthetic as `legacyId` |
| `packages/cli/src/index.ts` | CLI entry point (commander) |
| `packages/cli/src/convert.ts` | Legacy data converter (old format → new JSON) |
| `packages/viewer/src/` | React + Tailwind offline SPA |
| `.github/workflows/ci.yml` | CI: type-check + build |

## Hard rules

1. **English only** in code, comments, variable names, log messages,
   CLI output, and error messages. The only exceptions are:
   - `README.zh-CN.md` (translated README)
   - i18n string tables (if added later)
   - QZone API parameter values that must match the upstream protocol
2. **No AI attribution** in commit messages. No `Co-authored-by: Cursor`
   or similar trailers.
3. **No internal/vendored component names in user-facing strings.**
   Don't expose module names like `[client]`, `[downloader]` to end
   users. Use contextual messages instead.
4. **Pure JSON output.** The backup engine must produce clean JSON files
   with relative media paths — no `window.var =`, no base64-encoded
   HTML, no vendor lock-in.
5. **Resume by default.** Every batch operation must be checkpoint-based.
   Interrupted runs resume where they left off, never re-download
   already validated files.
6. **Never commit secrets.** `cookies.json`, `auth.json`, and any file
   containing authentication tokens must be gitignored.

## Pipeline overview

```
QR Login → Session (cookies + g_tk)
                ↓
         QzoneClient (HTTP + retry + rate-limit)
                ↓
    API modules (messages, photos, blogs, ...)
                ↓
    JSON output + media download (Downloader + Validator)
                ↓
         Viewer SPA (reads JSON from relative paths)
```

## Error handling conventions

- Use the custom error hierarchy (`NoAccessError`, `RateLimitError`,
  `AuthInvalidError`, `EmptyDataError`) — never throw bare strings.
- Errors that terminate a module should be caught at the orchestration
  layer and recorded in progress state.
- Never silently swallow errors with empty `catch {}`. At minimum,
  log at debug level.

## Linked references

- English-only policy → `.cursor/rules/english-only.mdc`
- Commit hygiene → `.cursor/rules/no-cursor-attribution.mdc`
- Versioning → `.cursor/rules/versioning.mdc`
