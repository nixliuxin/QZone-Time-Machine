/**
 * Shares API.
 * QZone shares API.
 */
'use strict';

const { REST_URLS } = require('./urls.js');

/**
 * Note: SHARE_LIST_URL returns HTML (not JSON), with multiple
 * `shareInfos.push({...});` calls embedded in <script> blocks.
 */
async function getSharesHtml({ client, targetUin, page = 1, pageSize = 30 }) {
  const { status, data } = await client._requestOnce(
    REST_URLS.SHARE_LIST_URL,
    {
      uin: targetUin,
      page,
      num: pageSize,
      spaceuin: targetUin,
      isfriend: 0,
      ttype: 0,
    },
    { tag: 'shares.getSharesHtml' }
  );
  return { status, html: String(data || '') };
}

/**
 * Parse HTML to extract all objects from shareInfos.push({...}) calls.
 * Total count is extracted from the "X 条分享" text in the page.
 */
function parseSharesHtml(html) {
  const list = [];
  if (!html) return { list, total: 0 };
  const re = /shareInfos\.push\(\s*(\{[\s\S]*?\})\s*\);/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    try {
      // shareInfos contains JSON-like objects but keys are often unquoted;
      // try JSON.parse first, fall back to Function eval (sandboxed)
      try {
        list.push(JSON.parse(raw));
      } catch (_) {
        const fn = new Function(`return (${raw});`);
        list.push(fn());
      }
    } catch (_) { /* skip unparseable entry */ }
  }
  let total = 0;
  const t = /([\d,]+)\s*条分享/.exec(html);
  if (t) total = parseInt(t[1].replace(/,/g, ''), 10) || 0;
  return { list, total };
}

async function getComments({ client, targetUin, id, page, pageSize = 20 }) {
  const ownerUin = client.session.uin;
  return client.getJson(
    REST_URLS.SHARE_COMMENTS_URL,
    {
      fupdate: 2,
      uin: ownerUin,
      hostUin: targetUin,
      start: page * pageSize,
      num: pageSize,
      order: 1,
      topicId: `${targetUin}_${id}`,
      format: 'jsonp',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      ref: '',
      random: Math.random(),
    },
    { tag: 'shares.getComments', allowEmpty: true, retries: 2 }
  );
}

module.exports = { getSharesHtml, parseSharesHtml, getComments };
