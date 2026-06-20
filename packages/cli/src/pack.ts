/**
 * Pack each user directory into a single store-mode (uncompressed) zip so the
 * archive becomes a handful of large files instead of tens of thousands of tiny
 * ones (Dropbox / cloud-sync friendly). A `_manifest.json` is generated for the
 * launcher homepage.
 *
 * Store mode is intentional: media is already compressed (jpg/gif/mp4), so
 * compression wastes CPU for ~0 gain, and store mode lets the launcher stream
 * any single entry by byte offset without inflating the whole archive.
 *
 * Zipping is delegated to the bundled native 7-Zip binary (via `7zip-bin`):
 * it is ~5-20x faster than a pure-JS zipper on the tens of thousands of small
 * files a QZone backup contains, and finalizes ZIP64 archives reliably.
 */
import sevenBin from '7zip-bin';
import yazl from 'yazl';
import { spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, basename, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVEN_ZIP = sevenBin.path7za;
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Name of the built launcher executable copied alongside the packed zips.
 * The leading underscore groups it with `_manifest.json`, sorting both apart
 * from the hundreds of `<uin>_<name>.zip` user files.
 */
const LAUNCHER_EXE = '_QQ空间时光机.exe';

/**
 * Copy the freshly built launcher exe into the packed-archive folder so the
 * output is self-contained ("ready to use": double-click the exe to browse).
 * Only copies when the destination is missing or older than the build.
 */
function copyLauncherExe(out: string, log: { info: (m: string) => void; warn: (m: string) => void }): void {
  // __dirname is packages/cli/{src|dist}; the exe is built into packages/launcher/dist-exe.
  const candidates = [
    resolve(__dirname, '..', '..', 'launcher', 'dist-exe', LAUNCHER_EXE),
    resolve(__dirname, '..', '..', '..', 'launcher', 'dist-exe', LAUNCHER_EXE),
  ];
  const src = candidates.find((p) => existsSync(p));
  if (!src) {
    log.warn(`Launcher exe not found (build it via \`pnpm --filter @qzone-tools/launcher exe\`); skipping exe copy.`);
    return;
  }
  const dest = join(out, LAUNCHER_EXE);
  try {
    if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) {
      log.info(`Launcher exe already up to date in output.`);
      return;
    }
    copyFileSync(src, dest);
    log.info(`Copied launcher exe -> ${dest}`);
  } catch (e) {
    log.warn(`Failed to copy launcher exe: ${(e as Error).message}`);
  }
}

export interface PackOptions {
  root: string;
  out: string;
  filter?: string;
  skipExisting?: boolean;
  /** Copy the launcher exe into the output dir (default true). */
  exe?: boolean;
  logger?: { info: (m: string) => void; warn: (m: string) => void };
}

interface ManifestUser {
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

const COUNT_KEYS = ['messages_count', 'blogs_count', 'photos_count', 'boards_count', 'videos_count', 'friends_count', 'shares_count', 'diaries_count'];

function countJsonFile(dataDir: string, file: string): number {
  const p = join(dataDir, file);
  if (!existsSync(p)) return 0;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    if (Array.isArray(data)) return data.length;
    if (data && Array.isArray(data.items)) return data.items.length;
    return 0;
  } catch {
    return 0;
  }
}

function countPhotosFromData(dataDir: string): number {
  const p = join(dataDir, 'photos', 'albums.json');
  if (!existsSync(p)) return 0;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(data) ? data.reduce((s: number, a: { total?: number }) => s + (a.total || 0), 0) : 0;
  } catch {
    return 0;
  }
}

/** Derive module counts from data/*.json when user.json lacks *_count fields (common after --scope topup). */
function countsFromDataDir(dataDir: string): Record<string, number> {
  const raw: Record<string, number> = {
    messages: countJsonFile(dataDir, 'messages.json'),
    blogs: countJsonFile(dataDir, 'blogs.json'),
    photos: countPhotosFromData(dataDir),
    boards: countJsonFile(dataDir, 'boards.json'),
    videos: countJsonFile(dataDir, 'videos.json'),
    friends: countJsonFile(dataDir, 'friends.json'),
    shares: countJsonFile(dataDir, 'shares.json'),
    diaries: countJsonFile(dataDir, 'diaries.json'),
  };
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v > 0) counts[k] = v;
  }
  return counts;
}

