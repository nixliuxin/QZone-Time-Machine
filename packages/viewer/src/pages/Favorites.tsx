import { useData } from '../hooks/useData';
import { MediaGrid } from '../components/MediaGrid';
import { Breadcrumb } from '../components/Breadcrumb';

const typeLabels: Record<number, string> = {
  1: '链接', 2: '说说', 3: '日志', 5: '视频', 6: '歌曲', 7: '相册',
};

interface FavImage {
  custom_filepath?: string;
  url?: string;
}

interface FavItem {
  id?: string;
  title?: string;
  url?: string;
  create_time?: number;
  type?: number;
  custom_abstract?: string;
  custom_images?: FavImage[];
}

export function Favorites() {
  const { data: favs, loading, error } = useData<FavItem[]>('./data/favorites.json');

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!favs?.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无收藏</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Breadcrumb />
      <h2 className="text-xl font-semibold mb-4 text-[hsl(var(--foreground))]">收藏 ({favs.length})</h2>
      <div className="space-y-3">
        {favs.map((item, i) => {
          const images = (item.custom_images || []).map((img) => ({
            src: img.custom_filepath || img.url || '',
          })).filter((m) => m.src);

          return (
            <article key={item.id || i} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.title || '未命名'}</a>
                    ) : (item.title || '未命名')}
                  </p>
                  {item.custom_abstract && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 line-clamp-2">{item.custom_abstract}</p>}
                </div>
                {item.type != null && (
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]">
                    {typeLabels[item.type] || `类型${item.type}`}
                  </span>
                )}
              </div>
              {images.length > 0 && <MediaGrid items={images} maxVisible={4} className="mt-2" />}
              {item.create_time && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">{new Date(item.create_time * 1000).toLocaleDateString('zh-CN')}</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
