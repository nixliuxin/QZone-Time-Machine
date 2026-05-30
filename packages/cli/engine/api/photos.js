/**
 * Albums / photos API.
 * QZone photo album API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

function rand() { return Math.random(); }

function tParam() {
  // Same as the browser extension: take last 9 digits of toFixed, replace leading 0 with 9
  return String(Math.random().toFixed(16)).slice(-9).replace(/^0/, '9');
}

/**
 * Parse album route (idcNum). Returns a number.
 * The original extension uses a hash algorithm to select domains;
 * here we simplify: accept any response, default to 0 (most common).
 */
async function getRoute({ client, targetUin }) {
  const json = await client.getJson(
    REST_URLS.PHOTOS_ROUTE_URL,
    {
      UIN: targetUin,
      type: 'json',
      version: 2,
      json_esc: 1,
    },
    { tag: 'photos.getRoute', allowEmpty: true, retries: 2, jsonpKey: /^photoDomainNameCallback\(/ }
  );
  // 取一个 domain_n 字段对应的 idcnum；找不到默认 0
  const data = json && (json.data || json) || {};
  for (const k of Object.keys(data)) {
    if (/^domain_\d$/.test(k)) {
      const v = data[k];
      if (v && typeof v.idcnum === 'number') return v.idcnum;
    }
  }
  return 0;
}

/** Album list pagination */
async function getAlbums({ client, targetUin, page, pageSize = 30, idcNum = 0 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.ALBUM_LIST_URL,
    {
      callback: 'shine0_Callback',
      t: tParam(),
      hostUin: targetUin,
      uin: ownerUin,
      appid: 4,
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      source: 'qzone',
      plat: 'qzone',
      format: 'jsonp',
      notice: 0,
      filter: 1,
      handset: 4,
      needUserInfo: 1,
      idcNum,
      mode: 2,
      sortOrder: '2',
      pageStart: page * pageSize,
      pageNum: pageSize,
      callbackFun: 'shine0',
      _: Date.now(),
    },
    { tag: 'photos.getAlbums', allowEmpty: true, retries: 2 }
  );
}

/** Album comments pagination */
async function getAlbumComments({ client, targetUin, albumId, page, pageSize = 20 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.ALBUM_PHOTOS_COMMENTS_URL,
    {
      need_private_comment: 1,
      uin: ownerUin,
      hostUin: targetUin,
      start: page * pageSize,
      num: pageSize,
      order: 1,
      topicId: albumId,
      format: 'jsonp',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      t: Date.now(),
      cmtType: 1,
      plat: 'qzone',
      source: 'qzone',
      random: rand(),
    },
    { tag: 'photos.getAlbumComments', allowEmpty: true, retries: 2 }
  );
}

/** Photo list pagination within an album */
async function getImages({ client, targetUin, albumId, page, pageSize = 500, idcNum = 0 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.IMAGES_LIST_URL,
    {
      callback: 'shine0_Callback',
      t: tParam(),
      mode: 0,
      idcNum,
      hostUin: targetUin,
      topicId: albumId,
      noTopic: 0,
      uin: ownerUin,
      pageStart: page * pageSize,
      pageNum: pageSize,
      skipCmtCount: 0,
      singleurl: 1,
      batchId: '',
      notice: 0,
      appid: 4,
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      source: 'qzone',
      plat: 'qzone',
      outstyle: 'json',
      format: 'jsonp',
      json_esc: 1,
      callbackFun: 'shine0',
      _: Date.now(),
    },
    { tag: 'photos.getImages', allowEmpty: true, retries: 2 }
  );
}

/** Photo detail (for original URL & EXIF) */
async function getImageInfo({ client, targetUin, albumId, picKey, postNum = 0 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.IMAGES_INFO_URL,
    {
      t: tParam(),
      topicId: albumId,
      picKey,
      shootTime: '',
      cmtOrder: 1,
      fupdate: 1,
      plat: 'qzone',
      source: 'qzone',
      cmtNum: 10,
      likeNum: 5,
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      offset: 0,
      number: 40,
      uin: ownerUin,
      hostUin: targetUin,
      appid: 4,
      isFirst: 1,
      sortOrder: 1,
      showMode: 1,
      need_private_comment: 1,
      prevNum: 0,
      postNum,
      _: Date.now(),
    },
    { tag: 'photos.getImageInfo', allowEmpty: true, retries: 2 }
  );
}

/** Photo comments pagination */
async function getImageComments({ client, targetUin, albumId, picKey, page, pageSize = 20 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.ALBUM_PHOTOS_COMMENTS_URL,
    {
      uin: ownerUin,
      hostUin: targetUin,
      start: page * pageSize,
      num: pageSize,
      order: 1,
      topicId: `${albumId}_${picKey}`,
      format: 'jsonp',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      ref: 'photo',
      need_private_comment: 1,
      albumId,
      qzone: 'qzone',
      plat: 'qzone',
      random: Date.now(),
    },
    { tag: 'photos.getImageComments', allowEmpty: true, retries: 2 }
  );
}

module.exports = {
  getRoute,
  getAlbums,
  getAlbumComments,
  getImages,
  getImageInfo,
  getImageComments,
};