/** Top-level entries to include, in archive-root-relative form. */
function topLevelEntries(userDir: string): string[] {
  const entries: string[] = [];
  if (existsSync(join(userDir, 'index.html'))) entries.push('index.html');
  if (existsSync(join(userDir, 'meta.json'))) entries.push('meta.json');
  for (const sub of ['data', 'media']) {
    const d = join(userDir, sub);
    if (existsSync(d) && statSync(d).isDirectory()) entries.push(sub);
  }
  return entries;
}

/**
 * Pack one user dir into a store-mode zip using native 7-Zip.
 * Writes to `<outZip>.part` then atomically renames, so a crash never leaves a
 * truncated zip that `--skip-existing` would later mistake for a finished one.
 * `onProgress(percent)` is invoked as 7-Zip reports progress (0-100).
 */
function packOne(userDir: string, outZip: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const entries = topLevelEntries(userDir);
    if (!entries.length) return reject(new Error('no files'));

    const part = `${outZip}.part`;
    try { if (existsSync(part)) rmSync(part, { force: true }); } catch { /* ignore */ }

    // a=add, -tzip=zip container, -mx0=store (no compression),
    // -bso0=quiet stdout, -bsp1=progress->stdout, -bb0=no per-file log, -y=assume yes.
    const args = ['a', '-tzip', '-mx0', '-bso0', '-bsp1', '-bb0', '-y', part, ...entries];
    // Plain cwd only: spawn/CreateProcess cannot use a \\?\ extended-length cwd,
    // and trailing dot/space dirs (which a normal cwd can't enter) are routed to
    // packOneJs instead, so this path always gets a spawn-safe directory.
    const child = spawn(SEVEN_ZIP, args, { cwd: userDir });

    let stderr = '';
    child.stdout.on('data', (buf: Buffer) => {
      const m = buf.toString().match(/(\d{1,3})%/g);
      if (m && onProgress) {
        const last = m[m.length - 1];
        onProgress(Math.min(100, parseInt(last, 10)));
      }
    });
    child.stderr.on('data', (buf: Buffer) => { stderr += buf.toString(); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        try { renameSync(part, outZip); resolve(); }
        catch (e) { reject(e as Error); }
      } else {
        try { if (existsSync(part)) rmSync(part, { force: true }); } catch { /* ignore */ }
        reject(new Error(`7-Zip exited with code ${code}${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`));
      }
    });
  });
}

/**
 * Pure-JS fallback for the rare directories whose name ends in a dot or space.
 * Windows can't use such a path as a spawn cwd, so 7-Zip is unusable here; we
 * instead read every file through the `\\?\` extended-length prefix (which
 * Node's fs honors) and stream it into a yazl store-mode zip. Only ever hit by
 * a handful of small users, so yazl's slowness is irrelevant.
 */
function packOneJs(userDir: string, outZip: string): Promise<void> {
  return new Promise((resolve_, reject) => {
    const lp = process.platform === 'win32' && isAbsolute(userDir) ? `\\\\?\\${resolve(userDir)}` : userDir;
    const files: { abs: string; rel: string }[] = [];
    const walk = (absDir: string, rel: string) => {
      for (const name of readdirSync(absDir)) {
        const abs = `${absDir}\\${name}`;
        const childRel = rel ? `${rel}/${name}` : name;
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs, childRel);
        else if (st.isFile()) files.push({ abs, rel: childRel });
      }
    };
    for (const e of topLevelEntries(userDir)) {
      const abs = `${lp}\\${e}`;
      if (statSync(abs).isDirectory()) walk(abs, e);
      else files.push({ abs, rel: e });
    }
    if (!files.length) return reject(new Error('no files'));

    const part = `${outZip}.part`;
    try { if (existsSync(part)) rmSync(part, { force: true }); } catch { /* ignore */ }
    const zip = new yazl.ZipFile();
    const ws = createWriteStream(part);
    ws.on('close', () => { try { renameSync(part, outZip); resolve_(); } catch (e) { reject(e as Error); } });
    ws.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(ws);
    for (const f of files) zip.addFile(f.abs, f.rel, { compress: false });
    zip.end();
  });
}

