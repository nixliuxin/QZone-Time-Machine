/**
 * Visitors collector: writes data/visitors.json
 *
 * Output structure: { items: [...], total: <actual total>, totalPage: <page count> }
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData, randomSleep } = require('./_util.js');
const visitorsApi = require('../api/visitors.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 1500;

async function collectVisitors({
  client,
  targetUin,
  outputRoot,
  progress,
  logger = console,
  maxPages = 1000,
  listFetch = true,
}) {
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let consecutiveKnown = 0;
  let rateLimited = false;

  const outFile = path.join(outputRoot, 'data', 'visitors.json');

  // Unified "fill-missing" model. Visitor entries have no stable unique id, so
  // dedup uses uin+time; the list is volatile (repeat visits), so "complete"
  // means have >= total.
  const r = readData(outFile, logger);
  const existing = (r.ok && r.value && Array.isArray(r.value.items)) ? r.value.items : [];
  if (r.ok && r.value) {
    if (typeof r.value.total === 'number') totalReported = r.value.total;
  } else if (r.raw) {
    logger.warn('[visitors] existing JSON unparseable; treating as empty');
  }
  let lastTotalPage = (r.ok && r.value && typeof r.value.totalPage === 'number') ? r.value.totalPage : 0;
  const have = existing.length;
  const visitorKey = (it) => `${it.uin}_${it.time || it.pubtime || ''}`;

  if (!listFetch || (totalReported > 0 && have >= totalReported)) {
    if (have > 0 || !listFetch) {
      logger.info(`[visitors] ${!listFetch ? 'fill-missing (no list fetch)' : `already complete (${have}/${totalReported})`}; skipping list fetch`);
      progress.finishModule('visitors', 'done');
      return { status: 'done', total: totalReported || have, fetched: have, items: existing };
    }
  }

  const all = existing.slice();
  const seen = new Set(existing.map(visitorKey));
  // Derive page size from prior total/totalPage to resume forward at the right page.
  const pageSize = (lastTotalPage > 0 && totalReported > 0) ? Math.ceil(totalReported / lastTotalPage) : 0;
  let startPage = pageSize > 0 ? Math.floor(have / pageSize) : 0;
  if (have > 0) {
    logger.info(`[visitors] fill-missing: ${have} existing (total≈${totalReported || '?'}), resuming forward from page ${startPage}`);
  }

  for (let page = startPage; page < maxPages; page++) {
    let json;
    try {
      json = await visitorsApi.getList({ client, targetUin, page });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('visitors', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      logger.warn(`[visitors] page ${page} error: ${err.message}`);
      break;
    }
    const data = (json && json.data) || {};
    const list = Array.isArray(data.items) ? data.items
      : (Array.isArray(data.list) ? data.list : []);
    let totalCount = 0;
    let totalPage = 0;
    if (data.Ishost === 0) {
      const mvc = Array.isArray(data.modvisitcount) ? data.modvisitcount[0] : null;
      totalCount = (mvc && mvc.totalcount) || 0;
      totalPage = 1;
    } else {
      totalCount = data.totalcount || 0;
      totalPage = data.totalpage || 0;
    }
    if (totalCount) totalReported = totalCount;

    if (totalPage) lastTotalPage = totalPage;

    if (list.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) {
        rateLimited = totalReported > all.length;
        break;
      }
    } else {
      consecutiveEmpty = 0;
      const newItems = list.filter(it => !seen.has(visitorKey(it)));
      for (const it of newItems) seen.add(visitorKey(it));
      if (newItems.length === 0) {
        consecutiveKnown++;
        if (totalPage && page + 1 >= totalPage) break;
        if (totalReported && all.length >= totalReported) break;
        if (consecutiveKnown >= 2) break;
      } else {
        consecutiveKnown = 0;
        all.push(...newItems);
        progress.markPageDone('visitors', page, all.length, totalReported);
        writeData(outFile, { items: all, total: totalReported, totalPage: lastTotalPage });
        logger.info(`[visitors] page ${page}: +${newItems.length} new => total ${all.length}/${totalReported || '?'} (totalpage=${totalPage || '?'})`);
        if (totalPage && page + 1 >= totalPage) break;
      }
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  writeData(outFile, { items: all, total: totalReported, totalPage: lastTotalPage });
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('visitors', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported, fetched: all.length, items: all };
}

module.exports = { collectVisitors };
