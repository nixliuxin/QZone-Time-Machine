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
}) {
  if (client.session.uin !== targetUin) {
    logger.info('[favorites] only accessible by owner uin, skipping');
    progress.finishModule('favorites', 'no_access', 'not-owner');
    return { status: 'no_access', total: 0, fetched: 0, items: [] };
  }

  const all = [];
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;

  let startPage = (progress.module('favorites').lastPage ?? -1) + 1;
  const outFile = path.join(outputRoot, 'data', 'favorites.json');
  if (startPage > 0) {
    const r = readData(outFile, logger);
    if (r.ok && Array.isArray(r.value)) {
      all.push(...r.value);
    } else if (r.raw) {
      startPage = 0;
      progress.module('favorites').lastPage = -1;
      logger.warn('[favorites] existing JSON unparseable, resetting startPage=0 for full re-fetch');
    }
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
      all.push(...list);
      progress.markPageDone('favorites', page, all.length, totalReported);
      writeData(outFile, all);
      logger.info(`[favorites] page ${page}: +${list.length} => total ${all.length}/${totalReported || '?'}`);
      if (totalReported && all.length >= totalReported) break;
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  writeData(outFile, all);
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('favorites', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported, fetched: all.length, items: all };
}

module.exports = { collectFavorites };
