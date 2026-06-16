/**
 * Private diaries collector (owner uin only).
 * Writes data/diaries.json
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData, randomSleep } = require('./_util.js');
const diariesApi = require('../api/diaries.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const KNOWN_PAGE_THRESHOLD = 2;
const PAGE_SLEEP_MS = 1500;

async function collectDiaries({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 50,
  logger = console,
  withDetail = false,
  listFetch = true,
}) {
  if (client.session.uin !== targetUin) {
    logger.info('[diaries] private diaries only accessible by owner uin, skipping');
    progress.finishModule('diaries', 'no_access', 'not-owner');
    return { status: 'no_access', total: 0, fetched: 0, items: [] };
  }

  let totalReported = 0;
  let consecutiveEmpty = 0;
  let consecutiveKnown = 0;
  let rateLimited = false;

  const outFile = path.join(outputRoot, 'data', 'diaries.json');

  // Unified "fill-missing" model (see messages.js).
  const r = readData(outFile, logger);
  const existingItems = (r.ok && Array.isArray(r.value)) ? r.value : [];
  const seen = new Set(existingItems.map(d => String(d.blogid)));
  if (!r.ok && r.raw) logger.warn('[diaries] existing JSON unparseable; treating as empty');
  const have = existingItems.length;
  const progTotal = progress.module('diaries').totalReported || 0;

  const all = existingItems.slice();
  let startPage = (!listFetch || (progTotal > 0 && have >= progTotal))
    ? Number.MAX_SAFE_INTEGER : Math.floor(have / pageSize);
  if (have > 0 && startPage !== Number.MAX_SAFE_INTEGER) {
    logger.info(`[diaries] fill-missing: ${have} existing (total≈${progTotal || '?'}), resuming forward from page ${startPage}`);
  }

  for (let page = startPage; page < 10000; page++) {
    let json;
    try {
      json = await diariesApi.getDiaries({ client, page, pageSize });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('diaries', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      logger.warn(`[diaries] page ${page} error: ${err.message}`);
      break;
    }
    const data = json && json.data || {};
    const list = Array.isArray(data.titlelist) ? data.titlelist
               : Array.isArray(data.list) ? data.list : [];
    if (typeof data.total_num === 'number') totalReported = data.total_num;
    else if (typeof data.totalNum === 'number') totalReported = data.totalNum;
    else if (typeof data.total === 'number') totalReported = data.total;

    if (list.length === 0) {
      consecutiveEmpty++;
      if (totalReported && all.length >= totalReported) break;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) {
        rateLimited = totalReported > all.length;
        break;
      }
    } else {
      consecutiveEmpty = 0;
      const newItems = list.filter(d => !seen.has(String(d.blogid)));
      for (const d of newItems) seen.add(String(d.blogid));
      if (newItems.length === 0) {
        consecutiveKnown++;
        if (totalReported && all.length >= totalReported) break;
        if (consecutiveKnown >= KNOWN_PAGE_THRESHOLD) break;
      } else {
        consecutiveKnown = 0;
        all.push(...newItems);
        progress.markPageDone('diaries', page, all.length, totalReported);
        writeData(outFile, all);
        logger.info(`[diaries] page ${page}: +${newItems.length} new => total ${all.length}/${totalReported || '?'}`);
        if (totalReported && all.length >= totalReported) break;
      }
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  if (withDetail) {
    for (let i = 0; i < all.length; i++) {
      const d = all[i];
      if (d.custom_html) continue; // already filled
      try {
        const { html } = await diariesApi.getDiaryInfoHtml({ client, blogid: d.blogid });
        d.custom_html = html;
      } catch (e) {
        if (e instanceof AuthInvalidError) throw e;
      }
      if (i % 10 === 9) await randomSleep(800);
    }
  }

  writeData(outFile, all);
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('diaries', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported, fetched: all.length, items: all };
}

module.exports = { collectDiaries };
