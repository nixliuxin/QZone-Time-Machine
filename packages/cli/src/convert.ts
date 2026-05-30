#!/usr/bin/env node
/**
 * Convert legacy QZone plugin export (window.var = JSON format)
 * into the new viewer-compatible pure JSON structure.
 *
 * All media is copied into the output directory — the result is
 * a fully self-contained archive with no external dependencies.
 *
 * Output layout:
 *   {uin}_{name}/
 *     index.html + assets/   ← viewer SPA
 *     data/                  ← pure JSON
 *       user.json
 *       messages.json
 *       blogs.json
 *       boards.json
 *       friends.json
 *       videos.json
 *       favorites.json
 *       shares.json
 *       visitors.json
 *       diaries.json
 *       photos/
 *         albums.json
 *         {albumId}.json
 *     media/                 ← all images/videos local
 *       messages/
 *       albums/{albumName}/
 *       albums/covers/
 *       boards/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync, createWriteStream } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Utilities ───

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      if (!existsSync(destPath)) copyFileSync(srcPath, destPath);
    }
  }
}

function copyFlatDir(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src)) {
    const srcFile = join(src, entry);
    if (!statSync(srcFile).isFile()) continue;
    const destFile = join(dest, entry);
    if (!existsSync(destFile)) copyFileSync(srcFile, destFile);
    count++;
  }
  return count;
}

// ─── Parse legacy .js files ───

function parseLegacyJs(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  let text = readFileSync(filePath, 'utf8').trim();

  const match = text.match(/^window\.\w+\s*=\s*/);
  if (match) {
    text = text.slice(match[0].length);
  }
  if (text.endsWith(';')) text = text.slice(0, -1).trim();

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`  [warn] Failed to parse: ${filePath} (${(err as Error).message})`);
    return null;
  }
}

// ─── Album conversion ───

// QZone built-in album class IDs → display names (upstream values)
const BUILTIN_CLASS_NAMES: Record<number, string> = {
  100: '最爱',
  101: '人物',
  102: '风景',
  103: '动物',
  104: '游记',
  105: '卡通',
  106: '生活',
  107: '其他',
};

interface LegacyAlbum {
  id: string;
  name: string;
  desc?: string;
  total?: number;
  pre?: string;
  createtime?: number;
  modifytime?: number;
  priv?: number;
  classid?: number;
  className?: string;
  photoList?: LegacyPhoto[];
  [key: string]: unknown;
}

interface LegacyPhoto {
  lloc?: string;
  sloc?: string;
  url?: string;
  pre?: string;
  raw?: string;
  origin_url?: string;
  name?: string;
  desc?: string;
  uploadtime?: string;
  rawshoottime?: string;
  is_video?: boolean;
  video_info?: { video_url?: string };
  height?: number;
  width?: number;
  custom_filepath?: string;
  exif?: Record<string, string>;
  [key: string]: unknown;
}

function resolveClassName(album: LegacyAlbum): string {
  // Prefer classid mapping (more reliable) over className which may be wrong ("其他" for all)
  if (album.classid != null && BUILTIN_CLASS_NAMES[album.classid]) {
    return BUILTIN_CLASS_NAMES[album.classid];
  }
  return album.className || '其他';
}

