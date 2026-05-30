/**
 * Likes API (detail / count).
 * QZone likes API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

/**
 * unikey format: 'http://user.qzone.qq.com/{ownerUin}/mood/{tid}' (messages)
 *                or 'http://user.qzone.qq.com/{ownerUin}/blog/{blogid}', etc.
 */
async function getLikeCount({ client, unikey }) {
  return client.getJson(
    REST_URLS.LIKE_COUNT_URL,
    { fupdate: 1, unikey },
    { tag: 'likes.getLikeCount', allowEmpty: true, retries: 2 }
  );
}

async function getLikeList({ client, unikey, beginUin = 0 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.LIKE_LIST_URL,
    {
      uin: ownerUin,
      unikey,
      begin_uin: beginUin || 0,
      query_count: 60,
      if_first_page: beginUin === 0 ? 1 : 0,
    },
    { tag: 'likes.getLikeList', allowEmpty: true, retries: 2 }
  );
}

/**
 * unikey builder for each module.
 */
function buildUniKey(kind, ownerUin, id) {
  switch (kind) {
    case 'mood': return `http://user.qzone.qq.com/${ownerUin}/mood/${id}`;       // messages
    case 'blog': return `http://user.qzone.qq.com/${ownerUin}/blog/${id}`;       // blogs
    case 'photo': return `http://user.qzone.qq.com/${ownerUin}/photo/${id}`;     // photos/albums
    case 'share': return `00${ownerUin}00${id}`;                                  // shares (from ShareInfo)
    default: return null;
  }
}

module.exports = { getLikeCount, getLikeList, buildUniKey };
