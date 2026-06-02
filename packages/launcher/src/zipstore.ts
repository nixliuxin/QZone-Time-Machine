/**
 * Random-access reader over a store-mode (uncompressed) ZIP.
 *
 * Opens the zip once, caches the central directory (name -> entry), and serves
 * individual entries as streams. Store mode + zip64 means even multi-GB archives
 * stream a single entry without loading the whole file into memory.
 */
import yauzl, { type ZipFile, type Entry } from 'yauzl';
import { Readable } from 'node:stream';

export interface EntryStream {
  stream: Readable;
  size: number;
}

export class ZipStore {
  private zipfile: ZipFile;
  private entries: Map<string, Entry>;

  private constructor(zipfile: ZipFile, entries: Map<string, Entry>) {
    this.zipfile = zipfile;
    this.entries = entries;
  }

  static open(path: string): Promise<ZipStore> {
    return new Promise((resolve, reject) => {
      yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
        if (err || !zipfile) return reject(err || new Error('failed to open zip'));
        const entries = new Map<string, Entry>();
        zipfile.on('entry', (entry: Entry) => {
          // Skip directory entries.
          if (!/\/$/.test(entry.fileName)) entries.set(normalize(entry.fileName), entry);
          zipfile.readEntry();
        });
        zipfile.on('end', () => resolve(new ZipStore(zipfile, entries)));
        zipfile.on('error', reject);
        zipfile.readEntry();
      });
    });
  }

  has(name: string): boolean {
    return this.entries.has(normalize(name));
  }

  size(name: string): number | null {
    const e = this.entries.get(normalize(name));
    return e ? e.uncompressedSize : null;
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Open a read stream for an entry, optionally a byte range [start, end] inclusive.
   * Range reads require the entry to be stored (compress: false) — which is how we pack.
   */
  read(name: string, range?: { start: number; end: number }): Promise<EntryStream | null> {
    const entry = this.entries.get(normalize(name));
    if (!entry) return Promise.resolve(null);
    const opts: { decompress: boolean | null; start?: number; end?: number } = { decompress: null };
    // For stored entries, decompress:null streams raw bytes; start/end slice them.
    if (range) { opts.start = range.start; opts.end = range.end + 1; }
    return new Promise((resolve, reject) => {
      this.zipfile.openReadStream(entry, opts as never, (err, stream) => {
        if (err || !stream) return reject(err || new Error('read failed'));
        resolve({ stream, size: entry.uncompressedSize });
      });
    });
  }

  close(): void {
    try { this.zipfile.close(); } catch { /* ignore */ }
  }
}

function normalize(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}