function convertAlbums(sourceDir: string, outputDataDir: string, outputDir: string): void {
  const albumsJs = join(sourceDir, 'Albums', 'json', 'albums.js');
  const raw = parseLegacyJs(albumsJs);
  if (!raw || !Array.isArray(raw)) {
    console.log('  Albums: no data');
    return;
  }

  const albums = raw as LegacyAlbum[];
  const photosDir = join(outputDataDir, 'photos');
  mkdirSync(photosDir, { recursive: true });

  // Copy album cover thumbnails
  const coversDir = join(outputDir, 'media', 'albums', 'covers');
  copyFlatDir(join(sourceDir, 'Albums', 'images'), coversDir);

  // Copy album photo directories under photos/ level
  const albumsRoot = join(sourceDir, 'Albums');
  const mediaDirs = readdirSync(albumsRoot).filter((d) => {
    const full = join(albumsRoot, d);
    return statSync(full).isDirectory() && !['images', 'js', 'json'].includes(d);
  });
  for (const subDir of mediaDirs) {
    copyDirRecursive(join(albumsRoot, subDir), join(outputDir, 'media', 'albums', 'photos', subDir));
  }

  const albumIndex: { id: string; name: string; className: string; total?: number; cover_url?: string; createtime?: string }[] = [];

  for (const album of albums) {
    const correctClass = resolveClassName(album);
    albumIndex.push({
      id: album.id,
      name: album.name,
      className: correctClass,
      total: album.total ?? album.photoList?.length ?? 0,
      cover_url: getAlbumCoverPath(album, correctClass),
      createtime: album.createtime ? new Date(album.createtime * 1000).toISOString() : undefined,
    });

    if (album.photoList && album.photoList.length > 0) {
      const photos = album.photoList.map((p) => ({
        lloc: p.lloc,
        url: rewriteAlbumPhotoPath(p, correctClass),
        name: p.name,
        desc: p.desc,
        uploadtime: p.uploadtime,
        shoottime: p.rawshoottime,
        is_video: p.is_video || false,
        video_url: p.video_info?.video_url,
        width: p.width,
        height: p.height,
        origin_width: (p as Record<string, unknown>).origin_width as number | undefined,
        origin_height: (p as Record<string, unknown>).origin_height as number | undefined,
        custom_filename: (p as Record<string, unknown>).custom_filename as string | undefined,
        photocubage: (p as Record<string, unknown>).photocubage as number | undefined,
        poiName: (p as Record<string, unknown>).poiName as string | undefined,
        comments: (p as Record<string, unknown>).comments as unknown[] | undefined,
        exif: p.exif,
      }));
      writeFileSync(join(photosDir, `${album.id}.json`), JSON.stringify(photos, null, 2), 'utf8');
    }
  }

  writeFileSync(join(photosDir, 'albums.json'), JSON.stringify(albumIndex, null, 2), 'utf8');
  console.log(`  Albums: ${albumIndex.length} albums, ${albums.reduce((s, a) => s + (a.photoList?.length ?? 0), 0)} photos`);
}

function getAlbumCoverPath(album: LegacyAlbum & { custom_filepath?: string }, correctClass: string): string {
  if (album.custom_filepath) {
    // Fix path: replace wrong className with correct one based on classid
    return fixAlbumPath(album.custom_filepath, correctClass);
  }
  if (album.photoList && album.photoList.length > 0) {
    const firstPhoto = album.photoList[0];
    if (firstPhoto.custom_filepath) {
      return fixAlbumPath(firstPhoto.custom_filepath, correctClass);
    }
  }
  return '';
}

