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

  const outFile = path.join(outputRoot, 'data', 'videos.json');
  const vidKey = (x) => String(x.vid || x.shuoshuoid || x.video_id || '');
  const seen = new Set();
  // `lastPage` is repurposed here as the next `start` cursor (QZone video API is offset-based).
  let start = 0;

  // Fill-missing: load whatever exists; skip entirely if already complete.
  const r0 = readData(outFile, logger);
  const existingVids = (r0.ok && Array.isArray(r0.value)) ? r0.value : [];
  const progTotal = progress.module('videos').totalReported || 0;
  if (progTotal > 0 && existingVids.length >= progTotal) {
    logger.info(`[videos] already complete (${existingVids.length}/${progTotal}); skipping list fetch`);
    progress.finishModule('videos', 'done');
    return { status: 'done', total: progTotal, fetched: existingVids.length, rateLimited: false, items: existingVids };
  }

  const lp = progress.module('videos').lastPage;
  if (existingVids.length > 0) {
    all.push(...existingVids);
    for (const it of all) seen.add(vidKey(it));
    if (typeof lp === 'number' && lp > 0) start = lp;
    logger.info(`[videos] fill-missing: ${all.length} existing (total≈${progTotal || '?'}), resuming from start=${start}`);
  } else if (r0.raw) {
    progress.module('videos').lastPage = -1;
    logger.warn('[videos] existing JSON unparseable, resetting start=0 for full re-fetch');
  }

  for (let guard = 0; guard < 10000; guard++) {
    let json;
    try {
      json = await videosApi.getVideos({ client, targetUin, start, pageSize });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('videos', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, rateLimited: false, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      logger.warn(`[videos] start ${start} error: ${err.message}`);
      progress.finishModule('videos', 'error', err.message);
      writeData(outFile, all);
      return { status: 'error', total: totalReported, fetched: all.length, rateLimited: false, items: all };
    }

    const data = json && json.data || {};
    // QZone returns the list under `Videos` (capital). Keep legacy fallbacks just in case.
    const list = Array.isArray(data.Videos) ? data.Videos
      : (Array.isArray(data.videoList) ? data.videoList : []);
    if (typeof data.total === 'number') totalReported = data.total;
    else if (typeof data.total_video_count === 'number') totalReported = data.total_video_count;

    if (list.length === 0) {
      consecutiveEmpty++;
      logger.info(`[videos] start ${start} empty (${consecutiveEmpty}/${EMPTY_PAGE_THRESHOLD})`);
      if (totalReported && all.length >= totalReported) break;
      if (data.isLast) break;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) {
        rateLimited = totalReported > all.length;
        break;
      }
    } else {
      consecutiveEmpty = 0;
      const fresh = list.filter((x) => !seen.has(vidKey(x)));
      for (const x of fresh) seen.add(vidKey(x));
      all.push(...fresh);
      // Advance by the API's own cursor when sane, else by the count we received.
      const next = (typeof data.nextPageStart === 'number' && data.nextPageStart > start)
        ? data.nextPageStart : start + list.length;
      start = next;
      progress.markPageDone('videos', start, all.length, totalReported);
      writeData(outFile, all);
      logger.info(`[videos] +${fresh.length} (start->${start}) => total ${all.length}/${totalReported || '?'}`);
      if (data.isLast) break;
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
