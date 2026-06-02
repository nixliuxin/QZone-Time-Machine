/**
 * Shares collector: writes data/shares.json
 *
 * Note: the shares API uses 1-based page numbers (unlike other modules).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData, randomSleep, mergeByIds, buildIdSet } = require('./_util.js');
const sharesApi = require('../api/shares.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 1500;

async function collectShares({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 30,
  logger = console,
  incremental = false,
}) {
  const all = [];
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;
  let hadError = false;
  let lastError = null;

  const outFile = path.join(outputRoot, 'data', 'shares.json');

  let existingIds = null;
  let existingItems = [];
  if (incremental) {
    const r = readData(outFile, logger);
    if (r.ok && Array.isArray(r.value)) {
      existingItems = r.value;
      existingIds = buildIdSet(existingItems, 'shares');
      logger.info(`[shares] incremental: ${existingItems.length} existing items, ${existingIds.size} unique IDs`);
    }
  }

  let startPage = incremental ? 0 : (progress.module('shares').lastPage ?? -1) + 1;
  if (!incremental && startPage > 0) {
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

      if (incremental && existingIds) {
        const newItems = list.filter(it => !existingIds.has(String(it.id)));
        if (newItems.length === 0) {
          logger.info(`[shares] page ${apiPage}: all ${list.length} items already known, stopping incremental`);
          break;
        }
        all.push(...newItems);
      } else {
        all.push(...list);
      }

      progress.markPageDone('shares', page, all.length, totalReported);
      writeData(outFile, all);
      logger.info(`[shares] page ${apiPage}: +${list.length} => total ${all.length}/${totalReported || '?'}`);
      if (totalReported && all.length >= totalReported) break;
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  let finalItems = all;
  if (incremental && existingItems.length > 0) {
    if (all.length > 0) {
      const { merged, addedCount } = mergeByIds(existingItems, all, 'shares');
      logger.info(`[shares] incremental merge: ${addedCount} new items added to ${existingItems.length} existing`);
      finalItems = merged;
    } else {
      finalItems = existingItems;
    }
  }

  writeData(outFile, finalItems);
  let status = 'done';
  let errMsg = null;
  if (rateLimited) { status = 'rate_limited'; errMsg = 'consecutive empty pages'; }
  else if (hadError && finalItems.length === 0) { status = 'error'; errMsg = lastError; }
  progress.finishModule('shares', status, errMsg);
  return { status, total: totalReported || finalItems.length, fetched: finalItems.length, items: finalItems };
}

module.exports = { collectShares };
