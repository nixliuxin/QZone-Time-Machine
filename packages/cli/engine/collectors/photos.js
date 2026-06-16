/**
 * Photos/albums collector.
 *
 * Flow:
 *   1) Fetch album route (idcNum)
 *   2) Paginate album list
 *   3) For each album, paginate photo list
 *   4) Attach custom_url / custom_filename / custom_filepath to each photo
 *   5) Enqueue images to downloader
 *   6) Write data/photos/albums.json when complete
 *
 * Directory structure:
 *   media/albums/{className}/{albumName}/{idx}_{photoName}_{hash}.{ext}
 *   media/albums/covers/{coverHash}.{ext}
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { writeData, readData, sanitizeFilename, shortHash, extFromUrl, preferOriginal, ensureDir, randomSleep } =
  require('./_util.js');
const photosApi = require('../api/photos.js');
const { NoAccessError, AuthInvalidError } = require('../client.js');

const ALBUM_PAGE_SIZE = 30;
const IMAGE_PAGE_SIZE = 500;
const PAGE_SLEEP_MS = 1500;
const EMPTY_PAGE_THRESHOLD = 3;

const BUILTIN_CLASS_NAMES = {
  100: '最爱',
  101: '人物',
  102: '风景',
  103: '动物',
  104: '游记',
  105: '卡通',
  106: '生活',
  107: '其他',
};

function chooseClassName(album) {
  const builtin = BUILTIN_CLASS_NAMES[album.classid];
  if (builtin) return sanitizeFilename(builtin) || '其他';
  const name = album.className || album.classname || '其他';
  return sanitizeFilename(name) || '其他';
}

function chooseAlbumName(album) {
  return sanitizeFilename(album.name || album.title || `album_${album.id}`) || `album_${album.id}`;
}

function pickPhotoUrl(photo) {
  return preferOriginal(
    photo.raw || photo.url_l || photo.url_m || photo.url || photo.l || photo.s ||
    photo.pre || photo.custom_url || ''
  );
}

function pickPhotoFamily(photo) {
  const t = photo.phototype;
  if (t === 2) return 'gif';
  if (t === 3) return 'png';
  if (t === 4) return 'bmp';
  return 'jpg';
}

/**
 * Main entry: collect photo albums. Downloader instance provided by caller.
 */
