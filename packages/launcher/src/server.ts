/**
 * Local HTTP server for a packed QZone archive.
 *
 * Discovers users (one `<id>.zip` per user, or loose `<id>/` dirs), serves each
 * user's self-contained `index.html` plus media streamed from the zip with HTTP
 * range support. A homepage lists everyone with avatar + counts.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { ZipSource, DirSource, type UserSource } from './source.js';
import { renderHome } from './home.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.amr': 'audio/amr', '.silk': 'application/octet-stream',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export interface UserMeta {
  id: string;
  uin?: number;
  name: string;
  nickname?: string;
  remark?: string;
  avatar?: string;
  counts?: Record<string, number>;
  isOwner?: boolean;
}

/** Folder id is `<uin>_<remark-or-nickname>`; split it into the two parts. */
function splitId(id: string): { uin?: number; suffix?: string } {
  const m = id.match(/^(\d+)_(.*)$/);
  if (!m) return {};
  return { uin: Number(m[1]), suffix: m[2] || undefined };
}

interface UserEntry {
  id: string;
  kind: 'zip' | 'dir';
  path: string;
  source?: UserSource;
}

export interface ServeOptions { root: string; port?: number; }

export interface ArchiveServer {
  server: ReturnType<typeof createServer>;
  userCount: number;
  /** When the target was a single zip, the id to open directly. */
  singleId: string | null;
}

export function createArchiveServer(target: string): ArchiveServer {
  // Target may be a directory (scan all users) or a single <id>.zip file.
  let manifestDir = target;
  let singleId: string | null = null;
  let users: UserEntry[];
  let st;
  try { st = statSync(target); } catch { st = null; }
  if (st && st.isFile() && extname(target).toLowerCase() === '.zip') {
    const id = basename(target, extname(target));
    users = [{ id, kind: 'zip', path: target }];
    manifestDir = join(target, '..');
    singleId = id;
  } else {
    users = discoverUsers(target);
  }
  const byId = new Map(users.map((u) => [u.id, u]));
  let manifest: UserMeta[] | null = loadManifest(manifestDir, users);

  async function getSource(entry: UserEntry): Promise<UserSource> {
    if (!entry.source) {
      entry.source = entry.kind === 'zip'
        ? await ZipSource.open(entry.id, entry.path)
        : new DirSource(entry.id, entry.path);
    }
    return entry.source;
  }

  async function ensureManifest(): Promise<UserMeta[]> {
    if (manifest) return manifest;
    const out: UserMeta[] = [];
    for (const u of users) {
      try {
        const src = await getSource(u);
        const r = await src.read('data/user.json');
        const { uin: idUin, suffix } = splitId(u.id);
        let meta: UserMeta = { id: u.id, uin: idUin, name: suffix || u.id, remark: suffix };
        if (r) {
          const txt = await streamToString(r.stream);
          const j = JSON.parse(txt);
          const uin = Number(j.uin) || idUin;
          const remark = suffix && suffix !== j.nickname ? suffix : undefined;
          const counts = pickCounts(j);
          meta = {
            id: u.id,
            uin,
            name: suffix || j.nickname || u.id,
            nickname: j.nickname,
            remark,
            avatar: uin ? `media/avatars/${uin}.jpg` : undefined,
            counts: Object.keys(counts).length ? counts : undefined,
            isOwner: j.is_owner === true,
          };
        }
        out.push(meta);
      } catch {
        out.push({ id: u.id, name: u.id });
      }
    }
    manifest = out;
    return out;
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const path = decodeURIComponent(url.pathname);

      if (path === '/' || path === '/index.html') {
        const list = await ensureManifest();
        return sendHtml(res, renderHome(list));
      }
      if (path === '/api/users') {
        const list = await ensureManifest();
        return sendJson(res, list);
      }

      // /u/<id>/<asset...>
      const m = path.match(/^\/u\/([^/]+)\/(.*)$/);
      if (m) {
        const id = m[1];
        let asset = m[2] || 'index.html';
        if (asset === '' || asset.endsWith('/')) asset += 'index.html';
        const entry = byId.get(id);
        if (!entry) return send404(res);
        const src = await getSource(entry);
        return await serveAsset(req, res, src, asset);
      }

      // Bare /u/<id> -> redirect to trailing slash so relative paths resolve.
      const mb = path.match(/^\/u\/([^/]+)$/);
      if (mb) { res.statusCode = 302; res.setHeader('Location', `/u/${mb[1]}/`); return res.end(); }

      return send404(res);
    } catch (err) {
      res.statusCode = 500;
      res.end(`Server error: ${(err as Error).message}`);
    }
  };

  const server = createServer(handler);
  return { server, userCount: users.length, singleId };
}

async function serveAsset(req: IncomingMessage, res: ServerResponse, src: UserSource, asset: string) {
  const total = await src.size(asset);
  if (total == null) return send404(res);
  const mime = MIME[extname(asset).toLowerCase()] || 'application/octet-stream';
  const range = parseRange(req.headers.range, total);

  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Accept-Ranges', 'bytes');

  if (range) {
    const r = await src.read(asset, range);
    if (!r) return send404(res);
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
    r.stream.on('error', () => res.destroy());
    return r.stream.pipe(res);
  }

  const r = await src.read(asset);
  if (!r) return send404(res);
  res.statusCode = 200;
  res.setHeader('Content-Length', String(total));
  r.stream.on('error', () => res.destroy());
  r.stream.pipe(res);
}

function discoverUsers(root: string): UserEntry[] {
  const out: UserEntry[] = [];
  let names: string[] = [];
  try { names = readdirSync(root); } catch { return out; }
  for (const name of names) {
    const full = join(root, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isFile() && extname(name).toLowerCase() === '.zip') {
      out.push({ id: basename(name, extname(name)), kind: 'zip', path: full });
    } else if (st.isDirectory() && existsSync(join(full, 'index.html'))) {
      out.push({ id: name, kind: 'dir', path: full });
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id, 'zh'));
  return out;
}

function loadManifest(root: string, users: UserEntry[]): UserMeta[] | null {
  const p = join(root, '_manifest.json');
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const arr: UserMeta[] = Array.isArray(j) ? j : (j.users || []);
    if (!arr.length) return null;
    // Only keep manifest entries that actually have a discoverable source.
    const ids = new Set(users.map((u) => u.id));
    const filtered = arr.filter((u) => ids.has(u.id)).map((u) => {
      // Self-heal older manifests that predate the uin/remark fields: both are
      // derivable from the folder id, so backfill them without reopening zips.
      if (u.uin && u.remark !== undefined) return u;
      const { uin, suffix } = splitId(u.id);
      const remark = suffix && suffix !== u.nickname ? suffix : undefined;
      return { ...u, uin: u.uin ?? uin, remark: u.remark ?? remark };
    });
    return filtered.length ? filtered : null;
  } catch { return null; }
}

function pickCounts(j: Record<string, unknown>): Record<string, number> {
  const keys = ['messages_count', 'blogs_count', 'photos_count', 'boards_count', 'videos_count', 'friends_count', 'shares_count', 'diaries_count'];
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = j[k];
    if (typeof v === 'number' && v > 0) out[k.replace('_count', '')] = v;
  }
  return out;
}

function parseRange(header: string | undefined, total: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : total - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
    end = Math.min(end, total - 1);
    if (start > end) return null;
  }
  return { start, end };
}

function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function sendHtml(res: ServerResponse, html: string) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}
function sendJson(res: ServerResponse, data: unknown) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
function send404(res: ServerResponse) { res.statusCode = 404; res.end('Not found'); }
