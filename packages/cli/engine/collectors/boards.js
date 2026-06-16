/**
 * Message board collector.
 * Writes data/boards.json: {items, total}
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData, randomSleep, buildIdSet } = require('./_util.js');
const boardsApi = require('../api/boards.js');
const { NoAccessError, AuthInvalidError, RateLimitError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const KNOWN_PAGE_THRESHOLD = 2;
const PAGE_SLEEP_MS = 1500;

async function collectBoards({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 20,
  logger = console,
  pageLimit = 0,
  incremental = false,
}) {
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let consecutiveKnown = 0;
  let rateLimited = false;

  const outFile = path.join(outputRoot, 'data', 'boards.json');

  // Unified "fill-missing" model (see messages.js): skip if complete, else
  // resume forward; never re-scan from page 0.
  const r = readData(outFile, logger);
  let existingItems = [];
  if (r.ok && r.value) existingItems = Array.isArray(r.value) ? r.value : (r.value.items || []);
  else if (r.raw) logger.warn(`[boards] existing JSON unparseable; treating as empty`);
  const existingIds = buildIdSet(existingItems, 'boards');
  const have = existingItems.length;
  const progTotal = progress.module('boards').totalReported || 0;

  if (progTotal > 0 && have >= progTotal && pageLimit === 0) {
    logger.info(`[boards] already complete (${have}/${progTotal}); skipping list fetch`);
    progress.finishModule('boards', 'done');
    return { status: 'done', total: progTotal, fetched: have, rateLimited: false, items: existingItems };
  }

  const all = existingItems.slice();
  let startPage = Math.floor(have / pageSize);
  if (have > 0) {
    logger.info(`[boards] fill-missing: ${have} existing (total≈${progTotal || '?'}), resuming forward from page ${startPage}`);
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

      const newItems = list.filter(it => !existingIds.has(String(it.id)));
      for (const it of newItems) existingIds.add(String(it.id));

      if (newItems.length === 0) {
        consecutiveKnown++;
        logger.info(`[boards] page ${page}: all ${list.length} known (${consecutiveKnown}/${KNOWN_PAGE_THRESHOLD})`);
        if (totalReported && all.length >= totalReported) break;
        if (consecutiveKnown >= KNOWN_PAGE_THRESHOLD) break;
      } else {
        consecutiveKnown = 0;
        all.push(...newItems);
        progress.markPageDone('boards', page, all.length, totalReported);
        writeData(outFile, { items: all, total: totalReported });
        logger.info(`[boards] page ${page}: +${newItems.length} new (${list.length - newItems.length} known) => total ${all.length}/${totalReported || '?'}`);
        if (totalReported && all.length >= totalReported) break;
      }
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  const finalItems = all;
  writeData(outFile, { items: finalItems, total: totalReported || finalItems.length });
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('boards', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported || finalItems.length, fetched: finalItems.length, rateLimited, items: finalItems };
}

module.exports = { collectBoards };
