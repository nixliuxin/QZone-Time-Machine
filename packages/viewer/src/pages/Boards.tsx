import { useMemo } from 'react';
import { useData } from '../hooks/useData';
import { usePagination } from '../hooks/usePagination';
import { CommentList } from '../components/CommentList';
import { Breadcrumb } from '../components/Breadcrumb';
import { Pagination } from '../components/Pagination';
import { QQLink } from '../components/QQLink';
import { formatQQContent } from '../utils/format';

interface Reply {
  content?: string;
  name?: string;
  nickname?: string;
  create_time?: number;
  custom_create_time?: string;
  replies?: Reply[];
  list?: Reply[];
}

interface BoardMessage {
  id?: string;
  nick?: string;
  nickname?: string;
  uin?: number;
  htmlContent?: string;
  ubbContent?: string;
  custom_html?: string;
  pubtime?: string;
  custom_create_time?: string;
  replyList?: Reply[];
  custom_replies?: Reply[];
  custom_images?: { custom_filepath?: string; url?: string }[];
}

interface Friend {
  uin: number;
  img?: string;
  avatar?: string;
}

function decodeBase64(str: string): string {
  let html: string;
  try {
    html = decodeURIComponent(escape(atob(str)));
  } catch {
    try { html = atob(str); } catch { return str; }
  }
  html = html.replace(/src="\/qzone\/em\/(e\d+\.gif)"/g, 'src="media/emoji/$1"');
  html = html.replace(/src='\/qzone\/em\/(e\d+\.gif)'/g, "src='media/emoji/$1'");
  return html;
}

export function Boards() {
  const { data: raw, loading, error } = useData<BoardMessage[] | { items: BoardMessage[] }>('./data/boards.json');
  const { data: friends } = useData<Friend[]>('./data/friends.json');
  const boards = raw ? (Array.isArray(raw) ? raw : raw.items ?? []) : [];
  const { paged, currentPage, totalPages, total: boardTotal, setPage, pageSize } = usePagination(boards);

  const avatarMap = useMemo(() => {
    const map = new Map<number, string>();
    if (friends) {
      for (const f of friends) {
        const url = f.avatar || f.img;
        if (url) map.set(f.uin, url);
      }
    }
    return map;
  }, [friends]);

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!boards.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无留言</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Breadcrumb />
      <h2 className="text-xl font-bold mb-6 text-[hsl(var(--foreground))]">留言板 ({boardTotal})</h2>
      <div className="space-y-3">
        {paged.map((msg, i) => {
          const replies = msg.custom_replies || msg.replyList || [];
          const html = msg.custom_html ? decodeBase64(msg.custom_html) : '';
          const plainContent = msg.htmlContent || msg.ubbContent || '';
          const contentHtml = html || formatQQContent(plainContent);
          const time = msg.custom_create_time || msg.pubtime || '';
          const images = msg.custom_images || [];
          const avatar = msg.uin ? avatarMap.get(msg.uin) : undefined;

          return (
            <article key={msg.id || i} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <QQLink uin={msg.uin} className="shrink-0">
                  {avatar ? (
                    <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover hover:ring-2 ring-[hsl(var(--border))] transition" loading="lazy" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center text-xs">👤</div>
                  )}
                </QQLink>
                <div>
                  <QQLink uin={msg.uin} className="font-medium text-sm text-[hsl(var(--foreground))]">{msg.nickname || msg.nick || `QQ ${msg.uin}`}</QQLink>
                  {time && <time className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">{time}</time>}
                </div>
              </div>

              {contentHtml ? (
                <div
                  className="text-sm leading-relaxed text-[hsl(var(--foreground))] [&_img]:rounded-md [&_img]:max-w-full [&_img]:my-1 [&_.qq-emoji]:inline-block [&_.qq-emoji]:w-5 [&_.qq-emoji]:h-5 [&_.qq-emoji]:align-text-bottom"
                  dangerouslySetInnerHTML={{ __html: contentHtml }}
                />
              ) : null}

              {images.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {images.map((img, j) => {
                    const src = img.custom_filepath || img.url || '';
                    return src ? <img key={j} src={src} alt="" className="w-20 h-20 object-cover rounded-md" loading="lazy" /> : null;
                  })}
                </div>
              )}

              {replies.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">回复 ({replies.length})</p>
                  <CommentList comments={replies} />
                </div>
              )}
            </article>
          );
        })}
      </div>

      <Pagination currentPage={currentPage} totalPages={totalPages} total={boardTotal} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
