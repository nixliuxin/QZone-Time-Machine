/**
 * In-place single-entry replacement for store-mode (uncompressed) ZIP archives.
 *
 * Store mode was chosen precisely so the archive behaves like a folder: each
 * entry is raw bytes located via the central directory at the end of the file.
 * That means we can swap one file (e.g. the viewer's `index.html`) WITHOUT
 * rewriting the tens of GB of media in front of it.
 *
 * Strategy (append + rewrite trailer):
 *   1. Read the End-Of-Central-Directory (and ZIP64 variants) to find the
 *      central directory's offset/size and total entry count.
 *   2. Parse every central-directory header, copying each record's raw bytes so
 *      untouched entries are reproduced byte-for-byte.
 *   3. Append the new entry (local header + data) starting where the OLD central
 *      directory began — the media bytes before it are never touched.
 *   4. Write a fresh central directory: the target entry's header points at the
 *      newly appended copy; every other header is copied verbatim.
 *   5. Write ZIP64 EOCD + locator + EOCD, then truncate.
 *
 * Crash safety: the only bytes destroyed are the old trailer (central directory
 * + EOCD). We back them up to a small `.cdbak` sidecar first and remove it only
 * after a successful, validated write, so an interrupted run is recoverable.
 *
 * The old copy of the replaced entry is left as dead space (it is no longer
 * referenced by the central directory). For a ~350 KB index.html inside a multi-
 * GB archive this is negligible.
 */
import { closeSync, existsSync, fstatSync, ftruncateSync, openSync, readFileSync, readSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { crc32 as zlibCrc32 } from 'node:zlib';

const SIG_LFH = 0x04034b50; // local file header
const SIG_CDH = 0x02014b50; // central directory header
const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_Z64_EOCD = 0x06064b50; // zip64 end of central directory record
const SIG_Z64_LOC = 0x07064b50; // zip64 end of central directory locator
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

/** CRC-32 (IEEE) of a buffer, using Node's native impl when available. */
function crc32(buf: Buffer): number {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function readAt(fd: number, offset: number, length: number): Buffer {
  const buf = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const n = readSync(fd, buf, read, length - read, offset + read);
    if (n <= 0) break;
    read += n;
  }
  return read === length ? buf : buf.subarray(0, read);
}

interface CdhRecord {
  name: string;
  raw: Buffer; // full central-directory header bytes (fixed + name + extra + comment)
  localOffset: number;
}

interface Eocd {
  cdOffset: number;
  cdSize: number;
  totalEntries: number;
}

/** Locate and parse the EOCD, following ZIP64 records when present. */
function readEocd(fd: number, fileSize: number): Eocd {
  const tailLen = Math.min(fileSize, 0x10000 + 22); // max comment (64KB) + EOCD
  const tail = readAt(fd, fileSize - tailLen, tailLen);
  let eocdRel = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) { eocdRel = i; break; }
  }
  if (eocdRel < 0) throw new Error('EOCD signature not found (not a zip?)');

  let totalEntries = tail.readUInt16LE(eocdRel + 10);
  let cdSize = tail.readUInt32LE(eocdRel + 12);
  let cdOffset = tail.readUInt32LE(eocdRel + 16);

  const needsZip64 = totalEntries === U16_MAX || cdSize === U32_MAX || cdOffset === U32_MAX;
  if (needsZip64) {
    const eocdAbs = fileSize - tailLen + eocdRel;
    const locAbs = eocdAbs - 20;
    if (locAbs < 0) throw new Error('ZIP64 locator missing');
    const loc = readAt(fd, locAbs, 20);
    if (loc.readUInt32LE(0) !== SIG_Z64_LOC) throw new Error('ZIP64 locator signature mismatch');
    const z64Off = Number(loc.readBigUInt64LE(8));
    const z64 = readAt(fd, z64Off, 56);
    if (z64.readUInt32LE(0) !== SIG_Z64_EOCD) throw new Error('ZIP64 EOCD signature mismatch');
    totalEntries = Number(z64.readBigUInt64LE(32));
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }
  return { cdOffset, cdSize, totalEntries };
}

/** Read the ZIP64 local-header offset out of a CDH's extra field, if present. */
function cdhLocalOffset(cdh: Buffer): number {
  const off32 = cdh.readUInt32LE(42);
  const compSize = cdh.readUInt32LE(20);
  const uncompSize = cdh.readUInt32LE(24);
  const diskStart = cdh.readUInt16LE(34);
  if (off32 !== U32_MAX) return off32;
  // Walk extra fields for the ZIP64 (0x0001) block; offset is the 3rd 8-byte
  // value, present only after the size fields that were themselves 0xFFFFFFFF.
  const fnameLen = cdh.readUInt16LE(28);
  const extraLen = cdh.readUInt16LE(30);
  let p = 46 + fnameLen;
  const extraEnd = p + extraLen;
  while (p + 4 <= extraEnd) {
    const id = cdh.readUInt16LE(p);
    const size = cdh.readUInt16LE(p + 2);
    let q = p + 4;
    if (id === 0x0001) {
      if (uncompSize === U32_MAX) q += 8;
      if (compSize === U32_MAX) q += 8;
      if (q + 8 <= extraEnd) return Number(cdh.readBigUInt64LE(q));
      if (diskStart === U16_MAX) { /* offset absent but disk present: unsupported */ }
    }
    p += 4 + size;
  }
  return off32;
}

