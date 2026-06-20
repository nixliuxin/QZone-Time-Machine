#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { resolve, join, basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { convertUser, convertBatch, embedViewer, downloadAllEmojis } from './convert.js';

const require = createRequire(import.meta.url);

const { Session } = require('../engine/session.js');
const { login } = require('../engine/qr-login.js');
const { QzoneClient, AuthInvalidError, CircuitOpenError } = require('../engine/client.js');
const { ProgressStore, STATUSES, MODULES } = require('../engine/progress.js');
const { Downloader, sanitizeFilename, SANITIZE_RULES } = require('../engine/downloader.js');
const { collectUserInfo, updateUserCounts } = require('../engine/collectors/common.js');
const { collectMessages } = require('../engine/collectors/messages.js');
const { collectBlogs } = require('../engine/collectors/blogs.js');
const { collectBoards } = require('../engine/collectors/boards.js');
const { collectVideos } = require('../engine/collectors/videos.js');
const { collectPhotos, repairAlbumPhotoFiles } = require('../engine/collectors/photos.js');
const { collectFriends } = require('../engine/collectors/friends.js');
const { collectDiaries } = require('../engine/collectors/diaries.js');
const { collectFavorites } = require('../engine/collectors/favorites.js');
const { collectShares } = require('../engine/collectors/shares.js');
const { collectVisitors } = require('../engine/collectors/visitors.js');
const enrichers = require('../engine/collectors/enrichers.js');
const { buildUniKey } = require('../engine/api/likes.js');
const { writeData } = require('../engine/collectors/_util.js');
const { augmentUserDir } = require('../engine/augment.js');
const { downloadInlineResources } = require('../engine/inline-resources.js');

const program = new Command();

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

function makeLogger(prefix: string) {
  const log = (lvl: string, ...a: unknown[]) => {
    const line = `${ts()} [${lvl}] ${prefix} ${a.map(String).join(' ')}`;
    if (lvl === 'error') console.error(line);
    else console.log(line);
  };
  return {
    info: (...a: unknown[]) => log('info', ...a),
    warn: (...a: unknown[]) => log('warn', ...a),
    error: (...a: unknown[]) => log('error', ...a),
    debug: (...a: unknown[]) => log('debug', ...a),
    log: (...a: unknown[]) => log('info', ...a),
  };
}

type AccessStatus = 'accessible' | 'no_access';

/**
 * Record a per-uin access snapshot into <outputRoot>/_access_status.json as a
 * free byproduct of the `common` probe each backup already runs. This lets the
 * launcher roster show which friends were accessible at backup time even after
 * empty stub dirs for no-access friends are cleaned up. Sequential (backup-all
 * runs one child at a time), so a plain read-modify-write is safe.
 */
function recordAccessStatus(
  outputRoot: string, uin: number, name: string, status: AccessStatus,
  logger: { warn: (m: string) => void },
): void {
  try {
    const file = join(outputRoot, '_access_status.json');
    let doc: { generatedAt?: string; users: Record<string, any> } = { users: {} };
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.users) doc = parsed;
      } catch { /* start fresh on corrupt file */ }
    }
    doc.users[String(uin)] = { uin, name, status, checkedAt: new Date().toISOString() };
    doc.generatedAt = new Date().toISOString();
    writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
  } catch (e: any) {
    logger.warn(`[access] failed to record status for ${uin}: ${e.message}`);
  }
}

/** True if the user dir holds any real archived content (list items or media). */
function userDirHasRealData(userDir: string): boolean {
  const dataDir = join(userDir, 'data');
  if (!existsSync(dataDir)) return false;
  const lists = ['messages.json', 'blogs.json', 'boards.json', 'shares.json', 'videos.json', 'diaries.json', 'favorites.json', 'visitors.json'];
  for (const f of lists) {
    const p = join(dataDir, f);
    if (!existsSync(p)) continue;
    try {
      const v = JSON.parse(readFileSync(p, 'utf8'));
      const arr = Array.isArray(v) ? v : (Array.isArray(v?.items) ? v.items : null);
      if (arr && arr.length > 0) return true;
    } catch { /* ignore */ }
  }
  const photosDir = join(dataDir, 'photos');
  if (existsSync(photosDir)) {
    try { if (readdirSync(photosDir).some((n) => n.endsWith('.json') && n !== 'albums.json')) return true; } catch { /* ignore */ }
  }
  return false;
}

/**
 * Remove a freshly-created empty stub dir (no real content) for a no-access
 * target, so a backup folder always means "has real archived content". Never
 * deletes a dir that a prior successful backup populated.
 */
function cleanupEmptyUserDir(userDir: string, logger: { info: (m: string) => void; warn: (m: string) => void }): void {
  try {
    if (!existsSync(userDir)) return;
    if (userDirHasRealData(userDir)) {
      logger.warn(`[cleanup] ${basename(userDir)} has real data; keeping despite no_access`);
      return;
    }
    rmSync(userDir, { recursive: true, force: true });
    logger.info(`[cleanup] removed empty no-access stub: ${basename(userDir)}`);
  } catch (e: any) {
    logger.warn(`[cleanup] failed to remove ${basename(userDir)}: ${e.message}`);
  }
}

program
  .name('qzone-tools')
  .description('QQ Zone backup & archive toolkit')
  .version('0.1.0');

// ─── login ───

program
  .command('login')
  .description('Log in to QQ Zone via QR code scan')
  .option('-d, --data-dir <dir>', 'Directory to store cookies.json / auth.json', '.')
  .option('-q, --qr-path <path>', 'Path to save QR code PNG image')
  .action(async (opts) => {
    const dataDir = resolve(opts.dataDir);
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const cookiesFile = join(dataDir, 'cookies.json');
    const authFile = join(dataDir, 'auth.json');

    const { cookies, uin } = await login({
      qrPath: opts.qrPath || join(dataDir, 'qrcode.png'),
    });

    const session = new Session({ cookiesFile, authFile });
    session.applyCookies(cookies);
    if (uin && session.uin !== uin) session.uin = uin;
    session.save();
    session.saveCreatedAt(dataDir);

    console.log(`Login successful! uin=${session.uin}`);
    console.log(`Cookies saved to: ${cookiesFile}`);
  });

// ─── import-cookies ───

program
  .command('import-cookies')
  .description('Import cookies from browser (paste cookie string from DevTools)')
  .option('-d, --data-dir <dir>', 'Directory to store cookies.json / auth.json', '.')
  .option('-f, --file <path>', 'Read cookie string from a text file instead of stdin')
  .action(async (opts) => {
    const dataDir = resolve(opts.dataDir);
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const cookiesFile = join(dataDir, 'cookies.json');
    const authFile = join(dataDir, 'auth.json');

    let cookieStr = '';
    if (opts.file) {
      cookieStr = readFileSync(resolve(opts.file), 'utf-8').trim();
    } else {
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      cookieStr = await new Promise<string>((res) => {
        console.log('Paste your cookie string from browser DevTools (F12 → Network → Request Headers → Cookie):');
        rl.question('> ', (answer) => { rl.close(); res(answer.trim()); });
      });
    }

    if (!cookieStr) {
      console.error('Empty cookie string. Aborting.');
      process.exit(1);
    }

    const cookies = cookieStr.split(';').map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return null;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) return null;
      return { name, value, domain: '.qq.com', path: '/', expires: -1, httpOnly: false, secure: false, session: true };
    }).filter(Boolean);

    if (cookies.length === 0) {
      console.error('No valid cookies parsed. Aborting.');
      process.exit(1);
    }

    const session = new Session({ cookiesFile, authFile });
    session.applyCookies(cookies);
    session.save();
    session.saveCreatedAt(dataDir);

    if (!session.uin || !session.gtk) {
      console.error('Warning: could not extract uin or g_tk from cookies.');
      console.error('Make sure you copied the full cookie string from a logged-in QZone page.');
    } else {
      console.log(`Import successful! uin=${session.uin}, g_tk=${session.gtk}`);
    }
    console.log(`Cookies saved to: ${cookiesFile} (${cookies.length} cookies)`);
  });

// ─── sync scope resolution ───
//
// "scope" is the single knob describing how deep a sync goes:
//   full  (default) — rescan item lists (discover newly-added/missing whole
//                     items) AND backfill per-item details/media.
//   topup           — trust the local lists as complete; only backfill missing
//                     per-item data (comments/likes/visitors/detail/media) on
//                     items already on disk. API-light; skips the list rescan
//                     (the step most likely to trip rate limits).
// The legacy boolean flag `--fill-missing` is kept as a hidden alias for
// `--scope topup` so existing scripts/habits keep working.
function resolveScope(opts: any): 'full' | 'topup' {
  const raw = (opts.scope ?? '').toString().trim().toLowerCase();
  if (raw && raw !== 'full' && raw !== 'topup') {
    console.error(`Invalid --scope "${opts.scope}". Use "full" or "topup".`);
    process.exit(1);
  }
  if (opts.fillMissing) return 'topup'; // legacy alias wins
  return raw === 'topup' ? 'topup' : 'full';
}

// ─── backup (single user) ───