function fixAlbumPath(filepath: string, correctClass: string): string {
  // filepath format: "Albums/{oldClass}/{albumName}/{file}" or "Albums/images/{file}"
  const stripped = filepath.replace(/^Albums\//, '');
  const parts = stripped.split('/');

  // Cover images: "images/xxx.jpeg" → "media/albums/covers/xxx.jpeg"
  if (parts[0] === 'images') {
    return `media/albums/covers/${parts.slice(1).join('/')}`;
  }

  // Photo files: "{oldClass}/{albumName}/{file}" → "media/albums/photos/{correctClass}/{albumName}/{file}"
  if (parts.length >= 3) {
    parts[0] = correctClass;
    return `media/albums/photos/${parts.join('/')}`;
  }
  return `media/albums/photos/${stripped}`;
}

function rewriteAlbumPhotoPath(photo: LegacyPhoto, correctClass: string): string {
  if (photo.custom_filepath) {
    return fixAlbumPath(photo.custom_filepath, correctClass);
  }
  return photo.raw || photo.origin_url || photo.pre || photo.url || '';
}

// ─── Messages conversion (rewrite image paths) ───

interface LegacyMessage {
  [key: string]: unknown;
  custom_images?: LegacyMsgImage[];
  custom_videos?: { custom_filepath?: string; url?: string; [k: string]: unknown }[];
}

interface LegacyMsgImage {
  custom_filepath?: string;
  custom_pre_filepath?: string;
  url1?: string;
  url2?: string;
  url3?: string;
  [key: string]: unknown;
}

function convertMessages(sourceDir: string, outputDataDir: string, outputDir: string): void {
  const srcPath = join(sourceDir, 'Messages', 'json', 'messages.js');
  const raw = parseLegacyJs(srcPath);
  if (!raw || !Array.isArray(raw)) {
    console.log('  Messages: no data');
    return;
  }

  copyFlatDir(join(sourceDir, 'Messages', 'images'), join(outputDir, 'media', 'messages', 'images'));
  copyFlatDir(join(sourceDir, 'Messages', 'posters'), join(outputDir, 'media', 'messages', 'posters'));
  copyFlatDir(join(sourceDir, 'Messages', 'videos'), join(outputDir, 'media', 'messages', 'videos'));
  copyFlatDir(join(sourceDir, 'Messages', 'audios'), join(outputDir, 'media', 'messages', 'audios'));
  copyFlatDir(join(sourceDir, 'Messages', 'magics'), join(outputDir, 'media', 'messages', 'magics'));

  const messages = raw as LegacyMessage[];
  for (const msg of messages) {
    rewriteMediaFields(msg, 'messages');
    if (typeof msg.content === 'string') collectTextEmojis(msg.content);
    if (typeof msg.custom_content === 'string') collectTextEmojis(msg.custom_content);
  }

  writeFileSync(join(outputDataDir, 'messages.json'), JSON.stringify(messages, null, 2), 'utf8');
  console.log(`  Messages: ${messages.length} items`);
}

// ─── Boards conversion (rewrite image paths) ───

function convertBoards(sourceDir: string, outputDataDir: string, outputDir: string): void {
  const srcPath = join(sourceDir, 'Boards', 'json', 'boards.js');
  const raw = parseLegacyJs(srcPath);
  if (raw == null) {
    console.log('  Boards: no data');
    return;
  }

  copyFlatDir(join(sourceDir, 'Boards', 'images'), join(outputDir, 'media', 'boards', 'images'));
  copyFlatDir(join(sourceDir, 'Boards', 'videos'), join(outputDir, 'media', 'boards', 'videos'));
  copyFlatDir(join(sourceDir, 'Boards', 'posters'), join(outputDir, 'media', 'boards', 'posters'));

  let data: unknown = raw;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    data = (raw as Record<string, unknown>)['items'] ?? raw;
  }

  if (Array.isArray(data)) {
    for (const item of data as Record<string, unknown>[]) {
      rewriteMediaFields(item, 'boards');
      if (typeof item.custom_html === 'string' && item.custom_html) {
        item.custom_html = rewriteHtmlMediaPaths(item.custom_html, 'boards');
      }
      if (typeof item.ubbContent === 'string') collectTextEmojis(item.ubbContent);
      if (typeof item.content === 'string') collectTextEmojis(item.content);
    }
  }

  writeFileSync(join(outputDataDir, 'boards.json'), JSON.stringify(data, null, 2), 'utf8');
  const count = Array.isArray(data) ? data.length : 'object';
  console.log(`  Boards: ${count} items`);
}

// ─── Blogs/Diaries conversion (base64 custom_html + media) ───

const collectedEmojis = new Set<string>();

function rewriteHtmlMediaPaths(base64Html: string, moduleLower: string): string {
  const html = Buffer.from(base64Html, 'base64').toString('utf8');
  const rewritten = html
    .replace(/src="images\//g, `src="media/${moduleLower}/images/`)
    .replace(/src='images\//g, `src='media/${moduleLower}/images/`)
    .replace(/src="videos\//g, `src="media/${moduleLower}/videos/`)
    .replace(/src='videos\//g, `src='media/${moduleLower}/videos/`)
    .replace(/src="posters\//g, `src="media/${moduleLower}/posters/`)
    .replace(/src='posters\//g, `src='media/${moduleLower}/posters/`)
    .replace(/src="\/qzone\/em\/(e\d+\.gif)"/g, (_m, file: string) => { collectedEmojis.add(file); return `src="media/emoji/${file}"`; })
    .replace(/src='\/qzone\/em\/(e\d+\.gif)'/g, (_m, file: string) => { collectedEmojis.add(file); return `src='media/emoji/${file}'`; });
  return Buffer.from(rewritten, 'utf8').toString('base64');
}

function collectTextEmojis(text: string): void {
  const matches = text.matchAll(/\[em\](e\d+)\[\/em\]/g);
  for (const m of matches) {
    collectedEmojis.add(`${m[1]}.gif`);
  }
}

function downloadFile(url: string, dest: string): Promise<boolean> {
  return new Promise((res) => {
    const mod = url.startsWith('https') ? https : http;
    const file = createWriteStream(dest);
    mod.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        const loc = response.headers.location;
        if (loc) { downloadFile(loc, dest).then(res); return; }
        res(false); return;
      }
      if (response.statusCode !== 200) { file.close(); res(false); return; }
      response.pipe(file);
      file.on('finish', () => { file.close(); res(true); });
    }).on('error', () => { file.close(); res(false); });
  });
}

