/**
 * Reconcile synthetic ids in converted-from-legacy backups.
 *
 * Old QZoneExport dumps stored some items with synthetic ids instead of the
 * real QZone id:
 *   - blogs : sequential counters ("1","2","35") instead of >=6-digit blogIds
 *   - boards : short sequential ids ("1".."284") instead of ~10-digit ids
 *   - albums : UUIDs ("06bf9fe4-...") instead of the real album id
 * Synthetic ids cannot be addressed by the per-item APIs (read counts, comments,
 * likes), and they make cross-machine merges duplicate. This module re-fetches
 * the live LIST for the affected module (cheap, ~paged), matches each synthetic
 * local item to its live counterpart by content+time, and promotes the real id
 * to the primary id field while retaining the synthetic one in `legacyId`.
 *
 * Matching is conservative: only a UNIQUE high-confidence match is applied;
 * ambiguous or unmatched (e.g. deleted) items keep their synthetic id and are
 * flagged `idUnresolved` so they are reported and never silently mis-linked.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readData, randomSleep, mergeByIds, LEGACY_ID_FIELD } = require('./collectors/_util.js');
const blogsApi = require('./api/blogs.js');
const boardsApi = require('./api/boards.js');
const photosApi = require('./api/photos.js');

// ─── synthetic-id detection ───
const REAL_BLOG_ID = /^\d{6,}$/;
const SHORT_NUMERIC = /^\d{1,5}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSyntheticBlogId(id) {
  const s = String(id == null ? '' : id);
  return s !== '' && !REAL_BLOG_ID.test(s);
}
function isSyntheticBoardId(id) {
  return SHORT_NUMERIC.test(String(id == null ? '' : id));
}
function isSyntheticAlbumId(id) {
  return UUID_RE.test(String(id == null ? '' : id));
}

// ─── normalisation helpers (build stable match keys) ───
function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Normalise a timestamp to "YYYY-MM-DD HH:MM".
 * Unix seconds are formatted in UTC so they line up with ISO strings produced
 * by `convert` (which uses Date.toISOString(), i.e. UTC). Plain
 * "YYYY-MM-DD HH:MM" strings are taken verbatim (both sides share the format).
 */