program
  .command('backup')
  .description('Back up a single user\'s QQ Zone data')
  .argument('<uin>', 'Target QQ number')
  .option('-d, --data-dir <dir>', 'Auth data directory (with cookies.json)', '.')
  .option('-o, --output <dir>', 'Output root directory', './output')
  .option('-n, --name <name>', 'User nickname (for folder naming)')
  .option('--no-download', 'Skip media downloads (JSON only)')
  .option('--no-photos', 'Skip photo album collection')
  .option('--no-convert', 'Skip automatic conversion to viewer format')
  .option('--no-enrich-comments', 'Skip comment enrichment (enabled by default)')
  .option('--no-enrich-likes', 'Skip like enrichment (enabled by default)')
  .option('--likes-count-only', 'Likes: keep only the embedded count (likeTotal); skip the per-item liker-list fetch (much faster)', false)
  .option('--enrich-visitors', 'Also fetch per-item visitors (API-heavy; off by default)', false)
  .option('--sample <pages>', 'Sample mode: limit pages per module', '0')
  .option('--inline-concurrency <n>', 'Concurrent inline resource downloads', '6')
  .option('--incremental', 'Only fetch new items (ID-based dedup against existing data)', false)
  .option('--scope <mode>', 'Sync depth: "full" (rescan lists + backfill details/media) or "topup" (trust local lists; only backfill missing per-item data; API-light)', 'full')
  .option('--fill-missing', '[deprecated] alias for --scope topup', false)
  .option('--reconcile-ids', 'Repair synthetic ids in converted-legacy data (blogs/boards/albums) before enrichment', false)
  .option('--min-gap <ms>', 'Minimum gap between API requests (anti-ban throttle)', '500')
  .option('--rl-threshold <n>', 'Abort run after N consecutive rate-limit responses (0=never)', '3')
  .action(async (targetUinStr, opts) => {
    const targetUin = Number(targetUinStr);
    if (!targetUin || !Number.isFinite(targetUin)) {
      console.error('Invalid QQ number');
      process.exit(1);
    }

    const dataDir = resolve(opts.dataDir);
    const cookiesFile = join(dataDir, 'cookies.json');
    const authFile = join(dataDir, 'auth.json');

    const session = new Session({ cookiesFile, authFile });
    session.load();
    if (!session.looksValid()) {
      console.error('Session expired or invalid. Please run "qzone-tools login" first.');
      process.exit(1);
    }

    const minGap = parseInt(opts.minGap, 10);
    const rlThreshold = parseInt(opts.rlThreshold, 10);
    const client = new QzoneClient({
      session,
      config: {
        dataDir,
        minRequestGapMs: Number.isFinite(minGap) ? minGap : 500,
        rlCircuitThreshold: Number.isFinite(rlThreshold) ? rlThreshold : 3,
      },
    });
    const logger = makeLogger(`uin=${targetUin}`);
    const download = opts.download !== false;
    const doPhotos = opts.photos !== false;
    const doConvert = opts.convert !== false;
    const samplePages = parseInt(opts.sample, 10) || 0;
    const inlineConcurrency = parseInt(opts.inlineConcurrency, 10) || 6;

    const name = opts.name || String(targetUin);
    const folder = `${targetUin}_${sanitizeFilename(name)}`;
    const outputRoot = resolve(opts.output);
    const userDir = join(outputRoot, folder);
    if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

    const progress = new ProgressStore({ outputRoot, uin: targetUin, name });
    progress.load();
    progress.setOverall('running');

    const downloader = new Downloader({
      client, progress, outputRoot: userDir,
      concurrency: 4, maxRetries: 3, logger,
    });

    const counts: Record<string, number> = {};

    const incremental = !!opts.incremental;
    const scope = resolveScope(opts);
    const fillMissing = scope === 'topup';
    if (fillMissing) logger.info('scope=topup (trust local lists; backfill missing per-item data only)');
    // In topup scope every collector runs with listFetch=false (no list
    // pagination at all). Modules whose per-item data is filled by the
    // enrichment pass below (comments/likes/visitors) need nothing from the
    // collector, so they're skipped outright to save even a disk read. The rest
    // (blogs/diaries detail, favorites/friends/visitors snapshots) run with
    // listFetch=false to fill/keep their own data without any API calls.
    const fillMissingSkip = new Set(['messages', 'boards', 'videos', 'shares', 'photos']);

    const runModule = async (label: string, fn: () => Promise<any>) => {
      const mod = progress.module(label);
      if (fillMissing && label !== 'common' && fillMissingSkip.has(label)) {
        logger.info(`--- ${label} --- (fill-missing: skip list collection)`);
        return { status: 'skipped', total: mod.totalReported, fetched: 0, items: [] };
      }
      if (mod.status === 'done' && !incremental && !fillMissing) {
        logger.info(`--- ${label} --- (already done, skipping)`);
        return { status: 'done', total: mod.totalReported, fetched: mod.fetched, items: [] };
      }
      if (mod.status === 'done' && incremental) {
        logger.info(`--- ${label} --- (done, incremental re-check)`);
      }
      logger.info(`--- ${label} ---`);
      try {
        const r = await fn();
        logger.info(`${label} done: status=${r.status} ${r.fetched ?? 0}/${r.total ?? 0}`);
        return r;
      } catch (err: any) {
        if (err instanceof AuthInvalidError) throw err;
        if (err instanceof CircuitOpenError) throw err; // abort whole user, don't swallow
        logger.error(`${label} error: ${err.message}`);
        return { status: 'error', total: 0, fetched: 0, items: [] };
      }
    };

    const inlineNow = async (label: string) => {
      if (!download) return;
      try {
        const r = await downloadInlineResources(userDir, {
          logger, client, module: label,
          downloadVideos: true,
          downloadAudios: true,
          concurrency: inlineConcurrency,
        });
        const s = r[label];
        if (s) logger.info(`[inline-${label}] ok=${s.ok} skip=${s.skip} fail=${s.fail} total=${s.total}`);
      } catch (e: any) {
        logger.error(`[inline-${label}] error: ${e.message}`);
      }
    };

    try {
      // 1) Common
      const u = await runModule('common', () =>
        collectUserInfo({ client, targetUin, outputRoot: userDir, logger })
      );

      // Access-status snapshot (free byproduct of the common probe).
      recordAccessStatus(outputRoot, Number(targetUin), name,
        u.status === 'no_access' ? 'no_access' : 'accessible', logger);

      if (u.status === 'no_access') {
        logger.warn('No access to this user\'s QZone, aborting.');
        progress.setOverall('no_access');
        // A backup folder should mean "has real archived content"; the full
        // friend roster + access snapshot are preserved centrally, so drop the
        // empty stub (keeps a prior populated dir if one somehow exists).
        cleanupEmptyUserDir(userDir, logger);
        return;
      }

      // Record name sanitization into the user's own data.json so any cleaned name
      // is always traceable back to the original. Matching/dedup keys off uin, never
      // the display name. The folder uses the display name (remark||name); the QZone
      // nickname is recorded separately since it is where messy strings (emoji markup,
      // whitespace, trailing dots) usually live.
      try {
        const sName = sanitizeFilename(name);
        const ujPath = join(userDir, 'data', 'user.json');
        let uj: any = {};
        if (existsSync(ujPath)) { try { uj = JSON.parse(readFileSync(ujPath, 'utf8')); } catch { /* ignore corrupt */ } }
        else { mkdirSync(join(userDir, 'data'), { recursive: true }); }
        const nick = uj.nickname != null ? String(uj.nickname) : null;
        const nickClean = nick != null ? sanitizeFilename(nick) : null;
        uj.sanitize = {
          folder: basename(userDir),
          display_name: sName,            // folder suffix (cleaned name actually used)
          display_name_raw: name,         // raw display name (remark||name) before sanitize
          nickname_raw: nick,             // QZone nickname as stored
          nickname_sanitized: nickClean,  // nickname after the same engine sanitizer
          changed: name !== sName || (nick != null && nick !== nickClean),
          rules: SANITIZE_RULES,
          at: new Date().toISOString(),
        };
        writeFileSync(ujPath, JSON.stringify(uj, null, 2), 'utf8');
      } catch (e: any) {
        logger.warn(`[sanitize] failed to record name sanitize: ${e.message}`);
      }

      const realName = u.info?.name || u.info?.nickname || name;
      progress.state.name = realName;

      // Record owner identity so the viewer can accurately decide module
      // visibility (owner-only modules like friends/shares/diaries) and so we
      // always know whose session produced this archive.
      const ownerUin = Number(session.uin);
      const isOwner = ownerUin === Number(targetUin);
      try {
        writeFileSync(join(userDir, 'meta.json'), JSON.stringify({
          source: 'backup',
          uin: Number(targetUin),
          nickname: realName,
          owner_uin: ownerUin,
          is_owner: isOwner,
          backedUpAt: new Date().toISOString(),
        }, null, 2), 'utf8');
        const userJsonPath = join(userDir, 'data', 'user.json');
        if (existsSync(userJsonPath)) {
          const uj = JSON.parse(readFileSync(userJsonPath, 'utf8'));
          uj.owner_uin = ownerUin;
          uj.is_owner = isOwner;
          writeFileSync(userJsonPath, JSON.stringify(uj, null, 2), 'utf8');
        }
      } catch (e: any) {
        logger.warn(`Failed to write owner meta: ${e.message}`);
      }

      // 1.5) Reconcile synthetic ids (converted-legacy data) BEFORE enrichment,
      // so blogs readnum / comments / likes and photo enrichment all address the
      // corrected real ids in this same pass. No-op (zero API) when no synthetic
      // ids are present. Opt-in via --reconcile-ids.
      if (opts.reconcileIds) {
        try {
          const { reconcileUser } = require('../engine/reconcile.js');
          logger.info('--- reconcile-ids ---');
          const rep = await reconcileUser({ client, userDir, targetUin, apply: true, logger });
          for (const mod of Object.keys(rep.modules)) {
            const rm = rep.modules[mod];
            if (rm && rm.synthetic > 0) {
              logger.info(`[reconcile] ${mod}: synthetic=${rm.synthetic} changed=${rm.changed ?? 0} matched=${rm.matched} ambiguous=${rm.ambiguous} unmatched=${rm.unmatched}`);
            }
          }
        } catch (err: any) {
          if (err instanceof AuthInvalidError) throw err;
          if (err instanceof CircuitOpenError) throw err;
          logger.warn(`[reconcile] error: ${err.message}`);
        }
      }

      // 2) Messages
      const m = await runModule('messages', () =>
        collectMessages({ client, targetUin, outputRoot: userDir, progress, logger, pageLimit: samplePages, incremental })
      );
      counts.messages = m.fetched;
      if (m.fetched > 0) await inlineNow('messages');

      // 3) Blogs
      const b = await runModule('blogs', () =>
        collectBlogs({ client, targetUin, outputRoot: userDir, progress, logger, pageLimit: samplePages, incremental, listFetch: !fillMissing })
      );
      counts.blogs = b.fetched;
      if (b.fetched > 0) await inlineNow('blogs');

      // 4) Boards
      const bo = await runModule('boards', () =>
        collectBoards({ client, targetUin, outputRoot: userDir, progress, logger, pageLimit: samplePages, incremental })
      );
      counts.boards = bo.fetched;
      if (bo.fetched > 0) await inlineNow('boards');

      // 5) Videos
      const v = await runModule('videos', () =>
        collectVideos({ client, targetUin, outputRoot: userDir, progress, logger })
      );
      counts.videos = v.fetched;
      if (v.fetched > 0) await inlineNow('videos');

      // 6) Friends
      const f = await runModule('friends', () =>
        collectFriends({ client, targetUin, outputRoot: userDir, progress, logger, listFetch: !fillMissing })
      );
      counts.friends = f.fetched;

      // 7) Diaries
      const d = await runModule('diaries', () =>
        collectDiaries({ client, targetUin, outputRoot: userDir, progress, logger, withDetail: fillMissing, listFetch: !fillMissing })
      );
      counts.diaries = d.fetched;
      if (d.fetched > 0) await inlineNow('diaries');

      // 8) Favorites
      const fav = await runModule('favorites', () =>
        collectFavorites({ client, targetUin, outputRoot: userDir, progress, logger, listFetch: !fillMissing })
      );
      counts.favorites = fav.fetched;
      if (fav.fetched > 0) await inlineNow('favorites');

      // 9) Shares
      const sh = await runModule('shares', () =>
        collectShares({ client, targetUin, outputRoot: userDir, progress, logger, incremental })
      );
      counts.shares = sh.fetched;
      if (sh.fetched > 0) await inlineNow('shares');

      // 10) Photos
      let p: any = { fetched: 0, items: [] };
      if (doPhotos) {
        p = await runModule('photos', () =>
          collectPhotos({
            client, targetUin, outputRoot: userDir, progress, downloader, logger,
            downloadImages: download,
            albumLimit: samplePages ? 2 : 0,
            photoLimitPerAlbum: samplePages ? 5 : 0,
          })
        );
        counts.photos = p.fetched;
      }

      // 11) Visitors
      const vs = await runModule('visitors', () =>
        collectVisitors({ client, targetUin, outputRoot: userDir, progress, logger, listFetch: !fillMissing })
      );
      counts.visitors = Math.max(vs.total || 0, vs.fetched || 0);

      // 12) Enrich (optional)
      // Helper: load items from disk if in-memory array is empty (module was already done)
      const loadFromDisk = (file: string): any[] => {
        const p = join(userDir, 'data', file);
        if (!existsSync(p)) return [];
        try {
          const raw = JSON.parse(readFileSync(p, 'utf8'));
          return Array.isArray(raw) ? raw : (raw?.items || []);
        } catch { return []; }
      };

      if (opts.enrichComments) {
        logger.info('--- enrich.comments ---');
        const msgItems = m.items?.length ? m.items : loadFromDisk('messages.json');
        if (msgItems.length) {
          await enrichers.enrichMessageComments({ client, targetUin, items: msgItems, logger });
          writeData(join(userDir, 'data', 'messages.json'), msgItems);
        }
        const blogItems = b.items?.length ? b.items : loadFromDisk('blogs.json');
        if (blogItems.length) {
          await enrichers.enrichBlogComments({ client, targetUin, items: blogItems, logger });
          writeData(join(userDir, 'data', 'blogs.json'), blogItems);
        }
        // Enrich album photo comments from disk
        const photosDir = join(userDir, 'data', 'photos');
        if (existsSync(photosDir)) {
          const { readdirSync } = await import('node:fs');
          const albumFiles = readdirSync(photosDir).filter((f: string) => f.endsWith('.json'));
          for (const af of albumFiles) {
            const afPath = join(photosDir, af);
            try {
              const raw = JSON.parse(readFileSync(afPath, 'utf-8'));
              const photos = Array.isArray(raw) ? raw : raw.photoList || [];
              if (!photos.length) continue;
              const albumId = photos[0]?.albumId || af.replace('.json', '');
              const touched = await enrichers.enrichAlbumPhotoComments({
                client, targetUin,
                albums: [{ id: albumId, photoList: photos }],
                logger,
              });
              if (touched > 0) {
                writeData(afPath, photos);
              }
            } catch (e: any) {
              if (e instanceof CircuitOpenError || e instanceof AuthInvalidError) throw e;
              logger.warn(`[enrich] album ${af} error: ${e.message}`);
            }
          }
        }
        // Video comments
        const videoItems = v.items?.length ? v.items : loadFromDisk('videos.json');
        if (videoItems.length) {
          await enrichers.enrichVideoComments({ client, targetUin, items: videoItems, logger });
          writeData(join(userDir, 'data', 'videos.json'), videoItems);
        }
        // Share comments
        const shareItems = sh.items?.length ? sh.items : loadFromDisk('shares.json');
        if (shareItems.length) {
          await enrichers.enrichShareComments({ client, targetUin, items: shareItems, logger });
          writeData(join(userDir, 'data', 'shares.json'), shareItems);
        }
      }

      if (opts.enrichLikes) {
        logger.info('--- enrich.likes ---');
        const msgItemsL = m.items?.length ? m.items : loadFromDisk('messages.json');
        if (msgItemsL.length) {
          await enrichers.enrichLikes({
            client, items: msgItemsL,
            buildKey: (it: any) => buildUniKey('mood', targetUin, it.tid),
            label: 'messages', logger, countOnly: opts.likesCountOnly,
          });
          writeData(join(userDir, 'data', 'messages.json'), msgItemsL);
        }
        const blogItemsL = b.items?.length ? b.items : loadFromDisk('blogs.json');
        if (blogItemsL.length) {
          await enrichers.enrichLikes({
            client, items: blogItemsL,
            buildKey: (it: any) => buildUniKey('blog', targetUin, it.blogId || it.blogid),
            label: 'blogs', logger, countOnly: opts.likesCountOnly,
          });
          writeData(join(userDir, 'data', 'blogs.json'), blogItemsL);
        }
        // Share likes
        const shareItemsL = sh.items?.length ? sh.items : loadFromDisk('shares.json');
        if (shareItemsL.length) {
          await enrichers.enrichLikes({
            client, items: shareItemsL,
            buildKey: (it: any) => buildUniKey('share', targetUin, it.id || it.shareid),
            label: 'shares', logger, countOnly: opts.likesCountOnly,
          });
          writeData(join(userDir, 'data', 'shares.json'), shareItemsL);
        }
        // Photo likes (per-album files under data/photos/)
        const photosDirL = join(userDir, 'data', 'photos');
        if (existsSync(photosDirL)) {
          const { readdirSync } = await import('node:fs');
          const albumFilesL = readdirSync(photosDirL).filter((f: string) => f.endsWith('.json') && f !== 'albums.json');
          for (const af of albumFilesL) {
            const afPath = join(photosDirL, af);
            try {
              const raw = JSON.parse(readFileSync(afPath, 'utf-8'));
              const photos = Array.isArray(raw) ? raw : raw.photoList || [];
              if (!photos.length) continue;
              await enrichers.enrichLikes({
                client, items: photos,
                buildKey: (it: any) => buildUniKey('photo', targetUin, it.lloc || it.picKey),
                label: `photos/${af}`, logger, countOnly: opts.likesCountOnly,
              });
              writeData(afPath, photos);
            } catch (e: any) {
              if (e instanceof CircuitOpenError || e instanceof AuthInvalidError) throw e;
              logger.warn(`[enrich] photo-likes ${af} error: ${e.message}`);
            }
          }
        }
      }

      // Per-item visitors (who viewed each post). API-heavy; opt-in only.
      if (opts.enrichVisitors) {
        logger.info('--- enrich.visitors (per-item) ---');
        const msgItemsV = m.items?.length ? m.items : loadFromDisk('messages.json');
        if (msgItemsV.length) {
          await enrichers.enrichSingleVisitors({
            client, targetUin, items: msgItemsV, appid: 311,
            targetIdOf: (it: any) => it.tid, label: 'messages', logger,
          });
          writeData(join(userDir, 'data', 'messages.json'), msgItemsV);
        }
        const blogItemsV = b.items?.length ? b.items : loadFromDisk('blogs.json');
        if (blogItemsV.length) {
          await enrichers.enrichSingleVisitors({
            client, targetUin, items: blogItemsV, appid: 2,
            targetIdOf: (it: any) => it.blogId || it.blogid, label: 'blogs', logger,
          });
          writeData(join(userDir, 'data', 'blogs.json'), blogItemsV);
        }
      }

      // Wait for photo download queue, then run the data-driven album media
      // repair (downloads any album cover/photo whose local file is missing).
      // This runs in every mode — including fill-missing and "photos already
      // done" re-runs — so album media is self-healing like inline media.
      if (download && doPhotos) {
        logger.info('Waiting for photo download queue...');
        await downloader.drain();
        try {
          await repairAlbumPhotoFiles({ outputRoot: userDir, downloader, logger });
        } catch (e: any) {
          logger.warn(`[photos] media repair error: ${e.message}`);
        }
        logger.info('All downloads complete');
      }

      // 13) Update user counts (skip in fill-missing: skipped collectors returned 0
      //     and must not clobber the real counts already in user.json)
      if (!fillMissing) {
        updateUserCounts({ outputRoot: userDir, counts, name: realName, uin: targetUin, logger });
      }

      // 14) Augment
      logger.info('--- augment ---');
      try {
        const r = augmentUserDir(userDir, { logger });
        logger.info(`augment done: touched=${r.touched} augmented=${r.augmented}`);
      } catch (e: any) {
        logger.error(`augment error: ${e.message}`);
      }

      // 15) Final inline resources pass
      if (download) {
        logger.info('--- inline-resources (final pass) ---');
        try {
          const r = await downloadInlineResources(userDir, {
            logger, client,
            downloadVideos: true,
            downloadAudios: true,
            concurrency: inlineConcurrency,
          });
          const totals = Object.entries(r).map(([k, v]: [string, any]) =>
            `${k}: ${v.ok}/${v.total} (skip=${v.skip} fail=${v.fail})`
          ).join(' | ');
          logger.info(`inline done: ${totals}`);
        } catch (e: any) {
          logger.error(`inline-resources error: ${e.message}`);
        }
      }

      // 15b) Download QQ emojis locally (archive completeness)
      logger.info('--- emoji download ---');
      try {
        const emojiResult = await downloadAllEmojis(userDir);
        logger.info(`emojis: found=${emojiResult.found} downloaded=${emojiResult.downloaded}`);
      } catch (e: any) {
        logger.error(`emoji download error: ${e.message}`);
      }

      progress.setOverall('done');
      logger.info('========== Backup complete ==========');

      // 16) Split albums.json into individual album photo files for viewer
      const albumsJsonPath = join(userDir, 'data', 'photos', 'albums.json');
      if (existsSync(albumsJsonPath)) {
        try {
          const { repairAlbumCoverUrls } = require('../engine/collectors/photos.js');
          const coverFix = repairAlbumCoverUrls(userDir, logger);
          if (coverFix.fixed) logger.info(`[photos] backfilled ${coverFix.fixed} album cover paths`);

          const albumsRaw = JSON.parse(readFileSync(albumsJsonPath, 'utf8'));
          if (Array.isArray(albumsRaw)) {
            const albumIndex: Record<string, unknown>[] = [];
            for (const album of albumsRaw) {
              const photoList = album.photoList || [];
              if (photoList.length > 0) {
                writeFileSync(
                  join(userDir, 'data', 'photos', `${album.id}.json`),
                  JSON.stringify(photoList, null, 2), 'utf8'
                );
              }
              const { photoList: _, ...meta } = album;
              meta.total = meta.total ?? photoList.length;
              meta.cover_url = meta.custom_filepath || '';
              albumIndex.push(meta);
            }
            writeFileSync(albumsJsonPath, JSON.stringify(albumIndex, null, 2), 'utf8');
            logger.info(`Split ${albumsRaw.length} albums into individual JSON files`);
          }
        } catch (e: any) {
          logger.error(`Album split error: ${e.message}`);
        }
      }

      // 17) Write provenance metadata
      const meta = {
        source: 'backup',
        uin: targetUin,
        nickname: opts.name || String(targetUin),
        backedUpAt: new Date().toISOString(),
      };
      writeFileSync(join(userDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

      // 18) Download avatars
      {
        logger.info('--- download avatars ---');
        const avatarDir = join(userDir, 'media', 'avatars');
        if (!existsSync(avatarDir)) mkdirSync(avatarDir, { recursive: true });

        const uins = new Set<string>();
        uins.add(String(targetUin));

        const dataDir = join(userDir, 'data');
        const tryCollectUins = (file: string, extractor: (items: any[]) => string[]) => {
          const p = join(dataDir, file);
          if (!existsSync(p)) return;
          try {
            const raw = JSON.parse(readFileSync(p, 'utf-8'));
            const items = Array.isArray(raw) ? raw : raw.items || [];
            for (const u of extractor(items)) { if (u) uins.add(String(u)); }
          } catch {}
        };

        tryCollectUins('friends.json', (items) => items.map(f => f.uin));
        tryCollectUins('visitors.json', (items) => items.map(v => v.uin));
        tryCollectUins('boards.json', (items) => items.map(b => b.uin));

        const https = await import('node:https');
        const http = await import('node:http');
        const fetchAvatar = (url: string, dest: string): Promise<boolean> => {
          if (existsSync(dest)) return Promise.resolve(true);
          return new Promise((resolve) => {
            const mod = url.startsWith('https') ? https : http;
            const req = mod.get(url, { timeout: 10000 }, (res: any) => {
              if (res.statusCode === 301 || res.statusCode === 302) {
                const loc = res.headers.location;
                if (loc) { fetchAvatar(loc, dest).then(resolve); return; }
              }
              if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
              const { createWriteStream } = require('node:fs');
              const ws = createWriteStream(dest);
              res.pipe(ws);
              ws.on('finish', () => resolve(true));
              ws.on('error', () => resolve(false));
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
          });
        };

        // Download owner QZone avatar
        await fetchAvatar(`https://q.qlogo.cn/g?b=qz&nk=${targetUin}&s=640`, join(avatarDir, `${targetUin}_qz.jpg`));

        // Download QQ avatars for all collected UINs
        let dlCount = 0;
        const uinArr = [...uins];
        const BATCH = 8;
        for (let i = 0; i < uinArr.length; i += BATCH) {
          const batch = uinArr.slice(i, i + BATCH);
          const results = await Promise.all(batch.map(u =>
            fetchAvatar(`https://q.qlogo.cn/headimg_dl?dst_uin=${u}&spec=640`, join(avatarDir, `${u}.jpg`))
          ));
          dlCount += results.filter(Boolean).length;
        }
        logger.info(`[avatars] downloaded: ${dlCount}/${uins.size} avatars`);
      }

      // 19) Embed viewer (unless --no-convert)
      if (doConvert) {
        logger.info('--- embed viewer ---');
        try {
          embedViewer(userDir);
          logger.info(`Viewer embedded in: ${userDir}`);
        } catch (e: any) {
          logger.error(`Embed viewer error: ${e.message}`);
        }
      }

    } catch (err: any) {
      if (err instanceof AuthInvalidError) {
        logger.error('Session expired. Please re-login (desktop login shell or "qzone-tools login"), then re-run — progress is saved.');
        progress.setOverall('error');
        process.exit(77); // distinct code so backup-all pauses the whole batch for re-login
      }
      if (err instanceof CircuitOpenError) {
        logger.error(`Rate-limit circuit tripped (${err.reason}). Aborting this user. ` +
          `Wait a while (recommend hours), then re-run to resume — progress is saved.`);
        progress.setOverall('rate_limited');
        process.exit(75); // distinct code so backup-all stops the whole batch
      }
      logger.error(`Unexpected error: ${err.stack || err.message}`);
      progress.setOverall('error');
      process.exit(1);
    }
  });

// ─── backup-all (batch) ───

program
  .command('backup-all')
  .description('Batch backup all accessible friends')
  .option('-d, --data-dir <dir>', 'Auth data directory', '.')
  .option('-o, --output <dir>', 'Output root directory', './output')
  .option('--delay <ms>', 'Base delay between users (ms); also caps the inter-dispatch stagger when --concurrency>1', '30000')
  .option('--concurrency <n>', 'Starting number of users to back up in parallel (adaptive: auto-ramps up to --max-concurrency, halves + cools down on rate-limit)', '1')
  .option('--max-concurrency <n>', 'Ceiling for adaptive concurrency auto-ramp (defaults to --concurrency, i.e. no ramp)', '1')
  .option('--cooldown <ms>', 'Pause window after a rate-limit trip before resuming dispatch at reduced concurrency', '300000')
  .option('--daily-limit <n>', 'Max users to process per run (0=unlimited)', '50')
  .option('--no-download', 'Skip media downloads')
  .option('--no-convert', 'Skip conversion to viewer format')
  .option('--no-enrich-comments', 'Skip comment enrichment (enabled by default)')
  .option('--no-enrich-likes', 'Skip like enrichment (enabled by default)')
  .option('--likes-count-only', 'Likes: keep only the embedded count (likeTotal); skip the per-item liker-list fetch (much faster)', false)
  .option('--enrich-visitors', 'Also fetch per-item visitors (API-heavy; off by default)', false)
  .option('--skip <uins>', 'Comma-separated UINs to skip')
  .option('--start-index <n>', 'Resume from the Nth target in the full list (1-based, matches the [N/total] progress label); skips everything before it without re-checking', '0')
  .option('--sample <pages>', 'Sample mode: limit pages per module', '0')
  .option('--incremental', 'Only fetch new items (ID-based dedup)', false)
  .option('--scope <mode>', 'Sync depth: "full" (rescan lists + backfill details/media) or "topup" (trust local lists; only backfill missing per-item data; API-light, only tops up existing backups)', 'full')
  .option('--fill-missing', '[deprecated] alias for --scope topup', false)
  .option('--reconcile-ids', 'Repair synthetic ids in converted-legacy data (blogs/boards/albums) before enrichment', false)
  .option('--min-gap <ms>', 'Minimum gap between API requests (anti-ban throttle)', '500')
  .option('--rl-threshold <n>', 'Stop the batch after N consecutive rate-limit responses (0=never)', '3')
  .option('--access-file <path>', 'Optional access_status.json (from check-access): skip inaccessible targets')
  .action(async (opts) => {
    const dataDir = resolve(opts.dataDir);
    const cookiesFile = join(dataDir, 'cookies.json');
    const authFile = join(dataDir, 'auth.json');

    const session = new Session({ cookiesFile, authFile });
    session.load();
    if (!session.looksValid()) {
      console.error('Session expired. Please run "qzone-tools login" or "qzone-tools import-cookies" first.');
      process.exit(1);
    }

    // Proactive session age check
    const remaining = session.estimatedRemainingMs(dataDir);
    if (remaining <= 0) {
      console.error('Session expired (age > 20h). Please re-login.');
      process.exit(1);
    }
    if (remaining < 2 * 60 * 60 * 1000) {
      console.warn(`Warning: session expires in ~${Math.round(remaining / 60000)} minutes.`);
    }

    const client = new QzoneClient({ session, config: { dataDir } });
    const logger = makeLogger('batch');
    const { getFriends } = require('../engine/api/friends.js');

    const skipSet = new Set((opts.skip || '').split(',').map((s: string) => s.trim()).filter(Boolean));
    const dailyLimit = parseInt(opts.dailyLimit, 10) || 0;
    const scope = resolveScope(opts);
    const fillMissing = scope === 'topup';
    if (fillMissing) logger.info('scope=topup (only tops up existing backups; no list rescan)');

    // Optional: load an access-status file (from `check-access` or the legacy
    // friends_with_access.json) and skip targets that are not accessible.
    const inaccessibleSet = new Set<string>();
    if (opts.accessFile) {
      const accPath = resolve(opts.accessFile);
      if (!existsSync(accPath)) {
        console.error(`Access file not found: ${accPath}`);
        process.exit(1);
      }
      try {
        const parsed = JSON.parse(readFileSync(accPath, 'utf8'));
        const list = Array.isArray(parsed) ? parsed : (parsed.results || []);
        for (const r of list) {
          const uin = String(r.uin ?? r.fuin ?? '');
          if (!uin) continue;
          const inaccessible = r.status
            ? (r.status === 'no_permission' || r.status === 'not_activated')
            : (r.access === false);
          if (inaccessible) inaccessibleSet.add(uin);
        }
        logger.info(`Access filter: ${inaccessibleSet.size} inaccessible targets will be skipped (from ${basename(accPath)})`);
      } catch (e: any) {
        console.error(`Failed to parse access file: ${e.message}`);
        process.exit(1);
      }
    }

    logger.info('Fetching friends list...');
    const friendsJson = await getFriends({ client, targetUin: session.uin });
    const items = friendsJson?.data?.items || friendsJson?.items || [];

    // Always include the owner's own space first, even if not in the friends
    // list, so backup-all never misses self.
    const ownerUin = Number(session.uin);
    const hasSelf = items.some((f: any) => Number(f.uin || f.fuin) === ownerUin);
    if (!hasSelf && ownerUin) {
      items.unshift({ uin: ownerUin, name: '我', remark: '' });
      logger.info(`Prepended owner self (${ownerUin}) to backup list`);
    }
    logger.info(`Found ${items.length} targets (${hasSelf ? 'self in friends' : 'self prepended'}, skipping ${skipSet.size})`);
    if (dailyLimit > 0) {
      logger.info(`Daily limit: ${dailyLimit} users per run`);
    }

    const delay = parseInt(opts.delay, 10) || 30000;
    const startConc = Math.max(1, parseInt(opts.concurrency, 10) || 1);
    const maxConc = Math.max(startConc, parseInt(opts.maxConcurrency, 10) || startConc);
    const cooldownMs = Math.max(0, parseInt(opts.cooldown, 10) || 300000);
    const startIndex = Math.max(0, parseInt(opts.startIndex, 10) || 0);
    const RAMP_AFTER = 4;     // clean account completions before +1 concurrency
    const MAX_BACKOFFS = 6;   // consecutive rate-limit backoffs (no recovery) before full stop
    let processedCount = 0;
    let stop = false;
    let stopReason = '';

    // Pre-filter the eligible targets (same skip rules as before) so the worker
    // pool only has real work to dispatch.
    const eligible: { uin: any; name: string; idx: number }[] = [];
    for (let i = 0; i < items.length; i++) {
      const friend = items[i];
      const uin = friend.uin || friend.fuin;
      const name = friend.remark || friend.name || `User_${uin}`;
      if (startIndex > 0 && (i + 1) < startIndex) {
        continue; // --start-index: silently skip everything before the resume point
      }
      if (skipSet.has(String(uin))) {
        logger.info(`[${i + 1}/${items.length}] SKIP ${uin} (${name})`);
        continue;
      }
      if (inaccessibleSet.has(String(uin))) {
        logger.info(`[${i + 1}/${items.length}] SKIP ${uin} (${name}) - inaccessible per access file`);
        continue;
      }
      // topup only tops up accounts that ALREADY have a real backup on disk; it
      // must never fabricate a new (empty) backup for a never-collected friend
      // (e.g. service accounts). Such targets need a full backup instead.
      if (fillMissing) {
        const hasBackup = existsSync(opts.output) && readdirSync(opts.output).some(
          (d: string) => d.startsWith(`${uin}_`) && existsSync(join(opts.output, d, 'data'))
        );
        if (!hasBackup) {
          logger.info(`[${i + 1}/${items.length}] SKIP ${uin} (${name}) - no existing backup (scope=topup only tops up existing ones)`);
          continue;
        }
      }
      eligible.push({ uin, name, idx: i });
    }

    logger.info(`${eligible.length} eligible targets; adaptive concurrency start=${startConc} max=${maxConc}, cooldown=${Math.round(cooldownMs / 1000)}s on rate-limit`);

    const { spawn } = require('child_process');
    const thisScript = process.argv[1];
    const projRoot = resolve(fileURLToPath(import.meta.url), '../../..');

    const buildArgs = (uin: any, name: string) => {
      const args = ['backup', String(uin), '-d', dataDir, '-o', opts.output, '-n', name];
      if (!opts.download) args.push('--no-download');
      if (!opts.convert) args.push('--no-convert');
      if (opts.enrichComments === false) args.push('--no-enrich-comments');
      if (opts.enrichLikes === false) args.push('--no-enrich-likes');
      if (opts.likesCountOnly) args.push('--likes-count-only');
      if (opts.enrichVisitors) args.push('--enrich-visitors');
      if (opts.incremental) args.push('--incremental');
      if (fillMissing) args.push('--scope', 'topup');
      if (opts.reconcileIds) args.push('--reconcile-ids');
      if (opts.sample !== '0') args.push('--sample', opts.sample);
      if (opts.minGap) args.push('--min-gap', String(opts.minGap));
      if (opts.rlThreshold != null) args.push('--rl-threshold', String(opts.rlThreshold));
      return args;
    };

    // Pick the lightest launcher for child backups. When running the compiled
    // build (thisScript is a .js), spawn `node script` DIRECTLY — one process per
    // child. The old `npx tsx script` path forks npx→tsx→node (3 procs/child) and,
    // over hundreds of sequential children, leaks handles/memory in the parent
    // until its event loop drains and it silently exits 0 mid-batch (observed
    // dying around the ~265th child). Direct node avoids that entirely. Only fall
    // back to `npx tsx` when actually running TypeScript source in dev.
    const isCompiled = /\.[cm]?js$/.test(thisScript);
    const [childCmd, childPrefix] = isCompiled
      ? [process.execPath, [thisScript]]
      : ['npx', ['tsx', thisScript]];

    // spawn (no shell) so names with spaces/quotes are passed verbatim and
    // resolve the child's exit code (75 = rate-limit circuit, 77 = session).
    const runOne = (uin: any, name: string) => new Promise<number>((resolveP) => {
      const child = spawn(childCmd, [...childPrefix, ...buildArgs(uin, name)], { stdio: 'inherit', cwd: projRoot });
      child.on('exit', (code: number | null) => resolveP(code == null ? 0 : code));
      child.on('error', (err: any) => { logger.error(`spawn failed for ${uin}: ${err.message}`); resolveP(0); });
    });

    // Adaptive concurrency controller (AIMD): a sustained run of clean account
    // completions ramps `target` up (+1) toward maxConc; a rate-limit circuit
    // trip (child exit 75) multiplicatively halves `target` and parks dispatch
    // for a cooldown window — i.e. concurrency temporarily drops to 0, exactly
    // the user's "stopping == parallelism 0" model. The rate-limited account is
    // re-queued (backups are idempotent/resumable). Repeated backoffs with no
    // recovery, a session expiry, or low session age stop the batch for good.
    const queue = eligible.slice();
    const inFlight = new Set<Promise<void>>();
    let target = startConc;
    let active = 0;
    let cleanStreak = 0;
    let backoffs = 0;
    let cooldownUntil = 0;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const launch = (item: { uin: any; name: string; idx: number }) => {
      active++;
      const p = (async () => {
        const { uin, name, idx } = item;
        logger.info(`[${idx + 1}/${items.length}] Backing up ${uin} (${name}) [conc target=${target}, active=${active}]`);
        const code = await runOne(uin, name);
        processedCount++;
        if (code === 77) {
          stop = true; stopReason = 'session-expired';
          logger.error(`Session expired while backing up ${uin}. Pausing the batch. Re-login, then re-run backup-all to resume — progress is saved.`);
        } else if (code === 75) {
          backoffs++; cleanStreak = 0;
          const next = Math.max(1, Math.floor(target / 2));
          logger.warn(`[adaptive] rate-limited on ${uin}: concurrency ${target}→${next}, cooldown ${Math.round(cooldownMs / 1000)}s, re-queueing (backoff ${backoffs}/${MAX_BACKOFFS})`);
          target = next;
          cooldownUntil = Date.now() + cooldownMs;
          queue.push(item);
          if (backoffs >= MAX_BACKOFFS) {
            stop = true; stopReason = 'repeated-rate-limit';
            logger.error(`[adaptive] ${backoffs} rate-limit backoffs without recovery; stopping. Wait hours, then re-run backup-all to resume — progress is saved.`);
          }
        } else {
          if (code !== 0) logger.error(`Backup ${uin} exited with code ${code}`);
          cleanStreak++;
          if (cleanStreak >= RAMP_AFTER) {
            backoffs = 0; // healthy recovery resets the backoff counter
            if (target < maxConc) { target++; logger.info(`[adaptive] ${RAMP_AFTER} clean in a row → ramp up concurrency to ${target}`); }
            cleanStreak = 0;
          }
        }
      })();
      const wrapped = p.then(() => { active--; inFlight.delete(wrapped); });
      inFlight.add(wrapped);
    };

    while (!stop) {
      if (dailyLimit > 0 && processedCount >= dailyLimit) {
        stop = true; stopReason = stopReason || 'daily-limit';
        logger.info(`Daily limit reached (${dailyLimit} users). Stopping. Resume next run.`);
        break;
      }
      const sessRemaining = session.estimatedRemainingMs(dataDir);
      if (sessRemaining <= 10 * 60 * 1000) {
        stop = true; stopReason = stopReason || 'session-age';
        logger.warn(`Session expires in ~${Math.round(sessRemaining / 60000)} min. Stopping dispatch to avoid wasted requests.`);
        break;
      }
      const now = Date.now();
      const inCooldown = now < cooldownUntil;
      if (!inCooldown && active < target && queue.length > 0) {
        launch(queue.shift()!);
        await sleep(300 + Math.random() * Math.min(delay, 1200)); // stagger launches
        continue;
      }
      if (queue.length === 0 && active === 0) break; // all done
      // Cooldown, at target, or queue drained but children still in flight:
      // wait for the next slot to free up or the cooldown to elapse.
      const waitMs = inCooldown ? Math.min(cooldownUntil - now, 5000) : 5000;
      await Promise.race(inFlight.size ? [...inFlight, sleep(waitMs)] : [sleep(waitMs)]);
    }
    await Promise.all([...inFlight]); // drain in-flight children before reporting

    logger.info(`Batch complete: ${processedCount} users processed in this run` + (stopReason ? ` (stopped: ${stopReason})` : ''));
  });

// ─── convert (legacy format → viewer format) ───

program
  .command('convert')
  .description('Convert legacy backup (window.var format) to viewer-compatible JSON')
  .argument('<source>', 'Source directory (single user or batch root)')
  .argument('<output>', 'Output directory')
  .option('--filter <pattern>', 'Only convert directories matching pattern')
  .option('--batch', 'Treat source as batch root (multiple user dirs)')
  .action((source, output, opts) => {
    const sourceDir = resolve(source);
    const outputDir = resolve(output);

    if (!existsSync(sourceDir)) {
      console.error(`Source not found: ${sourceDir}`);
      process.exit(1);
    }

    if (opts.batch) {
      convertBatch(sourceDir, outputDir, { filter: opts.filter });
    } else {
      convertUser(sourceDir, outputDir);
    }
  });

program
  .command('generate-progress')
  .description('Scan user data dirs and create synthetic .progress files for converted/backed-up users')
  .argument('<root>', 'Root directory containing user dirs (e.g., ./qzone-backup)')
  .option('--overwrite', 'Overwrite existing progress files', false)
  .action((root: string, opts: { overwrite: boolean }) => {
    const rootDir = resolve(root);
    if (!existsSync(rootDir)) {
      console.error(`Root directory not found: ${rootDir}`);
      process.exit(1);
    }

    const progressDir = join(rootDir, '.progress');
    mkdirSync(progressDir, { recursive: true });

    const userDirs = readdirSync(rootDir).filter(d => {
      if (d.startsWith('.')) return false;
      const full = join(rootDir, d);
      return statSync(full).isDirectory() && existsSync(join(full, 'data'));
    });

    const MODULE_FILE_MAP: Record<string, string> = {
      messages: 'messages.json',
      blogs: 'blogs.json',
      boards: 'boards.json',
      friends: 'friends.json',
      videos: 'videos.json',
      diaries: 'diaries.json',
      favorites: 'favorites.json',
      shares: 'shares.json',
      visitors: 'visitors.json',
    };

    const ENRICHABLE_MODULES = ['messages', 'blogs', 'shares', 'videos'];

    let created = 0;
    let skipped = 0;

    for (const dir of userDirs) {
      const uinMatch = dir.match(/^(\d+)/);
      if (!uinMatch) continue;
      const uin = Number(uinMatch[1]);
      const progressFile = join(progressDir, `${uin}.json`);

      if (existsSync(progressFile) && !opts.overwrite) {
        skipped++;
        continue;
      }

      const dataDir = join(rootDir, dir, 'data');
      const store = new ProgressStore({ outputRoot: rootDir, uin, name: dir });
      store.load();

      for (const mod of Object.keys(MODULE_FILE_MAP)) {
        const filePath = join(dataDir, MODULE_FILE_MAP[mod]);
        if (!existsSync(filePath)) continue;
        try {
          const data = JSON.parse(readFileSync(filePath, 'utf8'));
          const items = Array.isArray(data) ? data : (data?.items || []);
          const count = items.length;
          if (count > 0) {
            store.setModule(mod, {
              status: STATUSES.DONE,
              fetched: count,
              totalReported: count,
              lastPage: 999,
            });

            if (ENRICHABLE_MODULES.includes(mod)) {
              const hasComments = items.some((it: any) =>
                it.custom_comments?.length > 0 || it.comments?.length > 0
              );
              const hasLikes = items.some((it: any) =>
                it.likes?.length > 0 || it.likenum > 0
              );
              store.setModule(mod, {
                enrichment: {
                  comments: hasComments ? 'done' : 'pending',
                  likes: hasLikes ? 'done' : 'pending',
                },
              });
            }
          }
        } catch { /* skip corrupt files */ }
      }

      // Handle photos (albums)
      const albumsFile = join(dataDir, 'photos', 'albums.json');
      if (existsSync(albumsFile)) {
        try {
          const albums = JSON.parse(readFileSync(albumsFile, 'utf8'));
          if (Array.isArray(albums) && albums.length > 0) {
            store.setModule('photos', { status: STATUSES.DONE });
            for (const album of albums) {
              const albumFile = join(dataDir, 'photos', `${album.id}.json`);
              if (existsSync(albumFile)) {
                try {
                  const photos = JSON.parse(readFileSync(albumFile, 'utf8'));
                  store.setAlbum(album.id, {
                    status: STATUSES.DONE,
                    fetched: Array.isArray(photos) ? photos.length : 0,
                    totalReported: album.total || (Array.isArray(photos) ? photos.length : 0),
                    lastPage: 999,
                  });
                } catch {}
              }
            }
          }
        } catch {}
      }

      store.setOverall(STATUSES.DONE);
      store.flush(true);
      created++;
      console.log(`[${created}] ${dir}: progress generated`);
    }

    console.log(`\nDone: ${created} created, ${skipped} skipped (existing)`);
  });

program
  .command('dedup-dirs')
  .description('Merge duplicate user directories (same QQ, different nicknames) using remark-first naming')
  .argument('<root>', 'Root directory containing user dirs (e.g., ./qzone-backup)')
  .option('--friends <path>', 'Path to friends.json for remark lookup')
  .option('--dry-run', 'Preview changes without executing', false)
  .action(async (root: string, opts: { friends?: string; dryRun: boolean }) => {
    const rootDir = resolve(root);
    if (!existsSync(rootDir)) {
      console.error(`Root not found: ${rootDir}`);
      process.exit(1);
    }

    // Build uin → correct name from friends.json (remark > name)
    const nameMap = new Map<string, string>();
    const friendsPaths: string[] = [];

    if (opts.friends) {
      friendsPaths.push(resolve(opts.friends));
    } else {
      // Auto-discover: scan all user dirs for friends.json
      const dirs = readdirSync(rootDir).filter(d => {
        if (d.startsWith('.')) return false;
        const fp = join(rootDir, d, 'data', 'friends.json');
        return existsSync(fp);
      });
      for (const d of dirs) {
        friendsPaths.push(join(rootDir, d, 'data', 'friends.json'));
      }
    }

    for (const fp of friendsPaths) {
      try {
        const friends = JSON.parse(readFileSync(fp, 'utf8'));
        const items = Array.isArray(friends) ? friends : (friends?.items || []);
        for (const f of items) {
          const uin = String(f.uin || f.fuin || '');
          if (!uin) continue;
          const correctName = (f.remark && f.remark.trim()) || f.name || uin;
          if (!nameMap.has(uin)) {
            nameMap.set(uin, correctName);
          } else {
            const existing = nameMap.get(uin)!;
            if (f.remark && f.remark.trim() && existing === f.name) {
              nameMap.set(uin, correctName);
            }
          }
        }
      } catch {}
    }
    console.log(`Loaded name mapping for ${nameMap.size} friends`);

    // Group directories by QQ number
    const allDirs = readdirSync(rootDir).filter(d => {
      if (d.startsWith('.')) return false;
      return statSync(join(rootDir, d)).isDirectory();
    });

    const groups = new Map<string, string[]>();
    for (const d of allDirs) {
      const m = d.match(/^(\d+)_/);
      if (!m) continue;
      const uin = m[1];
      if (!groups.has(uin)) groups.set(uin, []);
      groups.get(uin)!.push(d);
    }

    const { mergeByIds } = require('../engine/collectors/_util.js');

    const MODULE_FILES = [
      'messages.json', 'blogs.json', 'boards.json', 'friends.json',
      'videos.json', 'diaries.json', 'favorites.json', 'shares.json', 'visitors.json',
    ];
    const MODULE_NAMES: Record<string, string> = {
      'messages.json': 'messages', 'blogs.json': 'blogs', 'boards.json': 'boards',
      'friends.json': 'friends', 'videos.json': 'videos', 'diaries.json': 'diaries',
      'favorites.json': 'favorites', 'shares.json': 'shares', 'visitors.json': 'visitors',
    };

    let merged = 0;
    let renamed = 0;
    let unchanged = 0;

    for (const [uin, dirs] of groups) {
      const correctName = nameMap.get(uin) || null;
      const correctFolder = correctName ? `${uin}_${sanitizeFilename(correctName)}` : null;

      if (dirs.length === 1) {
        // Single dir — just check if rename needed
        if (correctFolder && dirs[0] !== correctFolder) {
          const src = join(rootDir, dirs[0]);
          const dst = join(rootDir, correctFolder);
          if (opts.dryRun) {
            console.log(`[rename] ${dirs[0]} → ${correctFolder}`);
          } else {
            if (!existsSync(dst)) {
              const { renameSync } = await import('node:fs');
              renameSync(src, dst);
              console.log(`[rename] ${dirs[0]} → ${correctFolder}`);
              renamed++;
            }
          }
        } else {
          unchanged++;
        }
        continue;
      }

      // Multiple dirs — merge data into target, remove others
      const targetFolder = correctFolder || dirs[0];
      const targetDir = join(rootDir, targetFolder);
      const sourceDirs = dirs.filter(d => d !== targetFolder);

      if (sourceDirs.length === 0 && dirs.includes(targetFolder)) {
        unchanged++;
        continue;
      }

      // If target folder doesn't exist yet (rename case), pick the best source to rename
      if (!existsSync(targetDir)) {
        // Pick the dir with the most data
        let bestDir = dirs[0];
        let bestSize = 0;
        for (const d of dirs) {
          const dataDir = join(rootDir, d, 'data');
          if (!existsSync(dataDir)) continue;
          let size = 0;
          try {
            for (const f of readdirSync(dataDir)) {
              try { size += statSync(join(dataDir, f)).size; } catch {}
            }
          } catch {}
          if (size > bestSize) { bestSize = size; bestDir = d; }
        }

        if (opts.dryRun) {
          console.log(`[rename] ${bestDir} → ${targetFolder}`);
        } else {
          const { renameSync } = await import('node:fs');
          renameSync(join(rootDir, bestDir), targetDir);
          console.log(`[rename] ${bestDir} → ${targetFolder}`);
        }
        // Remove bestDir from sourceDirs
        const idx = sourceDirs.indexOf(bestDir);
        if (idx >= 0) sourceDirs.splice(idx, 1);
        // Also remove from dirs that need to be merged as source
        renamed++;
      }

      // Merge each source into target
      for (const srcFolder of sourceDirs) {
        const srcDir = join(rootDir, srcFolder);
        const srcData = join(srcDir, 'data');
        const dstData = join(targetDir, 'data');

        if (!existsSync(srcData)) {
          if (opts.dryRun) {
            console.log(`[remove] ${srcFolder} (no data)`);
          } else {
            const { rmSync } = await import('node:fs');
            rmSync(srcDir, { recursive: true, force: true });
          }
          continue;
        }

        if (opts.dryRun) {
          console.log(`[merge] ${srcFolder} → ${targetFolder}`);
          continue;
        }

        mkdirSync(dstData, { recursive: true });

        // Merge JSON data files
        for (const file of MODULE_FILES) {
          const srcFile = join(srcData, file);
          const dstFile = join(dstData, file);
          if (!existsSync(srcFile)) continue;

          try {
            const srcRaw = JSON.parse(readFileSync(srcFile, 'utf8'));
            const srcItems = Array.isArray(srcRaw) ? srcRaw : (srcRaw?.items || []);
            if (srcItems.length === 0) continue;

            if (!existsSync(dstFile)) {
              writeFileSync(dstFile, readFileSync(srcFile, 'utf8'));
              continue;
            }

            const dstRaw = JSON.parse(readFileSync(dstFile, 'utf8'));
            const dstItems = Array.isArray(dstRaw) ? dstRaw : (dstRaw?.items || []);
            const modName = MODULE_NAMES[file] || file.replace('.json', '');
            const { merged: items, addedCount } = mergeByIds(dstItems, srcItems, modName, { fieldMerge: true });
            if (addedCount > 0) {
              const out = Array.isArray(dstRaw) ? items : { ...dstRaw, items };
              writeFileSync(dstFile, JSON.stringify(out, null, 2), 'utf8');
              console.log(`  ${file}: +${addedCount} from ${srcFolder}`);
            }
          } catch {}
        }

        // Merge photos
        const srcPhotos = join(srcData, 'photos');
        const dstPhotos = join(dstData, 'photos');
        if (existsSync(srcPhotos)) {
          mkdirSync(dstPhotos, { recursive: true });
          for (const pf of readdirSync(srcPhotos).filter(f => f.endsWith('.json'))) {
            const sp = join(srcPhotos, pf);
            const dp = join(dstPhotos, pf);
            if (!existsSync(dp)) {
              writeFileSync(dp, readFileSync(sp, 'utf8'));
              continue;
            }
            try {
              const srcArr = JSON.parse(readFileSync(sp, 'utf8'));
              const dstArr = JSON.parse(readFileSync(dp, 'utf8'));
              if (!Array.isArray(srcArr) || !Array.isArray(dstArr)) continue;
              const modName = pf === 'albums.json' ? 'albums' : 'photos';
              const { merged: items, addedCount } = mergeByIds(dstArr, srcArr, modName, { fieldMerge: true });
              if (addedCount > 0) {
                writeFileSync(dp, JSON.stringify(items, null, 2), 'utf8');
              }
            } catch {}
          }
        }

        // Copy media (don't overwrite existing)
        const srcMedia = join(srcDir, 'media');
        const dstMedia = join(targetDir, 'media');
        if (existsSync(srcMedia)) {
          const copyMedia = (src: string, dst: string) => {
            mkdirSync(dst, { recursive: true });
            for (const entry of readdirSync(src)) {
              const s = join(src, entry);
              const d = join(dst, entry);
              if (statSync(s).isDirectory()) {
                copyMedia(s, d);
              } else if (!existsSync(d)) {
                const { copyFileSync } = require('node:fs');
                copyFileSync(s, d);
              }
            }
          };
          copyMedia(srcMedia, dstMedia);
        }

        // Remove merged source
        const { rmSync } = await import('node:fs');
        rmSync(srcDir, { recursive: true, force: true });
        console.log(`[merged+removed] ${srcFolder} → ${targetFolder}`);
        merged++;
      }
    }

    console.log(`\nDone: ${merged} merged, ${renamed} renamed, ${unchanged} unchanged`);
  });

// ─── reconcile-ids ───
//
// Repair synthetic ids in converted-from-legacy backups (blogs/boards/albums)
// by matching each synthetic item to the live LIST and promoting the real
// QZone id, retaining the synthetic id in `legacyId`. Default is a dry-run
// report; pass --apply to write. --detect-only scans locally with no API.

program
  .command('reconcile-ids')
  .description('Detect & repair synthetic ids in converted legacy data (blogs/boards/albums) by matching live lists')
  .option('-d, --data-dir <dir>', 'Auth data directory (cookies.json)', '.')
  .option('-o, --output <dir>', 'Backup root directory containing <uin>_<name> dirs', '.')
  .option('--apply', 'Write corrected ids (default: dry-run report only)', false)
  .option('--detect-only', 'Local scan only, no API calls', false)
  .option('--modules <list>', 'Comma list of modules: blogs,boards,albums', 'blogs,boards,albums')
  .option('--filter <substr>', 'Only process user dirs whose name includes this substring')
  .option('--uin <uin>', 'Only process this single uin')
  .option('--min-gap <ms>', 'Minimum gap between API requests', '600')
  .option('--rl-threshold <n>', 'Abort after N consecutive rate-limit responses (0=never)', '3')
  .action(async (opts) => {
    const { reconcileUser, scanUserDir, ALL_MODULES } = require('../engine/reconcile.js');
    const rootDir = resolve(opts.output);
    if (!existsSync(rootDir)) {
      console.error(`Output directory not found: ${rootDir}`);
      process.exit(1);
    }
    const modules = String(opts.modules).split(',').map((s: string) => s.trim()).filter(Boolean)
      .filter((m: string) => ALL_MODULES.includes(m));
    if (modules.length === 0) {
      console.error(`No valid modules in --modules (allowed: ${ALL_MODULES.join(',')})`);
      process.exit(1);
    }

    const userDirs = readdirSync(rootDir)
      .filter((d) => /^\d+_/.test(d))
      .filter((d) => existsSync(join(rootDir, d, 'data')))
      .filter((d) => !opts.filter || d.includes(opts.filter))
      .filter((d) => !opts.uin || d.startsWith(`${opts.uin}_`) || d === String(opts.uin))
      .sort();

    const logger = makeLogger('reconcile');
    logger.info(`scanning ${userDirs.length} user dirs; modules=${modules.join(',')}; mode=${opts.detectOnly ? 'detect-only' : (opts.apply ? 'APPLY' : 'dry-run')}`);

    // Detect-only: pure local scan, no session/network.
    if (opts.detectOnly) {
      const affected: any[] = [];
      const totals: Record<string, { synthetic: number; total: number }> = {};
      for (const d of userDirs) {
        const scan = scanUserDir(join(rootDir, d), modules);
        let any = 0;
        for (const m of modules) {
          const s = scan[m] || { synthetic: 0, total: 0 };
          totals[m] = totals[m] || { synthetic: 0, total: 0 };
          totals[m].synthetic += s.synthetic; totals[m].total += s.total;
          any += s.synthetic;
        }
        if (any > 0) affected.push({ dir: d, scan });
      }
      console.log(`\nAffected user dirs: ${affected.length}/${userDirs.length}`);
      for (const m of modules) console.log(`  ${m}: ${totals[m].synthetic} synthetic / ${totals[m].total} total`);
      for (const a of affected) {
        const parts = modules.map((m) => `${m}=${(a.scan[m] || {}).synthetic || 0}`).filter((p: string) => !p.endsWith('=0'));
        console.log(`  [synthetic] ${a.dir}: ${parts.join(' ')}`);
      }
      const reportPath = join(rootDir, '_reconcile_scan.json');
      writeFileSync(reportPath, JSON.stringify({ scannedAt: new Date().toISOString(), totals, affected }, null, 2), 'utf8');
      console.log(`\nReport: ${reportPath}`);
      return;
    }

    // Live mode (dry-run match rates or apply): needs a session.
    const dataDir = resolve(opts.dataDir);
    const session = new Session({ cookiesFile: join(dataDir, 'cookies.json'), authFile: join(dataDir, 'auth.json') });
    session.load();
    if (!session.looksValid()) {
      console.error('Session expired or invalid. Please run "login" first.');
      process.exit(1);
    }
    const minGap = parseInt(opts.minGap, 10);
    const rlThreshold = parseInt(opts.rlThreshold, 10);
    const client = new QzoneClient({
      session,
      config: {
        dataDir,
        minRequestGapMs: Number.isFinite(minGap) ? minGap : 600,
        rlCircuitThreshold: Number.isFinite(rlThreshold) ? rlThreshold : 3,
      },
    });

    const reports: any[] = [];
    const sum: Record<string, { synthetic: number; changed: number; matched: number; ambiguous: number; unmatched: number }> = {};
    for (const m of modules) sum[m] = { synthetic: 0, changed: 0, matched: 0, ambiguous: 0, unmatched: 0 };
    let idx = 0;
    for (const d of userDirs) {
      idx++;
      const uin = Number((d.match(/^(\d+)_/) || [])[1] || 0);
      // Quick local pre-check: skip dirs with no synthetic ids (no API spent).
      const scan = scanUserDir(join(rootDir, d), modules);
      const hasSynthetic = modules.some((m) => (scan[m] || {}).synthetic > 0);
      if (!hasSynthetic) continue;
      logger.info(`[${idx}/${userDirs.length}] ${d} (uin=${uin})`);
      try {
        const report = await reconcileUser({ client, userDir: join(rootDir, d), targetUin: uin, modules, apply: !!opts.apply, logger });
        reports.push(report);
        for (const m of modules) {
          const r = report.modules[m]; if (!r) continue;
          sum[m].synthetic += r.synthetic || 0;
          sum[m].changed += r.changed || 0;
          sum[m].matched += r.matched || 0;
          sum[m].ambiguous += r.ambiguous || 0;
          sum[m].unmatched += r.unmatched || 0;
          if (r.synthetic > 0) {
            logger.info(`  ${m}: synthetic=${r.synthetic} changed=${r.changed ?? 0} matched=${r.matched} ambiguous=${r.ambiguous} unmatched=${r.unmatched}`);
          }
        }
      } catch (err: any) {
        if (err instanceof CircuitOpenError) {
          logger.error(`Circuit open (rate limited). Stopping. Re-run later to resume. ${err.message}`);
          break;
        }
        if (err instanceof AuthInvalidError) {
          logger.error(`Session expired. Re-login then re-run. ${err.message}`);
          break;
        }
        logger.warn(`  ${d}: ${err.message}`);
      }
    }

    console.log(`\n=== reconcile summary (${opts.apply ? 'APPLIED' : 'dry-run'}) ===`);
    for (const m of modules) {
      const s = sum[m];
      console.log(`  ${m}: synthetic=${s.synthetic} changed=${s.changed} matched=${s.matched} ambiguous=${s.ambiguous} unmatched=${s.unmatched}`);
    }
    const reportPath = join(rootDir, opts.apply ? '_reconcile_applied.json' : '_reconcile_dryrun.json');
    writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), apply: !!opts.apply, summary: sum, reports }, null, 2), 'utf8');
    console.log(`\nReport: ${reportPath}`);
  });