async function downloadEmojis(outputDir: string): Promise<number> {
  if (collectedEmojis.size === 0) return 0;
  const emojiDir = join(outputDir, 'media', 'emoji');
  mkdirSync(emojiDir, { recursive: true });

  let downloaded = 0;
  const CDN = 'https://qzonestyle.gtimg.cn/qzone/em/';

  const batch = [...collectedEmojis];
  const CONCURRENCY = 10;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (file) => {
      const dest = join(emojiDir, file);
      if (existsSync(dest)) return true;
      return downloadFile(`${CDN}${file}`, dest);
    }));
    downloaded += results.filter(Boolean).length;
  }
  return downloaded;
}

/**
 * Scan a userDir's JSON data for all emoji references and download them locally.
 * Works with engine-format output (custom_html is base64, content has [em] tags).
 * Also rewrites custom_html paths from /qzone/em/ to media/emoji/ in-place.
 */
export async function downloadAllEmojis(userDir: string): Promise<{ found: number; downloaded: number }> {
  const emojiSet = new Set<string>();
  const dataDir = join(userDir, 'data');

  const scanJsonFile = (filePath: string) => {
    if (!existsSync(filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      const items = Array.isArray(raw) ? raw : (raw?.items || []);
      for (const item of items) {
        if (typeof item.content === 'string') {
          for (const m of item.content.matchAll(/\[em\](e\d+)\[\/em\]/g)) emojiSet.add(`${m[1]}.gif`);
        }
        if (typeof item.custom_content === 'string') {
          for (const m of item.custom_content.matchAll(/\[em\](e\d+)\[\/em\]/g)) emojiSet.add(`${m[1]}.gif`);
        }
        if (typeof item.ubbContent === 'string') {
          for (const m of item.ubbContent.matchAll(/\[em\](e\d+)\[\/em\]/g)) emojiSet.add(`${m[1]}.gif`);
        }
        if (typeof item.custom_html === 'string' && item.custom_html) {
          let html: string;
          try { html = Buffer.from(item.custom_html, 'base64').toString('utf8'); } catch { html = item.custom_html; }
          for (const m of html.matchAll(/\/qzone\/em\/(e\d+\.gif)/g)) emojiSet.add(m[1]);
          for (const m of html.matchAll(/\[em\](e\d+)\[\/em\]/g)) emojiSet.add(`${m[1]}.gif`);
          // Rewrite paths in-place
          const rewritten = html
            .replace(/src="\/qzone\/em\/(e\d+\.gif)"/g, 'src="media/emoji/$1"')
            .replace(/src='\/qzone\/em\/(e\d+\.gif)'/g, "src='media/emoji/$1'");
          if (rewritten !== html) {
            item.custom_html = Buffer.from(rewritten, 'utf8').toString('base64');
          }
        }
        // Scan replies/comments
        const replies = item.custom_replies || item.replyList || item.replys || [];
        if (Array.isArray(replies)) {
          for (const r of replies) {
            if (typeof r.content === 'string') {
              for (const m of r.content.matchAll(/\[em\](e\d+)\[\/em\]/g)) emojiSet.add(`${m[1]}.gif`);
            }
          }
        }
      }
      // Write back if any rewrites happened
      writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
    } catch { /* skip unreadable files */ }
  };

  // Scan all known data files
  for (const file of ['messages.json', 'boards.json', 'blogs.json', 'diaries.json', 'favorites.json', 'shares.json']) {
    scanJsonFile(join(dataDir, file));
  }

  if (emojiSet.size === 0) return { found: 0, downloaded: 0 };

  // Download
  const emojiDir = join(userDir, 'media', 'emoji');
  mkdirSync(emojiDir, { recursive: true });
  const CDN = 'https://qzonestyle.gtimg.cn/qzone/em/';
  let downloaded = 0;
  const batch = [...emojiSet];
  const CONCURRENCY = 10;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (file) => {
      const dest = join(emojiDir, file);
      if (existsSync(dest)) return true;
      return downloadFile(`${CDN}${file}`, dest);
    }));
    downloaded += results.filter(Boolean).length;
  }
  return { found: emojiSet.size, downloaded };
}