function normTime(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' || /^\d{9,11}$/.test(String(v))) {
    const d = new Date(Number(v) * 1000);
    if (!isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    }
    return '';
  }
  const s = String(v).trim().replace('T', ' ');
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])} ${pad2(m[4])}:${m[5]}`;
  return s;
}

/** Normalise a title/name for matching: trim + collapse internal whitespace. */
function normText(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

// ─── live list fetch (paginated, dedup by real id) ───
async function fetchLiveBlogs({ client, targetUin }) {
  const out = []; const seen = new Set();
  for (let page = 0; page < 400; page++) {
    const json = await blogsApi.getBlogs({ client, targetUin, page, pageSize: 50 });
    const data = (json && json.data) || {};
    const list = Array.isArray(data.list) ? data.list : [];
    if (list.length === 0) break;
    let added = 0;
    for (const b of list) {
      const id = String(b.blogId || b.blogid || '');
      if (id && !seen.has(id)) { seen.add(id); out.push(b); added++; }
    }
    const total = typeof data.totalNum === 'number' ? data.totalNum : 0;
    if (total && out.length >= total) break;
    if (added === 0) break;
    await randomSleep(800);
  }
  return out;
}

async function fetchLiveBoards({ client, targetUin }) {
  const out = []; const seen = new Set();
  for (let page = 0; page < 400; page++) {
    const json = await boardsApi.getBoards({ client, targetUin, page, pageSize: 20 });
    const data = (json && json.data) || {};
    const list = Array.isArray(data.commentList) ? data.commentList : [];
    if (list.length === 0) break;
    let added = 0;
    for (const it of list) {
      const id = String(it.id == null ? '' : it.id);
      if (id && !seen.has(id)) { seen.add(id); out.push(it); added++; }
    }
    const total = typeof data.total === 'number' ? data.total : 0;
    if (total && out.length >= total) break;
    if (added === 0) break;
    await randomSleep(800);
  }
  return out;
}

async function fetchLiveAlbums({ client, targetUin }) {
  const out = []; const seen = new Set();
  let idcNum = 0;
  try { idcNum = await photosApi.getRoute({ client, targetUin }); } catch (_) {}
  for (let page = 0; page < 200; page++) {
    const json = await photosApi.getAlbums({ client, targetUin, page, pageSize: 30, idcNum });
    const data = (json && json.data) || {};
    const list = Array.isArray(data.albumListModeSort) ? data.albumListModeSort
      : (Array.isArray(data.albumList) ? data.albumList : []);
    if (list.length === 0) break;
    let added = 0;
    for (const a of list) {
      const id = String(a.id == null ? '' : a.id);
      if (id && !seen.has(id)) { seen.add(id); out.push(a); added++; }
    }
    const total = typeof data.albumsInUser === 'number' ? data.albumsInUser : 0;
    if (total && out.length >= total) break;
    if (added === 0) break;
    await randomSleep(800);
  }
  return out;
}

// ─── matching ───
/**
 * Build a key->[liveItems] index. Keys with >1 live item are ambiguous and
 * will not be auto-applied.
 */
function buildLiveIndex(liveItems, keyFn) {
  const map = new Map();
  for (const it of liveItems) {
    const k = keyFn(it);
    if (!k) continue;
    if (map.has(k)) map.get(k).push(it); else map.set(k, [it]);
  }
  return map;
}

const KEYS = {
  blogs: {
    local: (b) => `${normText(b.title)}|${normTime(b.pubTime || b.pubtime)}`,
    live: (b) => `${normText(b.title)}|${normTime(b.pubtime || b.pubTime)}`,
    realId: (b) => String(b.blogId || b.blogid || ''),
  },
  boards: {
    local: (b) => `${b.uin == null ? '' : b.uin}|${normTime(b.pubtime || b.time)}`,
    live: (b) => `${b.uin == null ? '' : b.uin}|${normTime(b.pubtime || b.time)}`,
    realId: (b) => String(b.id == null ? '' : b.id),
  },
  albums: {
    local: (a) => `${normText(a.name)}|${normTime(a.createtime)}`,
    live: (a) => `${normText(a.name)}|${normTime(a.createtime)}`,
    realId: (a) => String(a.id == null ? '' : a.id),
  },
};

/**
 * Match synthetic local items against a live list.
 * @returns {{ resolved: Map<oldId,newId>, ambiguous: number, unmatched: number }}
 */
function matchItems(syntheticItems, liveItems, moduleName, oldIdFn) {
  const k = KEYS[moduleName];
  const liveIndex = buildLiveIndex(liveItems, k.live);
  const usedRealIds = new Set();
  const resolved = new Map();
  let ambiguous = 0, unmatched = 0;
  for (const item of syntheticItems) {
    const key = k.local(item);
    const cands = (key && liveIndex.get(key)) || [];
    if (cands.length === 1) {
      const realId = k.realId(cands[0]);
      if (realId && !usedRealIds.has(realId)) {
        usedRealIds.add(realId);
        resolved.set(String(oldIdFn(item)), realId);
      } else {
        ambiguous++;
      }
    } else if (cands.length > 1) {
      ambiguous++;
    } else {
      unmatched++;
    }
  }
  return { resolved, ambiguous, unmatched };
}

// ─── per-module reconcile ───
function unwrap(value) {
  if (Array.isArray(value)) return { items: value, wrap: (items) => items };
  if (value && Array.isArray(value.items)) return { items: value.items, wrap: (items) => ({ ...value, items }) };
  return { items: [], wrap: (items) => items };
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

async function reconcileBlogsBoards({ client, userDir, targetUin, moduleName, fetchLive, apply, logger }) {
  const file = path.join(userDir, 'data', `${moduleName}.json`);
  const r = readData(file, logger);
  if (!r.ok) return { synthetic: 0, matched: 0, ambiguous: 0, unmatched: 0, skipped: 'no-file' };
  const { items, wrap } = unwrap(r.value);
  const detect = moduleName === 'blogs' ? isSyntheticBlogId : isSyntheticBoardId;
  const oldIdFn = moduleName === 'blogs'
    ? (b) => b.blogId || b.blogid
    : (b) => b.id;
  const synthetic = items.filter((it) => detect(oldIdFn(it)));
  if (synthetic.length === 0) return { synthetic: 0, matched: 0, ambiguous: 0, unmatched: 0 };

  const live = await fetchLive({ client, targetUin });
  const { resolved, ambiguous, unmatched } = matchItems(synthetic, live, moduleName, oldIdFn);
  // A "match" whose live id equals the local id means the id was real all along
  // (e.g. very old blogs legitimately have tiny blogIds, or an album's UUID is
  // its genuine id). Only a DIFFERING live id is a true synthetic→real promotion.
  let changed = 0;
  for (const [oldId, realId] of resolved) if (String(realId) !== String(oldId)) changed++;

  if (apply) {
    for (const it of items) {
      const oldId = String(oldIdFn(it));
      // Self-heal: drop a redundant legacyId left by an earlier over-eager pass
      // (legacyId === current id means nothing was actually relabelled).
      if (it[LEGACY_ID_FIELD] != null && String(it[LEGACY_ID_FIELD]) === oldId) delete it[LEGACY_ID_FIELD];
      if (resolved.has(oldId)) {
        const realId = resolved.get(oldId);
        if (String(realId) !== oldId) {
          if (it[LEGACY_ID_FIELD] == null) it[LEGACY_ID_FIELD] = oldId;
          if (moduleName === 'blogs') { it.blogId = realId; it.blogid = realId; }
          else { it.id = realId; }
        }
        delete it.idUnresolved;
      } else if (detect(oldIdFn(it))) {
        it.idUnresolved = true;
      }
    }
    writeJsonAtomic(file, wrap(items));
  }
  return { synthetic: synthetic.length, matched: resolved.size, changed, ambiguous, unmatched, liveCount: live.length };
}

async function reconcileAlbums({ client, userDir, targetUin, apply, logger }) {
  const photosDir = path.join(userDir, 'data', 'photos');
  const albumsFile = path.join(photosDir, 'albums.json');
  const r = readData(albumsFile, logger);
  if (!r.ok) return { synthetic: 0, matched: 0, ambiguous: 0, unmatched: 0, skipped: 'no-file' };
  const { items: albums, wrap } = unwrap(r.value);
  const synthetic = albums.filter((a) => isSyntheticAlbumId(a.id));
  if (synthetic.length === 0) return { synthetic: 0, matched: 0, ambiguous: 0, unmatched: 0 };

  const live = await fetchLiveAlbums({ client, targetUin });
  const { resolved, ambiguous, unmatched } = matchItems(synthetic, live, 'albums', (a) => a.id);
  let changed = 0;
  for (const [oldId, realId] of resolved) if (String(realId) !== String(oldId)) changed++;

  if (apply) {
    for (const album of albums) {
      const oldId = String(album.id);
      if (album[LEGACY_ID_FIELD] != null && String(album[LEGACY_ID_FIELD]) === oldId) delete album[LEGACY_ID_FIELD];
      if (resolved.has(oldId)) {
        const realId = resolved.get(oldId);
        if (String(realId) !== oldId) {
          if (album[LEGACY_ID_FIELD] == null) album[LEGACY_ID_FIELD] = oldId;
          album.id = realId;
          remapAlbumFile(photosDir, oldId, realId, logger);
        }
        delete album.idUnresolved;
      } else if (isSyntheticAlbumId(album.id)) {
        album.idUnresolved = true;
      }
    }
    writeJsonAtomic(albumsFile, wrap(albums));
  }
  return { synthetic: synthetic.length, matched: resolved.size, changed, ambiguous, unmatched, liveCount: live.length };
}

/**
 * Rename data/photos/{oldId}.json -> {realId}.json and rewrite each photo's
 * albumId. Crash-safe: write the new file first, then remove the old one. If
 * the target already exists, photo arrays are merged by lloc.
 */
function remapAlbumFile(photosDir, oldId, realId, logger) {
  const oldFile = path.join(photosDir, `${oldId}.json`);
  const newFile = path.join(photosDir, `${realId}.json`);
  if (!fs.existsSync(oldFile)) return;
  let oldArr;
  try { oldArr = JSON.parse(fs.readFileSync(oldFile, 'utf8')); } catch (e) {
    logger && logger.warn && logger.warn(`[reconcile] album ${oldId}.json unreadable: ${e.message}`);
    return;
  }
  if (!Array.isArray(oldArr)) return;
  for (const p of oldArr) { if (p && typeof p === 'object') p.albumId = realId; }

  let outArr = oldArr;
  if (fs.existsSync(newFile) && path.resolve(newFile) !== path.resolve(oldFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(newFile, 'utf8'));
      if (Array.isArray(existing)) {
        outArr = mergeByIds(existing, oldArr, 'photos', { fieldMerge: true }).merged;
      }
    } catch (_) {}
  }
  writeJsonAtomic(newFile, outArr);
  if (path.resolve(newFile) !== path.resolve(oldFile)) fs.rmSync(oldFile, { force: true });
}

// ─── public API ───
const ALL_MODULES = ['blogs', 'boards', 'albums'];

/**
 * Scan a single user dir (no network) and report synthetic-id counts per module.
 */
function scanUserDir(userDir, modules = ALL_MODULES) {
  const out = {};
  if (modules.includes('blogs')) out.blogs = countSynthetic(path.join(userDir, 'data', 'blogs.json'), (b) => b.blogId || b.blogid, isSyntheticBlogId);
  if (modules.includes('boards')) out.boards = countSynthetic(path.join(userDir, 'data', 'boards.json'), (b) => b.id, isSyntheticBoardId);
  if (modules.includes('albums')) out.albums = countSynthetic(path.join(userDir, 'data', 'photos', 'albums.json'), (a) => a.id, isSyntheticAlbumId);
  return out;
}

function countSynthetic(file, idFn, detect) {
  if (!fs.existsSync(file)) return { total: 0, synthetic: 0 };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return { total: 0, synthetic: 0, broken: true }; }
  const items = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
  let synthetic = 0;
  for (const it of items) if (detect(idFn(it))) synthetic++;
  return { total: items.length, synthetic };
}

/**
 * Reconcile one user dir. With apply=false this still fetches live lists to
 * compute match rates (dry-run); with apply=true it writes corrected ids.
 */
async function reconcileUser({ client, userDir, targetUin, modules = ALL_MODULES, apply = false, logger = console }) {
  const report = { uin: targetUin, modules: {} };
  if (modules.includes('blogs')) {
    report.modules.blogs = await reconcileBlogsBoards({ client, userDir, targetUin, moduleName: 'blogs', fetchLive: fetchLiveBlogs, apply, logger });
  }
  if (modules.includes('boards')) {
    report.modules.boards = await reconcileBlogsBoards({ client, userDir, targetUin, moduleName: 'boards', fetchLive: fetchLiveBoards, apply, logger });
  }
  if (modules.includes('albums')) {
    report.modules.albums = await reconcileAlbums({ client, userDir, targetUin, apply, logger });
  }
  return report;
}

module.exports = {
  ALL_MODULES,
  isSyntheticBlogId,
  isSyntheticBoardId,
  isSyntheticAlbumId,
  normTime,
  normText,
  matchItems,
  scanUserDir,
  reconcileUser,
  reconcileBlogsBoards,
  reconcileAlbums,
  fetchLiveBlogs,
  fetchLiveBoards,
  fetchLiveAlbums,
};
