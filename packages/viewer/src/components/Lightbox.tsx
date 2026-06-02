import { useEffect, useCallback, useState, useRef, type ReactNode, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { CommentList } from './CommentList';

export interface LightboxMeta {
  filename?: string;
  width?: number;
  height?: number;
  uploadtime?: string | number;
  shoottime?: string | number;
  location?: string;
  desc?: string;
  filesize?: number;
  exif?: Record<string, string>;
  comments?: unknown[];
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
  /** Context label shown in the header (e.g. album name). */
  title?: string;
}

function formatTs(val: string | number | undefined): string {
  if (!val) return '';
  if (typeof val === 'number' && val > 100000) return new Date(val * 1000).toLocaleString('zh-CN');
  if (typeof val === 'string') return val;
  return '';
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <p className="text-[hsl(var(--foreground))] break-words mt-0.5">{value}</p>
    </div>
  );
}

function InfoPanel({ meta, src }: { meta?: LightboxMeta; src: string }) {
  const filename = meta?.filename || src.split('/').pop() || '';
  const dims = meta?.width && meta?.height ? `${meta.width} × ${meta.height}` : '';
  const upload = formatTs(meta?.uploadtime);
  const shoot = formatTs(meta?.shoottime);
  const size = formatFileSize(meta?.filesize);
  const exifEntries = meta?.exif ? Object.entries(meta.exif).filter(([, v]) => v && String(v).trim()) : [];
  const comments = (meta?.comments ?? []) as ComponentProps<typeof CommentList>['comments'];

  return (
    <aside className="w-80 shrink-0 bg-[hsl(var(--card))] border-l border-[hsl(var(--border))] p-4 overflow-y-auto text-xs space-y-4">
      {meta?.desc && (
        <p className="text-sm text-[hsl(var(--foreground))] break-words whitespace-pre-wrap">{meta.desc}</p>
      )}

      <div className="space-y-2">
        {shoot && <Row label="拍摄" value={shoot} />}
        {upload && <Row label="上传" value={upload} />}
        {dims && <Row label="尺寸" value={dims} />}
        {filename && <Row label="文件" value={filename} />}
        {size && <Row label="大小" value={size} />}
        {meta?.location && <Row label="位置" value={meta.location} />}
      </div>

      {exifEntries.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-[hsl(var(--foreground))] mb-2 uppercase tracking-wide">EXIF</h5>
          <div className="space-y-1.5">
            {exifEntries.map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} />
            ))}
          </div>
        </div>
      )}

      {comments.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-[hsl(var(--foreground))] mb-2">评论 ({comments.length})</h5>
          <CommentList comments={comments} />
        </div>
      )}
    </aside>
  );
}

