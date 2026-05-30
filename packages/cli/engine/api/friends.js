/**
 * Friends API.
 * QZone friends API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

/** QQ friends (by group) - returns all at once */
async function getFriends({ client }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.FRIENDS_LIST_URL,
    { uin: ownerUin, follow_flag: 0, groupface_flag: 0, fupdate: 1 },
    { tag: 'friends.getFriends', allowEmpty: true, retries: 2 }
  );
}

/** Sorted friends (with intimacy scores, etc.) */
async function getSortFriends({ client }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.FRIENDS_SORT_LIST_URL,
    {
      res_uin: ownerUin,
      res_type: 'normal',
      format: 'jsonp',
      count_per_page: 10,
      page_index: 0,
      page_type: 0,
      mayknowuin: '',
      qqmailstat: '',
    },
    { tag: 'friends.getSortFriends', allowEmpty: true, retries: 2 }
  );
}

/** Friend-since timestamp */
async function getFriendshipTime({ client, targetUin }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.FRIENDSHIP_INFO_URL,
    { activeuin: ownerUin, passiveuin: targetUin, situation: 1, isCalendar: 1 },
    { tag: 'friends.getFriendshipTime', allowEmpty: true, retries: 2 }
  );
}

/** Check zone access (detects -4002 / -4009) */
async function getZoneAccess({ client, targetUin }) {
  return client.getJson(
    REST_URLS.USER_OVERVIEW_URL,
    {
      uin: targetUin,
      param: `3_${targetUin}_0|8_8_${targetUin}_1_1_0_0_1|15|16`,
    },
    { tag: 'friends.getZoneAccess', allowEmpty: true, retries: 1 }
  );
}

/** Special care list */
async function getSpecialCare({ client }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.SPECIAL_CARE_LIST_URL,
    { uin: ownerUin, do: 3, fupdate: 1, rd: Math.random() },
    { tag: 'friends.getSpecialCare', allowEmpty: true, retries: 2 }
  );
}

module.exports = {
  getFriends,
  getSortFriends,
  getFriendshipTime,
  getZoneAccess,
  getSpecialCare,
};
