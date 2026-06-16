/**
 * Favorites collector (owner uin only).
 * Writes data/favorites.json
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData, randomSleep } = require('./_util.js');
const favoritesApi = require('../api/favorites.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 1500;

async function collectFavorites({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 30,
  logger = console,
  listFetch = true,
}) {
  if (client.session.uin !== targetUin) {
    logger.info('[favorites] only accessible by owner uin, skipping');
    progress.finishModule('favorites', 'no_access', 'not-owner');
    return { status: 'no_access', total: 0, fetched: 0, items: [] };
  }

  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;

  const outFile = path.join(outputRoot, 'data', 'favorites.json');

  // Unified "fill-missing" model (see messages.js): load existing, skip if
  // complete, else resume forward; listFetch=false means no list calls at all.
  const r = readData(outFile, logger);
  const existingItems = (r.ok && Array.isArray(r.value)) ? r.value : [];
  if (!r.ok && r.raw) logger.warn('[favorites] existing JSON unparseable; treating as empty');
  const have = existingItems.length;
  const progTotal = progress.module('favorites').totalReported || 0;

  if (!listFetch || (progTotal > 0 && have >= progTotal)) {
    if (have > 0 || !listFetch) {
      logger.info(`[favorites] ${!listFetch ? 'fill-missing (no list fetch)' : `already complete (${have}/${progTotal})`}; skipping list fetch`);
      progress.finishModule('favorites', 'done');
      return { status: 'done', total: progTotal || have, fetched: have, items: existingItems };
    }
  }

  const all = existingItems.slice();
  const seen = new Set(existingItems.map(it => String(it.id)));
  let consecutiveKnown = 0;
  let startPage = Math.floor(have / pageSize);
  if (have > 0) {
    logger.info(`[favorites] fill-missing: ${have} existing (total≈${progTotal || '?'}), resuming forward from page ${startPage}`);
  }

  for (let page = startPage; page < 10000; page++) {
    let json;
    try {
      json = await favoritesApi.getFavorites({ client, page, pageSize });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('favorites', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      logger.warn(`[favorites] page ${page} error: ${err.message}`);
      break;
    }
    const data = json && json.data || {};
    const list = Array.isArray(data.fav_list) ? data.fav_list
      : (Array.isArray(data.favList) ? data.favList : []);
    if (typeof data.total === 'number') totalReported = data.total;
    else if (typeof data.total_num === 'number') totalReported = data.total_num;

    if (list.length === 0) {
      consecutiveEmpty++;
      if (totalReported && all.length >= totalReported) break;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) {
        rateLimited = totalReported > all.length;
        break;
      }
    } else {
      consecutiveEmpty = 0;
      const newItems = list.filter(it => !seen.has(String(it.id)));
      for (const it of newItems) seen.add(String(it.id));
      if (newItems.length === 0) {
        consecutiveKnown++;
        if (totalReported && all.length >= totalReported) break;
        if (consecutiveKnown >= 2) break;
      } else {
        consecutiveKnown = 0;
        all.push(...newItems);
        progress.markPageDone('favorites', page, all.length, totalReported);
        writeData(outFile, all);
        logger.info(`[favorites] page ${page}: +${newItems.length} new => total ${all.length}/${totalReported || '?'}`);
        if (totalReported && all.length >= totalReported) break;
      }
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  writeData(outFile, all);
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('favorites', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported, fetched: all.length, items: all };
}

module.exports = { collectFavorites };
