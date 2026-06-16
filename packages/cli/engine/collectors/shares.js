/**
 * Shares collector: writes data/shares.json
 *
 * Note: the shares API uses 1-based page numbers (unlike other modules).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData, randomSleep, buildIdSet } = require('./_util.js');
const sharesApi = require('../api/shares.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const KNOWN_PAGE_THRESHOLD = 2;
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
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let consecutiveKnown = 0;
  let rateLimited = false;
  let hadError = false;
  let lastError = null;

  const outFile = path.join(outputRoot, 'data', 'shares.json');

  // Unified "fill-missing" model (see messages.js).
  const r = readData(outFile, logger);
  const existingItems = (r.ok && Array.isArray(r.value)) ? r.value : [];
  const existingIds = buildIdSet(existingItems, 'shares');
  if (!r.ok && r.raw) logger.warn('[shares] existing JSON unparseable; treating as empty');
  const have = existingItems.length;
  const progTotal = progress.module('shares').totalReported || 0;

  if (progTotal > 0 && have >= progTotal) {
    logger.info(`[shares] already complete (${have}/${progTotal}); skipping list fetch`);
    progress.finishModule('shares', 'done');
    return { status: 'done', total: progTotal, fetched: have, items: existingItems };
  }

  const all = existingItems.slice();
  const startPage = Math.floor(have / pageSize);
  if (have > 0) {
    logger.info(`[shares] fill-missing: ${have} existing (total≈${progTotal || '?'}), resuming forward from page ${startPage}`);
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

      const newItems = list.filter(it => !existingIds.has(String(it.id)));
      for (const it of newItems) existingIds.add(String(it.id));

      if (newItems.length === 0) {
        consecutiveKnown++;
        logger.info(`[shares] page ${apiPage}: all ${list.length} known (${consecutiveKnown}/${KNOWN_PAGE_THRESHOLD})`);
        if (totalReported && all.length >= totalReported) break;
        if (consecutiveKnown >= KNOWN_PAGE_THRESHOLD) break;
      } else {
        consecutiveKnown = 0;
        all.push(...newItems);
        progress.markPageDone('shares', page, all.length, totalReported);
        writeData(outFile, all);
        logger.info(`[shares] page ${apiPage}: +${newItems.length} new (${list.length - newItems.length} known) => total ${all.length}/${totalReported || '?'}`);
        if (totalReported && all.length >= totalReported) break;
      }
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  const finalItems = all;
  writeData(outFile, finalItems);
  let status = 'done';
  let errMsg = null;
  if (rateLimited) { status = 'rate_limited'; errMsg = 'consecutive empty pages'; }
  else if (hadError && finalItems.length === 0) { status = 'error'; errMsg = lastError; }
  progress.finishModule('shares', status, errMsg);
  return { status, total: totalReported || finalItems.length, fetched: finalItems.length, items: finalItems };
}

module.exports = { collectShares };
