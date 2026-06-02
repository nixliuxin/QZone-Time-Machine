/**
 * A user content source: either a store-mode ZIP or a loose directory.
 * Both expose has/size/read so the server treats them uniformly.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize as pathNormalize } from 'node:path';
import { Readable } from 'node:stream';
import { ZipStore, type EntryStream } from './zipstore.js';

export interface UserSource {
  id: string;
  has(name: string): boolean | Promise<boolean>;
  size(name: string): number | null | Promise<number | null>;
  read(name: string, range?: { start: number; end: number }): Promise<EntryStream | null>;
  close(): void;
}

export class ZipSource implements UserSource {
  id: string;
  private store: ZipStore;
  private constructor(id: string, store: ZipStore) { this.id = id; this.store = store; }
  static async open(id: string, zipPath: string): Promise<ZipSource> {
    return new ZipSource(id, await ZipStore.open(zipPath));
  }
  has(name: string) { return this.store.has(name); }
  size(name: string) { return this.store.size(name); }
  read(name: string, range?: { start: number; end: number }) { return this.store.read(name, range); }
  close() { this.store.close(); }
}

export class DirSource implements UserSource {
  id: string;
  private root: string;
  constructor(id: string, root: string) { this.id = id; this.root = root; }
  private resolve(name: string): string | null {
    const clean = name.replace(/\\/g, '/').replace(/^\.?\//, '');
    const full = pathNormalize(join(this.root, clean));
    // Prevent path traversal outside the user root.
    if (!full.startsWith(pathNormalize(this.root))) return null;
    return full;
  }
  has(name: string) { const p = this.resolve(name); return !!p && existsSync(p) && statSync(p).isFile(); }
  size(name: string) { const p = this.resolve(name); return p && existsSync(p) ? statSync(p).size : null; }
  async read(name: string, range?: { start: number; end: number }): Promise<EntryStream | null> {
    const p = this.resolve(name);
    if (!p || !existsSync(p) || !statSync(p).isFile()) return null;
    const size = statSync(p).size;
    const stream = range
      ? createReadStream(p, { start: range.start, end: range.end })
      : createReadStream(p);
    return { stream: stream as Readable, size };
  }
  close() { /* nothing to close */ }
}
