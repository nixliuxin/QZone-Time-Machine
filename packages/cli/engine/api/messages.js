/**
 * Messages (status updates) API.
 * QZone messages/mood API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

function rand() { return Math.random(); }

/**
 * Fetch messages list page.
 * @param {object} args
 *   - client: QzoneClient
 *   - targetUin: target QQ number
 *   - page: 0-based
 *   - pageSize: default 40
 */
async function getMessages({ client, targetUin, page, pageSize = 40 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.MESSAGES_LIST_URL,
    {
      uin: targetUin,
      ftype: 0,
      sort: 0,
      pos: page * pageSize,
      num: pageSize,
      replynum: 100,
      callback: '_preloadCallback',
      code_version: 1,
      format: 'jsonp',
      need_private_comment: 1,
    },
    {
      tag: 'messages.getMessages',
      allowEmpty: true, // let collector handle empty (distinguish last page vs silent rate-limit)
      retries: 2,
    }
  );
}

/** Fetch full message content */
async function getFullContent({ client, targetUin, tid }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.MESSAGES_DETAIL_URL,
    {
      tid,
      uin: targetUin,
      t1_source: 1,
      not_trunc_con: 1,
      hostuin: ownerUin,
      code_version: 1,
      format: 'jsonp',
      qzreferrer: 'https://user.qzone.qq.com',
    },
    { tag: 'messages.getFullContent', allowEmpty: true, retries: 2 }
  );
}

/** Fetch message images (when >9 images) */
async function getImageInfos({ client, targetUin, tid }) {
  return client.getJson(
    REST_URLS.MESSAGES_IMAGES_URL,
    {
      r: rand(),
      tid,
      uin: targetUin,
      t1_source: 1,
      random: rand(),
    },
    { tag: 'messages.getImageInfos', allowEmpty: true, retries: 2 }
  );
}

/** Message comments pagination */
async function getComments({ client, targetUin, tid, page, pageSize = 20 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.MESSAGES_VIDEOS_COMMONTS_URL,
    {
      need_private_comment: 1,
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
      random: rand(),
    },
    { tag: 'messages.getComments', allowEmpty: true, retries: 2 }
  );
}

module.exports = { getMessages, getFullContent, getImageInfos, getComments };
