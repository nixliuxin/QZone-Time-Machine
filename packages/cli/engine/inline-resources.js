/**
 * inline-resources.js — Download all inline remote media URLs from collector
 * output JSON to local files, writing back `custom_filepath`,
 * `custom_pre_filepath`, etc. on each resource object.
 *
 * Must run after augment (depends on custom_images / custom_videos /
 * custom_audios / custom_magics / custom_voices being present).
 *
 * Resource storage (relative to userDir):
 *   <Module>/images/<sha1>.<ext>     - images (pic_id, smallurl, custom_url)
 *   <Module>/videos/<sha1>.<ext>     - video files (video.url3)
 *   <Module>/posters/<sha1>.<ext>    - video covers (video.url1 / pic_url)
 *   <Module>/audios/<sha1>.<ext>     - audio files
 *
 * Field write-back:
 *   image.custom_filepath        - <Module>/images/...
 *   image.custom_pre_filepath    - <Module>/images/... (smallurl, if present)
 *   video.custom_filepath        - <Module>/videos/...
 *   video.custom_pre_filepath    - <Module>/posters/...
 *   audio.custom_filepath        - <Module>/audios/...
 *
 * Templates typically use `<%:= image.custom_filepath || image.custom_url %>`,
 * so when custom_filepath has a value the browser uses the local resource;
 * on download failure it falls back to the remote URL.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { augmentUserDir, MODULE_RULES, getArr, loadData, writeData } = require('./augment.js');
const { preferOriginal } = require('./collectors/_util.js');

/* ---------- url & file helpers ---------- */

function sha1Of(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16); }

function extFromUrl(url, fallback = 'bin') {
  try {
    const u = new URL(url);
    const p = u.pathname;
    const m = p.match(/\.([a-zA-Z0-9]{1,5})(?=$|\?|#|\/)/);
    if (m) {
      const e = m[1].toLowerCase();
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'mp3', 'm4a', 'wav', 'aac', 'ogg', 'flv'].includes(e)) {
        return e === 'jpeg' ? 'jpg' : e;
      }
    }
  } catch (_) {}
  return fallback;
}

