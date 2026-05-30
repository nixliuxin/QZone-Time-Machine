/**
 * Private diaries API.
 * QZone diary API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

async function getDiaries({ client, page, pageSize = 50 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.DIARY_LIST_URL,
    {
      uin: ownerUin,
      vuin: ownerUin,
      pos: page * pageSize,
      numperpage: pageSize,
      pwd2sig: '',
      r: Math.random(),
      fupdate: '1',
      iNotice: '0',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      format: 'jsonp',
      ref: 'qzone',
    },
    { tag: 'diaries.getDiaries', allowEmpty: true, retries: 2 }
  );
}

/** Detail HTML */
async function getDiaryInfoHtml({ client, blogid }) {
  const ownerUin = client.session.uin;
  const { status, data } = await client._requestOnce(
    REST_URLS.DIARY_INFO_URL,
    {
      uin: ownerUin,
      blogid,
      pwd2sig: '',
      styledm: 'qzonestyle.gtimg.cn',
      imgdm: 'qzs.qq.com',
      bdm: 'b.qzone.qq.com',
      rs: Math.random(),
      private: '1',
      ref: 'qzone',
      refererurl: 'https://qzs.qq.com/qzone/app/blog/v6/bloglist.html#nojump=1&catalog=private&page=1',
    },
    { tag: 'diaries.getDiaryInfoHtml' }
  );
  return { status, html: String(data || '') };
}

module.exports = { getDiaries, getDiaryInfoHtml };
