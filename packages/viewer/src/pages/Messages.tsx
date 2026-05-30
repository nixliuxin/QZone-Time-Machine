import { useState } from 'react';
import { useData } from '../hooks/useData';
import { usePagination } from '../hooks/usePagination';
import { MediaGrid } from '../components/MediaGrid';
import { CommentList } from '../components/CommentList';
import { VideoPlayer } from '../components/VideoPlayer';
import { Breadcrumb } from '../components/Breadcrumb';
import { Pagination } from '../components/Pagination';
import { formatQQContent } from '../utils/format';

interface MessagePic {
  url1?: string;
  url2?: string;
  url3?: string;
  custom_filepath?: string;
  custom_pre_filepath?: string;
  smallurl?: string;
  b_width?: number;
  b_height?: number;
  origin_width?: number;
  origin_height?: number;
  custom_filename?: string;
  uploadtime?: string | number;
  shoottime?: string | number;
}

interface MessageVideo {
  url?: string;
  custom_url?: string;
  custom_filepath?: string;
  custom_pre_filepath?: string;
  cover_url?: string;
  desc?: string;
}

interface Message {
  tid: string;
  content?: string;
  custom_content?: string;
  created_time?: number;
  custom_create_time?: string;
  commentlist?: Comment[];
  custom_comments?: Comment[];
  pic?: MessagePic[];
  custom_images?: MessagePic[];
  custom_videos?: MessageVideo[];
  lbs?: { idname?: string; name?: string; pos_x?: number; pos_y?: number };
  cmtnum?: number;
  commenttotal?: number;
  likenum?: number;
  fwdnum?: number;
  rt_sum?: number;
  name?: string;
  source_name?: string;
}

interface Comment {
  content?: string;
  name?: string;
  nickname?: string;
  create_time?: number;
  custom_create_time?: string;
  replies?: Comment[];
  list?: Comment[];
}

export function Messages() {
  const { data: messages, loading, error } = useData<Message[]>('./data/messages.json');
  const { paged, currentPage, totalPages, total: msgTotal, setPage, pageSize } = usePagination(messages || []);

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!messages?.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无说说</div>;

  // Group the current page items by year-month
  const groups = new Map<string, Message[]>();
  for (const msg of paged) {
    let key = '未知';
    if (msg.created_time && msg.created_time > 100000) {
      const d = new Date(msg.created_time * 1000);
      key = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    } else if (msg.custom_create_time) {
      const parts = msg.custom_create_time.match(/(\d{4})[-/年](\d{1,2})/);
      if (parts) key = `${parts[1]}年${parseInt(parts[2])}月`;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(msg);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Breadcrumb />
      <h2 className="text-xl font-bold mb-6 text-[hsl(var(--foreground))]">说说 ({msgTotal})</h2>

      <div className="space-y-8">
        {[...groups.entries()].map(([period, msgs]) => (
          <section key={period}>
            <div className="sticky top-0 z-10 bg-[hsl(var(--background))] py-2 mb-3 border-b border-[hsl(var(--border))]">
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{period} <span className="font-normal text-[hsl(var(--muted-foreground))]">({msgs.length})</span></h3>
            </div>
            <div className="space-y-4">
              {msgs.map((msg) => (
                <MessageCard key={msg.tid} message={msg} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <Pagination currentPage={currentPage} totalPages={totalPages} total={msgTotal} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}

function MessageCard({ message }: { message: Message }) {
  const [showComments, setShowComments] = useState(false);
  const rawContent = message.content || message.custom_content || '';
  const contentHtml = formatQQContent(rawContent);
  const pics = message.pic || message.custom_images || [];
  const videos = message.custom_videos || [];
  const comments = (message.commentlist || message.custom_comments || []) as Comment[];
  const commentCount = message.cmtnum ?? message.commenttotal ?? comments.length;

  let timeStr = '';
  if (message.created_time) {
    timeStr = new Date(message.created_time * 1000).toLocaleString('zh-CN');
  } else if (message.custom_create_time) {
    timeStr = message.custom_create_time;
  }

  const location = message.lbs?.idname || message.lbs?.name || '';

  const mediaItems = pics.map((p) => {
    const src = p.custom_filepath || p.url3 || p.url2 || p.url1 || '';
    const thumb = p.custom_pre_filepath || p.url2 || p.url1 || src;
    const w = p.origin_width || p.b_width;
    const h = p.origin_height || p.b_height;
    return {
      src, thumb,
      meta: {
        filename: p.custom_filename || src.split('/').pop() || undefined,
        width: w, height: h,
        uploadtime: p.uploadtime,
        shoottime: p.shoottime,
      },
    };
  }).filter((m) => m.src);

  return (
    <article className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm">
      {contentHtml && (
        <div
          className="whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--foreground))] [&_.qq-emoji]:inline-block [&_.qq-emoji]:w-5 [&_.qq-emoji]:h-5 [&_.qq-emoji]:align-text-bottom"
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      )}

      {mediaItems.length > 0 && (
        <MediaGrid items={mediaItems} maxVisible={9} className="mt-3" />
      )}

      {videos.length > 0 && (
        <div className="mt-3 space-y-2">
          {videos.map((v, i) => {
            const src = v.custom_filepath || v.custom_url || v.url || '';
            const poster = v.custom_pre_filepath || v.cover_url || '';
            return src ? (
              <VideoPlayer key={i} src={src} poster={poster} className="w-full max-w-md aspect-video" />
            ) : null;
          })}
        </div>
      )}

      <footer className="mt-3 flex items-center flex-wrap gap-3 text-xs text-[hsl(var(--muted-foreground))]">
        <time>{timeStr}</time>
        {location && <span>📍 {location}</span>}
        {message.source_name && <span className="opacity-70">{message.source_name}</span>}
        {(message.fwdnum ?? message.rt_sum ?? 0) > 0 && <span>🔁 {message.fwdnum || message.rt_sum}</span>}
        {(message.likenum ?? 0) > 0 && <span>👍 {message.likenum}</span>}
        {commentCount > 0 && (
          <button
            onClick={() => setShowComments(!showComments)}
            className="hover:text-[hsl(var(--foreground))] transition"
          >
            💬 {commentCount}
          </button>
        )}
      </footer>

      {showComments && comments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
          <CommentList comments={comments} />
        </div>
      )}
    </article>
  );
}
