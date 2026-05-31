/**
 * QZone QR code login.
 *
 * Flow:
 *   1) GET ptqrshow => get PNG image + qrsig cookie; save as PNG for mobile QQ scan
 *   2) Compute ptqrtoken from qrsig, poll ptqrlogin every ~2.5s
 *   3) Login success => ptuiCB(...) contains check_sig URL; GET it (no redirect) to collect cookies
 *   4) Visit https://user.qzone.qq.com with cookies => get p_skey and zone cookies
 *   5) Write cookies.json + auth.json
 *
 * Output: cookies.json (array, same format as puppeteer) + auth.json {gtk,uin,pSkey}.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const APPID = 549000912; // QZone web version fixed appid
const S_URL = 'https://qzs.qq.com/qzone/v5/loginsucc.html?para=izone';
const QZONE_HOME = 'https://user.qzone.qq.com';
const XLOGIN_REFERER =
  'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?proxy_url=https%3A//qzs.qq.com/qzone/v6/portal/proxy.html' +
  '&daid=5&hide_title_bar=1&low_login=0&qlogin_auto_login=1&no_verifyimg=1' +
  '&link_target=blank&appid=549000912&style=22&target=self' +
  '&s_url=https%3A//qzs.qq.com/qzone/v5/loginsucc.html%3Fpara%3Dizone' +
  '&pt_qr_app=%E6%89%8B%E6%9C%BAQQ%E7%A9%BA%E9%97%B4&pt_qr_link=https%3A//z.qzone.com/download.html' +
  '&self_regurl=https%3A//qzs.qq.com/qzone/v6/reg/index.html' +
  '&pt_qr_help_link=https%3A//z.qzone.com/download.html&pt_no_auth=0';

/**
 * ptqrtoken hash algorithm (based on public daowuya/qiangmouren implementation).
 */
function calcPtqrtoken(qrsig) {
  let hash = 0;
  for (let i = 0; i < qrsig.length; i++) {
    hash = (hash << 5) + qrsig.charCodeAt(i);
    hash &= 0x7fffffff;
  }
  return hash;
}

/**
 * Lightweight cookie jar: collects from set-cookie headers, keyed by name.
 * Outputs puppeteer-style array + concatenated Cookie header.
 */
class TinyJar {
  constructor() {
    this.map = new Map(); // name → {name, value, domain, path, expires?}
  }

  /** Absorb cookies from axios response set-cookie header array */
  absorb(setCookies) {
    if (!setCookies) return;
    const arr = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (const raw of arr) {
      if (!raw) continue;
      const parts = raw.split(';').map((s) => s.trim());
      const [nv, ...attrs] = parts;
      const eq = nv.indexOf('=');
      if (eq < 0) continue;
      const name = nv.slice(0, eq).trim();
      const value = nv.slice(eq + 1).trim();
      if (!name) continue;
      const cookie = { name, value, domain: '', path: '/', expires: -1 };
      for (const a of attrs) {
        const [k, v] = a.split('=').map((s) => (s || '').trim());
        const key = (k || '').toLowerCase();
        if (key === 'domain') cookie.domain = v || '';
        else if (key === 'path') cookie.path = v || '/';
        else if (key === 'expires') {
          const t = Date.parse(v);
          if (!Number.isNaN(t)) cookie.expires = Math.floor(t / 1000);
        } else if (key === 'max-age') {
          const sec = Number(v);
          if (!Number.isNaN(sec)) cookie.expires = Math.floor(Date.now() / 1000) + sec;
        }
      }
      this.map.set(name, cookie);
    }
  }

  header() {
    return Array.from(this.map.values()).map((c) => `${c.name}=${c.value}`).join('; ');
  }

