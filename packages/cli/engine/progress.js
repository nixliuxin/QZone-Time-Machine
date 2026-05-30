/**
 * Three-layer checkpoint/resume progress management.
 *
 * File: {outputRoot}/.progress/{uin}.json
 *
 * Structure:
 * {
 *   uin: number,
 *   name: string,
 *   modules: {
 *     messages: { status, totalReported, fetched, lastPage, items: { [tid]: {...} }, updatedAt }
 *     blogs:    { status, totalReported, fetched, lastPage, ... }
 *     photos:   { status, albums: { [albumId]: { status, lastPage, photos } } }
 *     boards:   { status, totalReported, fetched, lastPage }
 *     videos:   { status, totalReported, fetched, lastPage }
 *   },
 *   downloads: { byUrl: { [url]: { path, size, sha256, status, error } } }
 *   updatedAt: ISO string
 * }
 *
 * status values:
 *   pending | running | done | error | rate_limited | no_access
 */
'use strict';

const fs = require('fs');
const path = require('path');

const STATUSES = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error',
  RATE_LIMITED: 'rate_limited',
  NO_ACCESS: 'no_access',
};

const MODULES = [
  'messages', 'blogs', 'photos', 'boards', 'videos',
  'friends', 'diaries', 'favorites', 'shares', 'visitors',
];

function emptyModuleState() {
  return {
    status: STATUSES.PENDING,
    totalReported: 0,
    fetched: 0,
    lastPage: -1, // last successfully completed page (0-based), -1 means not started
    error: null,
    updatedAt: null,
  };
}

function emptyState(uin, name) {
  const modules = {};
  for (const m of MODULES) {
    modules[m] = m === 'photos' ? { ...emptyModuleState(), albums: {} } : emptyModuleState();
  }
  return {
    uin,
    name: name || '',
    modules,
    downloads: { byUrl: {} },
    overall: STATUSES.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

class ProgressStore {
  /**
   * @param {object} opts
   * @param {string} opts.outputRoot Backup output root directory
   * @param {number} opts.uin
   * @param {string} [opts.name]
   * @param {number} [opts.flushIntervalMs] throttled disk write (default 2 seconds)
   */
  constructor(opts) {
    this.outputRoot = opts.outputRoot;
    this.uin = opts.uin;
    this.name = opts.name || '';
    this.flushIntervalMs = opts.flushIntervalMs ?? 2000;
    this.dir = path.join(this.outputRoot, '.progress');
    this.file = path.join(this.dir, `${this.uin}.json`);
    this.state = null;
    this._dirty = false;
    this._lastFlushAt = 0;
  }

  load() {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const raw = fs.readFileSync(this.file, 'utf8');
        this.state = JSON.parse(raw);
        if (!this.state.modules) this.state = emptyState(this.uin, this.name);
        // Backwards compatibility: fill in missing module fields
        for (const m of MODULES) {
          if (!this.state.modules[m]) {
            this.state.modules[m] = m === 'photos'
              ? { ...emptyModuleState(), albums: {} }
              : emptyModuleState();
          }
        }
        if (!this.state.downloads) this.state.downloads = { byUrl: {} };
      } catch (e) {
        this.state = emptyState(this.uin, this.name);
      }
    } else {
      this.state = emptyState(this.uin, this.name);
    }
    if (this.name) this.state.name = this.name;
    return this.state;
  }

  flush(force = false) {
    if (!this._dirty && !force) return;
    const now = Date.now();
    if (!force && now - this._lastFlushAt < this.flushIntervalMs) return;
    this.state.updatedAt = new Date().toISOString();
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    this._dirty = false;
    this._lastFlushAt = now;
  }

  /** Get/set a module's fields, automatically marks dirty */
  module(name) {
    if (!this.state.modules[name]) {
      this.state.modules[name] = name === 'photos'
        ? { ...emptyModuleState(), albums: {} }
        : emptyModuleState();
    }
    return this.state.modules[name];
  }

  setModule(name, patch) {
    Object.assign(this.module(name), patch, { updatedAt: new Date().toISOString() });
    this._dirty = true;
    this.flush();
  }

  /** Mark a page as complete (for checkpoint resume) */
  markPageDone(name, page, fetched, totalReported) {
    const m = this.module(name);
    if (page > m.lastPage) m.lastPage = page;
    if (fetched != null) m.fetched = fetched;
    if (totalReported != null) m.totalReported = totalReported;
    m.status = STATUSES.RUNNING;
    m.updatedAt = new Date().toISOString();
    this._dirty = true;
    this.flush();
  }

  finishModule(name, status, errMsg) {
    const m = this.module(name);
    m.status = status;
    if (errMsg) m.error = String(errMsg);
    m.updatedAt = new Date().toISOString();
    this._dirty = true;
    this.flush(true);
  }

  /** Album pagination checkpoint */
  album(albumId) {
    const photos = this.module('photos');
    if (!photos.albums) photos.albums = {};
    if (!photos.albums[albumId]) {
      photos.albums[albumId] = {
        status: STATUSES.PENDING,
        lastPage: -1,
        fetched: 0,
        totalReported: 0,
        updatedAt: null,
      };
    }
    return photos.albums[albumId];
  }

  setAlbum(albumId, patch) {
    Object.assign(this.album(albumId), patch, { updatedAt: new Date().toISOString() });
    this._dirty = true;
    this.flush();
  }

  /** Download status entry (indexed by URL) */
  recordDownload(url, info) {
    this.state.downloads.byUrl[url] = {
      ...this.state.downloads.byUrl[url],
      ...info,
      updatedAt: new Date().toISOString(),
    };
    this._dirty = true;
    this.flush();
  }

  setOverall(status) {
    this.state.overall = status;
    this._dirty = true;
    this.flush(true);
  }

  /** Short summary (for logging) */
  summary() {
    const lines = [`uin=${this.uin} ${this.state.name}: overall=${this.state.overall}`];
    for (const m of MODULES) {
      const mod = this.module(m);
      lines.push(`  ${m}: status=${mod.status} ${mod.fetched}/${mod.totalReported} page=${mod.lastPage + 1}`);
    }
    return lines.join('\n');
  }
}

module.exports = { ProgressStore, STATUSES, MODULES, emptyState, emptyModuleState };
