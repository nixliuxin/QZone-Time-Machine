/**
 * BrowserTransport — Send HTTP requests through Playwright Chromium.
 *
 * All requests go through a real Chrome network stack, so the TLS fingerprint
 * matches a real browser, bypassing WAF JA3/JA4-based Node.js detection.
 */
'use strict';

function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class BrowserTransport {
  constructor(opts = {}) {
    this.browser = null;
    this.context = null;
    this.apiPage = null;
    this._pageStale = false;
    this._lastNavTime = 0;
    this._minNavInterval = 300; // min interval to prevent rapid navigation crashes in Chromium
    this.userAgent = opts.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.logger = opts.logger || (() => {});
  }

  async init(cookies) {
    let chromium;
    try {
      ({ chromium } = require('playwright'));
    } catch {
      throw new Error(
        'playwright is not installed. Run: npm install playwright && npx playwright install chromium'
      );
    }

    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: this.userAgent,
      locale: 'zh-CN',
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    const playwrightCookies = cookies
      .filter(c => c && c.name && c.value !== undefined)
      .map(c => ({
        name: c.name,
        value: String(c.value),
        domain: c.domain || '.qq.com',
        path: c.path || '/',
        secure: true,
        httpOnly: c.httpOnly ?? false,
        sameSite: 'None',
      }));

    for (const ck of playwrightCookies) {
      try {
        await this.context.addCookies([ck]);
      } catch {
        try {
          await this.context.addCookies([{ ...ck, sameSite: 'Lax' }]);
        } catch { /* skip */ }
      }
    }

    this.apiPage = await this.context.newPage();
    this._pageStale = false;
    this.logger('info', '[browser-transport] Chromium launched, cookies injected');
  }

  async _ensurePage() {
    if (!this._pageStale && this.apiPage) return;
    try { await this.apiPage?.close().catch(() => {}); } catch {}
    this.apiPage = await this.context.newPage();
    this._pageStale = false;
  }

  async request(url, params = {}, opts = {}) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }

    const timeout = opts.timeoutMs || 30000;
    const safetyTimeout = timeout + 10000;
    const t0 = Date.now();

    await this._ensurePage();

    // Prevent rapid consecutive navigations from crashing Chromium
    const sinceLast = Date.now() - this._lastNavTime;
    if (sinceLast < this._minNavInterval) {
      await new Promise(r => setTimeout(r, this._minNavInterval - sinceLast));
    }

    try {
      const result = await withTimeout(
        this._doGoto(u.toString(), timeout, opts.responseType),
        safetyTimeout,
        'page.goto'
      );
      this._lastNavTime = Date.now();
      return { ...result, elapsedMs: Date.now() - t0 };
    } catch (err) {
      this._pageStale = true;
      this._lastNavTime = Date.now();
      throw err;
    }
  }

  async _doGoto(fullUrl, timeout, responseType) {
    let response;
    try {
      response = await this.apiPage.goto(fullUrl, {
        waitUntil: 'commit',
        timeout,
      });
    } catch (navErr) {
      if (navErr.message && navErr.message.includes('net::ERR_ABORTED')) {
        // Navigation aborted (e.g. WAF redirect); mark page stale
        this._pageStale = true;
      }
      throw navErr;
    }

    if (!response) {
      throw new Error('page.goto returned null (possibly intercepted or redirected)');
    }

    const status = response.status();
    const headers = response.headers();
    let data;

    try {
      if (responseType === 'arraybuffer') {
        data = await withTimeout(response.body(), 15000, 'response.body');
      } else {
        data = await withTimeout(response.text(), 15000, 'response.text');
      }
    } catch (readErr) {
      this._pageStale = true;
      throw readErr;
    }

    return { status, data, headers };
  }

  async requestPost(url, params = {}, postData = '', opts = {}) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }

    const timeout = opts.timeoutMs || 30000;
    const t0 = Date.now();

    const response = await this.apiPage.request.post(u.toString(), {
      data: postData,
      headers: {
        'Content-Type': opts.contentType || 'application/json;charset=utf-8',
      },
      timeout,
    });

    const status = response.status();
    const headers = response.headers();
    const data = await withTimeout(response.text(), 15000, 'post.response.text');

    return { status, data, headers, elapsedMs: Date.now() - t0 };
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.apiPage = null;
    }
  }
}

module.exports = { BrowserTransport };