/** Pick the native (fast) packer, or the JS fallback for trailing dot/space dirs. */
function packUser(userDir: string, outZip: string, onProgress?: (pct: number) => void): Promise<void> {
  return /[ .]$/.test(basename(userDir)) ? packOneJs(userDir, outZip) : packOne(userDir, outZip, onProgress);
}

/**
 * Like packOne but zips ALL top-level entries of the folder (not just the
 * viewer's data/media subset), so it works for any layout (e.g. legacy archives
 * with Albums/Blogs/... folders). Quiet (no per-file progress) since callers run
 * many of these in parallel.
 */
function packOneRaw(userDir: string, outZip: string): Promise<void> {
  return new Promise((res, rej) => {
    const entries = readdirSync(userDir);
    if (!entries.length) return rej(new Error('empty folder'));
    const part = `${outZip}.part`;
    try { if (existsSync(part)) rmSync(part, { force: true }); } catch { /* ignore */ }
    const args = ['a', '-tzip', '-mx0', '-bso0', '-bsp0', '-bb0', '-y', part, ...entries];
    const child = spawn(SEVEN_ZIP, args, { cwd: userDir });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });
    child.on('error', rej);
    child.on('close', (code) => {
      if (code === 0) { try { renameSync(part, outZip); res(); } catch (e) { rej(e as Error); } }
      else { try { if (existsSync(part)) rmSync(part, { force: true }); } catch { /* ignore */ } rej(new Error(`7-Zip exited ${code}${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`)); }
    });
  });
}

/** Pure-JS full-folder packer for trailing dot/space dirs (spawn can't cwd into them). */
function packOneRawJs(userDir: string, outZip: string): Promise<void> {
  return new Promise((res, rej) => {
    const lp = process.platform === 'win32' && isAbsolute(userDir) ? `\\\\?\\${resolve(userDir)}` : userDir;
    const files: { abs: string; rel: string }[] = [];
    const walk = (absDir: string, rel: string) => {
      for (const name of readdirSync(absDir)) {
        const abs = `${absDir}\\${name}`;
        const childRel = rel ? `${rel}/${name}` : name;
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs, childRel);
        else if (st.isFile()) files.push({ abs, rel: childRel });
      }
    };
    walk(lp, '');
    if (!files.length) return rej(new Error('empty folder'));
    const part = `${outZip}.part`;
    try { if (existsSync(part)) rmSync(part, { force: true }); } catch { /* ignore */ }
    const zip = new yazl.ZipFile();
    const ws = createWriteStream(part);
    ws.on('close', () => { try { renameSync(part, outZip); res(); } catch (e) { rej(e as Error); } });
    ws.on('error', rej);
    zip.outputStream.on('error', rej);
    zip.outputStream.pipe(ws);
    for (const f of files) zip.addFile(f.abs, f.rel, { compress: false });
    zip.end();
  });
}

function packUserRaw(userDir: string, outZip: string): Promise<void> {
  return /[ .]$/.test(basename(userDir)) ? packOneRawJs(userDir, outZip) : packOneRaw(userDir, outZip);
}

export interface PackFoldersOptions {
  root: string;
  out: string;
  filter?: string;
  /** Number of folders to pack in parallel (default 4). */
  concurrency?: number;
  /** Skip folders whose zip already exists (for resuming). Default false. */
  skipExisting?: boolean;
  logger?: { info: (m: string) => void; warn: (m: string) => void };
}

/**
 * Store-mode zip every top-level folder (full contents) with a bounded
 * concurrency pool. Layout-agnostic: unlike `pack`, it does not assume the
 * viewer's data/media structure and writes no manifest — just one zip per folder.
 */
