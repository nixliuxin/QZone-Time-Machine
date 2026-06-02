#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { resolve, join, basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { convertUser, convertBatch, embedViewer, downloadAllEmojis } from './convert.js';

const require = createRequire(import.meta.url);

const { Session } = require('../engine/session.js');
const { login } = require('../engine/qr-login.js');
const { QzoneClient, AuthInvalidError } = require('../engine/client.js');
const { ProgressStore, STATUSES, MODULES } = require('../engine/progress.js');
const { Downloader, sanitizeFilename } = require('../engine/downloader.js');
const { collectUserInfo, updateUserCounts } = require('../engine/collectors/common.js');
const { collectMessages } = require('../engine/collectors/messages.js');
const { collectBlogs } = require('../engine/collectors/blogs.js');
const { collectBoards } = require('../engine/collectors/boards.js');
const { collectVideos } = require('../engine/collectors/videos.js');
const { collectPhotos } = require('../engine/collectors/photos.js');
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
  .option('--sample <pages>', 'Sample mode: limit pages per module', '0')
  .option('--inline-concurrency <n>', 'Concurrent inline resource downloads', '6')
  .option('--incremental', 'Only fetch new items (ID-based dedup against existing data)', false)
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

    const client = new QzoneClient({ session, config: { dataDir } });
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

    const runModule = async (label: string, fn: () => Promise<any>) => {
      const mod = progress.module(label);
      if (mod.status === 'done' && !incremental) {
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
      if (u.status === 'no_access') {
        logger.warn('No access to this user\'s QZone, aborting.');
        progress.setOverall('no_access');
        return;
      }
      const realName = u.info?.name || u.info?.nickname || name;
      progress.state.name = realName;

      // 2) Messages
      const m = await runModule('messages', () =>
        collectMessages({ client, targetUin, outputRoot: userDir, progress, logger, pageLimit: samplePages, incremental })
      );
      counts.messages = m.fetched;
      if (m.fetched > 0) await inlineNow('messages');

      // 3) Blogs
      const b = await runModule('blogs', () =>
        collectBlogs({ client, targetUin, outputRoot: userDir, progress, logger, pageLimit: samplePages, incremental })
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
        collectFriends({ client, targetUin, outputRoot: userDir, progress, logger })
      );
      counts.friends = f.fetched;

      // 7) Diaries
      const d = await runModule('diaries', () =>
        collectDiaries({ client, targetUin, outputRoot: userDir, progress, logger })
      );
      counts.diaries = d.fetched;
      if (d.fetched > 0) await inlineNow('diaries');

      // 8) Favorites
      const fav = await runModule('favorites', () =>
        collectFavorites({ client, targetUin, outputRoot: userDir, progress, logger })
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
        collectVisitors({ client, targetUin, outputRoot: userDir, progress, logger })
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
              logger.warn(`[enrich] album ${af} error: ${e.message}`);
            }
          }
        }
      }

      if (opts.enrichLikes) {
        logger.info('--- enrich.likes ---');
        const msgItemsL = m.items?.length ? m.items : loadFromDisk('messages.json');
        if (msgItemsL.length) {
          await enrichers.enrichLikes({
            client, items: msgItemsL,
            buildKey: (it: any) => buildUniKey('mood', targetUin, it.tid),
            label: 'messages', logger,
          });
          writeData(join(userDir, 'data', 'messages.json'), msgItemsL);
        }
        const blogItemsL = b.items?.length ? b.items : loadFromDisk('blogs.json');
        if (blogItemsL.length) {
          await enrichers.enrichLikes({
            client, items: blogItemsL,
            buildKey: (it: any) => buildUniKey('blog', targetUin, it.blogId || it.blogid),
            label: 'blogs', logger,
          });
          writeData(join(userDir, 'data', 'blogs.json'), blogItemsL);
        }
      }

      // Wait for photo download queue
      if (download && doPhotos) {
        logger.info('Waiting for photo download queue...');
        await downloader.drain();
        logger.info('All downloads complete');
      }

      // 13) Update user counts
      updateUserCounts({ outputRoot: userDir, counts, name: realName, uin: targetUin, logger });

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
        logger.error('Session expired. Please run "qzone-tools login" again.');
        progress.setOverall('error');
        process.exit(1);
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
  .option('--delay <ms>', 'Base delay between users (ms)', '30000')
  .option('--daily-limit <n>', 'Max users to process per run (0=unlimited)', '50')
  .option('--no-download', 'Skip media downloads')
  .option('--no-convert', 'Skip conversion to viewer format')
  .option('--no-enrich-comments', 'Skip comment enrichment (enabled by default)')
  .option('--no-enrich-likes', 'Skip like enrichment (enabled by default)')
  .option('--skip <uins>', 'Comma-separated UINs to skip')
  .option('--sample <pages>', 'Sample mode: limit pages per module', '0')
  .option('--incremental', 'Only fetch new items (ID-based dedup)', false)
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

    logger.info('Fetching friends list...');
    const friendsJson = await getFriends({ client, targetUin: session.uin });
    const items = friendsJson?.data?.items || friendsJson?.items || [];
    logger.info(`Found ${items.length} friends (skipping ${skipSet.size})`);
    if (dailyLimit > 0) {
      logger.info(`Daily limit: ${dailyLimit} users per run`);
    }

    const delay = parseInt(opts.delay, 10) || 30000;
    let processedCount = 0;

    for (let i = 0; i < items.length; i++) {
      // Check daily limit
      if (dailyLimit > 0 && processedCount >= dailyLimit) {
        logger.info(`Daily limit reached (${dailyLimit} users). Stopping. Resume next run.`);
        break;
      }

      // Re-check session age periodically
      const sessRemaining = session.estimatedRemainingMs(dataDir);
      if (sessRemaining <= 10 * 60 * 1000) {
        logger.warn(`Session expires in ~${Math.round(sessRemaining / 60000)} min. Stopping to avoid wasted requests.`);
        break;
      }

      const friend = items[i];
      const uin = friend.uin || friend.fuin;
      const name = friend.remark || friend.name || `User_${uin}`;

      if (skipSet.has(String(uin))) {
        logger.info(`[${i + 1}/${items.length}] SKIP ${uin} (${name})`);
        continue;
      }

      logger.info(`[${i + 1}/${items.length}] Backing up ${uin} (${name})`);

      const { execSync } = require('child_process');
      const thisScript = process.argv[1];
      const args = ['backup', String(uin), '-d', dataDir, '-o', opts.output, '-n', `"${name}"`];
      if (!opts.download) args.push('--no-download');
      if (!opts.convert) args.push('--no-convert');
      if (opts.enrichComments === false) args.push('--no-enrich-comments');
      if (opts.enrichLikes === false) args.push('--no-enrich-likes');
      if (opts.incremental) args.push('--incremental');
      if (opts.sample !== '0') args.push('--sample', opts.sample);

      const t0 = Date.now();
      try {
        const projRoot = resolve(fileURLToPath(import.meta.url), '../../..');
        const cmd = `npx tsx "${thisScript}" ${args.join(' ')}`;
        execSync(cmd, { stdio: 'inherit', cwd: projRoot });
      } catch (e: any) {
        logger.error(`Failed to backup ${uin}: ${e.message}`);
      }

      processedCount++;
      const elapsed = Date.now() - t0;
      if (i < items.length - 1 && elapsed > 5000) {
        // Randomized inter-user delay: base ± 50%, with extra jitter
        const jitter = delay * (0.5 + Math.random());
        const wait = Math.round(jitter);
        logger.info(`[${processedCount}/${dailyLimit || '∞'}] Waiting ${Math.round(wait / 1000)}s before next user...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }

    logger.info(`Batch complete: ${processedCount} users processed in this run`);
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
            const { merged: items, addedCount } = mergeByIds(dstItems, srcItems, modName);
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
              const { merged: items, addedCount } = mergeByIds(dstArr, srcArr, modName);
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

program.parse();
