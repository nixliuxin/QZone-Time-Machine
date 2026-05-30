import { useState, type ReactNode } from 'react';
import { Lightbox, type LightboxItem, type LightboxMeta } from './Lightbox';

interface MediaItem {
  src: string;
  thumb?: string;
  caption?: ReactNode;
  meta?: LightboxMeta;
}

interface MediaGridProps {
  items: MediaItem[];
  maxVisible?: number;
  className?: string;
}

export function MediaGrid({ items, maxVisible = 9, className = '' }: MediaGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!items.length) return null;

  const visible = items.slice(0, maxVisible);
  const overflow = items.length - maxVisible;

  const cols = items.length === 1 ? 'grid-cols-1 max-w-sm'
    : items.length <= 4 ? 'grid-cols-2 max-w-xs'
    : 'grid-cols-3 max-w-sm';

  const lightboxItems: LightboxItem[] = items.map((m) => ({
    src: m.src,
    thumb: m.thumb,
    caption: m.caption,
    meta: m.meta,
  }));

  return (
    <>
      <div className={`grid ${cols} gap-1.5 ${className}`}>
        {visible.map((item, i) => (
          <button
            key={i}
            onClick={() => setLightboxIndex(i)}
            className="relative aspect-square overflow-hidden rounded-md bg-[hsl(var(--muted))] hover:opacity-90 transition"
          >
            <img
              src={item.thumb || item.src}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {i === maxVisible - 1 && overflow > 0 && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-medium text-lg">
                +{overflow}
              </div>
            )}
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          items={lightboxItems}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