function convertBlogs(sourceDir: string, outputDataDir: string, outputDir: string): void {
  const srcPath = join(sourceDir, 'Blogs', 'json', 'blogs.js');
  const raw = parseLegacyJs(srcPath);
  if (!raw || !Array.isArray(raw)) {
    console.log('  Blogs: no data');
    return;
  }

  copyFlatDir(join(sourceDir, 'Blogs', 'images'), join(outputDir, 'media', 'blogs', 'images'));
  copyFlatDir(join(sourceDir, 'Blogs', 'videos'), join(outputDir, 'media', 'blogs', 'videos'));
  copyFlatDir(join(sourceDir, 'Blogs', 'posters'), join(outputDir, 'media', 'blogs', 'posters'));

  const blogs = raw as Record<string, unknown>[];
  for (const blog of blogs) {
    rewriteMediaFields(blog, 'blogs');
    if (typeof blog.custom_html === 'string' && blog.custom_html) {
      blog.custom_html = rewriteHtmlMediaPaths(blog.custom_html, 'blogs');
    }
  }

  writeFileSync(join(outputDataDir, 'blogs.json'), JSON.stringify(blogs, null, 2), 'utf8');
  console.log(`  Blogs: ${blogs.length} items`);
}

function convertDiaries(sourceDir: string, outputDataDir: string, outputDir: string): void {
  const srcPath = join(sourceDir, 'Diaries', 'json', 'diaries.js');
  const raw = parseLegacyJs(srcPath);
  if (!raw || !Array.isArray(raw)) {
    console.log('  Diaries: no data');
    return;
  }

  copyFlatDir(join(sourceDir, 'Diaries', 'images'), join(outputDir, 'media', 'diaries', 'images'));
  copyFlatDir(join(sourceDir, 'Diaries', 'videos'), join(outputDir, 'media', 'diaries', 'videos'));
  copyFlatDir(join(sourceDir, 'Diaries', 'posters'), join(outputDir, 'media', 'diaries', 'posters'));

  const diaries = raw as Record<string, unknown>[];
  for (const d of diaries) {
    rewriteMediaFields(d, 'diaries');
    if (typeof d.custom_html === 'string' && d.custom_html) {
      d.custom_html = rewriteHtmlMediaPaths(d.custom_html, 'diaries');
    }
  }

  writeFileSync(join(outputDataDir, 'diaries.json'), JSON.stringify(diaries, null, 2), 'utf8');
  console.log(`  Diaries: ${diaries.length} items`);
}

// ─── Visitors conversion (extract items from visitorInfo object) ───

function convertVisitors(sourceDir: string, outputDataDir: string, outputDir: string): number {
  const srcPath = join(sourceDir, 'Visitors', 'json', 'visitors.js');
  const raw = parseLegacyJs(srcPath);
  if (raw == null) {
    console.log('  Visitors: no data');
    return 0;
  }

  copyFlatDir(join(sourceDir, 'Visitors', 'images'), join(outputDir, 'media', 'visitors', 'images'));

  let data: unknown = raw;
  let officialTotal = 0;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    officialTotal = (obj['total'] as number) || 0;
    if (obj['items']) {
      data = obj['items'];
    }
  }

  writeFileSync(join(outputDataDir, 'visitors.json'), JSON.stringify(data, null, 2), 'utf8');
  const count = Array.isArray(data) ? data.length : 0;
  console.log(`  Visitors: ${count} items (total: ${officialTotal})`);
  return officialTotal || count;
}

// ─── Generic module with potential inline media ───