export function Lightbox({ items, startIndex = 0, onClose, title }: LightboxProps) {
  const [index, setIndex] = useState(startIndex);
  const [loaded, setLoaded] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  const resetZoom = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

  const goPrev = useCallback(() => {
    if (hasPrev) { setIndex((i) => i - 1); setLoaded(false); resetZoom(); }
  }, [hasPrev, resetZoom]);

  const goNext = useCallback(() => {
    if (hasNext) { setIndex((i) => i + 1); setLoaded(false); resetZoom(); }
  }, [hasNext, resetZoom]);

  const jumpTo = useCallback((i: number) => {
    if (i !== index && i >= 0 && i < items.length) { setIndex(i); setLoaded(false); resetZoom(); }
  }, [index, items.length, resetZoom]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'Home') jumpTo(0);
      else if (e.key === 'End') jumpTo(items.length - 1);
      else if (e.key === 'i' || e.key === 'I') setShowInfo((v) => !v);
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose, goPrev, goNext, jumpTo, items.length]);

  // Preload neighbors
  useEffect(() => {
    const preload = (i: number) => {
      if (i >= 0 && i < items.length) { const img = new Image(); img.src = items[i].src; }
    };
    preload(index + 1);
    preload(index - 1);
  }, [index, items]);

  // Keep active thumbnail in view
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.children[index] as HTMLElement | undefined;
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [index]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => {
      const next = Math.min(5, Math.max(1, s - e.deltaY * 0.0015));
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setOffset({ x: dragRef.current.ox + (e.clientX - dragRef.current.x), y: dragRef.current.oy + (e.clientY - dragRef.current.y) });
  };
  const endDrag = () => { dragRef.current = null; };

  const counter = `${index + 1} / ${items.length}`;

  return createPortal(
    <div
      data-lightbox
      className="fixed inset-0 z-[9999] flex flex-col bg-[hsl(var(--background))] animate-fade-in"
      onClick={onClose}
    >
      {/* Header: hierarchy + actions */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm shrink-0 border-b border-[hsl(var(--border))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0 text-[hsl(var(--muted-foreground))]">
          <button onClick={onClose} className="flex items-center gap-1 hover:text-[hsl(var(--foreground))] transition shrink-0" title="返回 (Esc)">
            <span className="text-base">&larr;</span><span>返回</span>
          </button>
          {title && (
            <>
              <span className="opacity-40">/</span>
              <span className="text-[hsl(var(--foreground))] truncate">{title}</span>
            </>
          )}
          <span className="opacity-40">/</span>
          <span className="shrink-0">{counter}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={item.src} target="_blank" rel="noopener noreferrer"
            className="px-2 h-8 flex items-center rounded hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] text-xs transition"
            title="在新标签打开原图"
          >原图</a>
          <button
            onClick={() => setShowInfo((v) => !v)}
            className={`w-8 h-8 flex items-center justify-center rounded transition text-sm ${showInfo ? 'bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]' : 'hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))]'}`}
            title="信息面板 (i)"
          >ⓘ</button>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] text-xl transition" title="关闭 (Esc)">&times;</button>
        </div>
      </div>

      {/* Content: image stage + info panel */}
      <div className="flex-1 flex min-h-0" onClick={(e) => e.stopPropagation()}>
        <div
          className="flex-1 flex items-center justify-center relative px-12 bg-[hsl(var(--muted))]/30 overflow-hidden"
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onDoubleClick={() => (scale > 1 ? resetZoom() : setScale(2.5))}
        >
          {hasPrev && (
            <button
              onClick={goPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-[hsl(var(--card))] hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] text-xl transition shadow-md border border-[hsl(var(--border))]"
              title="上一张 (←)"
            >&#8249;</button>
          )}

          <img
            src={item.src}
            alt=""
            className={`max-h-full max-w-full object-contain rounded shadow-lg transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              cursor: scale > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'zoom-in',
              transition: dragRef.current ? 'none' : 'transform 0.15s ease-out, opacity 0.2s',
            }}
            onLoad={() => setLoaded(true)}
            draggable={false}
          />

          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-8 h-8 border-2 border-[hsl(var(--muted-foreground))]/30 border-t-[hsl(var(--foreground))] rounded-full animate-spin" />
            </div>
          )}

          {hasNext && (
            <button
              onClick={goNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-[hsl(var(--card))] hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] text-xl transition shadow-md border border-[hsl(var(--border))]"
              title="下一张 (→)"
            >&#8250;</button>
          )}
        </div>

        {showInfo && item.meta && <InfoPanel meta={item.meta} src={item.src} />}
      </div>

      {/* Caption */}
      {item.caption && (
        <div
          className="shrink-0 px-6 py-2.5 text-[hsl(var(--muted-foreground))] text-sm text-center max-h-24 overflow-y-auto border-t border-[hsl(var(--border))]"
          onClick={(e) => e.stopPropagation()}
        >
          {item.caption}
        </div>
      )}

      {/* Bottom thumbnail strip */}
      {items.length > 1 && (
        <div
          ref={stripRef}
          className="shrink-0 flex gap-2 px-4 py-3 overflow-x-auto border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => jumpTo(i)}
              className={`relative shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition ${
                i === index ? 'border-[hsl(var(--foreground))] opacity-100' : 'border-transparent opacity-50 hover:opacity-90'
              }`}
              title={`${i + 1}`}
            >
              <img src={it.thumb || it.src} alt="" className="w-full h-full object-cover" loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
