/**
 * Session: cookie load/save, g_tk calculation, uin extraction.
 *
 * Reuses automation/cookies.json (Puppeteer array format) and automation/auth.json ({gtk,uin,pSkey}).
 * Also supports qr-login writing new cookie arrays to these files.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_COOKIES_FILE = path.resolve(process.cwd(), 'cookies.json');
const DEFAULT_AUTH_FILE = path.resolve(process.cwd(), 'auth.json');

/**
 * Compute g_tk (QZone standard DJB hash algorithm).
 * @param {string} skey p_skey preferred; otherwise skey/rv2
 */
function calcGtk(skey) {
  if (!skey) return undefined;
  let hash = 5381;
  for (let i = 0, len = skey.length; i < len; ++i) {
    hash += (hash << 5) + skey.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}

/**
 * Pick a cookie value by name from a puppeteer-style cookies array
 * (prefers .qzone.qq.com when multiple domains share the same name).
 */
function pickCookie(cookies, name, preferDomainContains) {
  const matches = cookies.filter((c) => c.name === name);
  if (matches.length === 0) return undefined;
  if (preferDomainContains) {
    const preferred = matches.find((c) => (c.domain || '').includes(preferDomainContains));
    if (preferred) return preferred.value;
  }
  return matches[0].value;
}

/**
 * Build a Cookie header from a puppeteer-style cookies array.
 * Does not distinguish by domain (QZone cookies are effectively same-origin).
 * Note: last cookie of the same name wins, matching browser behavior.
 */
function buildCookieHeader(cookies) {
  const seen = new Map();
  for (const c of cookies) {
    if (!c || !c.name) continue;
    seen.set(c.name, c.value == null ? '' : c.value);
  }
  return Array.from(seen.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Infer the login uin from the cookie array, e.g. p_uin=o0123456789.
 */
function extractUin(cookies) {
  const pUin = pickCookie(cookies, 'p_uin') || pickCookie(cookies, 'uin') || '';
  const m = /\d+/.exec(pUin);
  return m ? Number(m[0]) : undefined;
}

class Session {
  /**
   * @param {object} opts
   * @param {string} [opts.cookiesFile]
   * @param {string} [opts.authFile]
   */
  constructor(opts = {}) {
    this.cookiesFile = opts.cookiesFile || DEFAULT_COOKIES_FILE;
    this.authFile = opts.authFile || DEFAULT_AUTH_FILE;
    this.cookies = [];
    this.cookieHeader = '';
    this.uin = undefined;
    this.gtk = undefined;
    this.pSkey = undefined;
    this.skey = undefined;
  }

  load() {
    if (!fs.existsSync(this.cookiesFile)) {
      throw new Error(`Cookie file not found: ${this.cookiesFile} (run qr-login first)`);
    }
    const raw = fs.readFileSync(this.cookiesFile, 'utf8');
    const cookies = JSON.parse(raw);
    this.applyCookies(cookies);

    // auth.json is only used as supplementary validation
    if (fs.existsSync(this.authFile)) {
      try {
        const auth = JSON.parse(fs.readFileSync(this.authFile, 'utf8'));
        if (auth.uin && !this.uin) this.uin = auth.uin;
      } catch (_) {}
    }
    return this;
  }

  applyCookies(cookies) {
    this.cookies = Array.isArray(cookies) ? cookies : [];
    this.cookieHeader = buildCookieHeader(this.cookies);
    this.uin = extractUin(this.cookies);
    this.pSkey = pickCookie(this.cookies, 'p_skey', '.qzone.qq.com')
      || pickCookie(this.cookies, 'p_skey');
    this.skey = pickCookie(this.cookies, 'skey');
    const seed = this.pSkey || this.skey || pickCookie(this.cookies, 'rv2');
    this.gtk = calcGtk(seed);
  }

  save() {
    fs.writeFileSync(this.cookiesFile, JSON.stringify(this.cookies, null, 2), 'utf8');
    fs.writeFileSync(
      this.authFile,
      JSON.stringify({ gtk: this.gtk, uin: this.uin, pSkey: this.pSkey }, null, 2),
      'utf8'
    );
  }

  /**
   * Persist the session creation timestamp so we can proactively detect expiry.
   */
  saveCreatedAt(dataDir) {
    const metaFile = path.join(dataDir || path.dirname(this.cookiesFile), 'session_meta.json');
    const meta = { createdAt: new Date().toISOString(), createdAtMs: Date.now() };
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
  }

  /**
   * Returns session age in milliseconds, or -1 if unknown.
   */
  getAgeMs(dataDir) {
    const metaFile = path.join(dataDir || path.dirname(this.cookiesFile), 'session_meta.json');
    if (!fs.existsSync(metaFile)) return -1;
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      return Date.now() - (meta.createdAtMs || Date.parse(meta.createdAt));
    } catch { return -1; }
  }

  /**
   * Returns estimated remaining session life in ms.
   * QZone p_skey typically expires in ~24h; we use a conservative 20h window.
   */
  estimatedRemainingMs(dataDir) {
    const age = this.getAgeMs(dataDir);
    if (age < 0) return Infinity;
    const MAX_LIFE_MS = 20 * 60 * 60 * 1000; // 20 hours
    return Math.max(0, MAX_LIFE_MS - age);
  }

  /**
   * Whether the session looks valid (local heuristic only; actual validation happens at request time).
   */
  looksValid() {
    return Boolean(this.cookieHeader && this.uin && this.gtk);
  }

  toString() {
    return `Session(uin=${this.uin}, gtk=${this.gtk}, pSkey=${this.pSkey ? '***' : 'none'})`;
  }
}

module.exports = {
  Session,
  calcGtk,
  pickCookie,
  buildCookieHeader,
  extractUin,
  DEFAULT_COOKIES_FILE,
  DEFAULT_AUTH_FILE,
};
