/**
 * Shares collector: writes data/shares.json
 *
 * Note: the shares API uses 1-based page numbers (unlike other modules).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData } = require('./_util.js');
const sharesApi = require('../api/shares.js');
const { sleep, NoAccessError, AuthInvalidError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 600;

async function collectShares({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 30,
  logger = console,
}) {
  const all = [];
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;
  let hadError = false;
  let lastError = null;

  let startPage = (progress.module('shares').lastPage ?? -1) + 1;
  const outFile = path.join(outputRoot, 'data', 'shares.json');
  if (startPage > 0) {
    const r = readData(outFile, logger);
    if (r.ok && Array.isArray(r.value)) {
      all.push(...r.value);
    } else if (r.raw) {
      startPage = 0;
      progress.module('shares').lastPage = -1;
      logger.warn('[shares] existing JSON unparseable, resetting startPage=0 for full re-fetch');
    }
  }

  for (let page = startPage; page < 10000; page++) {
    const apiPage = page + 1;
    let html;
    try {
      const r = await sharesApi.getSharesHtml({ client, targetUin, page: apiPage, pageSize });
      html = r.html;
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('shares', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      logger.warn(`[shares] page ${apiPage} error: ${err.message}`);
      hadError = true;
      lastError = err.message;
      break;
    }
    const { list, total } = sharesApi.parseSharesHtml(html);
    if (total) totalReported = total;

    if (list.length === 0) {
      if (page === startPage && all.length === 0 && !totalReported) {
        logger.info('[shares] no share data');
        break;
      }
      consecutiveEmpty++;
      if (totalReported && all.length >= totalReported) break;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) {
        rateLimited = totalReported > all.length;
        break;
      }
    } else {
      consecutiveEmpty = 0;
      all.push(...list);
      progress.markPageDone('shares', page, all.length, totalReported);
      writeData(outFile, all);
      logger.info(`[shares] page ${apiPage}: +${list.length} => total ${all.length}/${totalReported || '?'}`);
      if (totalReported && all.length >= totalReported) break;
    }
    await sleep(PAGE_SLEEP_MS);
  }

  writeData(outFile, all);
  let status = 'done';
  let errMsg = null;
  if (rateLimited) { status = 'rate_limited'; errMsg = 'consecutive empty pages'; }
  else if (hadError && all.length === 0) { status = 'error'; errMsg = lastError; }
  progress.finishModule('shares', status, errMsg);
  return { status, total: totalReported, fetched: all.length, items: all };
}

module.exports = { collectShares };
