/**
 * Videos API.
 * QZone video API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

function tParam() {
  return String(Math.random().toFixed(16)).slice(-9).replace(/^0/, '9');
}

async function getVideos({ client, targetUin, page, pageSize = 20 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.VIDEO_LIST_URL,
    {
      callback: 'shine0_Callback',
      t: tParam(),
      uin: ownerUin,
      hostUin: targetUin,
      appid: 4,
      getMethod: 2,
      start: page * pageSize,
      count: pageSize,
      need_old: 0,
      getUserInfo: 0,
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      refer: 'qzone',
      source: 'qzone',
      callbackFun: 'shine0',
      _: Date.now(),
    },
    { tag: 'videos.getVideos', allowEmpty: true, retries: 2 }
  );
}

async function getComments({ client, targetUin, tid, page, pageSize = 20 }) {
  const { REST_URLS } = require('./urls.js');
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.MESSAGES_VIDEOS_COMMONTS_URL,
    {
      uin: ownerUin,
      hostUin: targetUin,
      start: page * pageSize,
      num: pageSize,
      order: 0,
      topicId: `${targetUin}_${tid}`,
      format: 'jsonp',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      ref: 'qzone',
      need_private_comment: 1,
      code_version: 1,
      out_charset: 'UTF-8',
    },
    { tag: 'videos.getComments', allowEmpty: true, retries: 2 }
  );
}

module.exports = { getVideos, getComments };
