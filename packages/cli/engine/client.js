/**
 * QZone HTTP Client.
 *
 * Responsibilities:
 * - Send QZone API requests with Cookie + Referer
 * - Parse JSONP / Callback() wrapped responses
 * - Detect rate limiting (HTTP errors, code=-10000, code=0 + empty data)
 * - Retry with exponential backoff (configurable max retries)
 * - Distinguish "no access" (-4009/-4002) from "rate limit"; the former throws NoAccessError
 *
 * Does not handle: login (qr-login), field parsing (api/*.js), pagination (collectors/*.js).
 */
'use strict';

const axios = require('axios');
const iconv = require('iconv-lite');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

class NoAccessError extends Error {
  constructor(code, message, raw) {
    super(`No access (code=${code}): ${message || ''}`);
    this.name = 'NoAccessError';
    this.code = code;
    this.raw = raw;
  }
}

class RateLimitError extends Error {
  constructor(reason, raw) {
    super(`Rate limited: ${reason}`);
    this.name = 'RateLimitError';
    this.raw = raw;
  }
}

class EmptyDataError extends Error {
  constructor(raw) {
    super('API returned success but data is empty (possible silent rate limit)');
    this.name = 'EmptyDataError';
    this.raw = raw;
  }
}

/**
 * Thrown when the global rate-limit circuit breaker opens: either a Tencent WAF
 * block (immediate) or too many consecutive rate-limit/empty responses. Once open,
 * every subsequent getJson throws this immediately so the run aborts fast instead
 * of hammering a server that is actively limiting us. Callers should stop the whole
 * backup (and, in batch mode, the whole batch) rather than continue to next module.
 */
class CircuitOpenError extends Error {
  constructor(reason) {
    super(`Rate-limit circuit open: ${reason}`);
    this.name = 'CircuitOpenError';
    this.reason = reason;
  }
}

/**
 * Parse QZone JSONP / Callback / xxx_Callback wrapped responses.
 * Returns a JSON object; throws on parse failure.
 *
 * @param {string} text  response body
 * @param {RegExp} [jsonpKey]  optional JSONP wrapper prefix regex (e.g. /^photoDomainNameCallback\(/)
 */