function convertModuleWithMedia(
  sourceDir: string,
  outputDataDir: string,
  outputDir: string,
  module: string,
  jsFile: string,
  outputFile: string,
): void {
  const srcPath = join(sourceDir, module, 'json', jsFile);
  const raw = parseLegacyJs(srcPath);
  if (raw == null) {
    console.log(`  ${module}: no data`);
    return;
  }

  const modLower = module.toLowerCase();
  copyFlatDir(join(sourceDir, module, 'images'), join(outputDir, 'media', modLower, 'images'));
  copyFlatDir(join(sourceDir, module, 'videos'), join(outputDir, 'media', modLower, 'videos'));
  copyFlatDir(join(sourceDir, module, 'posters'), join(outputDir, 'media', modLower, 'posters'));
  copyFlatDir(join(sourceDir, module, 'audios'), join(outputDir, 'media', modLower, 'audios'));
  copyFlatDir(join(sourceDir, module, 'magics'), join(outputDir, 'media', modLower, 'magics'));

  let data: unknown = raw;
  if (Array.isArray(data)) {
    for (const item of data as Record<string, unknown>[]) {
      rewriteMediaFields(item, modLower);
    }
  }

  writeFileSync(join(outputDataDir, outputFile), JSON.stringify(data, null, 2), 'utf8');
  const count = Array.isArray(data) ? data.length : 'object';
  console.log(`  ${module}: ${count} items`);
}

// ─── Shared media path rewriter ───

const KEY_TO_SUBDIR: Record<string, string> = {
  custom_images: 'images',
  custom_origin_images: 'images',
  custom_magics: 'magics',
  custom_videos: 'videos',
  custom_audios: 'audios',
  custom_voices: 'audios',
};

function rewriteMediaFields(item: Record<string, unknown>, modLower: string): void {
  for (const [key, subdir] of Object.entries(KEY_TO_SUBDIR)) {
    const arr = item[key] as { custom_filepath?: string; custom_pre_filepath?: string }[] | undefined;
    if (!arr || !Array.isArray(arr)) continue;
    for (const media of arr) {
      if (media.custom_filepath && !media.custom_filepath.startsWith('media/')) {
        media.custom_filepath = `media/${modLower}/${subdir}/${basename(media.custom_filepath)}`;
      }
      if (media.custom_pre_filepath && !media.custom_pre_filepath.startsWith('media/')) {
        const preSubdir = key === 'custom_videos' ? 'posters' : subdir;
        media.custom_pre_filepath = `media/${modLower}/${preSubdir}/${basename(media.custom_pre_filepath)}`;
      }
    }
  }

  // Handle top-level custom_filepath / custom_pre_filepath (e.g., Videos module items)
  const fp = item.custom_filepath as string | undefined;
  if (fp && !fp.startsWith('media/')) {
    item.custom_filepath = `media/${modLower}/videos/${basename(fp)}`;
  }
  const pfp = item.custom_pre_filepath as string | undefined;
  if (pfp && !pfp.startsWith('media/')) {
    item.custom_pre_filepath = `media/${modLower}/posters/${basename(pfp)}`;
  }
}

// ─── Simple module converters (no media rewriting needed) ───

function convertSimpleModule(
  sourceDir: string,
  outputDataDir: string,
  module: string,
  jsFile: string,
  outputFile: string,
  varName?: string,
): void {
  const srcPath = join(sourceDir, module, 'json', jsFile);
  const raw = parseLegacyJs(srcPath);
  if (raw == null) {
    console.log(`  ${module}: no data`);
    return;
  }

  let data = raw;
  if (varName && typeof raw === 'object' && !Array.isArray(raw)) {
    data = (raw as Record<string, unknown>)[varName] ?? raw;
  }

  writeFileSync(join(outputDataDir, outputFile), JSON.stringify(data, null, 2), 'utf8');
  const count = Array.isArray(data) ? data.length : 'object';
  console.log(`  ${module}: ${count} items`);
}

// ─── Main conversion for a single user ───