  toArray() {
    return Array.from(this.map.values()).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.qq.com',
      path: c.path || '/',
      expires: c.expires == null ? -1 : c.expires,
      httpOnly: false,
      secure: false,
      session: c.expires === -1,
    }));
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchQrcode(jar) {
  const t = Math.random();
  const url = `https://ssl.ptlogin2.qq.com/ptqrshow?appid=${APPID}&e=2&l=M&s=3&d=72&v=4&t=${t}&daid=5&pt_3rd_aid=0&u1=${encodeURIComponent(S_URL)}`;
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      Referer: 'https://xui.ptlogin2.qq.com/',
      Origin: 'https://xui.ptlogin2.qq.com',
      'User-Agent': UA,
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'same-site',
    },
    validateStatus: () => true,
  });
  if (resp.status !== 200) {
    throw new Error(`ptqrshow HTTP ${resp.status}`);
  }
  jar.absorb(resp.headers['set-cookie']);
  const qrsig = jar.map.get('qrsig')?.value;
  if (!qrsig) throw new Error('Failed to obtain qrsig cookie');
  return { png: Buffer.from(resp.data), qrsig };
}

async function pollLogin(jar, qrsig, opts = {}) {
  const interval = opts.intervalMs ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const onStatus = opts.onStatus || (() => {});

  const ptqrtoken = calcPtqrtoken(qrsig);
  const start = Date.now();
  let lastNotice = '';
  // login_sig comes from the initial xlogin page request (already in jar)
  const loginSig = jar.map.get('pt_login_sig')?.value || '';

  while (Date.now() - start < timeoutMs) {
    const action = `0-0-${Date.now()}`;
    const resp = await axios.get('https://ssl.ptlogin2.qq.com/ptqrlogin', {
      params: {
        u1: S_URL,
        ptqrtoken: String(ptqrtoken),
        ptredirect: '0',
        h: '1',
        t: '1',
        g: '1',
        from_ui: '1',
        ptlang: '2052',
        action,
        js_ver: '24090913',
        js_type: '1',
        login_sig: loginSig,
        pt_uistyle: '40',
        aid: String(APPID),
        daid: '5',
        has_onekey: '1',
        o1vId: '2b82096ccefcae244d20335bbe82233c',
        pt_js_version: 'v1.50.7',
      },
      headers: {
        Cookie: jar.header(),
        Referer: 'https://xui.ptlogin2.qq.com/',
        Origin: 'https://xui.ptlogin2.qq.com',
        'User-Agent': UA,
        'Sec-Fetch-Dest': 'script',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-site',
        Accept: '*/*',
      },
      validateStatus: () => true,
      responseType: 'text',
    });
    jar.absorb(resp.headers['set-cookie']);
    const text = String(resp.data || '');
    // ptuiCB('STATUS','0','URL','0','MSG','NICKNAME')
    const m = /ptuiCB\(([^)]*)\)/.exec(text);
    if (!m) {
      onStatus({ stage: 'parse', http: resp.status, raw: text.slice(0, 300) });
      await sleep(interval);
      continue;
    }
    const args = m[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    const status = args[0];
    const checkUrl = args[2];
    const msg = args[4];

    if (status === '0') {
      // Login successful
      onStatus({ stage: 'success', msg });
      return { checkUrl, msg };
    }

    if (status !== lastNotice) {
      onStatus({ stage: 'pending', status, msg });
      lastNotice = status;
    }

    if (status === '65') {
      throw new Error('QR code expired, please regenerate');
    }

    await sleep(interval);
  }
  throw new Error('QR login timed out');
}

async function fetchCookiesFromCheckUrl(jar, checkUrl) {
  // GET without auto-redirect, since each 3xx dispatches set-cookie headers
  let url = checkUrl;
  for (let i = 0; i < 8; i++) {
    const resp = await axios.get(url, {
      headers: {
        Cookie: jar.header(),
        Referer: XLOGIN_REFERER,
        'User-Agent': UA,
      },
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
    });
    jar.absorb(resp.headers['set-cookie']);
    const loc = resp.headers['location'];
    if (resp.status >= 300 && resp.status < 400 && loc) {
      url = new URL(loc, url).toString();
      continue;
    }
    break;
  }
  // Visit user.qzone.qq.com once more to obtain .qzone.qq.com domain p_skey
  await axios.get(QZONE_HOME, {
    headers: {
      Cookie: jar.header(),
      'User-Agent': UA,
    },
    maxRedirects: 0,
    validateStatus: () => true,
    responseType: 'text',
  }).then((r) => jar.absorb(r.headers['set-cookie']))
    .catch(() => {});
}

