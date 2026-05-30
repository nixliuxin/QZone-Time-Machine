/**
 * augment.js — Transform raw API data from collectors into the shape
 * needed for rendering/archiving.
 *
 * Two responsibilities:
 *
 * 1) Field mapping (normalize raw API fields to custom_* prefix):
 *      messages.pic    => messages.custom_images
 *      messages.video  => messages.custom_videos
 *      messages.audio  => messages.custom_audios
 *      messages.magic  => messages.custom_magics
 *      messages.voice  => messages.custom_voices
 *    Same for blogs / boards / shares / favorites.
 *
 * 2) Derived fields: custom_create_time (unified 'YYYY-MM-DD HH:mm:ss').
 *
 * Resource downloads (pic_id / url3 / pic_url / playurl remote URLs => local paths)
 * are handled by inline-resources.js. This module only reshapes data, no network I/O.
 */

'use strict';
const fs = require('fs');
const path = require('path');

/* -------------- helpers -------------- */

/** UTF-8 string to base64 (for custom_html encoding) */
function utf8ToBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}
function isBase64(str) {
  if (!str || str.length < 8) return false;
  return /^[A-Za-z0-9+/\r\n]+=*$/.test(str.slice(0, 200));
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDate(time) {
  if (typeof time === 'string' && time.trim()) return time;
  if (!Number.isFinite(time) || time <= 0) return '';
  const d = new Date(time * 1000);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function ensureCustomTime(item, sourceFields) {
  if (!item || typeof item !== 'object') return;
  if (item.custom_create_time) return;
  for (const f of sourceFields) {
    const v = item[f];
    if (v == null || v === '') continue;
    const formatted = formatDate(v);
    if (formatted) {
      item.custom_create_time = formatted;
      return;
    }
  }
}

function loadData(file) {
  let txt = fs.readFileSync(file, 'utf8');
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  try { return JSON.parse(txt); } catch (_) { return null; }
}

function writeData(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/* -------------- per-module converters -------------- */

function convertMessage(item) {
  if (item.custom_images != null) return; // already converted

  item.custom_content = item.content || '';
  item.conlist = item.conlist || [];

  // Comments
  item.commenttotal = item.cmtnum || (item.commentlist ? item.commentlist.length : 0);
  item.custom_comments = item.commentlist || [];

  // Images
  item.imagetotal = item.pictotal || 0;
  item.custom_images = item.pic || [];

  // Voice
  item.voicetotal = item.voicetotal || 0;
  item.custom_voices = item.voice || [];

  // Audio
  item.audiototal = item.audiototal || 0;
  item.custom_audios = item.audio || [];

  // Magic emoticons
  item.magictotal = item.magictotal || 0;
  item.custom_magics = item.magic || [];
  for (const magic of item.custom_magics) {
    if (magic.url1 && /\{"\$type":"magicEmoticon","id":(\d+)\}/.test(magic.url1)) {
      const id = magic.url1.match(/\{"\$type":"magicEmoticon","id":(\d+)\}/)[1];
      magic.custom_url = `http://qzonestyle.gtimg.cn/qzone/em/120/mb${id}.jpg`;
    }
  }

  // Videos
  item.videototal = item.videototal || 0;
  item.custom_videos = item.video || [];
  for (const v of item.custom_videos) {
    v.video_id = (v.video_id || '').replace('http://v.qq.com/', '');
  }

  // Location
  item.lbs = item.lbs || {};
}

function convertBlog(item) {
  const fromList = Array.isArray(item.images) ? item.images : (Array.isArray(item.pic) ? item.pic : []);
  let html = item.custom_html || '';
  // If a previous augment run already base64-encoded, decode back to raw HTML (inline needs raw HTML)
  if (html && isBase64(html)) {
    try { html = Buffer.from(html, 'base64').toString('utf8'); } catch (_) {}
    item.custom_html = html;
  }
  const fromHtml = extractImgUrls(html).map((u) => ({ url: u, _from_html: true }));
  const existing = Array.isArray(item.custom_images) ? item.custom_images : [];
  const have = new Set(existing.map((x) => x && (x.url || x.pic_id)).filter(Boolean));
  const merged = existing.slice();
  for (const im of [...fromList, ...fromHtml]) {
    const key = im && (im.url || im.pic_id);
    if (key && !have.has(key)) { merged.push(im); have.add(key); }
  }
  item.custom_images = merged;
  item.custom_videos = item.videos || item.video || [];
  item.custom_audios = item.audios || item.audio || [];
  item.custom_comments = item.commentlist || [];
  // Field normalization: template (blogs.js / TPL.BLOGS_LIST_ITEM) expects different names than the API
  if (item.blogid == null && item.blogId != null) item.blogid = item.blogId;
  if (item.pubtime == null && item.pubTime != null) item.pubtime = item.pubTime;
  if (item.lastModifyTime == null) item.lastModifyTime = item.modifyTime || item.modifytime || item.pubtime;
  if (item.replynum == null) {
    item.replynum = item.commentNum != null ? item.commentNum
      : item.cmtnum != null ? item.cmtnum
      : (Array.isArray(item.commentlist) ? item.commentlist.length : 0);
  }
  if (item.likeTotal == null) item.likeTotal = item.likeNum || item.likes_total || (Array.isArray(item.likes) ? item.likes.length : 0);
  if (item.category == null) item.category = item.cate || 'Default';
  // abstract fallback: when API has no abstract field, extract from html / title
  if (item.abstract == null) {
    const plain = (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    item.abstract = plain.slice(0, 120);
  }
  // img array (template blog.img) — uses custom_images (already has url/custom_url)
  if (!Array.isArray(item.img)) {
    item.img = (item.custom_images || []).slice(0, 6).map((x) => ({ url: x.url, custom_url: x.custom_filepath || x.url }));
  }
  // custom_title — template expects custom_title to exist
  if (!item.custom_title) item.custom_title = item.title || '';
  // Note: custom_html is NOT base64-encoded here because inline-resources still needs
  // to do URL => local path replacement on the raw HTML.
  // Base64 encoding is deferred to finalizeBase64 after inline-resources completes.
}

// Extract deduplicated <img src> URLs from an HTML string
function extractImgUrls(html) {
  if (!html || typeof html !== 'string') return [];
  const urls = [];
  const seen = new Set();
  const re = /<img\s[^>]*src=["']([^"'\s>]+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    if (/^https?:/.test(u) && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }
  return urls;
}

function convertBoard(item) {
  const fromPic = Array.isArray(item.pic) ? item.pic : (Array.isArray(item.images) ? item.images : []);
  let html = item.custom_html || item.htmlContent || item.htmlcontent || item.content || '';
  if (html && isBase64(html)) {
    try { html = Buffer.from(html, 'base64').toString('utf8'); } catch (_) {}
  }
  const fromHtml = extractImgUrls(html).map((u) => ({ url: u, _from_html: true }));
  const existing = Array.isArray(item.custom_images) ? item.custom_images : [];
  const have = new Set(existing.map((x) => x && (x.url || x.pic_id)).filter(Boolean));
  const merged = existing.slice();
  for (const im of [...fromPic, ...fromHtml]) {
    const key = im && (im.url || im.pic_id);
    if (key && !have.has(key)) { merged.push(im); have.add(key); }
  }
  item.custom_images = merged;
  item.custom_replies = item.replyList || item.replys || item.replies || [];
  item.custom_html = html;
}

function convertDiary(item) {
  if (item.custom_images != null) return;
  item.custom_images = item.images || item.pic || [];
  item.custom_videos = item.videos || [];
}

function convertVideo(item) {
  if (item.custom_url != null) return;
  // url1=cover thumbnail, url2=fallback, url3=mp4 source, pic_url=cover full-size
  item.custom_pre_url = item.url1 || item.pic_url || '';
  item.custom_url = item.url3 || item.url2 || item.url1 || '';
}

function convertShare(item) {
  if (item.custom_images != null) return;
  item.custom_images = item.images || item.pic || [];
  item.custom_videos = item.videos || item.video || [];
  item.custom_audios = item.audios || item.audio || [];
}

function convertFavorite(item) {
  if (item.custom_images != null) return;
  // Favorites media is nested inside *_info fields
  item.custom_uin = item.custom_uin || '';
  item.custom_abstract = item.abstract || '';
  item.album_info = item.album_info || {};
  item.blog_info = item.blog_info || {};
  item.shuoshuo_info = item.shuoshuo_info || {};
  item.share_info = item.share_info || {};
  item.url_info = item.url_info || {};

  const t = item.type;
  let videoList = [], musicList = [];
  if (t === 1) { videoList = item.url_info.video_list || []; musicList = item.url_info.music_list || []; }
  else if (t === 3) { videoList = item.blog_info.video_list || []; musicList = item.blog_info.music_list || []; }
  else if (t === 4) { videoList = item.album_info.video_list || []; musicList = item.album_info.music_list || []; }
  else if (t === 5) { videoList = item.shuoshuo_info.video_list || []; musicList = item.shuoshuo_info.music_list || []; }
  else if (t === 7) { videoList = item.share_info.video_list || []; musicList = item.share_info.music_list || []; }

  item.custom_origin_images = (item.origin_img_list || []).map((u) => ({ url: u }));
  item.custom_images = (item.img_list || []).map((u) => ({ url: u }));
  item.custom_videos = videoList.map((v) => v.video_info).filter(Boolean);
  item.custom_audios = musicList.map((m) => m.music_info).filter(Boolean);
}

/* -------------- module rules -------------- */

const MODULE_RULES = [
  { dataFile: 'messages.json', mediaDir: 'messages', isArray: true,
    timeFields: ['created_time', 'create_time', 'pubtime'], convert: convertMessage },
  { dataFile: 'boards.json', mediaDir: 'boards', isArray: false,
    arrPath: 'items',
    timeFields: ['pubtime', 'create_time'], convert: convertBoard },
  { dataFile: 'blogs.json', mediaDir: 'blogs', isArray: true,
    timeFields: ['pubtime', 'created_time', 'pubTime'], convert: convertBlog },
  { dataFile: 'diaries.json', mediaDir: 'diaries', isArray: true,
    timeFields: ['pubtime', 'create_time'], convert: convertDiary },
  { dataFile: 'videos.json', mediaDir: 'videos', isArray: true,
    timeFields: ['upload_time', 'uploadtime', 'pubtime', 'created_time'], convert: convertVideo },
  { dataFile: 'favorites.json', mediaDir: 'favorites', isArray: true,
    timeFields: ['create_time', 'opTime', 'pubtime'], convert: convertFavorite },
  { dataFile: 'shares.json', mediaDir: 'shares', isArray: true,
    timeFields: ['create_time', 'published', 'pubtime'], convert: convertShare },
];

function getArr(data, rule) {
  if (rule.isArray) return Array.isArray(data) ? data : null;
  if (rule.arrPath && data && Array.isArray(data[rule.arrPath])) return data[rule.arrPath];
  return null;
}

function augmentUserDir(userDir, opts = {}) {
  const logger = opts.logger || null;
  const onlyModule = opts.module || null;     // e.g. 'messages' to limit
  const stats = { touched: 0, augmented: 0 };
  for (const rule of MODULE_RULES) {
    if (onlyModule && rule.mediaDir !== onlyModule) continue;
    const file = path.join(userDir, 'data', rule.dataFile);
    if (!fs.existsSync(file)) continue;
    const data = loadData(file);
    if (data == null) continue;
    const arr = getArr(data, rule);
    if (!arr) continue;

    const before = JSON.stringify(data);
    let augN = 0;
    for (const it of arr) {
      const hadTime = !!it.custom_create_time;
      if (rule.convert) rule.convert(it);
      ensureCustomTime(it, rule.timeFields);
      if (!hadTime && it.custom_create_time) augN++;
    }
    const after = JSON.stringify(data);
    if (after !== before) {
      writeData(file, data);
      stats.touched++;
      stats.augmented += augN;
      if (logger) logger.info(`[augment] ${rule.mediaDir}: arr=${arr.length} +time=${augN}`);
    }
  }
  return stats;
}

/**
 * finalizeBase64 — called after inline-resources completes.
 * Encodes custom_html in Blogs / Boards / Diaries from raw HTML to base64
 * (viewer templates bloginfo.js / diaryinfo.js / boards.js decode via API.Utils.base64ToUtf8).
 */
function finalizeBase64(userDir, opts = {}) {
  const logger = opts.logger || null;
  const MODULES_WITH_HTML = ['blogs', 'boards', 'diaries'];
  for (const rule of MODULE_RULES) {
    if (!MODULES_WITH_HTML.includes(rule.mediaDir)) continue;
    const file = path.join(userDir, 'data', rule.dataFile);
    if (!fs.existsSync(file)) continue;
    const data = loadData(file);
    const arr = getArr(data, rule);
    if (!arr || !arr.length) continue;
    let changed = 0;
    for (const item of arr) {
      if (item.custom_html && !isBase64(item.custom_html)) {
        item.custom_html = utf8ToBase64(item.custom_html);
        changed++;
      }
    }
    if (changed) {
      writeData(file, data);
      if (logger) logger.info(`[finalizeBase64] ${rule.mediaDir}: encoded ${changed}/${arr.length} custom_html fields`);
    }
  }
}

module.exports = { augmentUserDir, finalizeBase64, formatDate, ensureCustomTime, MODULE_RULES, getArr, loadData, writeData };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node augment.js <userDir1> [<userDir2> ...]');
    process.exit(1);
  }
  for (const u of args) {
    if (!fs.existsSync(u)) { console.error('skip:', u); continue; }
    const r = augmentUserDir(u, { logger: { info: (s) => console.log(s) } });
    console.log(`[${path.basename(u)}] touched=${r.touched} augmented=${r.augmented}`);
  }
}