function parseJsonp(text, jsonpKey) {
  if (text == null) throw new Error('Response is empty');
  let s = String(text).trim();

  if (jsonpKey && jsonpKey.test(s)) {
    s = s.replace(jsonpKey, '');
    if (s.endsWith(';')) s = s.slice(0, -1).trim();
    if (s.endsWith(')')) s = s.slice(0, -1).trim();
    return JSON.parse(s);
  }

  // Generic *Callback( ... ); wrapper
  const idx = s.indexOf('Callback(');
  if (idx >= 0) {
    s = s.slice(idx + 'Callback('.length);
    if (s.endsWith(';')) s = s.slice(0, -1).trim();
    if (s.endsWith(')')) s = s.slice(0, -1).trim();
    return JSON.parse(s);
  }

  // Handle _Callback({...}); format (leading function name prefix)
  const head = s.match(/^[A-Za-z_][\w]*\(/);
  if (head) {
    s = s.slice(head[0].length);
    if (s.endsWith(';')) s = s.slice(0, -1).trim();
    if (s.endsWith(')')) s = s.slice(0, -1).trim();
    return JSON.parse(s);
  }

  // Already bare JSON
  return JSON.parse(s);
}

/**
 * Extract business code/message from parsed JSON.
 * QZone APIs are inconsistent: code / ret / errcode / subcode have all been observed.
 */
function detectStatus(json) {
  if (!json || typeof json !== 'object') return { code: 0, message: '' };
  const code = (json.code != null && json.code !== undefined)
    ? json.code
    : (json.ret != null ? json.ret : (json.errcode != null ? json.errcode : 0));
  const message = json.message || json.msg || json.errmsg || '';
  return { code: Number(code), message: String(message || '') };
}

/** Whether this is a "permission denied" error code (should not retry) */
function isNoAccessCode(code) {
  return code === -4009 || code === -4002 || code === 4002 || code === 4009
    || code === -10805  // album verification not passed
    || code === -99996; // no access (e.g. visitor log disabled)
}

/** Whether this is a "session invalid / not logged in" error code (should not retry; upper layer prompts re-login) */
function isAuthInvalidCode(code) {
  return code === -3000 || code === 3000 || code === -10001;
}

class AuthInvalidError extends Error {
  constructor(code, message, raw) {
    super(`Auth invalid (code=${code}): ${message || ''}`);
    this.name = 'AuthInvalidError';
    this.code = code;
    this.raw = raw;
  }
}

/** Whether this is an explicit rate-limit error code or message */
function isExplicitRateLimit(code, message) {
  if (code === -10000) return true;
  if (typeof message === 'string' && message.includes('使用人数过多')) return true;
  if (typeof message === 'string' && message.includes('请稍后再试')) return true;
  return false;
}

/** Simple sleep */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class QzoneClient {
  /**
   * @param {object} opts
   * @param {import('./session').Session} opts.session
   * @param {object} [opts.config]
   *   - listRetryCount: max retries per endpoint (exponential backoff)
   *   - listRetryBaseMs: backoff base interval in ms
   *   - listRetryMaxMs: backoff max interval in ms
   *   - timeoutMs: per-request timeout
   *   - userAgent: custom UA string
   *   - logger: function(level, ...args)
   *   - minRequestGapMs: global minimum gap between any two API requests (anti-ban)
   *   - dataDir: session data directory (for session age checks)
   */
  constructor(opts) {
    if (!opts || !opts.session) throw new Error('QzoneClient requires a session');
    this.session = opts.session;
    const c = opts.config || {};
    this.config = {
      listRetryCount: c.listRetryCount ?? 5,
      listRetryBaseMs: c.listRetryBaseMs ?? 2000,
      listRetryMaxMs: c.listRetryMaxMs ?? 60000,
      timeoutMs: c.timeoutMs ?? 30000,
      userAgent: c.userAgent || DEFAULT_USER_AGENT,
      referer: c.referer || 'https://user.qzone.qq.com/',
      minRequestGapMs: c.minRequestGapMs ?? 500,
      dataDir: c.dataDir || null,
      // Global circuit breaker: after this many consecutive getJson calls end in
      // a rate-limit / empty-data response (despite per-request backoff+retries),
      // trip the breaker so the whole run aborts. 0 disables. WAF 501 trips instantly.
      rlCircuitThreshold: c.rlCircuitThreshold ?? 3,
      wafAbort: c.wafAbort !== false,
    };
    this.logger = opts.logger || ((lvl, ...args) => {
      const fn = console[lvl] || console.log;
      fn(`[client]`, ...args);
    });
    this._lastRequestTime = 0;
    this._totalRequests = 0;
    this._sessionStartTime = Date.now();
    this._consecutiveRateLimits = 0;
    this._circuitOpen = false;
    this._circuitReason = null;
  }

  /** Enforce a minimum gap between consecutive requests (global throttle). */
  async _globalThrottle() {
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;
    const gap = this.config.minRequestGapMs;
    if (elapsed < gap && this._lastRequestTime > 0) {
      const jitter = Math.random() * gap * 0.4;
      await sleep(gap - elapsed + jitter);
    }
    this._lastRequestTime = Date.now();
    this._totalRequests++;
  }

  /** Check session age; throws if session is likely expired. */
  checkSessionAge() {
    if (!this.config.dataDir) return;
    const remaining = this.session.estimatedRemainingMs(this.config.dataDir);
    if (remaining <= 0) {
      throw new AuthInvalidError(-1, 'Session expired (age > 20h). Please re-login.', null);
    }
    if (remaining < 30 * 60 * 1000) {
      // The 20h window is only a heuristic; the real p_skey lifetime varies.
      // Throttle this advisory to once every 10 min so it doesn't spam the log
      // on every request once we enter the warning window.
      const now = Date.now();
      if (now - (this._lastSessionWarn || 0) >= 10 * 60 * 1000) {
        this._lastSessionWarn = now;
        this.logger('warn', `Session may expire in ~${Math.round(remaining / 60000)} min (heuristic). Re-login if requests start failing.`);
      }
    }
  }

  /** Returns QPM (queries per minute) since client creation. */
  getQpm() {
    const mins = (Date.now() - this._sessionStartTime) / 60000;
    return mins > 0 ? Math.round(this._totalRequests / mins) : 0;
  }

  /**
   * Single low-level request (no retry).
   * @param {string} url
   * @param {object} [params]  query params (g_tk appended automatically)
   * @param {object} [opts]
   *   - method: 'GET' | 'POST'
   *   - data: POST body
   *   - jsonpKey: RegExp, special JSONP wrapper prefix
   *   - skipGtk: skip g_tk append
   *   - referer: override default Referer
   *   - timeoutMs
   *   - responseType: 'text' (default) | 'arraybuffer'
   */
  async _requestOnce(url, params = {}, opts = {}) {
    await this._globalThrottle();
    const method = (opts.method || 'GET').toUpperCase();
    const queryParams = { ...params };
    if (!opts.skipGtk && queryParams.g_tk == null) {
      queryParams.g_tk = this.session.gtk;
    }
    const headers = {
      Cookie: this.session.cookieHeader,
      Referer: opts.referer || this.config.referer,
      'User-Agent': this.config.userAgent,
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };

    // Fetch text responses as arraybuffer and decode by Content-Type charset (avoids GBK being garbled as UTF-8)
    const wantText = !opts.responseType || opts.responseType === 'text';
    const reqCfg = {
      url,
      method,
      params: queryParams,
      headers,
      timeout: opts.timeoutMs ?? this.config.timeoutMs,
      responseType: wantText ? 'arraybuffer' : opts.responseType,
      transformResponse: [(d) => d],
      validateStatus: () => true,
      maxRedirects: 5,
    };

    if (method === 'POST') {
      reqCfg.data = opts.data || '';
      headers['Content-Type'] = opts.contentType || 'application/json;charset=utf-8';
    }

    const t0 = Date.now();
    const resp = await axios(reqCfg);
    const elapsed = Date.now() - t0;

    let data = resp.data;
    if (wantText && Buffer.isBuffer(data)) {
      const ct = String(resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type']) || '');
      const m = /charset=([^\s;]+)/i.exec(ct);
      let charset = m ? m[1].toLowerCase() : '';
      if (!charset) {
        // No charset header: try UTF-8 first, fall back to GBK if too many replacement chars
        const utf = data.toString('utf8');
        const bad = (utf.match(/\uFFFD/g) || []).length;
        if (bad > 5 && iconv.encodingExists('gbk')) {
          data = iconv.decode(data, 'gbk');
        } else {
          data = utf;
        }
      } else if (/^utf-?8$/i.test(charset)) {
        data = data.toString('utf8');
      } else if (iconv.encodingExists(charset)) {
        data = iconv.decode(data, charset);
      } else {
        data = data.toString('utf8');
      }
    }
    return { status: resp.status, headers: resp.headers, data, elapsedMs: elapsed };
  }

  /**
   * Execute a GET request with retry, returning parsed JSON.
   * Rate limit (-10000) => throws RateLimitError for upper layer to handle cooldown.
   * No access (-4009 etc.) => throws NoAccessError (no retry).
   * Network error / 5xx => exponential backoff retry.
   *
   * @param {string} url
   * @param {object} [params]
   * @param {object} [opts]
   *   - jsonpKey: RegExp
   *   - allowEmpty: boolean, allow empty data return (default false => throws EmptyDataError)
   *   - emptyDetector: function(json)=>bool, custom "is empty" logic
   *   - referer
   *   - timeoutMs
   *   - retries: override default listRetryCount
   *   - method/data/contentType (POST)
   *   - tag: for logging only
   */
  async getJson(url, params = {}, opts = {}) {
    this.checkSessionAge();
    if (this._circuitOpen) {
      throw new CircuitOpenError(this._circuitReason || 'breaker already open');
    }
    const maxRetries = opts.retries ?? this.config.listRetryCount;
    let attempt = 0;
    let lastErr;
    while (attempt <= maxRetries) {
      try {
        const { status, data } = await this._requestOnce(url, params, opts);
        if (status === 401 || status === 403) {
          throw new NoAccessError(status, `HTTP ${status}`, data && String(data).slice(0, 200));
        }
        if (status >= 500 || status === 0) {
          // WAF 501: Tencent WAF global block, do not retry. Trip the breaker so the
          // entire run aborts immediately — continuing would only deepen the block.
          if (status === 501 && typeof data === 'string' && data.includes('waf.tencent.com')) {
            if (this.config.wafAbort) {
              this._circuitOpen = true;
              this._circuitReason = 'Tencent WAF 501 global block';
              this.logger('error', `WAF 501 detected — opening circuit breaker, aborting run.`);
              throw new CircuitOpenError(this._circuitReason);
            }
            const err = new RateLimitError(`WAF 501 (Tencent WAF blocked)`, data.slice(0, 200));
            err.isWaf = true;
            err.noRetry = true;
            throw err;
          }
          throw new Error(`HTTP ${status}`);
        }
        if (status >= 400) {
          throw new Error(`HTTP ${status}: ${String(data).slice(0, 200)}`);
        }

        const json = parseJsonp(String(data), opts.jsonpKey);
        const { code, message } = detectStatus(json);

        if (isNoAccessCode(code)) {
          throw new NoAccessError(code, message, json);
        }
        if (isAuthInvalidCode(code)) {
          throw new AuthInvalidError(code, message, json);
        }
        if (isExplicitRateLimit(code, message)) {
          throw new RateLimitError(message || `code=${code}`, json);
        }
        // Non-zero business code (unknown) => treat as retryable error
        if (code !== 0) {
          throw new Error(`Non-zero business code: code=${code} message=${message}`);
        }

        // Silent rate limit: success but data missing
        if (!opts.allowEmpty && typeof opts.emptyDetector === 'function') {
          if (opts.emptyDetector(json)) {
            throw new EmptyDataError(json);
          }
        }
        // Success: reset the consecutive-rate-limit counter.
        this._consecutiveRateLimits = 0;
        return json;
      } catch (err) {
        // Non-retryable errors, throw immediately
        if (err instanceof NoAccessError) throw err;
        if (err instanceof AuthInvalidError) throw err;
        if (err instanceof CircuitOpenError) throw err;
        if (err.noRetry) throw err;

        lastErr = err;
        if (attempt >= maxRetries) break;

        // Exponential backoff (doubled for rate limits)
        const isRL = err instanceof RateLimitError || err instanceof EmptyDataError;
        const base = isRL ? this.config.listRetryBaseMs * 2 : this.config.listRetryBaseMs;
        const wait = Math.min(base * Math.pow(2, attempt), this.config.listRetryMaxMs);
        const tag = opts.tag || url.split('/').slice(-2).join('/');
        this.logger('warn', `[retry ${attempt + 1}/${maxRetries}] ${tag}: ${err.message} (waiting ${wait}ms)`);
        await sleep(wait);
        attempt++;
      }
    }
    // Retries exhausted. If this was a rate-limit / silent-empty failure, count it
    // toward the global circuit breaker; trip once we hit the threshold.
    if (lastErr instanceof RateLimitError || lastErr instanceof EmptyDataError) {
      this._consecutiveRateLimits++;
      const threshold = this.config.rlCircuitThreshold;
      if (threshold > 0 && this._consecutiveRateLimits >= threshold) {
        this._circuitOpen = true;
        this._circuitReason = `${this._consecutiveRateLimits} consecutive rate-limit responses`;
        this.logger('error', `Circuit breaker tripped: ${this._circuitReason}. Aborting run to avoid a ban.`);
        throw new CircuitOpenError(this._circuitReason);
      }
      this.logger('warn', `Rate-limit strike ${this._consecutiveRateLimits}/${threshold} (will abort at threshold).`);
    }
    throw lastErr;
  }

  /**
   * Binary download (for images/videos).
   * @returns {Promise<{status:number, data:Buffer, headers:object}>}
   */
  async download(url, opts = {}) {
    const headers = {
      Cookie: this.session.cookieHeader,
      Referer: opts.referer || this.config.referer,
      'User-Agent': this.config.userAgent,
    };
    const resp = await axios({
      url,
      method: 'GET',
      headers,
      timeout: opts.timeoutMs ?? 60000,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      maxRedirects: 5,
    });
    return { status: resp.status, data: Buffer.from(resp.data), headers: resp.headers };
  }
}

module.exports = {
  QzoneClient,
  NoAccessError,
  AuthInvalidError,
  RateLimitError,
  EmptyDataError,
  CircuitOpenError,
  parseJsonp,
  detectStatus,
  sleep,
};
