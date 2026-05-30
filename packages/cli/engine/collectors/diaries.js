/**
 * Private diaries collector (owner uin only).
 * Writes data/diaries.json
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { writeData, readData } = require('./_util.js');
const diariesApi = require('../api/diaries.js');
const { sleep, NoAccessError, AuthInvalidError } = require('../client.js');

const EMPTY_PAGE_THRESHOLD = 3;
const PAGE_SLEEP_MS = 600;

async function collectDiaries({
  client,
  targetUin,
  outputRoot,
  progress,
  pageSize = 50,
  logger = console,
  withDetail = false,
}) {
  if (client.session.uin !== targetUin) {
    logger.info('[diaries] private diaries only accessible by owner uin, skipping');
    progress.finishModule('diaries', 'no_access', 'not-owner');
    return { status: 'no_access', total: 0, fetched: 0, items: [] };
  }

  const all = [];
  let totalReported = 0;
  let consecutiveEmpty = 0;
  let rateLimited = false;

  let startPage = (progress.module('diaries').lastPage ?? -1) + 1;
  const outFile = path.join(outputRoot, 'data', 'diaries.json');
  if (startPage > 0) {
    const r = readData(outFile, logger);
    if (r.ok && Array.isArray(r.value)) {
      all.push(...r.value);
    } else if (r.raw) {
      startPage = 0;
      progress.module('diaries').lastPage = -1;
      logger.warn('[diaries] existing JSON unparseable, resetting startPage=0 for full re-fetch');
    }
  }

  for (let page = startPage; page < 10000; page++) {
    let json;
    try {
      json = await diariesApi.getDiaries({ client, page, pageSize });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('diaries', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      logger.warn(`[diaries] page ${page} error: ${err.message}`);
      break;
    }
    const data = json && json.data || {};
    const list = Array.isArray(data.titlelist) ? data.titlelist
               : Array.isArray(data.list) ? data.list : [];
    if (typeof data.total_num === 'number') totalReported = data.total_num;
    else if (typeof data.totalNum === 'number') totalReported = data.totalNum;
    else if (typeof data.total === 'number') totalReported = data.total;

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
      progress.markPageDone('diaries', page, all.length, totalReported);
      writeData(outFile, all);
      logger.info(`[diaries] page ${page}: +${list.length} => total ${all.length}/${totalReported || '?'}`);
      if (totalReported && all.length >= totalReported) break;
    }
    await sleep(PAGE_SLEEP_MS);
  }

  if (withDetail) {
    for (let i = 0; i < all.length; i++) {
      const d = all[i];
      try {
        const { html } = await diariesApi.getDiaryInfoHtml({ client, blogid: d.blogid });
        d.custom_html = html;
      } catch (e) {}
      if (i % 10 === 9) await sleep(300);
    }
  }

  writeData(outFile, all);
  const status = rateLimited ? 'rate_limited' : 'done';
  progress.finishModule('diaries', status, rateLimited ? 'consecutive empty pages' : null);
  return { status, total: totalReported, fetched: all.length, items: all };
}

module.exports = { collectDiaries };