async function collectPhotos({
  client,
  targetUin,
  outputRoot,
  progress,
  downloader,
  logger = console,
  downloadImages = true,
  albumLimit = 0,
  albumFilter = null,
  photoLimitPerAlbum = 0,
}) {
  const photosState = progress.module('photos');
  const alreadyDone = photosState.status === 'done';
  if (alreadyDone && !downloadImages) {
    logger.info(`[photos] already done and --no-download, skipping`);
    return { status: 'done', total: photosState.totalReported, fetched: photosState.fetched, items: [] };
  }
  if (alreadyDone) {
    logger.info(`[photos] already done, download-only pass (skipping list fetch)`);
  }

  // 1) idcNum
  let idcNum = 0;
  try {
    idcNum = await photosApi.getRoute({ client, targetUin });
  } catch (err) {
    if (err instanceof NoAccessError) {
      progress.finishModule('photos', 'no_access', err.message);
      return { status: 'no_access', total: 0, fetched: 0, items: [] };
    }
    if (err instanceof AuthInvalidError) throw err;
    logger.warn(`[photos] getRoute failed, using idc=0: ${err.message}`);
    idcNum = 0;
  }

  // 2) Paginate album list
  const albumOutFile = path.join(outputRoot, 'data', 'photos', 'albums.json');
  let albums = [];
  let totalAlbums = 0;
  if ((photosState.lastPage ?? -1) >= 0) {
    const r = readData(albumOutFile, logger);
    if (r.ok && Array.isArray(r.value)) {
      albums = r.value;
    }
  }

  if (alreadyDone) {
    const r = readData(albumOutFile, logger);
    if (r.ok && Array.isArray(r.value)) albums = r.value;
    totalAlbums = albums.length;
  }

  let consecutiveEmpty = 0;
  const classIdMap = new Map();
  const startPage = alreadyDone ? 99999 : ((photosState.lastPage ?? -1) + 1);

  for (let page = startPage; page < 10000; page++) {
    let json;
    try {
      json = await photosApi.getAlbums({ client, targetUin, page, pageSize: ALBUM_PAGE_SIZE, idcNum });
    } catch (err) {
      if (err instanceof NoAccessError) {
        progress.finishModule('photos', 'no_access', err.message);
        return { status: 'no_access', total: 0, fetched: 0, items: [] };
      }
      if (err instanceof AuthInvalidError) throw err;
      logger.warn(`[photos] album page ${page} error: ${err.message}`);
      break;
    }
    const data = json && json.data || {};
    const list = Array.isArray(data.albumListModeSort) ? data.albumListModeSort
      : (Array.isArray(data.albumList) ? data.albumList : []);
    if (typeof data.albumsInUser === 'number') totalAlbums = data.albumsInUser;

    if (Array.isArray(data.classList)) {
      for (const cls of data.classList) {
        if (cls.id != null && cls.name) classIdMap.set(cls.id, cls.name);
      }
    }

    if (list.length === 0) {
      consecutiveEmpty++;
      logger.info(`[photos] album page ${page} empty (${consecutiveEmpty}/${EMPTY_PAGE_THRESHOLD})`);
      if (totalAlbums && albums.length >= totalAlbums) break;
      if (consecutiveEmpty >= EMPTY_PAGE_THRESHOLD) break;
    } else {
      consecutiveEmpty = 0;
      const classMap = new Map();
      const grouped = Array.isArray(data.albumListModeClass) ? data.albumListModeClass : [];
      for (const cls of grouped) {
        const groupName = cls.className || cls.name || '';
        if (groupName && groupName !== '其他') {
          for (const a of (cls.albumList || [])) classMap.set(a.id, groupName);
        }
      }
      for (const a of list) {
        if (a.classid != null && BUILTIN_CLASS_NAMES[a.classid]) {
          a.className = BUILTIN_CLASS_NAMES[a.classid];
        } else if (classMap.has(a.id) && !a.className) {
          a.className = classMap.get(a.id);
        } else if (!a.className && a.classid != null && classIdMap.has(a.classid)) {
          a.className = classIdMap.get(a.classid);
        }
      }
      albums.push(...list);
      progress.markPageDone('photos', page, albums.length, totalAlbums);
      writeData(albumOutFile, albums);
      logger.info(`[photos] album page ${page}: +${list.length} => total ${albums.length}/${totalAlbums || '?'}`);
      if (totalAlbums && albums.length >= totalAlbums) break;
    }
    await randomSleep(PAGE_SLEEP_MS);
  }

  // 3) Fetch photo list for each album + enqueue downloads
  let totalPhotos = 0;
  let processed = 0;
  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    const _name = album.name || album.title || `album_${album.id}`;
    if (albumFilter && !albumFilter.test(_name)) continue;
    if (albumLimit > 0 && processed >= albumLimit) {
      logger.info(`[photos] reached albumLimit=${albumLimit}, stopping`);
      break;
    }
    processed++;
    const className = chooseClassName(album);
    const albumName = chooseAlbumName(album);
    const albumDir = path.join(outputRoot, 'media', 'albums', 'photos', className, albumName);
    ensureDir(albumDir);

    const albumState = progress.album(album.id);
    if (albumState.status === 'done') {
      const cached = Array.isArray(album.photoList) ? album.photoList : [];
      totalPhotos += cached.length;
      if (downloadImages) {
        cached.forEach((photo) => {
          const url = photo.custom_url || pickPhotoUrl(photo);
          if (!url || !photo.custom_filename) return;
          const family = pickPhotoFamily(photo);
          const absPath = path.join(albumDir, photo.custom_filename);
          downloader.enqueue({
            url,
            destAbs: absPath,
            expectedFamily: family === 'jpg' ? 'jpg' : family,
            tag: 'album-photo',
            meta: { albumId: album.id, albumName, picKey: photo.picKey },
          });
        });
        if (album.custom_url && album.custom_filename) {
          const coverAbs = path.join(outputRoot, 'media', 'albums', 'covers', album.custom_filename);
          downloader.enqueue({
            url: album.custom_url, destAbs: coverAbs,
            expectedFamily: 'jpg',
            tag: 'album-cover',
            meta: { albumId: album.id, albumName },
          });
        }
      }
      continue;
    }
    const photoList = Array.isArray(album.photoList) ? album.photoList.slice() : [];
    const albumStartPage = (albumState.lastPage ?? -1) + 1;
    let albumConsecutiveEmpty = 0;

    for (let p = albumStartPage; p < 10000; p++) {
      let json;
      try {
        json = await photosApi.getImages({
          client, targetUin, albumId: album.id, page: p, pageSize: IMAGE_PAGE_SIZE, idcNum,
        });
      } catch (err) {
        if (err instanceof NoAccessError) {
          progress.setAlbum(album.id, { status: 'no_access', error: err.message });
          break;
        }
        if (err instanceof AuthInvalidError) throw err;
        logger.warn(`[photos] album=${albumName} page=${p} error: ${err.message}`);
        progress.setAlbum(album.id, { status: 'error', error: err.message });
        break;
      }
      const data = json && json.data || {};
      const photos = Array.isArray(data.photoList) ? data.photoList : [];
      const totalReported = data.totalInAlbum || data.total || album.total || 0;

      if (photos.length === 0) {
        albumConsecutiveEmpty++;
        if (photoList.length >= totalReported) break;
        if (albumConsecutiveEmpty >= EMPTY_PAGE_THRESHOLD) break;
      } else {
        albumConsecutiveEmpty = 0;
        photoList.push(...photos);
        progress.setAlbum(album.id, {
          status: 'running',
          lastPage: p,
          fetched: photoList.length,
          totalReported,
        });
        if (photoList.length >= totalReported) break;
        if (photoLimitPerAlbum > 0 && photoList.length >= photoLimitPerAlbum) {
          logger.info(`[photos] album "${albumName}" reached photoLimitPerAlbum=${photoLimitPerAlbum}, stopping`);
          break;
        }
      }
      await randomSleep(PAGE_SLEEP_MS);
    }
    if (photoLimitPerAlbum > 0 && photoList.length > photoLimitPerAlbum) {
      photoList.length = photoLimitPerAlbum;
    }

    const padW = Math.max(2, String(photoList.length).length);
    photoList.forEach((photo, idx) => {
      const url = pickPhotoUrl(photo);
      const family = pickPhotoFamily(photo);
      const ext = extFromUrl(url, family === 'jpg' ? 'jpeg' : family);
      const baseName = sanitizeFilename(photo.name || photo.picKey || `photo_${idx}`);
      const hash = shortHash(photo.picKey || photo.lloc || photo.sloc || url);
      const fileName = `${String(idx + 1).padStart(padW, '0')}_${baseName}_${hash}.${ext}`;
      const relPath = path.posix.join('media', 'albums', 'photos', className, albumName, fileName);
      const absPath = path.join(albumDir, fileName);

      photo.albumId = album.id;
      photo.albumClassId = album.classid || photo.albumClassId;
      photo.albumClassName = className;
      photo.custom_url = url;
      photo.custom_filename = fileName;
      photo.custom_filepath = relPath;
      photo.custom_pre_filepath = relPath;
      photo.comments = photo.comments || [];

      if (downloadImages && url) {
        downloader.enqueue({
          url,
          destAbs: absPath,
          expectedFamily: family === 'jpg' ? 'jpg' : family,
          tag: 'album-photo',
          meta: { albumId: album.id, albumName, picKey: photo.picKey },
        });
      }
    });

    album.photoList = photoList;
    album.className = className;
    totalPhotos += photoList.length;

    if (album.url || album.pre) {
      const coverUrl = preferOriginal(album.url || album.pre);
      const coverExt = extFromUrl(coverUrl, 'jpeg');
      const coverHash = shortHash(album.id);
      const coverName = `${coverHash}.${coverExt}`;
      const coverRel = path.posix.join('media', 'albums', 'covers', coverName);
      const coverAbs = path.join(outputRoot, 'media', 'albums', 'covers', coverName);
      album.custom_url = coverUrl;
      album.custom_filename = coverName;
      album.custom_filepath = coverRel;
      if (downloadImages && coverUrl) {
        ensureDir(path.dirname(coverAbs));
        downloader.enqueue({
          url: coverUrl,
          destAbs: coverAbs,
          expectedFamily: coverExt === 'jpg' || coverExt === 'jpeg' ? 'jpg' : coverExt,
          tag: 'album-cover',
          meta: { albumId: album.id, albumName },
        });
      }
    }
    album.comments = album.comments || [];

    progress.setAlbum(album.id, {
      status: 'done',
      lastPage: 0,
      fetched: photoList.length,
      totalReported: photoList.length,
    });
    writeData(albumOutFile, albums);
    logger.info(`[photos] album ${i + 1}/${albums.length} "${albumName}": ${photoList.length} photos`);
  }

  writeData(albumOutFile, albums);
  progress.finishModule('photos', 'done');
  return { status: 'done', total: totalAlbums, fetched: totalPhotos, items: albums };
}

