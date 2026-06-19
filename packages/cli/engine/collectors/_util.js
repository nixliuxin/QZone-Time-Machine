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

/**
 * Randomized sleep: actual duration is uniformly distributed in [ms * 0.6, ms * 1.4].
 * Prevents fixed-interval patterns detectable by anti-scraping systems.
 */
function randomSleep(ms) {
  const actual = Math.round(ms * (0.6 + Math.random() * 0.8));
  return new Promise((resolve) => setTimeout(resolve, actual));
}

/**
 * ID field name for each data module.
 * Used by mergeByIds, incremental fetch, and convert merge.
 */
const MODULE_ID_FIELDS = {
  messages:  'tid',
  blogs:     item => item.blogId || item.blogid,
  boards:    'id',
  diaries:   'blogid',
  shares:    'id',
  videos:    item => item.vid || item.video_id || item.id,
  favorites: 'id',
  visitors:  item => `${item.uin}_${item.time || item.pubtime || ''}`,
  friends:   'uin',
  photos:    'lloc',
  albums:    'id',
};

/**
 * Field holding the original (pre-reconcile) synthetic id after an item's
 * primary id has been promoted to the real QZone id. Kept so that cross-machine
 * merges (dedup-dirs) and resumes still recognise the synthetic-id copy on the
 * other machine as the same logical item. See engine/reconcile.js.
 */
const LEGACY_ID_FIELD = 'legacyId';

/**
 * Extract the unique ID from an item given its module name.
 * @param {string} moduleName
 * @param {object} item
 * @returns {string|number|undefined}
 */
function getItemId(moduleName, item) {
  const field = MODULE_ID_FIELDS[moduleName];
  if (!field) return undefined;
  if (typeof field === 'function') return field(item);
  return item[field];
}

/**
 * All identity keys for an item: its primary id plus its retained legacy id
 * (if any). Two items are the "same logical item" if any of their keys overlap.
 * @returns {string[]}
 */
function getItemKeys(moduleName, item) {
  const keys = [];
  const id = getItemId(moduleName, item);
  if (id !== undefined && id !== null && id !== '') keys.push(String(id));
  const legacy = item && item[LEGACY_ID_FIELD];
  if (legacy !== undefined && legacy !== null && legacy !== '') {
    const ls = String(legacy);
    if (!keys.includes(ls)) keys.push(ls);
  }
  return keys;
}

/**
 * Prefer the item whose primary id is "resolved" (a real QZone id) over a
 * synthetic-id copy. An item carrying a legacyId has been reconciled, so its
 * primary id is real; an item flagged idUnresolved is still synthetic.
 */
function preferResolved(a, b) {
  const aLegacy = a && a[LEGACY_ID_FIELD] != null;
  const bLegacy = b && b[LEGACY_ID_FIELD] != null;
  if (aLegacy && !bLegacy) return a;
  if (bLegacy && !aLegacy) return b;
  const aUn = !!(a && a.idUnresolved);
  const bUn = !!(b && b.idUnresolved);
  if (aUn && !bUn) return b;
  if (bUn && !aUn) return a;
  return a;
}

const ENRICH_ARRAY_FIELDS = ['comments', 'likes', 'custom_replies', 'custom_comments'];
const ENRICH_SCALAR_FIELDS = ['readnum', 'custom_html'];

/**
 * Field-level merge: keep `primary` as the canonical record but backfill any
 * enrichment the `other` copy has and primary lacks (so neither machine's
 * comments/likes/readnum/body are lost when the two copies are combined).
 */
function mergeFields(primary, other) {
  const out = { ...other, ...primary };
  for (const f of ENRICH_ARRAY_FIELDS) {
    const p = Array.isArray(primary[f]) ? primary[f].length : 0;
    const o = Array.isArray(other[f]) ? other[f].length : 0;
    if (o > p) out[f] = other[f];
  }
  for (const f of ENRICH_SCALAR_FIELDS) {
    const empty = (v) => v === undefined || v === null || v === '';
    if (empty(primary[f]) && !empty(other[f])) out[f] = other[f];
  }
  return out;
}

/**
 * Merge two item arrays, alias-aware.
 *
 * Items collide when ANY of their identity keys overlap (primary id OR retained
 * legacyId), so a synthetic-id copy ("35") and its reconciled real-id copy
 * (real id + legacyId "35") are recognised as the same item instead of being
 * duplicated. On collision the resolved (real-id) representation is kept; with
 * opts.fieldMerge the enrichment from both copies is combined.
 *
 * @param {Array} base      - items kept when ids collide (higher priority)
 * @param {Array} incoming  - items added if not already present
 * @param {string} moduleName
 * @param {object} [opts]
 *   - sortField: sort merged result by this field (descending)
 *   - fieldMerge: field-level merge enrichment on collision (default false)
 * @returns {{ merged: Array, addedCount: number, duplicateCount: number }}
 */
function mergeByIds(base, incoming, moduleName, opts = {}) {
  const fieldMerge = !!opts.fieldMerge;
  const entries = [];
  const keyToEntry = new Map();
  let placeholderN = 0;

  const indexEntry = (item) => {
    let keys = getItemKeys(moduleName, item);
    if (keys.length === 0) keys = [`__idx_${placeholderN++}`];
    let existing = null;
    for (const k of keys) {
      if (keyToEntry.has(k)) { existing = keyToEntry.get(k); break; }
    }
    if (!existing) {
      const entry = { item, keys: new Set(keys) };
      entries.push(entry);
      for (const k of keys) keyToEntry.set(k, entry);
      return { entry, isNew: true };
    }
    for (const k of keys) { if (!existing.keys.has(k)) { existing.keys.add(k); keyToEntry.set(k, existing); } }
    return { entry: existing, isNew: false };
  };

  for (const item of base) indexEntry(item);

  let addedCount = 0;
  let duplicateCount = 0;
  for (const item of incoming) {
    const { entry, isNew } = indexEntry(item);
    if (isNew) { addedCount++; continue; }
    duplicateCount++;
    const preferred = preferResolved(entry.item, item);
    const otherCopy = preferred === entry.item ? item : entry.item;
    entry.item = fieldMerge ? mergeFields(preferred, otherCopy) : preferred;
    for (const k of getItemKeys(moduleName, entry.item)) {
      if (!entry.keys.has(k)) { entry.keys.add(k); keyToEntry.set(k, entry); }
    }
  }

  let merged = entries.map((e) => e.item);

  if (opts.sortField) {
    merged.sort((a, b) => {
      const va = a[opts.sortField] || 0;
      const vb = b[opts.sortField] || 0;
      return vb - va;
    });
  }

  return { merged, addedCount, duplicateCount };
}

/**
 * Build a Set of known item IDs from an existing array (primary id + legacyId).
 * Used by incremental collectors to detect the "already fetched" boundary.
 */
function buildIdSet(items, moduleName) {
  const set = new Set();
  for (const item of items) {
    for (const k of getItemKeys(moduleName, item)) set.add(k);
  }
  return set;
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
  randomSleep,
  MODULE_ID_FIELDS,
  LEGACY_ID_FIELD,
  getItemId,
  getItemKeys,
  mergeByIds,
  mergeFields,
  buildIdSet,
};
