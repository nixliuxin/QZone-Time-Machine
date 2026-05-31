/**
 * Enrichment utilities:
 *   - enrichComments: for each item, fetch remaining comment pages until cmtTotal/replyNum is met
 *   - enrichLikes: for each item, fetch the like list
 *
 * These functions are idempotent: each item's fields are modified in place;
 * callers should re-write the full list after completion.
 */
'use strict';

const messagesApi = require('../api/messages.js');
const blogsApi = require('../api/blogs.js');
const photosApi = require('../api/photos.js');
const sharesApi = require('../api/shares.js');
const videosApi = require('../api/videos.js');
const likesApi = require('../api/likes.js');
const visitorsApi = require('../api/visitors.js');
const { randomSleep } = require('./_util.js');

const PAGE_SLEEP_MS = 1200;

/**
 * Generic paginated comment fetcher: calls fetcher(page) until
 * accumulated list length >= targetCount or an empty list is returned.
 * fetcher: async (page) => { list:[], total:Number }
 */
async function pullCommentsPaged({
  fetcher,
  initialList = [],
  totalHint = 0,
  pageSize = 20,
  startPage = 0,
  maxPages = 100,
  logger = console,
}) {
  const merged = (initialList || []).slice();
  let totalReported = totalHint;
  for (let page = startPage; page < maxPages; page++) {
    let res;
    try {
      res = await fetcher(page);
    } catch (e) {
      logger.warn(`[enrich.comments] page ${page} error: ${e.message}`);
      break;
    }
    const list = Array.isArray(res.list) ? res.list : [];
    if (typeof res.total === 'number') totalReported = res.total;

    if (list.length === 0) break;
    merged.push(...list);
    if (totalReported && merged.length >= totalReported) break;
    await randomSleep(PAGE_SLEEP_MS);
  }
  return { list: merged, total: totalReported || merged.length };
}

/* ---- Per-module comment enrichment ---- */

async function enrichMessageComments({ client, targetUin, items, logger = console }) {
  let touched = 0;
  for (const m of items) {
    const cur = (m.commentlist || []).length;
    const total = m.cmtnum || m.cmtTotal || 0;
    if (total <= cur) { m.comments = m.commentlist || []; continue; }
    const pageSize = 20;
    const startPage = Math.floor(cur / pageSize);
    const { list } = await pullCommentsPaged({
      fetcher: async (p) => {
        const j = await messagesApi.getComments({
          client, targetUin, tid: m.tid, page: p, pageSize,
        });
        const data = j.data || j;
        return { list: data.commentlist || data.commentList || [], total: total };
      },
      initialList: m.commentlist || [],
      totalHint: total,
      startPage,
      pageSize,
      logger,
    });
    m.commentlist = list;
    m.comments = list;
    touched++;
  }
  if (touched) logger.info(`[enrich] messages comment enrichment: ${touched} items`);
  return touched;
}

async function enrichBlogComments({ client, targetUin, items, logger = console }) {
  let touched = 0;
  for (const b of items) {
    const cur = (b.comments || []).length;
    const total = b.commentNum || b.commentTotal || 0;
    if (total <= cur) continue;
    const pageSize = 20;
    const startPage = Math.floor(cur / pageSize);
    const { list } = await pullCommentsPaged({
      fetcher: async (p) => {
        const j = await blogsApi.getComments({
          client, targetUin, blogid: b.blogId || b.blogid, page: p, pageSize,
        });
        const data = j.data || j;
        return { list: data.comments || data.commentList || [], total };
      },
      initialList: b.comments || [],
      totalHint: total,
      startPage,
      pageSize,
      logger,
    });
    b.comments = list;
    touched++;
  }
  if (touched) logger.info(`[enrich] blogs comment enrichment: ${touched} items`);
  return touched;
}

async function enrichAlbumPhotoComments({ client, targetUin, albums, logger = console }) {
  let touched = 0;
  for (const album of albums) {
    if (!Array.isArray(album.photoList)) continue;
    for (const photo of album.photoList) {
      const cur = (photo.comments || []).length;
      const total = photo.cmtTotal || 0;
      if (total <= cur) continue;
      const pageSize = 20;
      const startPage = Math.floor(cur / pageSize);
      const { list } = await pullCommentsPaged({
        fetcher: async (p) => {
          const j = await photosApi.getImageComments({
            client, targetUin, albumId: album.id, picKey: photo.picKey || photo.lloc,
            page: p, pageSize,
          });
          const data = j.data || j;
          return { list: data.comments || [], total };
        },
        initialList: photo.comments || [],
        totalHint: total,
        startPage,
        pageSize,
        logger,
      });
      photo.comments = list;
      touched++;
    }
  }
  if (touched) logger.info(`[enrich] album-photo comment enrichment: ${touched} photos`);
  return touched;
}

