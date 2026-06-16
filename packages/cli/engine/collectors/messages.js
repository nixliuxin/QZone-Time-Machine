/**
 * Messages (status updates) collector.
 *
 * Responsibilities:
 *   - Paginate through the messages list until fetched >= total
 *     or consecutive empty pages >= EMPTY_PAGE_THRESHOLD
 *   - Auto-resume from progress.lastPage + 1
 *   - Writes data/messages.json
 */
'use strict';

const path = require('path');
const { writeData, readData, randomSleep, buildIdSet } = require('./_util.js');
const messagesApi = require('../api/messages.js');
const { RateLimitError, EmptyDataError, NoAccessError, AuthInvalidError } =
  require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
// When resuming, the first page(s) overlap with known data. Stop after this many
// consecutive fully-known pages so we don't keep scanning an already-complete list.
const KNOWN_PAGE_THRESHOLD = 2;
const PAGE_SLEEP_MS = 1500;

/**
 * Main entry: collect messages (status updates).
 * @returns {Promise<{status, total, fetched, rateLimited, items}>}
 */
async function collectMessages({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 40,
  logger = console,
  pageLimit = 0,
  incremental = false,
}) {
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let consecutiveKnown = 0;
  let rateLimited = false;

  const outFile = path.join(outputRoot, 'data', 'messages.json');

  // Unified "fill-missing" model (no full re-scan from page 0):
  //   - Load whatever already exists on disk.
  //   - If the list is already complete (have >= totalReported), skip the
  //     list fetch entirely (zero requests) and let enrichment fill gaps.
  //   - Otherwise resume FORWARD from the page where existing data ends and
  //     append only the still-missing (older) items, deduped by tid.
  const r = readData(outFile, logger);
  const existingItems = (r.ok && Array.isArray(r.value)) ? r.value : [];
  const existingIds = buildIdSet(existingItems, 'messages');
  if (!r.ok && r.raw) {
    logger.warn(`[messages] existing JSON unparseable; treating as empty`);
  }
  const have = existingItems.length;
  const progTotal = progress.module('messages').totalReported || 0;

  // Already complete -> skip list fetch; existing items still flow to enrichment.
  if (progTotal > 0 && have >= progTotal && pageLimit === 0) {
    logger.info(`[messages] already complete (${have}/${progTotal}); skipping list fetch`);
    progress.finishModule('messages', 'done');
    return { status: 'done', total: progTotal, fetched: have, rateLimited: false, items: existingItems };
  }

  // Start from existing data and resume forward to fill the missing tail.
  const all = existingItems.slice();
  let startPage = Math.floor(have / pageSize);
  if (have > 0) {
    logger.info(`[messages] fill-missing: ${have} existing (total≈${progTotal || '?'}), resuming forward from page ${startPage}`);
  }

  const maxPage = pageLimit > 0 ? startPage + pageLimit : 10000;
  for (let page = startPage; page < maxPage; page++) {
    let json;
    try {
      json = await messagesApi.getMessages({ client, targetUin, page, pageSize });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('messages', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, rateLimited: false, items: [] };
      }
      if (err instanceof AuthInvalidError) {
        throw err;
      }
      logger.warn(`[messages] page ${page} request error: ${err.message}`);
      progress.finishModule('messages', 'error', err.message);
      writeData(outFile, all);
      return { status: 'error', total: totalReported, fetched: all.length, rateLimited: false, items: all };
    }

    if (typeof json.total === 'number') totalReported = json.total;
    const list = Array.isArray(json.msglist) ? json.msglist : [];

    if (list.length === 0) {
      consecutiveEmpty++;
      logger.info(`[messages] page ${page} empty (${consecutiveEmpty}/${EMPTY_PAGE_THRESHOLD})`);
      if (totalReported && all.length >= totalReported) break;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) {
        rateLimited = totalReported > all.length;
        break;
      }
    } else {
      consecutiveEmpty = 0;

      // Dedup against everything already known (existing on disk + added this run).
      const newItems = list.filter(it => !existingIds.has(String(it.tid)));
      for (const it of newItems) existingIds.add(String(it.tid));

      if (newItems.length === 0) {
        // Overlap with already-known data. Keep advancing to reach the missing
        // tail, but guard against runaway loops when the list is fully caught up.
        consecutiveKnown++;
        logger.info(`[messages] page ${page}: all ${list.length} known (${consecutiveKnown}/${KNOWN_PAGE_THRESHOLD})`);
        if (totalReported && all.length >= totalReported) break;
        if (consecutiveKnown >= KNOWN_PAGE_THRESHOLD) break;
      } else {
        consecutiveKnown = 0;
        all.push(...newItems);
        progress.markPageDone('messages', page, all.length, totalReported);
        writeData(outFile, all);
        logger.info(`[messages] page ${page}: +${newItems.length} new (${list.length - newItems.length} known) => total ${all.length}/${totalReported || '?'}`);
        if (totalReported && all.length >= totalReported) break;
      }
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  writeData(outFile, all);
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('messages', status, rateLimited ? 'consecutive empty pages' : null);
  return {
    status,
    total: totalReported,
    fetched: all.length,
    rateLimited,
    items: all,
  };
}

module.exports = { collectMessages, EMPTY_PAGE_THRESHOLD };
