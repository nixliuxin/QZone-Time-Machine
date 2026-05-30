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
const { writeData, readData } = require('./_util.js');
const messagesApi = require('../api/messages.js');
const { sleep, RateLimitError, EmptyDataError, NoAccessError, AuthInvalidError } =
  require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 600;

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
}) {
  const all = [];
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;

  let startPage = (progress.module('messages').lastPage ?? -1) + 1;
  if (startPage > 0) {
    logger.info(`[messages] resuming from page ${startPage}`);
  }
  const outFile = path.join(outputRoot, 'data', 'messages.json');
  if (startPage > 0) {
    const r = readData(outFile, logger);
    if (r.ok && Array.isArray(r.value)) {
      all.push(...r.value);
    } else if (r.raw) {
      startPage = 0;
      all.length = 0;
      progress.module('messages').lastPage = -1;
      logger.warn(`[messages] existing JSON unparseable, resetting startPage=0 for full re-fetch`);
    }
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
      all.push(...list);
      progress.markPageDone('messages', page, all.length, totalReported);
      writeData(outFile, all);
      logger.info(`[messages] page ${page}: +${list.length} => total ${all.length}/${totalReported || '?'}`);
      if (totalReported && all.length >= totalReported) break;
    }
    await sleep(PAGE_SLEEP_MS);
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