/**
 * Main flow: returns cookies array + uin.
 *
 * Strategy: prefer Puppeteer (real browser, immune to TLS/JA3 fingerprint blocking);
 * fall back to pure HTTP if Puppeteer is unavailable (may be blocked by WAF).
 */
async function login(opts = {}) {
  const onStatus = opts.onStatus || ((e) => {
    if (e.stage === 'qr') console.log(`[qr-login] QR code generated: ${e.path}`);
    else if (e.stage === 'pending') console.log(`[qr-login] status changed: status=${e.status} msg=${e.msg}`);
    else if (e.stage === 'success') console.log(`[qr-login] login successful: ${e.msg}`);
    else if (e.stage === 'parse') console.log(`[qr-login] polling: http=${e.http} body=${(e.raw || '').slice(0, 200)}`);
    else if (e.stage === 'debug') console.log(`[qr-login] ${e.msg}`);
    else if (e.stage === 'browser') console.log(`[qr-login] ${e.msg}`);
  });

  // Try Puppeteer first
  try {
    return await loginWithPuppeteer(opts, onStatus);
  } catch (e) {
    if (e.message && e.message.includes('Cannot find module')) {
      onStatus({ stage: 'debug', msg: `Puppeteer unavailable (${e.message.slice(0, 80)}), falling back to pure HTTP` });
    } else {
      throw e;
    }
  }

  // Fallback: pure HTTP (may fail with 403 if WAF blocks non-browser TLS fingerprints)
  return await loginWithHttp(opts, onStatus);
}

/**
 * Puppeteer login: launch real Chromium, navigate to QZone login page,
 * extract cookies after user scans the QR code.
 *
 * Uses puppeteer-extra with stealth plugin to avoid automation detection.
 */
