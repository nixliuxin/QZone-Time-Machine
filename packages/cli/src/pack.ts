/**
 * Pack each user directory into a single store-mode (uncompressed) zip so the
 * archive becomes a handful of large files instead of tens of thousands of tiny
 * ones (Dropbox / cloud-sync friendly). A `_manifest.json` is generated for the
 * launcher homepage.
 *
 * Store mode is intentional: media is already compressed (jpg/gif/mp4), so
 * compression wastes CPU for ~0 gain, and store mode lets the launcher stream
 * any single entry by byte offset without inflating the whole archive.
 */
import yazl from 'yazl';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

export interface PackOptions {
  root: string;
  out: string;
  filter?: string;
  skipExisting?: boolean;
  logger?: { info: (m: string) => void; warn: (m: string) => void };
}

interface ManifestUser {
  id: string;
  name: string;
  nickname?: string;
  avatar?: string;
  counts?: Record<string, number>;
  isOwner?: boolean;
}

const COUNT_KEYS = ['messages_count', 'blogs_count', 'photos_count', 'boards_count', 'videos_count', 'friends_count', 'shares_count', 'diaries_count'];

function walk(dir: string, base: string, acc: { abs: string; rel: string }[]) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, base, acc);
    else if (st.isFile()) acc.push({ abs, rel: relative(base, abs).replace(/\\/g, '/') });
  }
}

function packOne(userDir: string, outZip: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const files: { abs: string; rel: string }[] = [];
    // index.html at root
    const idx = join(userDir, 'index.html');
    if (existsSync(idx)) files.push({ abs: idx, rel: 'index.html' });
    // meta.json + data/** + media/**
    const meta = join(userDir, 'meta.json');
    if (existsSync(meta)) files.push({ abs: meta, rel: 'meta.json' });
    for (const sub of ['data', 'media']) {
      const d = join(userDir, sub);
      if (existsSync(d) && statSync(d).isDirectory()) walk(d, userDir, files);
    }
    if (!files.length) return reject(new Error('no files'));

    const zip = new yazl.ZipFile();
    const ws = createWriteStream(outZip);
    ws.on('close', () => resolve());
    ws.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(ws);
    for (const f of files) {
      // compress:false => store mode; yazl auto-emits zip64 for large entries/archives.
      zip.addFile(f.abs, f.rel, { compress: false });
    }
    zip.end();
  });
}

function readManifestUser(userDir: string, id: string): ManifestUser {
  const userJson = join(userDir, 'data', 'user.json');
  const base: ManifestUser = { id, name: id };
  if (!existsSync(userJson)) return base;
  try {
    const j = JSON.parse(readFileSync(userJson, 'utf8'));
    const counts: Record<string, number> = {};
    for (const k of COUNT_KEYS) {
      const v = j[k];
      if (typeof v === 'number' && v > 0) counts[k.replace('_count', '')] = v;
    }
    const avatarFile = j.uin ? join(userDir, 'media', 'avatars', `${j.uin}.jpg`) : '';
    return {
      id,
      name: j.name || j.nickname || id,
      nickname: j.nickname,
      avatar: avatarFile && existsSync(avatarFile) ? `media/avatars/${j.uin}.jpg` : undefined,
      counts: Object.keys(counts).length ? counts : undefined,
      isOwner: j.is_owner === true,
    };
  } catch {
    return base;
  }
}

export async function packArchive(opts: PackOptions): Promise<{ packed: number; skipped: number; failed: number }> {
  const log = opts.logger || console;
  const { root, out } = opts;
  if (!existsSync(out)) mkdirSync(out, { recursive: true });

  const dirs = readdirSync(root)
    .filter((n) => {
      if (opts.filter && !n.includes(opts.filter)) return false;
      const full = join(root, n);
      try { return statSync(full).isDirectory() && existsSync(join(full, 'index.html')); }
      catch { return false; }
    })
    .sort((a, b) => a.localeCompare(b, 'zh'));

  log.info(`Packing ${dirs.length} user dirs from ${root} -> ${out}`);
  const manifest: ManifestUser[] = [];
  let packed = 0, skipped = 0, failed = 0;

  for (let i = 0; i < dirs.length; i++) {
    const id = dirs[i];
    const userDir = join(root, id);
    const outZip = join(out, `${id}.zip`);
    manifest.push(readManifestUser(userDir, id));

    if (opts.skipExisting && existsSync(outZip)) {
      skipped++;
      continue;
    }
    try {
      await packOne(userDir, outZip);
      const mb = (statSync(outZip).size / 1024 / 1024).toFixed(1);
      packed++;
      log.info(`[${i + 1}/${dirs.length}] ${id} -> ${mb} MB`);
    } catch (e) {
      failed++;
      log.warn(`[${i + 1}/${dirs.length}] ${id} FAILED: ${(e as Error).message}`);
    }
  }

  // Merge with any existing manifest so filtered / incremental runs accumulate.
  const manifestPath = join(out, '_manifest.json');
  const merged = new Map<string, ManifestUser>();
  if (existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(readFileSync(manifestPath, 'utf8'));
      for (const u of (prev.users || [])) if (u && u.id) merged.set(u.id, u);
    } catch { /* ignore corrupt manifest */ }
  }
  for (const u of manifest) merged.set(u.id, u);
  const allUsers = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id, 'zh'));
  writeFileSync(manifestPath, JSON.stringify({ generatedAt: new Date().toISOString(), users: allUsers }, null, 2), 'utf8');
  log.info(`Manifest written: ${manifest.length} users. packed=${packed} skipped=${skipped} failed=${failed}`);
  return { packed, skipped, failed };
}

export { basename };