function fetchBuf(url, redirects = 4) {
  return new Promise((resolve, reject) => {
    let lib;
    try { lib = url.startsWith('https') ? https : http; }
    catch (_) { return reject(new Error('bad url')); }
    const req = lib.get(url, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const sc = res.statusCode || 0;
      if (sc >= 300 && sc < 400 && res.headers.location && redirects > 0) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return fetchBuf(next, redirects - 1).then(resolve, reject);
      }
      if (sc !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${sc}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function fetchBufWithClient(client, url) {
  // Uses axios + cookie for resources requiring authentication (e.g. photovideo.photo.qq.com videos)
  const { status, data } = await client.download(url, { timeoutMs: 90000 });
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return data;
}

/** Whether to use the authenticated client for downloading */
function needsClient(url) {
  if (!url) return false;
  return /photovideo\.photo\.qq\.com|qzone\.qq\.com|vuser\.qq\.com/i.test(url);
}

async function downloadOne({ url, dst, minBytes = 200, retries = 1, client = null }) {
  if (!url || !/^https?:/.test(url)) return 'invalid';
  if (fs.existsSync(dst) && fs.statSync(dst).size >= minBytes) return 'skip';
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const useClient = client && needsClient(url);
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const buf = useClient ? await fetchBufWithClient(client, url) : await fetchBuf(url);
      if (buf.length < minBytes) { lastErr = new Error(`too small ${buf.length}B`); continue; }
      fs.writeFileSync(dst, buf);
      return 'ok';
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* ---------- task expansion ---------- */
/**
 * Expand a resource object (image/video/audio) into 0~N download tasks.
 * Each task = { url, kind, dst, urlField, fileField, parent }
 *   parent = the resource object (for field write-back)
 *   urlField / fileField = which fields to write on parent
 *
 * Same URL is not downloaded twice (url-hash as filename provides natural dedup).
 */
// custom_filepath path convention: relative to userDir root
//   image.custom_filepath = "media/messages/images/<sha1>.jpg"
//   video.custom_filepath = "media/messages/videos/<sha1>.mp4"
//   poster.custom_pre_filepath = "media/messages/posters/<sha1>.jpg"
// A task is (re)created when the field is unwritten OR the local file is
// actually missing (self-heals manual deletion / disk corruption). The
// existsSync is a cheap local stat and never re-downloads files that exist.
function needsTask(parent, fileField, dst) {
  return !parent[fileField] || !fs.existsSync(dst);
}

function imageTasks(parent, moduleDir, relPrefix) {
  const tasks = [];
  let big = parent.url2 || parent.url1 || parent.custom_url || parent.url || parent.b_url;
  if (big && /^https?:/.test(big)) big = preferOriginal(big);
  if (big && /^https?:/.test(big)) {
    const ext = extFromUrl(big, 'jpg');
    const fname = `${sha1Of(big)}.${ext}`;
    const dst = path.join(moduleDir, 'images', fname);
    if (needsTask(parent, 'custom_filepath', dst)) {
      tasks.push({
        url: big, kind: 'image', dst,
        relpath: `${relPrefix}/images/${fname}`,
        writeFile: 'custom_filepath', writeUrl: 'custom_url', parent,
      });
    }
  }
  let small = parent.smallurl || parent.pre || parent.custom_pre_url;
  if (small && /^https?:/.test(small) && small !== big) {
    const ext = extFromUrl(small, 'jpg');
    const fname = `${sha1Of(small)}.${ext}`;
    const dst = path.join(moduleDir, 'images', fname);
    if (needsTask(parent, 'custom_pre_filepath', dst)) {
      tasks.push({
        url: small, kind: 'image', dst,
        relpath: `${relPrefix}/images/${fname}`,
        writeFile: 'custom_pre_filepath', writeUrl: 'custom_pre_url', parent,
      });
    }
  }
  return tasks;
}

function videoTasks(parent, moduleDir, relPrefix) {
  const tasks = [];
  const mp4 = parent.url3 || parent.custom_url || parent.video_url;
  if (mp4 && /^https?:/.test(mp4)) {
    const ext = extFromUrl(mp4, 'mp4');
    const fname = `${sha1Of(parent.video_id || mp4)}.${ext}`;
    const dst = path.join(moduleDir, 'videos', fname);
    if (needsTask(parent, 'custom_filepath', dst)) {
      tasks.push({
        url: mp4, kind: 'video', dst,
        relpath: `${relPrefix}/videos/${fname}`,
        writeFile: 'custom_filepath', writeUrl: 'custom_url', parent,
        minBytes: 5_000,
      });
    }
  }
  const poster = parent.url1 || parent.pic_url || parent.custom_pre_url;
  if (poster && /^https?:/.test(poster)) {
    const ext = extFromUrl(poster, 'jpg');
    const fname = `${sha1Of(poster)}.${ext}`;
    const dst = path.join(moduleDir, 'posters', fname);
    if (needsTask(parent, 'custom_pre_filepath', dst)) {
      tasks.push({
        url: poster, kind: 'poster', dst,
        relpath: `${relPrefix}/posters/${fname}`,
        writeFile: 'custom_pre_filepath', writeUrl: 'custom_pre_url', parent,
      });
    }
  }
  return tasks;
}

function audioTasks(parent, moduleDir, relPrefix) {
  const tasks = [];
  const mp3 = parent.playurl || parent.url || parent.custom_url;
  if (mp3 && /^https?:/.test(mp3)) {
    const ext = extFromUrl(mp3, 'mp3');
    const fname = `${sha1Of(mp3)}.${ext}`;
    const dst = path.join(moduleDir, 'audios', fname);
    if (needsTask(parent, 'custom_filepath', dst)) {
      tasks.push({
        url: mp3, kind: 'audio', dst,
        relpath: `${relPrefix}/audios/${fname}`,
        writeFile: 'custom_filepath', writeUrl: 'custom_url', parent,
        minBytes: 1_000,
      });
    }
  }
  const cover = parent.image || parent.cover_url;
  if (cover && /^https?:/.test(cover)) {
    const ext = extFromUrl(cover, 'jpg');
    const fname = `${sha1Of(cover)}.${ext}`;
    const dst = path.join(moduleDir, 'images', fname);
    if (needsTask(parent, 'custom_image_filepath', dst)) {
      tasks.push({
        url: cover, kind: 'image', dst,
        relpath: `${relPrefix}/images/${fname}`,
        writeFile: 'custom_image_filepath', writeUrl: null, parent,
      });
    }
  }
  return tasks;
}

function magicTasks(parent, moduleDir, relPrefix) {
  const tasks = [];
  const u = parent.custom_url || parent.url1 || parent.url;
  if (u && /^https?:/.test(u)) {
    const ext = extFromUrl(u, 'gif');
    const fname = `${sha1Of(u)}.${ext}`;
    const dst = path.join(moduleDir, 'magics', fname);
    if (needsTask(parent, 'custom_filepath', dst)) {
      tasks.push({
        url: u, kind: 'image', dst,
        relpath: `${relPrefix}/magics/${fname}`,
        writeFile: 'custom_filepath', writeUrl: 'custom_url', parent,
      });
    }
  }
  return tasks;
}

function expandItemTasks(item, moduleDir, relPrefix) {
  const tasks = [];
  if (Array.isArray(item.custom_images)) {
    for (const im of item.custom_images) tasks.push(...imageTasks(im, moduleDir, relPrefix));
  }
  if (Array.isArray(item.custom_origin_images)) {
    for (const im of item.custom_origin_images) tasks.push(...imageTasks(im, moduleDir, relPrefix));
  }
  if (Array.isArray(item.custom_videos)) {
    for (const v of item.custom_videos) tasks.push(...videoTasks(v, moduleDir, relPrefix));
  }
  if (Array.isArray(item.custom_audios)) {
    for (const a of item.custom_audios) tasks.push(...audioTasks(a, moduleDir, relPrefix));
  }
  if (Array.isArray(item.custom_magics)) {
    for (const m of item.custom_magics) tasks.push(...magicTasks(m, moduleDir, relPrefix));
  }
  return tasks;
}

/* ---------- pool runner ---------- */

async function runPool(tasks, concurrency, onTick, client = null) {
  let idx = 0, ok = 0, skip = 0, fail = 0, invalid = 0;
  const failures = [];
  const workers = Array(Math.min(concurrency, tasks.length || 1)).fill(0).map(async () => {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      try {
        const r = await downloadOne({ url: t.url, dst: t.dst, minBytes: t.minBytes, client });
        if (r === 'ok' || r === 'skip') {
          if (t.writeFile) t.parent[t.writeFile] = t.relpath;
          if (r === 'ok') ok++; else skip++;
        } else if (r === 'invalid') {
          invalid++;
        }
      } catch (e) {
        fail++;
        failures.push({ url: t.url, kind: t.kind, err: e.message });
      }
      if (onTick && (idx % 20 === 0 || idx === tasks.length)) onTick({ idx, total: tasks.length, ok, skip, fail, invalid });
    }
  });
  await Promise.all(workers);
  return { ok, skip, fail, invalid, failures };
}

/* ---------- main ---------- */

async function downloadInlineResources(userDir, opts = {}) {
  const logger = opts.logger || null;
  const concurrency = opts.concurrency || 6;
  const downloadVideos = opts.downloadVideos !== false;
  const downloadAudios = opts.downloadAudios !== false;
  const client = opts.client || null;
  const onlyModule = opts.module || null;  // e.g. 'messages' to limit
  const log = (s) => logger ? logger.info(s) : console.log(s);
  const warn = (s) => logger ? logger.warn(s) : console.warn(s);

  augmentUserDir(userDir, { logger, module: onlyModule });

  const summary = {};
  for (const rule of MODULE_RULES) {
    if (onlyModule && rule.mediaDir !== onlyModule) continue;
    const file = path.join(userDir, 'data', rule.dataFile);
    if (!fs.existsSync(file)) continue;
    const data = loadData(file);
    const arr = getArr(data, rule);
    if (!arr || arr.length === 0) continue;

    const moduleDir = path.join(userDir, 'media', rule.mediaDir);
    const relPrefix = `media/${rule.mediaDir}`;
    const tasks = [];
    for (const it of arr) {
      const list = expandItemTasks(it, moduleDir, relPrefix);
      // Videos module: each top-level item IS a video (not nested in custom_videos)
      if (rule.mediaDir === 'videos') {
        list.push(...videoTasks(it, moduleDir, relPrefix));
      }
      for (const t of list) {
        if (!downloadVideos && t.kind === 'video') continue;
        if (!downloadAudios && t.kind === 'audio') continue;
        tasks.push(t);
      }
    }
    if (tasks.length === 0) {
      summary[rule.mediaDir] = { total: 0, ok: 0, skip: 0, fail: 0 };
      continue;
    }
    log(`[inline] ${rule.mediaDir}: ${tasks.length} resources to process`);

    const r = await runPool(tasks, concurrency, ({ idx, total, ok, skip, fail }) => {
      log(`[inline] ${rule.mediaDir}: ${idx}/${total}  ok=${ok} skip=${skip} fail=${fail}`);
    }, client);
    summary[rule.mediaDir] = { total: tasks.length, ...r };
    if (r.failures.length) {
      warn(`[inline] ${rule.mediaDir}: ${r.failures.length} failed, e.g.: ${r.failures.slice(0, 3).map((x) => x.err).join(' | ')}`);
    }
    let rewriteN = 0;
    for (const it of arr) {
      if (!Array.isArray(it.custom_images) || !it.custom_images.length) continue;
      const map = new Map();
      for (const im of it.custom_images) {
        if (im && im.url && im.custom_filepath) map.set(im.url, im.custom_filepath);
      }
      if (!map.size) continue;
      for (const field of ['htmlContent', 'htmlcontent', 'content', 'custom_html']) {
        if (typeof it[field] !== 'string' || !it[field]) continue;
        const before = it[field];
        let after = before;
        for (const [url, local] of map) {
          if (after.indexOf(url) !== -1) {
            after = after.split(url).join(local);
          }
        }
        if (after !== before) { it[field] = after; rewriteN++; }
      }
    }
    if (rewriteN) log(`[inline] ${rule.mediaDir}: rewrote ${rewriteN} html field(s) with local paths`);
    writeData(file, data);
  }

  const { finalizeBase64 } = require('./augment.js');
  finalizeBase64(userDir, { logger: logger || undefined });

  return summary;
}

module.exports = { downloadInlineResources };

if (require.main === module) {
  const args = process.argv.slice(2);
  const userDirs = args.filter((a) => !a.startsWith('--'));
  const noVideos = args.includes('--no-videos');
  const noAudios = args.includes('--no-audios');
  if (!userDirs.length) {
    console.error('Usage: node inline-resources.js [--no-videos] [--no-audios] <userDir1> [<userDir2> ...]');
    process.exit(1);
  }
  (async () => {
    const logger = { info: (s) => console.log(s), warn: (s) => console.warn(s) };
    for (const u of userDirs) {
      console.log(`\n=== ${path.basename(u)} ===`);
      const r = await downloadInlineResources(u, {
        logger, downloadVideos: !noVideos, downloadAudios: !noAudios,
      });
      console.log('summary:', JSON.stringify(r));
    }
  })();
}
