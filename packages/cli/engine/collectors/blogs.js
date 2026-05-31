/**
 * Blog posts collector.
 * Writes data/blogs.json.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData, randomSleep } = require('./_util.js');
const blogsApi = require('../api/blogs.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

function extractNestedDiv(html, startIdx) {
  let depth = 0;
  let i = startIdx;
  const openTag = /<div[\s>]/gi;
  const closeTag = /<\/div>/gi;
  openTag.lastIndex = startIdx;
  closeTag.lastIndex = startIdx;

  const firstClose = /<\/div>/gi;
  firstClose.lastIndex = startIdx;

  depth = 1;
  while (depth > 0 && i < html.length) {
    openTag.lastIndex = i;
    closeTag.lastIndex = i;
    const om = openTag.exec(html);
    const cm = closeTag.exec(html);
    if (!cm) break;
    if (om && om.index < cm.index) {
      depth++;
      i = om.index + om[0].length;
    } else {
      depth--;
      if (depth === 0) return html.substring(startIdx, cm.index);
      i = cm.index + cm[0].length;
    }
  }
  return html.substring(startIdx);
}

function parseBlogDetail(html) {
  if (!html || typeof html !== 'string') return { content: '', images: [] };
  const images = [];
  const seen = new Set();
  const re = /<img\s[^>]*src=["']([^"'\s>]+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    if (/^https?:/.test(u) && !seen.has(u)) {
      seen.add(u);
      images.push({ url: u });
    }
  }

  let content = '';
  const markers = [
    /<div[^>]*id=["']blogDetailDiv["'][^>]*>/i,
    /<div[^>]*class=["'][^"']*blogDetailDiv[^"']*["'][^>]*>/i,
    /<div[^>]*class=["'][^"']*ucBoxBlogTxt[^"']*["'][^>]*>/i,
  ];
  for (const marker of markers) {
    const mm = marker.exec(html);
    if (mm) {
      const contentStart = mm.index + mm[0].length;
      content = extractNestedDiv(html, contentStart);
      break;
    }
  }
  return { content, images };
}

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 1500;

async function collectBlogs({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 50,
  logger = console,
  withDetail = true,
  pageLimit = 0,
}) {
  const all = [];
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;

  let startPage = (progress.module('blogs').lastPage ?? -1) + 1;
  const outFile = path.join(outputRoot, 'data', 'blogs.json');
  if (startPage > 0) {
    const r = readData(outFile, logger);
    if (r.ok && Array.isArray(r.value)) {
      all.push(...r.value);
    } else if (r.raw) {
      startPage = 0;
      all.length = 0;
      progress.module('blogs').lastPage = -1;
      logger.warn(`[blogs] existing JSON unparseable, resetting startPage=0 for full re-fetch`);
    }
  }

  const maxPage = pageLimit > 0 ? startPage + pageLimit : 10000;
  for (let page = startPage; page < maxPage; page++) {
    let json;
    try {
      json = await blogsApi.getBlogs({ client, targetUin, page, pageSize });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('blogs', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, rateLimited: false, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      logger.warn(`[blogs] page ${page} error: ${err.message}`);
      progress.finishModule('blogs', 'error', err.message);
      writeData(outFile, all);
      return { status: 'error', total: totalReported, fetched: all.length, rateLimited: false, items: all };
    }

    const data = json && json.data || {};
    const list = Array.isArray(data.list) ? data.list : [];
    if (typeof data.totalNum === 'number') totalReported = data.totalNum;

    if (list.length === 0) {
      consecutiveEmpty++;
      logger.info(`[blogs] page ${page} empty (${consecutiveEmpty}/${EMPTY_PAGE_THRESHOLD})`);
      if (totalReported && all.length >= totalReported) break;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) {
        rateLimited = totalReported > all.length;
        break;
      }
    } else {
      consecutiveEmpty = 0;
      all.push(...list);
      progress.markPageDone('blogs', page, all.length, totalReported);
      writeData(outFile, all);
      logger.info(`[blogs] page ${page}: +${list.length} => total ${all.length}/${totalReported || '?'}`);
      if (totalReported && all.length >= totalReported) break;
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  if (withDetail && all.length) {
    let detailDone = 0;
    for (const b of all) {
      const id = b.blogId || b.blogid || b.id;
      if (!id) continue;
      if (b.custom_html && Array.isArray(b.custom_images)) continue;
      try {
        const { html } = await blogsApi.getBlogInfoHtml({ client, targetUin, blogid: id });
        if (html) {
          const { content, images } = parseBlogDetail(html);
          b.custom_html = content || html;
          b.custom_images = images;
        }
      } catch (e) {}
      detailDone++;
      if (detailDone % 5 === 0) {
        writeData(outFile, all);
        logger.info(`[blogs] detail ${detailDone}/${all.length}`);
        await randomSleep(1200);
      }
    }
    logger.info(`[blogs] detail fetch complete ${detailDone}/${all.length}`);

    // Fetch read counts (batch API, max 500 IDs per call)
    const blogIds = all.map(b => b.blogId || b.blogid || b.id).filter(Boolean);
    if (blogIds.length > 0) {
      try {
        const rcJson = await blogsApi.getReadCount({ client, targetUin, blogIds });
        const rcData = rcJson && rcJson.data || {};
        const itemList = Array.isArray(rcData.itemList) ? rcData.itemList : [];
        if (itemList.length > 0) {
          const readMap = new Map();
          for (const item of itemList) {
            if (item.id && item.read !== undefined) readMap.set(String(item.id), item.read);
          }
          let filled = 0;
          for (const b of all) {
            const id = String(b.blogId || b.blogid || b.id);
            if (readMap.has(id)) {
              b.readnum = readMap.get(id);
              filled++;
            }
          }
          logger.info(`[blogs] read counts: ${filled}/${all.length} blogs have readnum`);
        }
      } catch (e) {
        logger.warn(`[blogs] read count fetch failed: ${e.message}`);
      }
    }
  }

  writeData(outFile, all);
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('blogs', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported, fetched: all.length, rateLimited, items: all };
}

module.exports = { collectBlogs };
