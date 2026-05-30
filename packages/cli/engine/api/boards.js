/**
 * Message board API.
 * QZone message board API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

function rand() { return Math.random(); }

async function getBoards({ client, targetUin, page, pageSize = 20 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.BOARD_LIST_URL,
    {
      uin: ownerUin,
      hostUin: targetUin,
      start: page * pageSize,
      s: rand(),
      format: 'jsonp',
      num: pageSize,
      inCharset: 'utf-8',
      outCharset: 'utf-8',
    },
    { tag: 'boards.getBoards', allowEmpty: true, retries: 5 }
  );
}

module.exports = { getBoards };