export async function convertUser(sourceDir: string, outputDir: string): Promise<void> {
  collectedEmojis.clear();

  const dataDir = join(outputDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(outputDir, 'media'), { recursive: true });

  console.log(`Converting: ${basename(sourceDir)}`);
  console.log(`  Source: ${sourceDir}`);
  console.log(`  Output: ${outputDir}`);

  const folderName = basename(sourceDir);
  const uinMatch = folderName.match(/^(\d+)_(.+)$/);
  const uin = uinMatch ? Number(uinMatch[1]) : 0;
  const nickname = uinMatch ? uinMatch[2] : folderName;

  // Modules with media path rewriting
  convertMessages(sourceDir, dataDir, outputDir);
  convertBoards(sourceDir, dataDir, outputDir);
  convertAlbums(sourceDir, dataDir, outputDir);

  // Modules with potential inline media
  convertBlogs(sourceDir, dataDir, outputDir);
  convertDiaries(sourceDir, dataDir, outputDir);
  convertModuleWithMedia(sourceDir, dataDir, outputDir, 'Videos', 'videos.js', 'videos.json');
  convertModuleWithMedia(sourceDir, dataDir, outputDir, 'Favorites', 'favorites.js', 'favorites.json');
  convertModuleWithMedia(sourceDir, dataDir, outputDir, 'Shares', 'shares.js', 'shares.json');
  const visitorTotal = convertVisitors(sourceDir, dataDir, outputDir);

  // Simple modules (no local media)
  convertSimpleModule(sourceDir, dataDir, 'Friends', 'friends.js', 'friends.json');

  // Download all collected emojis locally
  if (collectedEmojis.size > 0) {
    console.log(`  Emojis: downloading ${collectedEmojis.size} files...`);
    const dlCount = await downloadEmojis(outputDir);
    console.log(`  Emojis: ${dlCount}/${collectedEmojis.size} downloaded`);
  }

  // Generate user summary (reads legacy Common/json/user.js for avatar)
  generateUserJson(dataDir, uin, nickname, sourceDir, visitorTotal);
  console.log(`  user.json: uin=${uin}, nickname=${nickname}`);

  // Write provenance metadata
  const meta = {
    source: 'convert',
    sourceDir,
    convertedAt: new Date().toISOString(),
    uin,
    nickname,
  };
  writeFileSync(join(outputDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  // Embed viewer
  embedViewer(outputDir);

  console.log('  Done!');
}

// ─── User summary JSON ───

function generateUserJson(dataDir: string, uin: number, nickname: string, sourceDir?: string, visitorTotal?: number): void {
  function countJson(file: string): number {
    const p = join(dataDir, file);
    if (!existsSync(p)) return 0;
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      if (Array.isArray(data)) return data.length;
      if (data && Array.isArray(data.items)) return data.items.length;
      return 0;
    } catch { return 0; }
  }

  function countPhotos(): number {
    const p = join(dataDir, 'photos', 'albums.json');
    if (!existsSync(p)) return 0;
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      return Array.isArray(data) ? data.reduce((s: number, a: { total?: number }) => s + (a.total || 0), 0) : 0;
    } catch { return 0; }
  }

  // Try reading legacy Common/json/user.js for avatar
  let avatar = '';
  let realNickname = nickname;
  if (sourceDir) {
    const legacyUserPath = join(sourceDir, 'Common', 'json', 'user.js');
    const legacyUser = parseLegacyJs(legacyUserPath) as Record<string, unknown> | null;
    if (legacyUser) {
      if (legacyUser.avatar) avatar = String(legacyUser.avatar);
      if (legacyUser.face) avatar = avatar || String(legacyUser.face);
      if (legacyUser.nickname) realNickname = String(legacyUser.nickname);
      if (legacyUser.name) realNickname = realNickname || String(legacyUser.name);
    }
  }

  const user: Record<string, unknown> = {
    uin,
    nickname: realNickname,
    ...(avatar ? { avatar } : {}),
    messages_count: countJson('messages.json'),
    blogs_count: countJson('blogs.json'),
    photos_count: countPhotos(),
    videos_count: countJson('videos.json'),
    boards_count: countJson('boards.json'),
    friends_count: countJson('friends.json'),
    diaries_count: countJson('diaries.json'),
    visitors_count: visitorTotal || countJson('visitors.json'),
    favorites_count: countJson('favorites.json'),
    shares_count: countJson('shares.json'),
  };

  writeFileSync(join(dataDir, 'user.json'), JSON.stringify(user, null, 2), 'utf8');
}

// ─── Embed viewer dist + inline data ───