/**
 * Data-driven album media repair (mirrors inline-resources for non-photo media):
 * reads data/photos/albums.json and (re)downloads any album cover / photo whose
 * local file is missing. Fully idempotent — the Downloader skips files that
 * already exist and pass validation, so nothing is re-fetched or re-downloaded.
 * Consumes NO list/data APIs; only media CDN fetches for genuinely missing files.
 * Reachable in --fill-missing (where the photos collector is skipped) and on any
 * re-run regardless of the photos module's "done" status.
 */
async function repairAlbumPhotoFiles({ outputRoot, downloader, logger = console }) {
  const albumOutFile = path.join(outputRoot, 'data', 'photos', 'albums.json');
  if (!fs.existsSync(albumOutFile)) return { enqueued: 0 };
  const r = readData(albumOutFile, logger);
  const albums = (r.ok && Array.isArray(r.value)) ? r.value : [];
  if (!albums.length) return { enqueued: 0 };

  let enq = 0;
  for (const album of albums) {
    if (album.custom_url && album.custom_filepath) {
      downloader.enqueue({
        url: album.custom_url,
        destAbs: path.join(outputRoot, album.custom_filepath),
        expectedFamily: 'jpg', tag: 'album-cover',
        meta: { albumId: album.id },
      });
      enq++;
    }
    const photoList = Array.isArray(album.photoList) ? album.photoList : [];
    for (const photo of photoList) {
      const url = photo.custom_url || pickPhotoUrl(photo);
      if (!url || !photo.custom_filepath) continue;
      const family = pickPhotoFamily(photo);
      downloader.enqueue({
        url,
        destAbs: path.join(outputRoot, photo.custom_filepath),
        expectedFamily: family === 'jpg' ? 'jpg' : family,
        tag: 'album-photo',
        meta: { albumId: album.id, picKey: photo.picKey },
      });
      enq++;
    }
  }
  logger.info(`[photos] media repair: verifying ${enq} album files (only missing ones download)`);
  await downloader.drain();
  return { enqueued: enq };
}

module.exports = { collectPhotos, repairAlbumPhotoFiles };
