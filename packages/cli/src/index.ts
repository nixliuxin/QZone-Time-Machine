#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { resolve, join, basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { convertUser, convertBatch, embedViewer, downloadAllEmojis } from './convert.js';

const require = createRequire(import.meta.url);

const { Session } = require('../engine/session.js');
const { login } = require('../engine/qr-login.js');
const { QzoneClient, AuthInvalidError } = require('../engine/client.js');
const { ProgressStore } = require('../engine/progress.js');
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

    console.log(`Login successful! uin=${session.uin}`);
    console.log(`Cookies saved to: ${cookiesFile}`);
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
  .option('--enrich-comments', 'Fetch full comment threads')
  .option('--enrich-likes', 'Fetch like details')
  .option('--sample <pages>', 'Sample mode: limit pages per module', '0')
  .option('--inline-concurrency <n>', 'Concurrent inline resource downloads', '6')
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

    const client = new QzoneClient({ session });
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

    const runModule = async (label: string, fn: () => Promise<any>) => {
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
        collectMessages({ client, targetUin, outputRoot: userDir, progress, logger, pageLimit: samplePages })
      );
      counts.messages = m.fetched;
      if (m.fetched > 0) await inlineNow('messages');

      // 3) Blogs
      const b = await runModule('blogs', () =>
        collectBlogs({ client, targetUin, outputRoot: userDir, progress, logger, pageLimit: samplePages })
      );
      counts.blogs = b.fetched;
      if (b.fetched > 0) await inlineNow('blogs');

      // 4) Boards
      const bo = await runModule('boards', () =>
        collectBoards({ client, targetUin, outputRoot: userDir, progress, logger, pageLimit: samplePages })
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
        collectShares({ client, targetUin, outputRoot: userDir, progress, logger })
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
      if (opts.enrichComments) {
        logger.info('--- enrich.comments ---');
        if (m.items?.length) {
          await enrichers.enrichMessageComments({ client, targetUin, items: m.items, logger });
          writeData(join(userDir, 'data', 'messages.json'), m.items);
        }
        if (b.items?.length) {
          await enrichers.enrichBlogComments({ client, targetUin, items: b.items, logger });
          writeData(join(userDir, 'data', 'blogs.json'), b.items);
        }
      }

      if (opts.enrichLikes) {
        logger.info('--- enrich.likes ---');
        if (m.items?.length) {
          await enrichers.enrichLikes({
            client, items: m.items,
            buildKey: (it: any) => buildUniKey('mood', targetUin, it.tid),
            label: 'messages', logger,
          });
          writeData(join(userDir, 'data', 'messages.json'), m.items);
        }
        if (b.items?.length) {
          await enrichers.enrichLikes({
            client, items: b.items,
            buildKey: (it: any) => buildUniKey('blog', targetUin, it.blogId || it.blogid),
            label: 'blogs', logger,
          });
          writeData(join(userDir, 'data', 'blogs.json'), b.items);
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

      // 18) Embed viewer (unless --no-convert)
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
  .option('--delay <ms>', 'Delay between users (ms)', '15000')
  .option('--no-download', 'Skip media downloads')
  .option('--no-convert', 'Skip conversion to viewer format')
  .option('--sample <pages>', 'Sample mode: limit pages per module', '0')
  .action(async (opts) => {
    const dataDir = resolve(opts.dataDir);
    const cookiesFile = join(dataDir, 'cookies.json');
    const authFile = join(dataDir, 'auth.json');

    const session = new Session({ cookiesFile, authFile });
    session.load();
    if (!session.looksValid()) {
      console.error('Session expired. Please run "qzone-tools login" first.');
      process.exit(1);
    }

    const client = new QzoneClient({ session });
    const logger = makeLogger('batch');
    const { getFriends } = require('../engine/api/friends.js');

    logger.info('Fetching friends list...');
    const friendsJson = await getFriends({ client, targetUin: session.uin });
    const items = friendsJson?.data?.items || friendsJson?.items || [];
    logger.info(`Found ${items.length} friends`);

    const delay = parseInt(opts.delay, 10) || 15000;

    for (let i = 0; i < items.length; i++) {
      const friend = items[i];
      const uin = friend.uin || friend.fuin;
      const name = friend.name || friend.remark || `User_${uin}`;
      logger.info(`[${i + 1}/${items.length}] Backing up ${uin} (${name})`);

      // Spawn backup as child process reusing same session
      const { execFileSync } = require('child_process');
      const thisScript = process.argv[1];
      const args = ['backup', String(uin), '-d', dataDir, '-o', opts.output, '-n', name];
      if (!opts.download) args.push('--no-download');
      if (!opts.convert) args.push('--no-convert');
      if (opts.sample !== '0') args.push('--sample', opts.sample);

      try {
        execFileSync(process.execPath, [thisScript, ...args], { stdio: 'inherit' });
      } catch (e: any) {
        logger.error(`Failed to backup ${uin}: ${e.message}`);
      }

      if (i < items.length - 1) {
        const jitter = Math.random() * delay * 0.5;
        const wait = delay + jitter;
        logger.info(`Waiting ${Math.round(wait / 1000)}s before next user...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }

    logger.info(`Batch complete: ${items.length} users processed`);
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

program.parse();