program
  .command('deploy-viewer')
  .description('Copy viewer dist + inline JSON data into every user dir so it works on file:// protocol')
  .argument('<root>', 'Root directory containing user dirs (e.g., ./qzone-backup)')
  .option('--filter <substr>', 'Only deploy to dirs whose name includes this substring')
  .action((root: string, opts: { filter?: string }) => {
    const rootDir = resolve(root);
    if (!existsSync(rootDir)) {
      console.error(`Root directory not found: ${rootDir}`);
      process.exit(1);
    }

    const userDirs = readdirSync(rootDir).filter(d => {
      if (d.startsWith('.')) return false;
      const full = join(rootDir, d);
      if (!statSync(full).isDirectory()) return false;
      if (!existsSync(join(full, 'data'))) return false;
      if (opts.filter && !d.includes(opts.filter)) return false;
      return true;
    });

    console.log(`Deploying viewer to ${userDirs.length} user dirs in ${rootDir}\n`);

    let ok = 0;
    let fail = 0;
    for (const dir of userDirs) {
      const userDir = join(rootDir, dir);
      try {
        embedViewer(userDir);
        ok++;
      } catch (e: any) {
        console.error(`  [ERROR] ${dir}: ${e.message}`);
        fail++;
      }
    }

    console.log(`\nDeploy complete: ${ok} ok, ${fail} failed, ${userDirs.length} total`);
  });

