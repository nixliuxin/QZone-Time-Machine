/**
 * Message board collector.
 * Writes data/boards.json: {items, total}
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData, randomSleep } = require('./_util.js');
const boardsApi = require('../api/boards.js');
const { NoAccessError, AuthInvalidError, RateLimitError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 1500;

async function collectBoards({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 20,
  logger = console,
  pageLimit = 0,
}) {
  const all = [];
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;

  let startPage = (progress.module('boards').lastPage ?? -1) + 1;
  const outFile = path.join(outputRoot, 'data', 'boards.json');
  if (startPage > 0) {
    const r = readData(outFile, logger);
    if (r.ok && r.value && Array.isArray(r.value.items)) {
      all.push(...r.value.items);
    } else if (r.raw) {
      startPage = 0;
      all.length = 0;
      progress.module('boards').lastPage = -1;
      logger.warn(`[boards] existing JSON unparseable, resetting startPage=0 for full re-fetch`);
    }
  }

  const maxPage = pageLimit > 0 ? startPage + pageLimit : 10000;
  for (let page = startPage; page < maxPage; page++) {
    let json;
    try {
      json = await boardsApi.getBoards({ client, targetUin, page, pageSize });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('boards', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, rateLimited: false, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      if (err instanceof RateLimitError || /HTTP 50[12]\b/.test(err.message)) {
        logger.warn(`[boards] WAF/rate-limit (${err.message.split('\n')[0]}), marking rate_limited`);
        progress.finishModule('boards', 'rate_limited', err.message);
        writeData(outFile, { items: all, total: totalReported });
        return { status: 'rate_limited', total: totalReported, fetched: all.length, rateLimited: true, items: all };
      }
      logger.warn(`[boards] page ${page} error: ${err.message}`);
      progress.finishModule('boards', 'error', err.message);
      writeData(outFile, { items: all, total: totalReported });
      return { status: 'error', total: totalReported, fetched: all.length, rateLimited: false, items: all };
    }

    const data = json && json.data || {};
    const list = Array.isArray(data.commentList) ? data.commentList : [];
    if (typeof data.total === 'number') totalReported = data.total;

    if (list.length === 0) {
      consecutiveEmpty++;
      logger.info(`[boards] page ${page} empty (${consecutiveEmpty}/${EMPTY_PAGE_THRESHOLD})`);
      if (totalReported && all.length >= totalReported) break;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) {
        rateLimited = totalReported > all.length;
        break;
      }
    } else {
      consecutiveEmpty = 0;
      all.push(...list);
      progress.markPageDone('boards', page, all.length, totalReported);
      writeData(outFile, { items: all, total: totalReported });
      logger.info(`[boards] page ${page}: +${list.length} => total ${all.length}/${totalReported || '?'}`);
      if (totalReported && all.length >= totalReported) break;
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  writeData(outFile, { items: all, total: totalReported });
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('boards', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported, fetched: all.length, rateLimited, items: all };
}

module.exports = { collectBoards };
