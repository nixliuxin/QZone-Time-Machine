import { useEffect, useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface LightboxMeta {
  filename?: string;
  width?: number;
  height?: number;
  uploadtime?: string | number;
  shoottime?: string | number;
  location?: string;
}

export interface LightboxItem {
  src: string;
  thumb?: string;
  caption?: ReactNode;
  meta?: LightboxMeta;
}

interface LightboxProps {
  items: LightboxItem[];
  startIndex?: number;
  onClose: () => void;
}

function formatTs(val: string | number | undefined): string {
  if (!val) return '';
  if (typeof val === 'number' && val > 100000) return new Date(val * 1000).toLocaleString('zh-CN');
  if (typeof val === 'string') return val;
  return '';
}

function InfoPanel({ meta, src }: { meta?: LightboxMeta; src: string }) {
  const filename = meta?.filename || src.split('/').pop() || '';
  const dims = meta?.width && meta?.height ? `${meta.width} × ${meta.height}` : '';
  const upload = formatTs(meta?.uploadtime);
  const shoot = formatTs(meta?.shoottime);
  const hasInfo = filename || dims || upload || shoot || meta?.location;
  if (!hasInfo) return null;

  return (
    <div className="w-64 shrink-0 bg-[hsl(var(--card))] border-l border-[hsl(var(--border))] p-4 overflow-y-auto text-xs space-y-2">
      {filename && <Row label="文件" value={filename} />}
      {dims && <Row label="尺寸" value={dims} />}
      {shoot && <Row label="拍摄" value={shoot} />}
      {upload && <Row label="上传" value={upload} />}
      {meta?.location && <Row label="位置" value={meta.location} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <p className="text-[hsl(var(--foreground))] break-words mt-0.5">{value}</p>
    </div>
  );
}

export function Lightbox({ items, startIndex = 0, onClose }: LightboxProps) {
  const [index, setIndex] = useState(startIndex);
  const [loaded, setLoaded] = useState(false);

  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  const goPrev = useCallback(() => {
    if (hasPrev) { setIndex((i) => i - 1); setLoaded(false); }
  }, [hasPrev]);

  const goNext = useCallback(() => {
    if (hasNext) { setIndex((i) => i + 1); setLoaded(false); }
  }, [hasNext]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose, goPrev, goNext]);

  useEffect(() => {
    const preload = (i: number) => {
      if (i >= 0 && i < items.length) {
        const img = new Image();
        img.src = items[i].src;
      }
    };
    preload(index + 1);
    preload(index - 1);
  }, [index, items]);

  return createPortal(
    <div
      data-lightbox
      className="fixed inset-0 z-[9999] flex flex-col bg-[hsl(var(--background))]/95 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-[hsl(var(--muted-foreground))] text-sm shrink-0 border-b border-[hsl(var(--border))]" onClick={(e) => e.stopPropagation()}>
        <span>{index + 1} / {items.length}</span>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] text-xl transition">&times;</button>
      </div>

      {/* Content: image + info panel */}
      <div className="flex-1 flex min-h-0" onClick={(e) => e.stopPropagation()}>
        {/* Main image area */}
        <div className="flex-1 flex items-center justify-center relative px-12">
          {hasPrev && (
            <button
              onClick={goPrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-[hsl(var(--muted))] hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] text-xl transition shadow-md"
            >&#8249;</button>
          )}

          <img
            src={item.src}
            alt=""
            className={`max-h-full max-w-full object-contain rounded-lg shadow-2xl transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setLoaded(true)}
            draggable={false}
          />

          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-[hsl(var(--muted-foreground))]/30 border-t-[hsl(var(--foreground))] rounded-full animate-spin" />
            </div>
          )}

          {hasNext && (
            <button
              onClick={goNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-[hsl(var(--muted))] hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] text-xl transition shadow-md"
            >&#8250;</button>
          )}
        </div>

        {/* Right info panel */}
        {item.meta && <InfoPanel meta={item.meta} src={item.src} />}
      </div>

      {/* Caption area */}
      {item.caption && (
        <div
          className="shrink-0 px-6 py-3 text-[hsl(var(--muted-foreground))] text-sm text-center max-h-32 overflow-y-auto border-t border-[hsl(var(--border))]"
          onClick={(e) => e.stopPropagation()}
        >
          {item.caption}
        </div>
      )}
    </div>,
    document.body
  );
}