program
  .command('check-access')
  .description('Probe every friend\'s QZone status (accessible / no_permission / not_activated) and write a status JSON')
  .option('-d, --data-dir <dir>', 'Auth data directory', '.')
  .option('-o, --output <file>', 'Output JSON path', './access_status.json')
  .option('--delay <ms>', 'Base delay between probes (ms)', '1200')
  .option('--resume', 'Skip targets already present in the output file', false)
  .action(async (opts: { dataDir: string; output: string; delay: string; resume: boolean }) => {
    const dataDir = resolve(opts.dataDir);
    const session = new Session({ cookiesFile: join(dataDir, 'cookies.json'), authFile: join(dataDir, 'auth.json') });
    session.load();
    if (!session.looksValid()) {
      console.error('Session expired. Please run "qzone-tools login" or "qzone-tools import-cookies" first.');
      process.exit(1);
    }

    const client = new QzoneClient({ session, config: { dataDir } });
    const logger = makeLogger('check-access');
    const { getFriends } = require('../engine/api/friends.js');
    const { probeAccess } = require('../engine/api/access.js');

    logger.info('Fetching friends list...');
    const friendsJson = await getFriends({ client, targetUin: session.uin });
    const items = friendsJson?.data?.items || friendsJson?.items || [];
    const ownerUin = Number(session.uin);
    if (!items.some((f: any) => Number(f.uin || f.fuin) === ownerUin) && ownerUin) {
      items.unshift({ uin: ownerUin, name: '我', remark: '' });
    }
    logger.info(`Probing ${items.length} targets...`);

    const outFile = resolve(opts.output);
    const baseDelay = parseInt(opts.delay, 10) || 1200;

    // Load existing results for resume.
    const byUin: Record<string, any> = {};
    if (opts.resume && existsSync(outFile)) {
      try {
        const prev = JSON.parse(readFileSync(outFile, 'utf8'));
        for (const r of (prev.results || [])) byUin[String(r.uin)] = r;
        logger.info(`Resume: ${Object.keys(byUin).length} targets already probed`);
      } catch { /* ignore */ }
    }

    const stats: Record<string, number> = {};
    let n = 0;
    for (const f of items) {
      const uin = Number(f.uin || f.fuin);
      const name = f.remark || f.name || String(uin);
      n++;
      if (opts.resume && byUin[String(uin)]) {
        const s = byUin[String(uin)].status;
        stats[s] = (stats[s] || 0) + 1;
        continue;
      }
      try {
        const r = await probeAccess(client, uin);
        r.name = name;
        byUin[String(uin)] = r;
        stats[r.status] = (stats[r.status] || 0) + 1;
        logger.info(`[${n}/${items.length}] ${uin} (${name}): ${r.status}${r.code ? ` code=${r.code}` : ''}`);
      } catch (e: any) {
        if (e instanceof AuthInvalidError) {
          logger.error('Session expired mid-run. Saving partial results and stopping.');
          break;
        }
        byUin[String(uin)] = { uin, name, status: 'error', code: null, message: e.message, checkedAt: new Date().toISOString() };
        stats.error = (stats.error || 0) + 1;
      }
      // Persist incrementally so a crash/ban doesn't lose progress.
      if (n % 10 === 0) {
        writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), owner: ownerUin, results: Object.values(byUin) }, null, 2), 'utf8');
      }
      const wait = Math.round(baseDelay * (0.6 + Math.random() * 0.8));
      await new Promise((r) => setTimeout(r, wait));
    }

    writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), owner: ownerUin, results: Object.values(byUin) }, null, 2), 'utf8');
    logger.info(`\nDone. Status JSON written to ${outFile}`);
    logger.info(`Summary: ${Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  });

program
  .command('pack')
  .description('Pack each user dir into a store-mode zip (cloud-sync friendly) + generate _manifest.json for the launcher')
  .argument('<root>', 'Root directory containing user dirs (e.g., ./qzone-backup)')
  .option('-o, --out <dir>', 'Output directory for the packed zips (default: <root>_packed)')
  .option('--filter <substr>', 'Only pack dirs whose name includes this substring')
  .option('--skip-existing', 'Skip users whose zip already exists in the output dir', false)
  .option('--no-exe', 'Do not copy the launcher exe into the output dir')
  .action(async (root: string, opts: { out?: string; filter?: string; skipExisting?: boolean; exe?: boolean }) => {
    const { packArchive } = await import('./pack.js');
    const rootAbs = resolve(root);
    const out = opts.out ? resolve(opts.out) : `${rootAbs.replace(/[\\/]+$/, '')}_packed`;
    const logger = makeLogger('pack');
    const r = await packArchive({ root: rootAbs, out, filter: opts.filter, skipExisting: opts.skipExisting, exe: opts.exe, logger });
    logger.info(`Done. ${r.packed} packed, ${r.skipped} skipped, ${r.failed} failed. Output: ${out}`);
  });

program
  .command('refresh-viewer')
  .description('Re-embed index.html into already-packed zips in place (no full re-pack) after a viewer code change. Run deploy-viewer first.')
  .argument('<root>', 'Source dirs with fresh index.html (e.g., ./qzone-backup)')
  .option('-o, --out <dir>', 'Folder containing the packed zips (default: <root>_packed)')
  .option('--filter <substr>', 'Only refresh dirs whose name includes this substring')
  .option('--entry <name>', 'Entry to refresh inside each zip', 'index.html')
  .action(async (root: string, opts: { out?: string; filter?: string; entry?: string }) => {
    const { refreshArchive } = await import('./pack.js');
    const rootAbs = resolve(root);
    const out = opts.out ? resolve(opts.out) : `${rootAbs.replace(/[\\/]+$/, '')}_packed`;
    const logger = makeLogger('refresh-viewer');
    const r = await refreshArchive({ root: rootAbs, out, filter: opts.filter, entry: opts.entry, logger });
    logger.info(`Done. ${r.updated} updated, ${r.skipped} skipped, ${r.failed} failed. Output: ${out}`);
  });

program
  .command('pack-folders')
  .description('Store-mode zip every top-level folder (full contents, layout-agnostic) in parallel. No manifest. Good for legacy archives.')
  .argument('<root>', 'Root directory containing the folders to zip (e.g., ./qzone-backup)')
  .option('-o, --out <dir>', 'Output directory for the zips (default: <root>, i.e. in place)')
  .option('--filter <substr>', 'Only pack folders whose name includes this substring')
  .option('-j, --concurrency <n>', 'Number of folders to pack in parallel', (v) => parseInt(v, 10), 4)
  .option('--skip-existing', 'Skip folders whose zip already exists (resume)', false)
  .action(async (root: string, opts: { out?: string; filter?: string; concurrency?: number; skipExisting?: boolean }) => {
    const { packFoldersRaw } = await import('./pack.js');
    const rootAbs = resolve(root);
    const out = opts.out ? resolve(opts.out) : rootAbs;
    const logger = makeLogger('pack-folders');
    const r = await packFoldersRaw({ root: rootAbs, out, filter: opts.filter, concurrency: opts.concurrency, skipExisting: opts.skipExisting, logger });
    logger.info(`Done. ${r.packed} packed, ${r.skipped} skipped, ${r.failed} failed. Output: ${out}`);
  });

program
  .command('repair-album-covers')
  .description('Backfill cover_url in albums.json from on-disk cover thumbnails (media/albums/covers/{hash}.{ext})')
  .argument('<root>', 'Root directory containing user dirs')
  .option('--filter <substr>', 'Only repair dirs whose name includes this substring')
  .action((root: string, opts: { filter?: string }) => {
    const { repairAlbumCoverUrls } = require('../engine/collectors/photos.js');
    const rootDir = resolve(root);
    const userDirs = readdirSync(rootDir).filter((d) => {
      if (d.startsWith('.')) return false;
      const full = join(rootDir, d);
      if (!statSync(full).isDirectory()) return false;
      if (!existsSync(join(full, 'data', 'photos', 'albums.json'))) return false;
      if (opts.filter && !d.includes(opts.filter)) return false;
      return true;
    });
    let total = 0;
    for (const dir of userDirs) {
      const r = repairAlbumCoverUrls(join(rootDir, dir));
      if (r.fixed) {
        console.log(`  ${dir}: ${r.fixed} covers`);
        total += r.fixed;
      }
    }
    console.log(`\nDone: ${total} album covers backfilled across ${userDirs.length} dirs`);
  });

program.parse();