export function embedViewer(outputDir: string): void {
  const candidates = [
    resolve(__dirname, '..', '..', 'viewer', 'dist'),
    resolve(__dirname, '..', '..', '..', 'viewer', 'dist'),
  ];
  const viewerDist = candidates.find((d) => existsSync(d));
  if (!viewerDist) {
    console.log('  Viewer: not found (run `pnpm build` in packages/viewer first)');
    return;
  }
  const entries = readdirSync(viewerDist);
  for (const f of entries) {
    const src = join(viewerDist, f);
    const dest = join(outputDir, f);
    if (statSync(src).isDirectory()) {
      copyDirRecursive(src, dest);
    } else {
      copyFileSync(src, dest);
    }
  }

  // Inject all JSON data into index.html so it works with file:// protocol
  const indexPath = join(outputDir, 'index.html');
  if (existsSync(indexPath)) {
    const dataDir = join(outputDir, 'data');
    const inlineData = buildInlineData(dataDir);
    const script = `<script>window.__QZONE_DATA__=${JSON.stringify(inlineData)};</script>`;

    let html = readFileSync(indexPath, 'utf8');

    // Note: inline <script type="module"> works fine on file:// protocol.
    // The CORS restriction only applies to external module scripts (src="...").
    // We keep type="module" because it provides automatic defer behavior.

    // Insert data script before the app script
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${script}\n</head>`);
    } else {
      html = html.replace('<body', `${script}\n<body`);
    }
    writeFileSync(indexPath, html, 'utf8');
    console.log(`  Viewer: data embedded (${Object.keys(inlineData).length} modules)`);
  }

  console.log('  Viewer: embedded');
}

function buildInlineData(dataDir: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const jsonFiles = [
    'user.json', 'messages.json', 'blogs.json', 'boards.json',
    'friends.json', 'videos.json', 'favorites.json', 'shares.json',
    'visitors.json', 'diaries.json',
  ];

  for (const file of jsonFiles) {
    const filePath = join(dataDir, file);
    if (existsSync(filePath)) {
      try {
        result[file.replace('.json', '')] = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch { /* skip corrupted */ }
    }
  }

  // Photos: albums.json + individual album files
  const photosDir = join(dataDir, 'photos');
  if (existsSync(photosDir)) {
    const albumsPath = join(photosDir, 'albums.json');
    if (existsSync(albumsPath)) {
      try {
        result['photos/albums'] = JSON.parse(readFileSync(albumsPath, 'utf8'));
      } catch { /* skip */ }
    }
    for (const f of readdirSync(photosDir)) {
      if (f === 'albums.json') continue;
      if (!f.endsWith('.json')) continue;
      const p = join(photosDir, f);
      try {
        const key = `photos/${f.replace('.json', '')}`;
        result[key] = JSON.parse(readFileSync(p, 'utf8'));
      } catch { /* skip */ }
    }
  }

  return result;
}

// ─── Batch conversion ───

export async function convertBatch(sourceRoot: string, outputRoot: string, opts: { filter?: string } = {}): Promise<void> {
  if (!existsSync(sourceRoot)) {
    console.error(`Source directory not found: ${sourceRoot}`);
    process.exit(1);
  }

  mkdirSync(outputRoot, { recursive: true });

  const entries = readdirSync(sourceRoot).filter((name) => {
    const full = join(sourceRoot, name);
    if (!statSync(full).isDirectory()) return false;
    if (name.startsWith('.')) return false;
    if (opts.filter && !name.includes(opts.filter)) return false;
    return true;
  });

  console.log(`Converting ${entries.length} users from ${sourceRoot} → ${outputRoot}\n`);

  let ok = 0;
  let fail = 0;
  for (const entry of entries) {
    try {
      await convertUser(join(sourceRoot, entry), join(outputRoot, entry));
      ok++;
    } catch (err) {
      console.error(`  [ERROR] ${entry}: ${(err as Error).message}`);
      fail++;
    }
    console.log('');
  }

  console.log(`\nBatch complete: ${ok} ok, ${fail} failed, ${entries.length} total`);
}

// ─── CLI entry ───

if (process.argv[1]?.endsWith('convert.js') || process.argv[1]?.endsWith('convert.ts')) {
  const args = process.argv.slice(2);
  const sourceRoot = args[0];
  const outputRoot = args[1];
  const filter = args[2] || undefined;

  if (!sourceRoot || !outputRoot) {
    console.error('Usage: convert <source-dir> <output-dir> [filter]');
    process.exit(1);
  }

  (async () => {
    if (filter) {
      const sourceDir = readdirSync(sourceRoot).find((n) => n.includes(filter));
      if (!sourceDir) {
        console.error(`No directory matching "${filter}" found in ${sourceRoot}`);
        process.exit(1);
      }
      await convertUser(join(sourceRoot, sourceDir), join(outputRoot, sourceDir));
    } else {
      await convertBatch(sourceRoot, outputRoot);
    }
  })();
}
