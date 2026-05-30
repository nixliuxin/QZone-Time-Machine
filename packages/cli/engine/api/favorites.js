/**
 * Favorites API.
 * QZone favorites API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

async function getFavorites({ client, page, pageSize = 30 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.FAVORITE_LIST_URL,
    {
      uin: ownerUin,
      type: 0,
      start: page * pageSize,
      num: pageSize,
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      need_nick: 1,
      need_cnt: 0,
      need_new_user: 0,
      fupdate: 1,
      random: Math.random(),
    },
    { tag: 'favorites.getFavorites', allowEmpty: true, retries: 2 }
  );
}

module.exports = { getFavorites };
