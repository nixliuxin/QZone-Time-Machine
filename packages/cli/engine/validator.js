/**
 * File integrity validator: detect corrupted files via magic bytes + file size,
 * allowing the downloader to confirm validity before skipping existing files.
 *
 * No strict validation (no image decoding), but catches:
 *   - 0-byte / truncated files
 *   - HTML error pages (QQ occasionally returns these)
 *   - Text "forbidden" / "limited" placeholder pages
 */
'use strict';

const fs = require('fs');

const MAGIC = {
  jpg: [
    [0xff, 0xd8, 0xff],
  ],
  png: [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  ],
  gif: [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
  webp: [
    // RIFF????WEBP — check bytes 0..3 for RIFF + 8..11 for WEBP
  ],
  bmp: [
    [0x42, 0x4d],
  ],
  mp4: [
    // mp4: first 4 bytes are box size, bytes 4..7 are 'ftyp'
  ],
  flv: [
    [0x46, 0x4c, 0x56, 0x01],
  ],
};

/**
 * Check whether buf matches any magic bytes signature for the given family.
 */
function matchesFamily(buf, family) {
  if (!buf || buf.length < 4) return false;
  if (family === 'webp') {
    return (
      buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    );
  }
  if (family === 'mp4' || family === 'mov') {
    // bytes 4..7 should be 'ftyp'
    return (
      buf.length >= 12 &&
      buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
    );
  }
  const sigs = MAGIC[family] || [];
  for (const sig of sigs) {
    let ok = true;
    for (let i = 0; i < sig.length; i++) {
      if (buf[i] !== sig[i]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Infer file type family from extension.
 */
function familyFromExt(ext) {
  ext = String(ext || '').toLowerCase().replace(/^\./, '');
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jpe') return 'jpg';
  if (ext === 'png') return 'png';
  if (ext === 'gif') return 'gif';
  if (ext === 'webp') return 'webp';
  if (ext === 'bmp') return 'bmp';
  if (ext === 'mp4' || ext === 'm4v') return 'mp4';
  if (ext === 'mov') return 'mov';
  if (ext === 'flv') return 'flv';
  return null;
}

/**
 * Auto-detect family from buffer magic bytes.
 */
function detectFamily(buf) {
  if (!buf || buf.length < 4) return null;
  for (const fam of ['jpg', 'png', 'gif', 'webp', 'bmp', 'flv']) {
    if (matchesFamily(buf, fam)) return fam;
  }
  if (matchesFamily(buf, 'mp4')) return 'mp4';
  return null;
}

/**
 * Validate a local file.
 * @param {string} filePath
 * @param {object} [opts]
 *   - minSize: minimum byte size (default 64)
 *   - expectedFamily: expected family; if given, checks magic bytes
 *   - maxHtmlSnippet: how many bytes to sniff for HTML
 * @returns {{ok: boolean, reason?: string, size?: number}}
 */
function validateFile(filePath, opts = {}) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    return { ok: false, reason: 'missing' };
  }
  if (!stat.isFile()) return { ok: false, reason: 'not-file' };
  const minSize = opts.minSize ?? 64;
  if (stat.size < minSize) return { ok: false, reason: `too-small (${stat.size}B)`, size: stat.size };

  // Read only the first 32 KB for magic / HTML detection
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(Math.min(32768, stat.size));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);

  // Sniff HTML / error pages
  const head = buf.slice(0, Math.min(buf.length, opts.maxHtmlSnippet ?? 2048))
    .toString('utf8', 0, Math.min(buf.length, 2048))
    .toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') ||
      head.includes('<title>403') || head.includes('forbidden') ||
      head.includes('errno') && head.includes('腾讯')) {
    return { ok: false, reason: 'looks-like-error-html', size: stat.size };
  }

  if (opts.expectedFamily) {
    if (!matchesFamily(buf, opts.expectedFamily)) {
      return { ok: false, reason: `magic-mismatch (expected ${opts.expectedFamily})`, size: stat.size };
    }
  } else {
    // No expected family specified; at least sniff for a known family
    const fam = detectFamily(buf);
    if (!fam) return { ok: false, reason: 'unknown-format', size: stat.size };
  }

  return { ok: true, size: stat.size };
}

module.exports = {
  validateFile,
  matchesFamily,
  familyFromExt,
  detectFamily,
  MAGIC,
};
