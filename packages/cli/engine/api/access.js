/**
 * Space access probe.
 *
 * Classifies a target QQ's QZone into one of:
 *   - accessible    : zone is open and the current account can read it
 *   - no_permission : zone exists but is restricted (owner-only / not a friend)
 *   - not_activated : the target has never opened a QZone
 *   - error         : transient failure (network, rate limit, unknown code)
 *
 * The raw API `code` and `message` are always recorded so the classification
 * can be audited / refined against real responses.
 */
'use strict';

const { REST_URLS } = require('./urls.js');
const { NoAccessError, AuthInvalidError, RateLimitError } = require('../client.js');

// Permission-denied business codes (zone exists but restricted).
const NO_PERMISSION_CODES = new Set([-4009, -4002, 4002, 4009, -99996, -10805]);

// Heuristic message fragments that indicate the target never opened a QZone.
const NOT_ACTIVATED_PATTERNS = [
  '未开通', '没有开通', '尚未开通', '开通qq空间', '开通空间',
  'not open', 'not activated', '空间不存在', '该用户不存在', '不存在该用户',
];

function matchesNotActivated(message) {
  const low = String(message || '').toLowerCase();
  return NOT_ACTIVATED_PATTERNS.some((p) => low.includes(p));
}

/**
 * Probe a single target's QZone accessibility.
 * @returns {{uin:number, status:string, code:number|null, message:string, checkedAt:string}}
 */
async function probeAccess(client, targetUin) {
  const result = {
    uin: Number(targetUin),
    status: 'unknown',
    code: null,
    message: '',
    checkedAt: new Date().toISOString(),
  };

  try {
    // main_page_cgi: open zone -> code 0; restricted -> NoAccessError (-4002/-4009)
    const json = await client.getJson(
      REST_URLS.USER_OVERVIEW_URL,
      { uin: targetUin, param: 16 },
      { tag: 'access.probe', allowEmpty: true, retries: 1 },
    );
    const code = json && (json.code != null ? json.code : (json.ret != null ? json.ret : 0));
    const message = json && (json.message || json.msg || '');
    result.code = Number(code) || 0;
    result.message = String(message || '');
    result.status = matchesNotActivated(result.message) ? 'not_activated' : 'accessible';
  } catch (err) {
    if (err instanceof AuthInvalidError) throw err;
    if (err instanceof NoAccessError) {
      result.code = err.code;
      result.message = String(err.message || '');
      result.status = matchesNotActivated(result.message)
        ? 'not_activated'
        : (NO_PERMISSION_CODES.has(err.code) ? 'no_permission' : 'no_permission');
    } else if (err instanceof RateLimitError) {
      result.code = -10000;
      result.message = String(err.message || 'rate limited');
      result.status = 'error';
    } else {
      result.code = (err && err.code != null) ? err.code : null;
      result.message = String((err && err.message) || err || '');
      result.status = matchesNotActivated(result.message) ? 'not_activated' : 'error';
    }
  }

  return result;
}

module.exports = { probeAccess, NO_PERMISSION_CODES, matchesNotActivated };
