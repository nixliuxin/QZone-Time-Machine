import { useRef, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { Lightbox, type LightboxItem } from '../components/Lightbox';
import { CommentList } from '../components/CommentList';
import { Breadcrumb } from '../components/Breadcrumb';

interface Comment {
  content?: string;
  name?: string;
  nickname?: string;
  create_time?: number;
  custom_create_time?: string;
  replies?: Comment[];
  list?: Comment[];
}

interface Diary {
  diaryId?: number | string;
  title?: string;
  custom_title?: string;
  pubTime?: string;
  pubtime?: string;
  custom_create_time?: string;
  category?: string;
  replynum?: number;
  custom_html?: string;
  abstract?: string;
  custom_comments?: Comment[];
  commentlist?: Comment[];
}

function decodeBase64(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    try { return atob(str); } catch { return str; }
  }
}

// ─── Diary List (route: /diaries) ───

export function DiaryList() {
  const { data: diaries, loading, error } = useData<Diary[]>('./data/diaries.json');

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!diaries?.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无日记</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Breadcrumb />
      <h2 className="text-xl font-bold mb-6 text-[hsl(var(--foreground))]">私密日记 ({diaries.length})</h2>
      <div className="space-y-2">
        {diaries.map((diary, i) => {
          const title = diary.title || diary.custom_title || '(无标题)';
          const time = diary.pubTime || diary.pubtime || diary.custom_create_time || '';
          const replies = diary.replynum ?? 0;

          return (
            <Link
              key={diary.diaryId || i}
              to={`/diaries/${i}`}
              className="block w-full text-left rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm hover:shadow-md transition"
            >
              <h3 className="font-medium text-sm text-[hsl(var(--foreground))]">{title}</h3>
              {diary.abstract && (
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))] line-clamp-2">{diary.abstract}</p>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                {time && <time>{time}</time>}
                {diary.category && <span className="px-1.5 py-0.5 bg-[hsl(var(--secondary))] rounded text-[hsl(var(--secondary-foreground))]">{diary.category}</span>}
                {replies > 0 && <span>评论 {replies}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── Diary Detail (route: /diaries/:diaryIndex) ───

export function DiaryDetail() {
  const { diaryIndex } = useParams<{ diaryIndex: string }>();
  const { data: diaries } = useData<Diary[]>('./data/diaries.json');

  const idx = parseInt(diaryIndex || '0', 10);
  const diary = diaries?.[idx];

  if (!diary) {
    return (
      <div className="p-6">
        <Link to="/diaries" className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">&larr; 返回私密日记</Link>
        <p className="mt-4 text-[hsl(var(--muted-foreground))]">日记不存在</p>
      </div>
    );
  }

  const title = diary.title || diary.custom_title || '(无标题)';
  const time = diary.pubTime || diary.pubtime || diary.custom_create_time || '';
  const comments = diary.custom_comments || diary.commentlist || [];
  const html = diary.custom_html ? decodeBase64(diary.custom_html) : '';
  const total = diaries?.length || 0;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Breadcrumb extra={[{ label: title }]} />
      <div className="flex items-center justify-between mb-4">
        <Link to="/diaries" className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition">&larr; 返回私密日记</Link>
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          {idx > 0 && <Link to={`/diaries/${idx - 1}`} className="hover:text-[hsl(var(--foreground))]">◀ 上一篇</Link>}
          <span>{idx + 1}/{total}</span>
          {idx < total - 1 && <Link to={`/diaries/${idx + 1}`} className="hover:text-[hsl(var(--foreground))]">下一篇 ▶</Link>}
        </div>
      </div>

      <article>
        <h1 className="text-xl font-semibold text-[hsl(var(--foreground))] mb-2">{title}</h1>
        <div className="flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))] mb-4">
          {time && <time>{time}</time>}
          {diary.category && <span className="px-1.5 py-0.5 bg-[hsl(var(--secondary))] rounded text-[hsl(var(--secondary-foreground))]">{diary.category}</span>}
        </div>

        {html ? (
          <DiaryContent html={html} />
        ) : diary.abstract ? (
          <p className="text-sm text-[hsl(var(--foreground))] whitespace-pre-wrap">{diary.abstract}</p>
        ) : null}

        {comments.length > 0 && (
          <div className="mt-6 pt-4 border-t border-[hsl(var(--border))]">
            <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-3">评论 ({comments.length})</h3>
            <CommentList comments={comments} />
          </div>
        )}
      </article>
    </div>
  );
}

// ─── Diary HTML Content with image lightbox ───

function DiaryContent({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [lightboxItems, setLightboxItems] = useState<LightboxItem[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const imgs = ref.current.querySelectorAll('img');
    const items: LightboxItem[] = [];
    imgs.forEach((img, i) => {
      items.push({ src: img.src });
      img.style.cursor = 'pointer';
      img.style.borderRadius = '6px';
      img.style.maxWidth = '100%';
      img.onclick = (e) => {
        e.stopPropagation();
        setLightboxIndex(i);
      };
    });
    setLightboxItems(items);
  }, [html]);

  return (
    <>
      <div
        ref={ref}
        className="text-sm leading-relaxed text-[hsl(var(--foreground))] [&_img]:my-2 [&_a]:text-blue-500 [&_a]:underline [&_p]:mb-2 [&_br]:leading-loose"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {lightboxIndex !== null && lightboxItems.length > 0 && (
        <Lightbox items={lightboxItems} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </>
  );
}
