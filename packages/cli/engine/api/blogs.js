/**
 * Blog posts API.
 * QZone blog API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

function rand() { return Math.random(); }

/** Blog list pagination */
async function getBlogs({ client, targetUin, page, pageSize = 50 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.BLOGS_LIST_URL,
    {
      hostUin: targetUin,
      uin: ownerUin,
      blogType: '0',
      cateName: '',
      cateHex: '',
      statYear: new Date().getFullYear(),
      reqInfo: '7',
      pos: page * pageSize,
      num: pageSize,
      sortType: '0',
      absType: '0',
      source: '0',
      rand: rand(),
      ref: 'qzone',
      verbose: '1',
    },
    { tag: 'blogs.getBlogs', allowEmpty: true, retries: 2 }
  );
}

/** Blog read counts (max 500 IDs per call) */
async function getReadCount({ client, targetUin, blogIds }) {
  return client.getJson(
    REST_URLS.BLOGS_READ_COUNT_URL,
    {
      type: 1,
      uinList: targetUin,
      idList: (blogIds || []).join('_'),
      r: rand(),
      iNotice: 0,
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      format: 'jsonp',
      ref: 'qzone',
    },
    { tag: 'blogs.getReadCount', allowEmpty: true, retries: 2 }
  );
}

/**
 * Blog detail.
 * Note: returns HTML, not JSON. Uses the client's low-level _requestOnce to fetch raw text.
 */
async function getBlogInfoHtml({ client, targetUin, blogid }) {
  const { status, data } = await client._requestOnce(
    REST_URLS.BLOGS_INFO_URL,
    {
      uin: targetUin,
      blogid,
      styledm: 'qzonestyle.gtimg.cn',
      imgdm: 'qzs.qq.com',
      bdm: 'b.qzone.qq.com',
      mode: '2',
      numperpage: '50',
      timestamp: Math.floor(Date.now() / 1000),
      dprefix: '',
      inCharset: 'gb2312',
      outCharset: 'gb2312',
      ref: 'qzone',
      page: '1',
      refererurl: 'https://qzs.qq.com/qzone/app/blog/v6/bloglist.html#nojump=1&page=1&catalog=list',
    },
    { tag: 'blogs.getBlogInfoHtml' }
  );
  return { status, html: String(data || '') };
}

/** Blog comments pagination */
async function getComments({ client, targetUin, blogid, page, pageSize = 20 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.BLOGS_COMMENTS_URL,
    {
      uin: ownerUin,
      num: pageSize,
      topicId: `${targetUin}_${blogid}`,
      start: page * pageSize,
      r: rand(),
      iNotice: 0,
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      format: 'jsonp',
      ref: 'qzone',
    },
    { tag: 'blogs.getComments', allowEmpty: true, retries: 2 }
  );
}

module.exports = { getBlogs, getReadCount, getBlogInfoHtml, getComments };
