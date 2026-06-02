/**
 * Write per-person sanitize provenance into a backup root. Auto-detects format:
 *   - NEW format  (folder/data/user.json): merges a `sanitize` field into user.json.
 *   - LEGACY format (folder/Common/json/user.js): writes a `_sanitize.json` sidecar.
 *
 * IMPORTANT data model: folders are named `sanitize(remark || nickname || User_<uin>)`
 * — remark by default, falling back to the nickname when there is no remark. Either
 * way the sanitizer runs at folder-creation time, so folder names are ALREADY
 * filesystem-clean. The messy *raw* strings (QQ emoji markup, leading/ideographic
 * whitespace, trailing dots) live in the QZone NICKNAME. So we DO NOT rename anything;
 * we only record, per person, the nickname's raw -> sanitized form using the SAME
 * engine sanitizer + rule list as live backups (old and new archives clean identically).
 *
 * Usage: node scripts/write-sanitize-records.mjs <backup-root>
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { sanitizeFilename, SANITIZE_RULES } = require('../engine/downloader.js');

const root = process.argv[2];
if (!root) {
  console.error('Usage: node scripts/write-sanitize-records.mjs <backup-root>');
  process.exit(1);
}
const progressDir = join(root, '.progress');

/** Returns { format, nickname, src } for a person folder, or null if unknown. */
function inspectUser(uin, userDir) {
  const dataUser = join(userDir, 'data', 'user.json');
  if (existsSync(dataUser)) {
    try {
      const j = JSON.parse(readFileSync(dataUser, 'utf8'));
      const nk = j.nickname ?? j.name ?? null;
      return { format: 'new', nickname: nk != null ? String(nk) : null, src: 'data/user.json', json: j, path: dataUser };
    } catch { /* fall through */ }
  }
  const pf = join(progressDir, `${uin}.json`);
  if (existsSync(pf)) {
    try { const j = JSON.parse(readFileSync(pf, 'utf8')); if (j && j.name != null) return { format: 'legacy', nickname: String(j.name), src: '.progress' }; } catch { /* ignore */ }
  }
  const uj = join(userDir, 'Common', 'json', 'user.js');
  if (existsSync(uj)) {
    try {
      const m = readFileSync(uj, 'utf8').match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (m) { const o = JSON.parse(m[1]); return { format: 'legacy', nickname: String(o.nickname ?? o.name ?? o.spacename ?? ''), src: 'Common/json/user.js' }; }
    } catch { /* ignore */ }
  }
  return { format: existsSync(join(userDir, 'data')) ? 'new' : 'legacy', nickname: null, src: null };
}

const entries = readdirSync(root).filter((n) => {
  if (n.startsWith('.')) return false;
  try { return statSync(join(root, n)).isDirectory(); } catch { return false; }
});

let written = 0, changed = 0, skipped = 0;
const fmt = { new: 0, legacy: 0 };
const changedList = [];

for (const folder of entries) {
  const m = folder.match(/^(\d+)_(.*)$/);
  if (!m) { skipped++; continue; }
  const uin = Number(m[1]);
  const folderSuffix = m[2];
  const userDir = join(root, folder);

  const u = inspectUser(uin, userDir);
  fmt[u.format] = (fmt[u.format] || 0) + 1;
  const nicknameRaw = u.nickname;
  const nicknameSanitized = nicknameRaw != null ? sanitizeFilename(nicknameRaw) : null;
  const nicknameChanged = nicknameRaw != null && nicknameRaw !== nicknameSanitized;

  const sanitize = {
    folder,                                 // ground truth (already clean, never renamed here)
    display_name: folderSuffix,             // cleaned name in use = sanitize(remark || nickname fallback)
    display_name_raw: null,                 // raw remark/nickname source not separately preserved in archives
    nickname_raw: nicknameRaw,              // QZone nickname as stored (often messy)
    nickname_sanitized: nicknameSanitized,  // nickname after the same engine sanitizer
    changed: nicknameChanged,
    rules: SANITIZE_RULES,
    nickname_source: u.src,
    at: new Date().toISOString(),
  };

  try {
    if (u.format === 'new' && u.json && u.path) {
      u.json.sanitize = sanitize;
      writeFileSync(u.path, JSON.stringify(u.json, null, 2), 'utf8');
    } else {
      writeFileSync(join(userDir, '_sanitize.json'), JSON.stringify({ uin, ...sanitize }, null, 2), 'utf8');
    }
    written++;
  } catch (e) { console.log('WRITE-FAIL', folder, e.message); }
  if (nicknameChanged) { changed++; changedList.push({ uin, raw: nicknameRaw, sanitized: nicknameSanitized }); }
}

console.log(`folders=${entries.length} records=${written} (new=${fmt.new || 0} legacy=${fmt.legacy || 0}) skipped(non-person)=${skipped} nicknamesCleaned=${changed} (NO folders renamed)`);
if (changedList.length) {
  console.log('Nicknames cleaned (record-only; folder names use 备注 and are untouched):');
  for (const c of changedList) console.log(`  ${c.uin}: ${JSON.stringify(c.raw)} -> ${JSON.stringify(c.sanitized)}`);
}
