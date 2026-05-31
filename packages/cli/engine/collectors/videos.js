/**
 * Videos collector. Writes data/videos.json
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData, randomSleep } = require('./_util.js');
const videosApi = require('../api/videos.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 1500;

async function collectVideos({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 20,
  logger = console,
}) {
  const all = [];
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;

  let startPage = (progress.module('videos').lastPage ?? -1) + 1;
  const outFile = path.join(outputRoot, 'data', 'videos.json');
  if (startPage > 0) {
    const r = readData(outFile, logger);
    if (r.ok && Array.isArray(r.value)) {
      all.push(...r.value);
    } else if (r.raw) {
      startPage = 0;
      progress.module('videos').lastPage = -1;
      logger.warn('[videos] existing JSON unparseable, resetting startPage=0 for full re-fetch');
    }
  }

  for (let page = startPage; page < 10000; page++) {
    let json;
    try {
      json = await videosApi.getVideos({ client, targetUin, page, pageSize });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('videos', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, rateLimited: false, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      logger.warn(`[videos] page ${page} error: ${err.message}`);
      progress.finishModule('videos', 'error', err.message);
      writeData(outFile, all);
      return { status: 'error', total: totalReported, fetched: all.length, rateLimited: false, items: all };
    }

    const data = json && json.data || {};
    const list = Array.isArray(data.videoList) ? data.videoList : [];
    if (typeof data.total_video_count === 'number') totalReported = data.total_video_count;
    else if (typeof data.total === 'number') totalReported = data.total;

    if (list.length === 0) {
      consecutiveEmpty++;
      logger.info(`[videos] page ${page} empty (${consecutiveEmpty}/${EMPTY_PAGE_THRESHOLD})`);
      if (totalReported && all.length >= totalReported) break;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) {
        rateLimited = totalReported > all.length;
        break;
      }
    } else {
      consecutiveEmpty = 0;
      all.push(...list);
      progress.markPageDone('videos', page, all.length, totalReported);
      writeData(outFile, all);
      logger.info(`[videos] page ${page}: +${list.length} => total ${all.length}/${totalReported || '?'}`);
      if (totalReported && all.length >= totalReported) break;
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  writeData(outFile, all);
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('videos', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported, fetched: all.length, rateLimited, items: all };
}

module.exports = { collectVideos };
