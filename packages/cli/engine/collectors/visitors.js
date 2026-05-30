/**
 * Visitors collector: writes data/visitors.json
 *
 * Output structure: { items: [...], total: <actual total>, totalPage: <page count> }
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData } = require('./_util.js');
const visitorsApi = require('../api/visitors.js');
const { sleep, NoAccessError, AuthInvalidError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 700;

async function collectVisitors({
  client,
  targetUin,
  outputRoot,
  progress,
  logger = console,
  maxPages = 1000,
}) {
  const all = [];
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;

  let startPage = (progress.module('visitors').lastPage ?? -1) + 1;
  const outFile = path.join(outputRoot, 'data', 'visitors.json');
  let lastTotalPage = 0;
  if (startPage > 0) {
    const r = readData(outFile, logger);
    if (r.ok && r.value) {
      if (Array.isArray(r.value.items)) all.push(...r.value.items);
      if (typeof r.value.total === 'number') totalReported = r.value.total;
      if (typeof r.value.totalPage === 'number') lastTotalPage = r.value.totalPage;
    } else if (r.raw) {
      startPage = 0;
      progress.module('visitors').lastPage = -1;
      logger.warn('[visitors] existing JSON unparseable, resetting startPage=0 for full re-fetch');
    }
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
      all.push(...list);
      progress.markPageDone('visitors', page, all.length, totalReported);
      writeData(outFile, { items: all, total: totalReported, totalPage: lastTotalPage });
      logger.info(`[visitors] page ${page}: +${list.length} => total ${all.length}/${totalReported || '?'} (totalpage=${totalPage || '?'})`);
      if (totalPage && page + 1 >= totalPage) break;
    }
    await sleep(PAGE_SLEEP_MS);
  }

  writeData(outFile, { items: all, total: totalReported, totalPage: lastTotalPage });
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('visitors', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported, fetched: all.length, items: all };
}

module.exports = { collectVisitors };
