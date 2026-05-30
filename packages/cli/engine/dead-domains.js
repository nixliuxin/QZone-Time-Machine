'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Two-tier blacklist for image downloads:
 *
 *   1. Domain-level — for DNS errors (ENOTFOUND / EAI_AGAIN).
 *      The domain literally doesn't resolve; every URL on it is dead.
 *      Threshold: 1 failure → instant blacklist.
 *
 *   2. URL-level — for HTTP 4xx, "too small", ECONNREFUSED, etc.
 *      The domain may still serve other images; only this specific URL is dead.
 *      Threshold: 2 cumulative failures across runs → blacklist that URL.
 *
 * Persisted as a single JSON file, shared across all users in a batch.
 */

const DOMAIN_ERRORS = /ENOTFOUND|EAI_AGAIN/i;
const URL_THRESHOLD = 2;

function urlHash(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16);
}

function extractDomain(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function isDnsError(errMsg) {
  return DOMAIN_ERRORS.test(String(errMsg || ''));
}

function isTrackableError(errMsg) {
  if (!errMsg) return false;
  const m = String(errMsg);
  if (/ETIMEDOUT|timeout/i.test(m) && !/ECONNRESET/i.test(m)) return false; // transient
  return true;
}

class DeadDomains {
  constructor(filePath) {
    this.filePath = filePath;
    this.domains = {};   // { hostname: { lastError, since } }
    this.urls = {};      // { hash: { url, failures, lastError, blacklisted } }
    this._dirty = false;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.domains = raw.domains || {};
        for (const [h, info] of Object.entries(raw.urls || {})) {
          this.urls[h] = {
            url:         info.url || '',
            failures:    info.failures || 0,
            lastError:   info.lastError || '',
            blacklisted: !!info.blacklisted,
          };
        }
      }
    } catch (_) { /* start fresh */ }
  }

  save() {
    if (!this._dirty) return;
    const out = {
      version: 2,
      updatedAt: new Date().toISOString(),
      domains: this.domains,
      urls: this.urls,
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(out, null, 2), 'utf8');
    this._dirty = false;
  }

  isBlacklisted(url) {
    const host = extractDomain(url);
    if (host && this.domains[host]) return true;
    const h = urlHash(url);
    const info = this.urls[h];
    return !!(info && info.blacklisted);
  }

  /**
   * Record a download failure.
   *   - DNS error → blacklist the entire domain immediately
   *   - Other errors → increment per-URL counter, blacklist after URL_THRESHOLD
   */
  recordFailure(url, errMsg) {
    if (!isTrackableError(errMsg)) return;

    if (isDnsError(errMsg)) {
      const host = extractDomain(url);
      if (host && !this.domains[host]) {
        this.domains[host] = { lastError: errMsg, since: new Date().toISOString() };
        this._dirty = true;
      }
      return;
    }

    const h = urlHash(url);
    if (!this.urls[h]) {
      this.urls[h] = { url, failures: 0, lastError: '', blacklisted: false };
    }
    const info = this.urls[h];
    info.failures++;
    info.lastError = errMsg;
    this._dirty = true;

    if (!info.blacklisted && info.failures >= URL_THRESHOLD) {
      info.blacklisted = true;
    }
  }

  recordSuccess(url) {
    const host = extractDomain(url);
    if (host && this.domains[host]) {
      delete this.domains[host];
      this._dirty = true;
    }
    const h = urlHash(url);
    if (this.urls[h]) {
      delete this.urls[h];
      this._dirty = true;
    }
  }

  stats() {
    const domainCount = Object.keys(this.domains).length;
    const urlTotal = Object.keys(this.urls).length;
    const urlBlacklisted = Object.values(this.urls).filter(u => u.blacklisted).length;
    const domainList = Object.entries(this.domains)
      .map(([host, d]) => `${host} (${d.lastError})`)
      .sort();
    return { domainCount, urlTotal, urlBlacklisted, domainList };
  }
}

let _instance = null;

function getInstance(filePath) {
  if (!_instance || _instance.filePath !== filePath) {
    _instance = new DeadDomains(filePath);
  }
  return _instance;
}

module.exports = { DeadDomains, getInstance };
