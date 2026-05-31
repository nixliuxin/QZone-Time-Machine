/**
 * User info collector: writes data/user.json.
 */
'use strict';

const path = require('path');
const { writeData, readData } = require('./_util.js');
const commonApi = require('../api/common.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

/**
 * @returns {{status, info}}
 *   status: 'done' | 'no_access' | 'error'
 */
async function collectUserInfo({ client, targetUin, outputRoot, logger = console }) {
  let info = { uin: targetUin };
  try {
    const json = await commonApi.getUserInfo(client, targetUin);
    if (json && json.data) Object.assign(info, json.data);
    if (json && json.nickname) info.nickname = json.nickname;
  } catch (err) {
    if (err instanceof AuthInvalidError) throw err;
    if (err instanceof NoAccessError) {
      logger.warn(`[common] getUserInfo no access: ${err.message}`);
      return { status: 'no_access', info };
    }
    logger.warn(`[common] getUserInfo error: ${err.message}`);
  }
  try {
    const card = await commonApi.getUserCard(client, targetUin);
    if (card && card.data) {
      info.nickname = info.nickname || card.data.nickname || card.data.nick;
      info.name = info.name || info.nickname;
      info.avatar = info.avatar || card.data.face || card.data.avatar;
    }
  } catch (e) {
    if (e instanceof AuthInvalidError) throw e;
  }
  if (!info.name) info.name = info.nickname || `User_${targetUin}`;
  if (!info.nickname) info.nickname = info.name;

  const outFile = path.join(outputRoot, 'data', 'user.json');
  writeData(outFile, info);
  return { status: 'done', info };
}

/**
 * Called after all modules complete to update actual counts for
 * messages/blogs/photos/boards/videos in user.json.
 */
function updateUserCounts({ outputRoot, counts, name, uin, logger = console }) {
  const userFile = path.join(outputRoot, 'data', 'user.json');
  let info = { uin, name, nickname: name };
  const r = readData(userFile, logger);
  if (r.ok && r.value && typeof r.value === 'object') {
    info = r.value;
  }
  Object.assign(info, counts);
  writeData(userFile, info);
  logger.info(`[common] updated user.json counts: ${JSON.stringify(counts)}`);
}

module.exports = { collectUserInfo, updateUserCounts };