async function enrichVideoComments({ client, targetUin, items, logger = console }) {
  let touched = 0;
  for (const v of items) {
    const tid = v.tid || v.video_id;
    const cur = (v.comments || []).length;
    const total = v.cmtTotal || v.commentNum || 0;
    if (!tid || total <= cur) continue;
    const pageSize = 20;
    const startPage = Math.floor(cur / pageSize);
    const { list } = await pullCommentsPaged({
      fetcher: async (p) => {
        const j = await videosApi.getComments({
          client, targetUin, tid, page: p, pageSize,
        });
        const data = j.data || j;
        return { list: data.commentlist || data.commentList || [], total };
      },
      initialList: v.comments || [],
      totalHint: total,
      startPage,
      pageSize,
      logger,
    });
    v.comments = list;
    touched++;
  }
  if (touched) logger.info(`[enrich] videos comment enrichment: ${touched} items`);
  return touched;
}

async function enrichShareComments({ client, targetUin, items, logger = console }) {
  let touched = 0;
  for (const s of items) {
    const id = s.id || s.shareid;
    const cur = (s.comments || []).length;
    const total = s.commentNum || s.commentTotal || 0;
    if (!id || total <= cur) continue;
    const pageSize = 20;
    const startPage = Math.floor(cur / pageSize);
    const { list } = await pullCommentsPaged({
      fetcher: async (p) => {
        const j = await sharesApi.getComments({
          client, targetUin, id, page: p, pageSize,
        });
        const data = j.data || j;
        return { list: data.comments || data.commentList || [], total };
      },
      initialList: s.comments || [],
      totalHint: total,
      startPage,
      pageSize,
      logger,
    });
    s.comments = list;
    touched++;
  }
  if (touched) logger.info(`[enrich] shares comment enrichment: ${touched} items`);
  return touched;
}

/* ---- Like detail enrichment ---- */

/**
 * @param {Function} buildKey  function(item) => unikey
 */
async function enrichLikes({ client, items, buildKey, label = 'item', logger = console }) {
  let touched = 0;
  for (const it of items) {
    const unikey = buildKey(it);
    if (!unikey) continue;
    try {
      const j = await likesApi.getLikeList({ client, unikey });
      const data = j && j.data || {};
      it.likes = data.like_uin_info || data.like_list || [];
      it.likeTotal = data.total || it.likes.length;
      touched++;
    } catch (e) {
      // silently ignore failures
    }
    if (touched % 20 === 0) await randomSleep(1000);
  }
  if (touched) logger.info(`[enrich] ${label} like enrichment: ${touched} items`);
  return touched;
}

/* ---- Per-item visitor enrichment ---- */

/**
 * Fetch per-item visitors (up to maxPages pages).
 *   appid: 311=messages, 2=blogs, 4=photos, 202=shares
 *   targetIdOf: function(item) => string targetId
 */
async function enrichSingleVisitors({
  client, targetUin, items, appid, targetIdOf, label = 'item',
  maxPages = 5, pageSize = 10, logger = console,
}) {
  let touched = 0;
  for (const it of items) {
    const targetId = targetIdOf(it);
    if (!targetId) continue;
    const collected = [];
    for (let p = 0; p < maxPages; p++) {
      let json;
      try {
        json = await visitorsApi.getSingleVisitors({
          client, targetUin, appid, targetId, page: p, pageSize,
        });
      } catch (_) { break; }
      const data = (json && json.data) || {};
      const list = Array.isArray(data.items) ? data.items
        : (Array.isArray(data.list) ? data.list : []);
      if (list.length === 0) break;
      collected.push(...list);
      if (data.totalNum && collected.length >= data.totalNum) break;
      await randomSleep(1000);
    }
    if (collected.length) {
      it.custom_visitor = { list: collected, total: collected.length };
      touched++;
    }
    if (touched % 20 === 0) await randomSleep(1000);
  }
  if (touched) logger.info(`[enrich] ${label} per-item visitor enrichment: ${touched} items`);
  return touched;
}

module.exports = {
  enrichMessageComments,
  enrichBlogComments,
  enrichAlbumPhotoComments,
  enrichVideoComments,
  enrichShareComments,
  enrichLikes,
  enrichSingleVisitors,
};
