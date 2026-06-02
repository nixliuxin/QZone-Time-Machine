/**
 * File download and local cache management.
 *
 * Key capabilities:
 *   - Skip already-downloaded files that pass validator checks
 *   - Retry on failure/corruption; log final failures to a failure list
 *   - Rate-limit via concurrency cap (default 4)
 *   - Record each URL → local file mapping in ProgressStore
 *   - Append failed entries as JSONL to failures.jsonl for later review
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { validateFile, familyFromExt, detectFamily } = require('./validator.js');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Keep SANITIZE_RULES in lock-step with the transforms below — it is recorded
// verbatim into each user's sanitize provenance (data/user.json / _sanitize.json).
const SANITIZE_RULES = [
  'strip-qq-emoji-markup',     // [em]e258158[/em] -> (removed)
  'illegal-chars->_',          // <>:"/\|?* and control chars -> _
  'collapse-whitespace',       // runs of whitespace -> single space
  'trim',                      // drop leading/trailing whitespace
  'strip-trailing-dot/space',  // Windows can't open names ending in . or space
  'max-200-chars',
];

function sanitizeFilename(name) {
  return String(name || '')
    // QZone nicknames embed sticker markup like [em]e258158[/em]; the "/" inside
    // would otherwise become "_" leaving ugly [em]e258158[_em]. Strip the whole tag.
    .replace(/\[em\][^\[\]]*\[\/em\]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    // Windows forbids trailing dots/spaces: such files/folders can't be opened
    // or right-clicked in Explorer and need \\?\ paths everywhere. Strip them so
    // display names never produce unusable paths (matching always keys off uin).
    .replace(/[ .]+$/, '');
}

function extFromUrl(url) {
  try {
    const u = new URL(url);
    const m = /\.([a-z0-9]+)(?:$|[?#])/i.exec(u.pathname);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return null;
}

function extFromContentType(ct) {
  if (!ct) return null;
  ct = ct.toLowerCase();
  if (ct.includes('image/jpeg')) return 'jpg';
  if (ct.includes('image/png')) return 'png';
  if (ct.includes('image/gif')) return 'gif';
  if (ct.includes('image/webp')) return 'webp';
  if (ct.includes('image/bmp')) return 'bmp';
  if (ct.includes('video/mp4')) return 'mp4';
  if (ct.includes('video/quicktime')) return 'mov';
  if (ct.includes('video/x-flv')) return 'flv';
  return null;
}

class FailureLog {
  constructor(filePath) {
    this.filePath = filePath;
    ensureDir(path.dirname(filePath));
  }
  append(entry) {
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
  }
}

class Downloader {
  /**
   * @param {object} opts
   * @param {import('./client.js').QzoneClient} opts.client
   * @param {import('./progress.js').ProgressStore} opts.progress
   * @param {string} opts.outputRoot User's output root (e.g. {output}/{uin}_{name})
   * @param {number} [opts.concurrency=4]
   * @param {number} [opts.maxRetries=3]
   * @param {function} [opts.logger]
   */
  constructor(opts) {
    this.client = opts.client;
    this.progress = opts.progress;
    this.outputRoot = opts.outputRoot;
    this.concurrency = opts.concurrency ?? 4;
    this.maxRetries = opts.maxRetries ?? 3;
    this.logger = opts.logger || ((lvl, ...a) => (console[lvl] || console.log)('[downloader]', ...a));
    this.failures = new FailureLog(path.join(this.outputRoot, 'failures.jsonl'));
    this.queue = [];
    this.inflight = 0;
    this.resolveDrain = null;
  }

  /**
   * Enqueue a download task. Returns immediately without waiting.
   * @param {object} task
   *   - url: download URL
   *   - destAbs: absolute destination path
   *   - expectedFamily: 'jpg' | 'png' | ... for validator
   *   - tag: category label for failure log ('photo' | 'video' | 'message-image' ...)
   *   - meta: arbitrary extra data, written to failures.jsonl
   */
  enqueue(task) {
    this.queue.push(task);
    this._pump();
  }

  /** Wait for all queued tasks to complete */
  drain() {
    if (this.queue.length === 0 && this.inflight === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.resolveDrain = resolve;
    });
  }

  _pump() {
    while (this.inflight < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.inflight++;
      this._run(task)
        .catch(() => {})
        .finally(() => {
          this.inflight--;
          if (this.queue.length === 0 && this.inflight === 0 && this.resolveDrain) {
            const r = this.resolveDrain;
            this.resolveDrain = null;
            r();
          } else {
            this._pump();
          }
        });
    }
  }

  /**
   * Synchronous download (no queuing, direct await).
   * Suitable for one-at-a-time display; for bulk, use enqueue + drain.
   */
  async download(task) {
    return this._run(task);
  }

  async _run(task) {
    const { url, destAbs, expectedFamily, tag, meta } = task;
    if (!url) return { ok: false, reason: 'no-url' };

    // 1) Already exists and passes validation → skip
    const existing = validateFile(destAbs, { expectedFamily });
    if (existing.ok) {
      this.progress.recordDownload(url, {
        path: destAbs,
        size: existing.size,
        status: 'done',
        skipped: true,
      });
      return { ok: true, skipped: true };
    }

    ensureDir(path.dirname(destAbs));

    let lastErr = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const resp = await this.client.download(url, { timeoutMs: 90_000 });
        if (resp.status >= 400) {
          throw new Error(`HTTP ${resp.status}`);
        }
        // Write to temp file then rename to avoid partial files
        const tmp = destAbs + '.crdownload';
        fs.writeFileSync(tmp, resp.data);
        fs.renameSync(tmp, destAbs);

        const v = validateFile(destAbs, { expectedFamily });
        if (!v.ok) {
          throw new Error(`validate-fail: ${v.reason}`);
        }
        this.progress.recordDownload(url, {
          path: destAbs,
          size: v.size,
          status: 'done',
        });
        return { ok: true, size: v.size };
      } catch (err) {
        lastErr = err;
        this.logger('warn', `download retry ${attempt + 1}/${this.maxRetries}: ${url} (${err.message})`);
      }
    }

    // All retries exhausted
    this.progress.recordDownload(url, { status: 'failed', error: String(lastErr && lastErr.message) });
    this.failures.append({
      tag,
      url,
      destAbs,
      error: String(lastErr && lastErr.message),
      meta,
      ts: new Date().toISOString(),
    });
    return { ok: false, reason: lastErr && lastErr.message };
  }
}

module.exports = {
  Downloader,
  FailureLog,
  ensureDir,
  sanitizeFilename,
  SANITIZE_RULES,
  extFromUrl,
  extFromContentType,
};
