/**
 * Friends collector: writes data/friends.json.
 *
 * Note: friends list is only accessible for the logged-in account;
 * when backing up another user's zone, this collector is skipped.
 */
'use strict';

const path = require('path');
const { writeData } = require('./_util.js');
const friendsApi = require('../api/friends.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

async function collectFriends({
  client,
  targetUin,
  outputRoot,
  progress,
  withFriendshipTime = false,
  logger = console,
}) {
  if (client.session.uin !== targetUin) {
    logger.info('[friends] friends list only accessible by owner uin, skipping');
    progress.finishModule('friends', 'no_access', 'not-owner');
    return { status: 'no_access', total: 0, fetched: 0, items: [] };
  }

  let json;
  try {
    json = await friendsApi.getFriends({ client });
  } catch (err) {
    if (err instanceof NoAccessError) {
      progress.finishModule('friends', 'no_access', err.message);
      return { status: 'no_access', total: 0, fetched: 0, items: [] };
    }
    if (err instanceof AuthInvalidError) throw err;
    progress.finishModule('friends', 'error', err.message);
    return { status: 'error', total: 0, fetched: 0, items: [] };
  }

  const data = (json && json.data) || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const groups = Array.isArray(data.gpnames) ? data.gpnames : [];
  const groupMap = new Map();
  for (const g of groups) groupMap.set(g.gpid, g.gpname);

  let sortMap = new Map();
  try {
    const s = await friendsApi.getSortFriends({ client });
    const sortItems = (s && s.data && s.data.items) || s.items || [];
    for (const it of sortItems) {
      sortMap.set(it.uin || it.fuin, it);
    }
  } catch (e) {
    logger.warn(`[friends] sort failed: ${e.message}`);
  }

  const careUins = new Set();
  try {
    const sc = await friendsApi.getSpecialCare({ client });
    const list = (sc && sc.data && sc.data.list) || sc.list || [];
    for (const it of list) careUins.add(Number(it.uin || it.tuin));
  } catch (e) {
    logger.warn(`[friends] specialCare failed: ${e.message}`);
  }

  for (const f of items) {
    f.gpname = groupMap.get(f.groupid);
    f.intimacyScore = (sortMap.get(f.uin) || {}).intimacyScore || 0;
    f.care = careUins.has(Number(f.uin));
  }

  if (withFriendshipTime) {
    for (const f of items) {
      try {
        const r = await friendsApi.getFriendshipTime({ client, targetUin: f.uin });
        f.addFriendTime = (r && r.data && r.data.addFriendTime) || 0;
      } catch (_) {}
    }
  }

  const outFile = path.join(outputRoot, 'data', 'friends.json');
  writeData(outFile, items);
  progress.finishModule('friends', 'done');
  return { status: 'done', total: items.length, fetched: items.length, items };
}

module.exports = { collectFriends };
