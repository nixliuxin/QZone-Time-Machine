import { useData } from '../hooks/useData';
import { VideoPlayer } from '../components/VideoPlayer';
import { Breadcrumb } from '../components/Breadcrumb';

interface Video {
  title?: string;
  desc?: string;
  video_url?: string;
  custom_url?: string;
  custom_filepath?: string;
  cover_url?: string;
  custom_pre_filepath?: string;
  custom_pre_url?: string;
  created_time?: number;
  upload_time?: number;
  custom_create_time?: string;
}

export function Videos() {
  const { data: videos, loading, error } = useData<Video[]>('./data/videos.json');

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!videos?.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无视频</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Breadcrumb />
      <h2 className="text-xl font-semibold mb-4 text-[hsl(var(--foreground))]">视频 ({videos.length})</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {videos.map((v, i) => {
          const src = v.custom_filepath || v.custom_url || v.video_url || '';
          const poster = v.custom_pre_filepath || v.cover_url || v.custom_pre_url || '';
          const time = v.custom_create_time
            || (v.created_time ? new Date(v.created_time * 1000).toLocaleDateString('zh-CN') : '')
            || (v.upload_time ? new Date(v.upload_time * 1000).toLocaleDateString('zh-CN') : '');

          return (
            <div key={i} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden shadow-sm">
              {src ? (
                <VideoPlayer src={src} poster={poster} className="w-full aspect-video" />
              ) : poster ? (
                <img src={poster} alt="" className="w-full aspect-video object-cover" />
              ) : (
                <div className="w-full aspect-video bg-[hsl(var(--muted))] flex items-center justify-center text-[hsl(var(--muted-foreground))]">无视频源</div>
              )}
              <div className="p-3">
                {v.title && <p className="font-medium text-sm text-[hsl(var(--foreground))] truncate">{v.title}</p>}
                {v.desc && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 line-clamp-2">{v.desc}</p>}
                {time && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{time}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
