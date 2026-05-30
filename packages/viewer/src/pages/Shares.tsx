import { useData } from '../hooks/useData';
import { MediaGrid } from '../components/MediaGrid';
import { Breadcrumb } from '../components/Breadcrumb';

interface ShareImage {
  custom_filepath?: string;
  url?: string;
}

interface ShareItem {
  id?: string;
  title?: string;
  summary?: string;
  desc?: string;
  share_url?: string;
  source_url?: string;
  create_time?: number;
  custom_create_time?: string;
  custom_images?: ShareImage[];
  source_name?: string;
}

export function Shares() {
  const { data: shares, loading, error } = useData<ShareItem[]>('./data/shares.json');

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!shares?.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无分享</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Breadcrumb />
      <h2 className="text-xl font-semibold mb-4 text-[hsl(var(--foreground))]">分享 ({shares.length})</h2>
      <div className="space-y-3">
        {shares.map((item, i) => {
          const url = item.share_url || item.source_url || '';
          const time = item.custom_create_time || (item.create_time ? new Date(item.create_time * 1000).toLocaleDateString('zh-CN') : '');
          const images = (item.custom_images || []).map((img) => ({
            src: img.custom_filepath || img.url || '',
          })).filter((m) => m.src);

          return (
            <article key={item.id || i} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm">
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.title || '未命名'}</a>
                ) : (item.title || '未命名')}
              </p>
              {(item.summary || item.desc) && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 line-clamp-3">{item.summary || item.desc}</p>
              )}
              {images.length > 0 && <MediaGrid items={images} maxVisible={4} className="mt-2" />}
              <div className="flex items-center gap-3 mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                {time && <time>{time}</time>}
                {item.source_name && <span>来源: {item.source_name}</span>}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