function parseCentralDirectory(cd: Buffer): CdhRecord[] {
  const records: CdhRecord[] = [];
  let p = 0;
  while (p + 46 <= cd.length) {
    if (cd.readUInt32LE(p) !== SIG_CDH) break;
    const fnameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const total = 46 + fnameLen + extraLen + commentLen;
    const raw = cd.subarray(p, p + total);
    const name = raw.toString('utf8', 46, 46 + fnameLen);
    records.push({ name, raw: Buffer.from(raw), localOffset: cdhLocalOffset(raw) });
    p += total;
  }
  return records;
}

/** Build a local file header (store mode, no data descriptor, no extra). */
function buildLfh(nameBuf: Buffer, content: Buffer, crc: number, dosTime: number, dosDate: number): Buffer {
  const h = Buffer.allocUnsafe(30 + nameBuf.length);
  h.writeUInt32LE(SIG_LFH, 0);
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(0, 6); // flags
  h.writeUInt16LE(0, 8); // method = store
  h.writeUInt16LE(dosTime, 10);
  h.writeUInt16LE(dosDate, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(content.length, 18); // compressed size
  h.writeUInt32LE(content.length, 22); // uncompressed size
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28); // extra len
  nameBuf.copy(h, 30);
  return h;
}

/**
 * Build a central-directory header for the appended entry, copying metadata
 * (version/flags/time/attrs) from the old header and updating crc/size/offset.
 * Adds a ZIP64 extra carrying the 64-bit offset when it exceeds 4 GiB.
 */
function buildCdh(old: Buffer, nameBuf: Buffer, content: Buffer, crc: number, localOffset: number): Buffer {
  const needZip64 = localOffset > U32_MAX;
  const extra = needZip64
    ? (() => { const e = Buffer.allocUnsafe(12); e.writeUInt16LE(0x0001, 0); e.writeUInt16LE(8, 2); e.writeBigUInt64LE(BigInt(localOffset), 4); return e; })()
    : Buffer.alloc(0);
  const h = Buffer.allocUnsafe(46 + nameBuf.length + extra.length);
  h.writeUInt32LE(SIG_CDH, 0);
  h.writeUInt16LE(old.readUInt16LE(4), 4); // version made by (preserve)
  h.writeUInt16LE(needZip64 ? 45 : 20, 6); // version needed
  h.writeUInt16LE(0, 8); // flags (clear data-descriptor bit; we wrote sizes inline)
  h.writeUInt16LE(0, 10); // method = store
  h.writeUInt16LE(old.readUInt16LE(12), 12); // mod time (preserve)
  h.writeUInt16LE(old.readUInt16LE(14), 14); // mod date (preserve)
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(content.length, 20); // compressed
  h.writeUInt32LE(content.length, 24); // uncompressed
  h.writeUInt16LE(nameBuf.length, 28);
  h.writeUInt16LE(extra.length, 30);
  h.writeUInt16LE(0, 32); // comment len
  h.writeUInt16LE(0, 34); // disk start
  h.writeUInt16LE(old.readUInt16LE(36), 36); // internal attrs (preserve)
  h.writeUInt32LE(old.readUInt32LE(38), 38); // external attrs (preserve)
  h.writeUInt32LE(needZip64 ? U32_MAX : localOffset, 42);
  nameBuf.copy(h, 46);
  extra.copy(h, 46 + nameBuf.length);
  return h;
}