async function loginWithPuppeteer(opts, onStatus) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
    onStatus({ stage: 'debug', msg: 'Using puppeteer-extra with stealth plugin' });
  } catch {
    puppeteer = require('puppeteer');
    onStatus({ stage: 'debug', msg: 'Stealth plugin not available, using vanilla puppeteer' });
  }
  const qrPath = path.resolve(opts.qrPath || path.join(process.cwd(), 'qrcode.png'));
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  onStatus({ stage: 'browser', msg: 'Launching browser...' });
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const page = await browser.newPage();
    await page.goto(XLOGIN_REFERER, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for QR code image to appear
    const qrSelector = '#qrlogin_img, .qrlogin_img, img[id*="qr"]';
    try {
      await page.waitForSelector(qrSelector, { timeout: 10000 });
      const qrEl = await page.$(qrSelector);
      if (qrEl) {
        await qrEl.screenshot({ path: qrPath });
        onStatus({ stage: 'qr', path: qrPath });
      }
    } catch (_) {
      // QR might be visible but selector differs; take full screenshot
      await page.screenshot({ path: qrPath });
      onStatus({ stage: 'qr', path: qrPath });
    }

    onStatus({ stage: 'browser', msg: 'Please scan the QR code in the browser with mobile QQ...' });

    // Wait for p_skey cookie (only set after successful QR scan + confirm)
    const start = Date.now();
    let loggedIn = false;
    while (Date.now() - start < timeoutMs) {
      await sleep(3000);
      const allCookies = await page.cookies('https://user.qzone.qq.com', 'https://qzone.qq.com');
      const hasPskey = allCookies.some((c) => c.name === 'p_skey' && c.value);
      if (hasPskey) {
        loggedIn = true;
        onStatus({ stage: 'browser', msg: 'p_skey detected, login successful!' });
        break;
      }
      // Also check URL in case of redirect to QZone after login
      const url = page.url();
      if (url.includes('user.qzone.qq.com') && !url.includes('ptlogin')) {
        // Double check cookies after redirect
        const ck2 = await page.cookies('https://user.qzone.qq.com', 'https://qzone.qq.com');
        if (ck2.some((c) => c.name === 'p_skey' && c.value)) {
          loggedIn = true;
          onStatus({ stage: 'browser', msg: 'Login successful (page redirected)' });
          break;
        }
      }
    }

    if (!loggedIn) {
      throw new Error('QR login timed out (p_skey not detected within 5 minutes)');
    }

    // Navigate to QZone to collect remaining cookies
    try {
      await page.goto('https://user.qzone.qq.com', { waitUntil: 'networkidle2', timeout: 15000 });
    } catch (_) {}
    await sleep(2000);

    // Extract all cookies
    const browserCookies = await page.cookies('https://qq.com', 'https://qzone.qq.com', 'https://user.qzone.qq.com', 'https://ptlogin2.qq.com');
    const cookies = browserCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: c.expires || -1,
      httpOnly: c.httpOnly || false,
      secure: c.secure || false,
      session: !c.expires || c.expires === -1,
    }));

    const pUin = cookies.find((c) => c.name === 'p_uin' || c.name === 'uin');
    const uinStr = pUin ? pUin.value : '';
    const m = /\d+/.exec(uinStr);
    const uin = m ? Number(m[0]) : undefined;

    onStatus({ stage: 'success', msg: `Login successful (uin=${uin}, ${cookies.length} cookies)` });
    return { cookies, uin };
  } finally {
    await browser.close();
  }
}

/**
 * Pure HTTP login (fallback, may be blocked by WAF).
 */
async function loginWithHttp(opts, onStatus) {
  const jar = new TinyJar();
  const qrPath = path.resolve(opts.qrPath || path.join(process.cwd(), 'qrcode.png'));

  try {
    const r = await axios.get(XLOGIN_REFERER, {
      headers: { 'User-Agent': UA },
      validateStatus: () => true,
      responseType: 'text',
      maxRedirects: 5,
    });
    jar.absorb(r.headers['set-cookie']);
  } catch (_) {}

  const { png, qrsig } = await fetchQrcode(jar);
  fs.writeFileSync(qrPath, png);
  onStatus({ stage: 'qr', path: qrPath, qrsig });

  const { checkUrl } = await pollLogin(jar, qrsig, {
    intervalMs: opts.intervalMs,
    timeoutMs: opts.timeoutMs,
    onStatus,
  });

  await fetchCookiesFromCheckUrl(jar, checkUrl);

  const cookies = jar.toArray();
  const pUin = jar.map.get('p_uin')?.value || jar.map.get('uin')?.value || '';
  const m = /\d+/.exec(pUin);
  const uin = m ? Number(m[0]) : undefined;
  return { cookies, uin };
}

module.exports = {
  login,
  calcPtqrtoken,
  TinyJar,
  APPID,
  S_URL,
  QZONE_HOME,
};

// CLI: node qzone-node/qr-login.js
if (require.main === module) {
  const { Session } = require('./session.js');
  (async () => {
    try {
      const { cookies, uin } = await login();
      const s = new Session();
      s.applyCookies(cookies);
      if (!uin) {
        console.error('[qr-login] warning: could not extract uin from cookies');
      } else if (s.uin !== uin) {
        s.uin = uin;
      }
      s.save();
      console.log(`[qr-login] cookies saved: ${s.cookiesFile}`);
      console.log(`[qr-login] auth: uin=${s.uin} gtk=${s.gtk}`);
    } catch (err) {
      console.error('[qr-login] failed:', err.message);
      process.exit(1);
    }
  })();
}
