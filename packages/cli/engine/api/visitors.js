/**
 * Visitors API.
 * QZone visitors API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

/**
 * Own zone visitor list (VISITOR_MORE_LIST_URL) with full detail mask=7.
 * Others' zones only get the simplified list (VISITOR_SIMPLE_LIST_URL, mask=2).
 */
async function getList({ client, targetUin, page = 0 }) {
  const isOwner = client.session.uin === targetUin;
  const params = {
    uin: targetUin,
    mask: isOwner ? 7 : 2,
    page,
    fupdate: 1,
  };
  if (isOwner) {
    params.clear = 1;
    params.sd = Math.random();
  }
  return client.getJson(
    isOwner ? REST_URLS.VISITOR_MORE_LIST_URL : REST_URLS.VISITOR_SIMPLE_LIST_URL,
    params,
    { tag: 'visitors.getList', allowEmpty: true, retries: 2 }
  );
}

/**
 * Per-item visitors (VISITOR_SINGLE_LIST_URL) for messages/blogs/albums/shares.
 * appid: 311=messages, 2=blogs, 4=photos, 202=shares.
 * page is 0-based; API expects beginNum = page * pageSize + 1.
 */
async function getSingleVisitors({
  client, targetUin, appid, targetId, page = 0, pageSize = 10,
}) {
  return client.getJson(
    REST_URLS.VISITOR_SINGLE_LIST_URL,
    {
      uin: targetUin,
      appid,
      param: targetId,
      beginNum: page * pageSize + 1,
      num: pageSize,
      needFriend: 1,
    },
    { tag: 'visitors.getSingleVisitors', allowEmpty: true, retries: 2 }
  );
}

module.exports = { getList, getSingleVisitors };