/** Build ZIP64 EOCD record + locator + EOCD (always emitted; valid for any size). */
function buildTrailer(totalEntries: number, cdOffset: number, cdSize: number, z64EocdOffset: number): Buffer {
  const z64 = Buffer.allocUnsafe(56);
  z64.writeUInt32LE(SIG_Z64_EOCD, 0);
  z64.writeBigUInt64LE(BigInt(44), 4); // size of remainder
  z64.writeUInt16LE(45, 12); // version made by
  z64.writeUInt16LE(45, 14); // version needed
  z64.writeUInt32LE(0, 16); // this disk
  z64.writeUInt32LE(0, 20); // disk with cd start
  z64.writeBigUInt64LE(BigInt(totalEntries), 24);
  z64.writeBigUInt64LE(BigInt(totalEntries), 32);
  z64.writeBigUInt64LE(BigInt(cdSize), 40);
  z64.writeBigUInt64LE(BigInt(cdOffset), 48);

  const loc = Buffer.allocUnsafe(20);
  loc.writeUInt32LE(SIG_Z64_LOC, 0);
  loc.writeUInt32LE(0, 4); // disk with zip64 eocd
  loc.writeBigUInt64LE(BigInt(z64EocdOffset), 8);
  loc.writeUInt32LE(1, 16); // total disks

  const eocd = Buffer.allocUnsafe(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with cd
  eocd.writeUInt16LE(Math.min(totalEntries, U16_MAX), 8);
  eocd.writeUInt16LE(Math.min(totalEntries, U16_MAX), 10);
  eocd.writeUInt32LE(Math.min(cdSize, U32_MAX), 12);
  eocd.writeUInt32LE(cdOffset > U32_MAX ? U32_MAX : cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([z64, loc, eocd]);
}

function writeAll(fd: number, offset: number, buf: Buffer): number {
  let written = 0;
  while (written < buf.length) {
    written += writeSync(fd, buf, written, buf.length - written, offset + written);
  }
  return offset + buf.length;
}

export interface PatchResult {
  /** true if an existing entry was replaced; false if the entry was newly added. */
  replaced: boolean;
  /** byte offset where the new entry's local header was written. */
  entryOffset: number;
  /** new total file size. */
  size: number;
}

/**
 * Replace (or add) a single entry in a store-mode zip in place, without
 * touching the preceding media bytes.
 */
export function replaceZipEntry(zipPath: string, entryName: string, content: Buffer): PatchResult {
  const name = entryName.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(content);

  const fd = openSync(zipPath, 'r+');
  const bak = `${zipPath}.cdbak`;
  let origCdOffset = -1; // captured for crash recovery
  try {
    const fileSize = fstatSync(fd).size;
    const eocd = readEocd(fd, fileSize);
    origCdOffset = eocd.cdOffset;
    const cd = readAt(fd, eocd.cdOffset, eocd.cdSize);
    const records = parseCentralDirectory(cd);
    if (records.length !== eocd.totalEntries) {
      // Tolerate count mismatch but flag it; parsing stops at first bad sig.
      if (records.length < eocd.totalEntries) {
        throw new Error(`central directory parse incomplete: ${records.length}/${eocd.totalEntries}`);
      }
    }

    const targetIdx = records.findIndex((r) => r.name.replace(/\\/g, '/') === name);
    const oldCdh = targetIdx >= 0 ? records[targetIdx].raw : Buffer.alloc(46);
    if (targetIdx < 0) {
      // Synthesize minimal defaults for a brand-new entry.
      oldCdh.writeUInt16LE(20, 4);
    }

    // 1. Back up the trailer we are about to overwrite (cheap; recoverable).
    const trailerBak = readAt(fd, eocd.cdOffset, fileSize - eocd.cdOffset);
    writeFileSync(bak, trailerBak);

    // 2. Append new entry where the old central directory began.
    const entryOffset = eocd.cdOffset;
    const dosTime = oldCdh.readUInt16LE(12);
    const dosDate = oldCdh.readUInt16LE(14);
    let pos = entryOffset;
    pos = writeAll(fd, pos, buildLfh(nameBuf, content, crc, dosTime, dosDate));
    pos = writeAll(fd, pos, content);

    // 3. Write the new central directory.
    const newCdOffset = pos;
    const newTarget = buildCdh(oldCdh, nameBuf, content, crc, entryOffset);
    for (let i = 0; i < records.length; i++) {
      pos = writeAll(fd, pos, i === targetIdx ? newTarget : records[i].raw);
    }
    if (targetIdx < 0) pos = writeAll(fd, pos, newTarget); // append as new entry
    const newCdSize = pos - newCdOffset;
    const newTotal = targetIdx < 0 ? records.length + 1 : records.length;

    // 4. Trailer (zip64 eocd + locator + eocd).
    const z64EocdOffset = pos;
    pos = writeAll(fd, pos, buildTrailer(newTotal, newCdOffset, newCdSize, z64EocdOffset));

    // 5. Truncate any leftover bytes from the (larger) old trailer.
    ftruncateSync(fd, pos);

    rmSync(bak, { force: true });
    return { replaced: targetIdx >= 0, entryOffset, size: pos };
  } catch (e) {
    // Restore the original trailer (backed up before any write) so a partial
    // write never leaves the archive unreadable.
    try {
      if (existsSync(bak) && origCdOffset >= 0) {
        const orig = readFileSync(bak);
        const end = writeAll(fd, origCdOffset, orig);
        ftruncateSync(fd, end);
        rmSync(bak, { force: true });
      }
    } catch { /* best effort */ }
    throw e;
  } finally {
    closeSync(fd);
  }
}