export async function packFoldersRaw(opts: PackFoldersOptions): Promise<{ packed: number; skipped: number; failed: number }> {
  const log = opts.logger || console;
  const { root, out } = opts;
  const concurrency = Math.max(1, opts.concurrency || 4);
  if (!existsSync(out)) mkdirSync(out, { recursive: true });

  const dirs = readdirSync(root)
    .filter((n) => {
      if (n.startsWith('.')) return false;
      if (opts.filter && !n.includes(opts.filter)) return false;
      try { return statSync(join(root, n)).isDirectory(); } catch { return false; }
    })
    .sort((a, b) => a.localeCompare(b, 'zh'));

  log.info(`Packing ${dirs.length} folders from ${root} -> ${out} (concurrency=${concurrency}, full-folder, store mode)`);
  let packed = 0, skipped = 0, failed = 0, done = 0;
  const t0 = Date.now();
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= dirs.length) break;
      const id = dirs[i];
      const userDir = join(root, id);
      const safeId = id.replace(/[ .]+$/, '') || id;
      const outZip = join(out, `${safeId}.zip`);
      done++;
      const tag = `[${done}/${dirs.length}]`;
      if (opts.skipExisting && existsSync(outZip)) { skipped++; continue; }
      try {
        await packUserRaw(userDir, outZip);
        const mb = (statSync(outZip).size / 1024 / 1024).toFixed(1);
        packed++;
        log.info(`${tag} ✓ ${safeId}  ${mb} MB  (ok=${packed} skip=${skipped} fail=${failed})`);
      } catch (e) {
        failed++;
        log.warn(`${tag} ✗ ${id}: ${(e as Error).message}  (ok=${packed} skip=${skipped} fail=${failed})`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  log.info(`Done in ${secs}s. packed=${packed} skipped=${skipped} failed=${failed}. Output: ${out}`);
  return { packed, skipped, failed };
}

function readManifestUser(userDir: string, id: string): ManifestUser {
  const { uin: idUin, suffix } = splitId(id);
  const userJson = join(userDir, 'data', 'user.json');
  const base: ManifestUser = { id, uin: idUin, name: suffix || id, remark: suffix };
  if (!existsSync(userJson)) return base;
  try {
    const j = JSON.parse(readFileSync(userJson, 'utf8'));
    const uin = Number(j.uin) || idUin;
    let counts: Record<string, number> = {};
    for (const k of COUNT_KEYS) {
      const v = j[k];
      if (typeof v === 'number' && v > 0) counts[k.replace('_count', '')] = v;
    }
    if (!Object.keys(counts).length) counts = countsFromDataDir(join(userDir, 'data'));
    // The folder suffix is the remark (备注) chosen at backup time; only treat it
    // as a distinct remark when it differs from the nickname.
    const remark = suffix && suffix !== j.nickname ? suffix : undefined;
    const avatarFile = uin ? join(userDir, 'media', 'avatars', `${uin}.jpg`) : '';
    return {
      id,
      uin,
      name: suffix || j.nickname || id,
      nickname: j.nickname,
      remark,
      avatar: avatarFile && existsSync(avatarFile) ? `media/avatars/${uin}.jpg` : undefined,
      counts: Object.keys(counts).length ? counts : undefined,
      isOwner: j.is_owner === true,
    };
  } catch {
    return base;
  }
}

interface RosterEntry {
  uin: number;
  name: string;
  nickname?: string;
  remark?: string;
  group?: string;
  /** 'accessible' | 'no_access' | 'unknown' (access snapshot at backup time). */
  access: string;
  accessCheckedAt?: string;
  /** Whether a real local backup (with content) exists for this friend. */
  hasBackup: boolean;
  counts?: Record<string, number>;
  isOwner?: boolean;
}

/**
 * Build `_roster.json`: the complete friend list (from the owner's
 * friends.json) merged with the access-status snapshot (_access_status.json)
 * and local-backup presence (the manifest). This is what lets the launcher show
 * every friend and distinguish (1) on the friend list, (2) access at backup
 * time, (3) whether content was archived locally — independent of which stub
 * dirs were cleaned up.
 */
function buildRoster(root: string, out: string, users: ManifestUser[], log: { info: (m: string) => void; warn: (m: string) => void }): void {
  // Owner's friends.json = the authoritative full roster.
  const owner = users.find((u) => u.isOwner);
  let friends: any[] = [];
  if (owner) {
    const fp = join(root, owner.id, 'data', 'friends.json');
    if (existsSync(fp)) {
      try {
        const v = JSON.parse(readFileSync(fp, 'utf8'));
        friends = Array.isArray(v) ? v : (Array.isArray(v?.items) ? v.items : []);
      } catch { log.warn('Roster: owner friends.json unparseable'); }
    }
  }
  if (!friends.length) log.warn('Roster: no owner friends.json found; roster will only list backed-up users');

  // Access snapshot recorded during backup runs.
  let access: Record<string, any> = {};
  const ap = join(root, '_access_status.json');
  if (existsSync(ap)) {
    try { access = JSON.parse(readFileSync(ap, 'utf8')).users || {}; } catch { /* ignore */ }
  }

  const mByUin = new Map<number, ManifestUser>();
  for (const u of users) if (u.uin) mByUin.set(u.uin, u);

  const roster: RosterEntry[] = [];
  const seen = new Set<number>();
  for (const f of friends) {
    const uin = Number(f.uin);
    if (!uin) continue;
    seen.add(uin);
    const m = mByUin.get(uin);
    const a = access[String(uin)];
    roster.push({
      uin,
      name: f.remark || f.name || m?.name || String(uin),
      nickname: f.name || undefined,
      remark: f.remark || undefined,
      group: f.gpname || undefined,
      access: a?.status || (m ? 'accessible' : 'unknown'),
      accessCheckedAt: a?.checkedAt,
      hasBackup: !!m,
      counts: m?.counts,
      isOwner: m?.isOwner,
    });
  }
  // Backed-up users not in the friend list (owner self, ex-friends, etc.).
  for (const m of users) {
    if (!m.uin || seen.has(m.uin)) continue;
    const a = access[String(m.uin)];
    roster.push({
      uin: m.uin,
      name: m.name,
      nickname: m.nickname,
      remark: m.remark,
      access: a?.status || 'accessible',
      accessCheckedAt: a?.checkedAt,
      hasBackup: true,
      counts: m.counts,
      isOwner: m.isOwner,
    });
  }
  roster.sort((a, b) =>
    (b.hasBackup ? 1 : 0) - (a.hasBackup ? 1 : 0) ||
    String(a.name).localeCompare(String(b.name), 'zh'));

  const withBackup = roster.filter((r) => r.hasBackup).length;
  const accessible = roster.filter((r) => r.access === 'accessible').length;
  writeFileSync(join(out, '_roster.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: roster.length,
    withBackup,
    accessible,
    users: roster,
  }, null, 2), 'utf8');
  log.info(`Roster written: ${roster.length} friends (${withBackup} with local backup, ${accessible} accessible)`);
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

  const isTTY = !!process.stdout.isTTY;
  const clearLine = () => { if (isTTY) process.stdout.write('\r' + ' '.repeat(78) + '\r'); };
  const drawBar = (prefix: string, pct: number) => {
    if (!isTTY) return;
    const width = 22;
    const filled = Math.max(0, Math.min(width, Math.round((width * pct) / 100)));
    const bar = '#'.repeat(filled) + '-'.repeat(width - filled);
    const line = `  ${prefix} [${bar}] ${String(pct).padStart(3)}%`;
    process.stdout.write('\r' + line.slice(0, 78).padEnd(78));
  };

  for (let i = 0; i < dirs.length; i++) {
    const id = dirs[i];
    const userDir = join(root, id);
    // Windows can't reliably create/stat files whose name ends in a dot/space,
    // so the zip filename (and its manifest id) drop any trailing dots/spaces.
    // We still read from the real (possibly trailing-dot) directory.
    const safeId = id.replace(/[ .]+$/, '') || id;
    const outZip = join(out, `${safeId}.zip`);
    manifest.push(readManifestUser(userDir, safeId));
    const tag = `[${i + 1}/${dirs.length}]`;

    if (opts.skipExisting && existsSync(outZip)) {
      skipped++;
      if (isTTY) process.stdout.write('\r' + `  ${tag} skipping already-packed… (${skipped})`.slice(0, 78).padEnd(78));
      continue;
    }
    const name = id.length > 28 ? id.slice(0, 27) + '…' : id;
    try {
      drawBar(`${tag} ${name}`, 0);
      await packUser(userDir, outZip, (pct) => drawBar(`${tag} ${name}`, pct));
      const mb = (statSync(outZip).size / 1024 / 1024).toFixed(1);
      packed++;
      clearLine();
      log.info(`${tag} ✓ ${id}  ${mb} MB   (packed=${packed} skipped=${skipped} failed=${failed})`);
    } catch (e) {
      failed++;
      clearLine();
      log.warn(`${tag} ✗ ${id} FAILED: ${(e as Error).message}   (packed=${packed} skipped=${skipped} failed=${failed})`);
    }
  }
  clearLine();

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

  // Roster: full friend list + access snapshot + local-backup flag.
  try { buildRoster(root, out, allUsers, log); }
  catch (e) { log.warn(`Roster build failed: ${(e as Error).message}`); }

  if (opts.exe !== false) copyLauncherExe(out, log);
  return { packed, skipped, failed };
}

