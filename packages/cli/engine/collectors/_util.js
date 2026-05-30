/**
 * Shared utilities for collectors: read/write JSON data files,
 * compute custom_filename, etc.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/**
 * Write data as a pure JSON file.
 */
function writeData(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Read and parse a pure JSON data file.
 * Returns { ok: boolean, value: any, raw: string }.
 * File missing => ok=false, value=undefined.
 * File exists but corrupt (JSON parse failure) => auto-backup to .broken-{ts}.bak, then ok=false.
 * Callers should reset the module's progress.lastPage to -1 on ok=false to re-fetch from scratch.
 */
function readData(filePath, logger = console) {
  if (!fs.existsSync(filePath)) return { ok: false, value: undefined, raw: '' };
  let txt = '';
  try {
    txt = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    logger.warn(`[readData] failed to read ${filePath}: ${e.message}`);
    return { ok: false, value: undefined, raw: '' };
  }
  try {
    const value = JSON.parse(txt);
    return { ok: true, value, raw: txt };
  } catch (e) {
    logger.warn(`[readData] ${filePath} JSON parse failed: ${e.message}`);
    backupBroken(filePath);
    return { ok: false, value: undefined, raw: txt };
  }
}

function backupBroken(filePath) {
  try {
    const bak = `${filePath}.broken-${Date.now()}.bak`;
    fs.copyFileSync(filePath, bak);
  } catch (_) {}
}

/**
 * Sanitize filenames: strip characters not allowed on Windows.
 */
function sanitizeFilename(name, maxLen = 200) {
  let s = String(name == null ? '' : name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .replace(/[. ]+$/, '');
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(s)) s = '_' + s;
  return s || '_';
}

/**
 * Same rules applied to each path segment (prevent illegal directory names via path.join).
 */
function sanitizePathSegment(seg) {
  return sanitizeFilename(seg, 120);
}

/**
 * Short hash for disambiguation.
 */
function shortHash(str, n = 8) {
  return crypto.createHash('md5').update(String(str || '')).digest('hex').toUpperCase().slice(0, n);
}

/**
 * Infer file extension from URL path; falls back to the given default.
 */
function extFromUrl(url, fallback = 'jpeg') {
  try {
    const u = new URL(url);
    const m = /\.([a-z0-9]+)(?:$|[?#])/i.exec(u.pathname);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return fallback;
}

/**
 * Upgrade QZone URL size flags from thumbnail (/a, /m) to full-size (/b).
 */
function preferOriginal(url) {
  if (!url) return url;
  return String(url)
    .replace(/!\/a\//g, '!/b/')
    .replace(/!\/m\//g, '!/b/')
    .replace(/!\/a&/g, '!/b&')
    .replace(/!\/m&/g, '!/b&');
}

module.exports = {
  ensureDir,
  writeData,
  readData,
  sanitizeFilename,
  sanitizePathSegment,
  shortHash,
  extFromUrl,
  preferOriginal,
};
