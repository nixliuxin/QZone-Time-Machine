/**
 * Common / user info API.
 * QZone general API (user info, overview, etc.).
 */
'use strict';

const { REST_URLS } = require('./urls.js');

function rand() {
  return Math.random();
}

/**
 * @param {import('../client.js').QzoneClient} client
 * @param {number} targetUin
 */
async function getUserInfo(client, targetUin) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.USER_INFO_URL,
    { uin: targetUin, vuin: ownerUin, fupdate: 1, rd: rand() },
    { tag: 'common.getUserInfo', allowEmpty: true, retries: 2 }
  );
}

/**
 * Overview: determines whether the zone is accessible to the current account.
 * Open zone returns code=0; insufficient permissions code=-4002 / -4009 => client throws NoAccessError.
 */
async function getOverview(client, targetUin) {
  return client.getJson(
    REST_URLS.USER_OVERVIEW_URL,
    { uin: targetUin, param: 16 },
    { tag: 'common.getOverview', allowEmpty: true, retries: 2 }
  );
}

async function getUserCard(client, targetUin) {
  return client.getJson(
    REST_URLS.USER_CARD_URL,
    { uin: targetUin, fupdate: 1, rd: rand() },
    { tag: 'common.getUserCard', allowEmpty: true, retries: 2 }
  );
}

module.exports = { getUserInfo, getOverview, getUserCard };