export interface RefreshOptions {
  /** Source dirs holding freshly-generated index.html (run deploy-viewer first). */
  root: string;
  /** Folder containing the packed <id>.zip files to patch in place. */
  out: string;
  filter?: string;
  /** Entry to refresh inside each zip (default index.html). */
  entry?: string;
  logger?: { info: (m: string) => void; warn: (m: string) => void };
}

/** Read a possibly trailing-dot/space file via the Windows extended-length prefix. */
function readFileLong(filePath: string): Buffer {
  if (process.platform === 'win32' && isAbsolute(filePath) && /[ .]$/.test(basename(filePath))) {
    return readFileSync(`\\\\?\\${resolve(filePath)}`);
  }
  return readFileSync(filePath);
}

/**
 * Re-embed a single entry (default `index.html`) into every already-packed zip
 * WITHOUT re-packing the whole archive. Store mode lets us swap one file by
 * appending it and rewriting only the central directory, so a viewer code fix
 * propagates to a multi-GB archive in milliseconds instead of minutes.
 */
export async function refreshArchive(opts: RefreshOptions): Promise<{ updated: number; skipped: number; failed: number }> {
  const log = opts.logger || console;
  const { root, out } = opts;
  const entry = opts.entry || 'index.html';
  const { replaceZipEntry } = await import('./zippatch.js');

  const dirs = readdirSync(root)
    .filter((n) => {
      if (n.startsWith('.')) return false;
      if (opts.filter && !n.includes(opts.filter)) return false;
      try { return statSync(join(root, n)).isDirectory(); }
      catch { return false; }
    })
    .sort((a, b) => a.localeCompare(b, 'zh'));

  log.info(`Refreshing "${entry}" in zips under ${out} from ${dirs.length} source dirs in ${root}`);
  let updated = 0, skipped = 0, failed = 0;
  const isTTY = !!process.stdout.isTTY;

  for (let i = 0; i < dirs.length; i++) {
    const id = dirs[i];
    const userDir = join(root, id);
    const safeId = id.replace(/[ .]+$/, '') || id;
    const zip = join(out, `${safeId}.zip`);
    const tag = `[${i + 1}/${dirs.length}]`;

    if (!existsSync(zip)) { skipped++; continue; }
    let content: Buffer;
    try {
      const srcPath = join(userDir, entry);
      content = (process.platform === 'win32' && /[ .]$/.test(id))
        ? readFileLong(srcPath)
        : (existsSync(srcPath) ? readFileSync(srcPath) : (() => { throw new Error('source entry missing'); })());
    } catch (e) {
      skipped++;
      continue;
    }
    try {
      replaceZipEntry(zip, entry, content);
      updated++;
      if (isTTY) process.stdout.write('\r' + `  ${tag} ✓ ${safeId}`.slice(0, 78).padEnd(78));
    } catch (e) {
      failed++;
      if (isTTY) process.stdout.write('\r' + ' '.repeat(78) + '\r');
      log.warn(`${tag} ✗ ${safeId} FAILED: ${(e as Error).message}`);
    }
  }
  if (isTTY) process.stdout.write('\r' + ' '.repeat(78) + '\r');
  log.info(`Refresh done. updated=${updated} skipped=${skipped} failed=${failed}`);
  return { updated, skipped, failed };
}

export { basename };
