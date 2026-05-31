import { useRef, useEffect, useState, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
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

interface Blog {
  blogId?: number | string;
  blogid?: number | string;
  title?: string;
  custom_title?: string;
  pubTime?: string;
  pubtime?: string;
  custom_create_time?: string;
  category?: string;
  cate?: string;
  blogType?: number;
  effect1?: number;
  ar?: number;
  replynum?: number;
  commentNum?: number;
  readnum?: number;
  likeTotal?: number;
  custom_html?: string;
  abstract?: string;
  custom_comments?: Comment[];
  commentlist?: Comment[];
  comments?: Comment[];
}

function getBlogTags(blog: Blog, isPinned = false): { type: '原创' | '转载' | null; isPrivate: boolean; isPinned: boolean } {
  const e1 = blog.effect1 ?? 0;
  const ar = blog.ar ?? 0;
  const isRepost = (e1 & 0x08) !== 0;
  const isOriginal = (e1 & 0x10) !== 0;
  const isPrivate = (ar & 0x20000000) !== 0;
  return {
    type: isRepost ? '转载' : isOriginal ? '原创' : null,
    isPrivate,
    isPinned,
  };
}

function detectPinnedIndex(blogs: Blog[]): number {
  if (blogs.length < 2) return -1;
  const t0 = blogs[0].pubTime || blogs[0].pubtime || blogs[0].custom_create_time || '';
  const t1 = blogs[1].pubTime || blogs[1].pubtime || blogs[1].custom_create_time || '';
  if (t0 && t1 && t0 < t1) return 0;
  return -1;
}

function decodeBase64(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    try { return atob(str); } catch { return str; }
  }
}

// ─── Blog List (route: /blogs) ───

export function BlogList() {
  const { data: blogs, loading, error } = useData<Blog[]>('./data/blogs.json');
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTag = searchParams.get('tag') || '';

  const categories = useMemo(() => {
    if (!blogs) return [];
    const set = new Set<string>();
    for (const b of blogs) {
      const c = b.category || b.cate || '';
      if (c) set.add(c);
    }
    return [...set].sort();
  }, [blogs]);

  const filtered = useMemo(() => {
    if (!blogs) return [];
    if (!activeTag) return blogs;
    return blogs.filter((b) => (b.category || b.cate || '') === activeTag);
  }, [blogs, activeTag]);

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!blogs?.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无日志</div>;

  const setTag = (tag: string) => {
    const params = new URLSearchParams(searchParams);
    if (tag) { params.set('tag', tag); } else { params.delete('tag'); }
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Breadcrumb />
      <h2 className="text-xl font-bold mb-4 text-[hsl(var(--foreground))]">日志 ({blogs.length})</h2>

      {/* Tag filter */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setTag('')}
            className={`px-2.5 py-1 text-xs rounded-full border transition ${
              !activeTag
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-transparent'
                : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'
            }`}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setTag(cat)}
              className={`px-2.5 py-1 text-xs rounded-full border transition ${
                activeTag === cat
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-transparent'
                  : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4">
        {activeTag ? `「${activeTag}」 ${filtered.length} 篇` : `共 ${filtered.length} 篇`}
      </p>

      <div className="space-y-2">
        {filtered.map((blog, _fi) => {
          const origIndex = blogs.indexOf(blog);
          const title = blog.title || blog.custom_title || '(无标题)';
          const time = blog.pubTime || blog.pubtime || blog.custom_create_time || '';
          const category = blog.category || blog.cate || '';
          const replies = blog.replynum ?? blog.commentNum ?? 0;
          const pinnedIdx = detectPinnedIndex(blogs);
          const { type: blogTag, isPrivate, isPinned } = getBlogTags(blog, origIndex === pinnedIdx);

          return (
            <Link
              key={blog.blogId || blog.blogid || origIndex}
              to={`/blogs/${origIndex}`}
              className="block w-full text-left rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm hover:shadow-md transition"
            >
              <h3 className="font-medium text-sm text-[hsl(var(--foreground))]">
                {isPrivate && <span className="mr-1.5 opacity-60" title="仅自己可见">🔒</span>}
                {isPinned && <span className="mr-1.5 text-orange-600 dark:text-orange-400 font-bold">[顶]</span>}
                {title}
              </h3>
              {blog.abstract && (
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))] line-clamp-2">{blog.abstract}</p>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                {time && <time>{time}</time>}
                {blogTag && !isPinned && (
                  <span className={`px-1.5 py-0.5 rounded text-xs ${blogTag === '原创' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'}`}>
                    {blogTag}
                  </span>
                )}
                {category && <span className="px-1.5 py-0.5 bg-[hsl(var(--secondary))] rounded text-[hsl(var(--secondary-foreground))]">{category}</span>}
                {(blog.readnum ?? 0) > 0 && <span>阅读 {blog.readnum}</span>}
                {(blog.likeTotal ?? 0) > 0 && <span>赞 {blog.likeTotal}</span>}
                {replies > 0 && <span>评论 {replies}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── Blog Detail (route: /blogs/:blogIndex) ───

export function BlogDetail() {
  const { blogIndex } = useParams<{ blogIndex: string }>();
  const { data: blogs } = useData<Blog[]>('./data/blogs.json');

  const idx = parseInt(blogIndex || '0', 10);
  const blog = blogs?.[idx];

  if (!blog) {
    return (
      <div className="p-6">
        <Link to="/blogs" className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">&larr; 返回日志列表</Link>
        <p className="mt-4 text-[hsl(var(--muted-foreground))]">日志不存在</p>
      </div>
    );
  }

  const title = blog.title || blog.custom_title || '(无标题)';
  const time = blog.pubTime || blog.pubtime || blog.custom_create_time || '';
  const category = blog.category || blog.cate || '';
  const comments = blog.custom_comments || blog.comments || blog.commentlist || [];
  const html = blog.custom_html ? decodeBase64(blog.custom_html) : '';
  const total = blogs?.length || 0;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Breadcrumb extra={[{ label: title }]} />
      <div className="flex items-center justify-between mb-4">
        <Link to="/blogs" className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition">&larr; 返回日志列表</Link>
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          {idx > 0 && <Link to={`/blogs/${idx - 1}`} className="hover:text-[hsl(var(--foreground))]">◀ 上一篇</Link>}
          <span>{idx + 1}/{total}</span>
          {idx < total - 1 && <Link to={`/blogs/${idx + 1}`} className="hover:text-[hsl(var(--foreground))]">下一篇 ▶</Link>}
        </div>
      </div>

      <article>
        <h1 className="text-xl font-semibold text-[hsl(var(--foreground))] mb-2">{title}</h1>
        <div className="flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))] mb-4">
          {time && <time>{time}</time>}
          {(() => { const pinnedIdx = detectPinnedIndex(blogs || []); const { type: tag, isPrivate, isPinned } = getBlogTags(blog, idx === pinnedIdx); return (<>
            {isPinned && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-bold">置顶</span>}
            {tag && !isPinned && (
              <span className={`px-1.5 py-0.5 rounded ${tag === '原创' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'}`}>
                {tag}
              </span>
            )}
            {isPrivate && <span className="opacity-60" title="仅自己可见">🔒 私密</span>}
          </>); })()}
          {category && <span className="px-1.5 py-0.5 bg-[hsl(var(--secondary))] rounded text-[hsl(var(--secondary-foreground))]">{category}</span>}
          {(blog.readnum ?? 0) > 0 && <span>阅读 {blog.readnum}</span>}
          {(blog.likeTotal ?? 0) > 0 && <span>赞 {blog.likeTotal}</span>}
        </div>

        {html ? (
          <BlogContent html={html} />
        ) : blog.abstract ? (
          <p className="text-sm text-[hsl(var(--foreground))] whitespace-pre-wrap">{blog.abstract}</p>
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

// ─── Blog HTML Content with image lightbox ───

function BlogContent({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [lightboxItems, setLightboxItems] = useState<LightboxItem[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const imgs = ref.current.querySelectorAll('img');
    const items: LightboxItem[] = [];
    imgs.forEach((img, i) => {
      const filename = img.src.split('/').pop() || '';
      const meta: LightboxItem['meta'] = { filename };
      if (img.naturalWidth && img.naturalHeight) {
        meta.width = img.naturalWidth;
        meta.height = img.naturalHeight;
      }
      items.push({ src: img.src, meta });
      img.style.cursor = 'pointer';
      img.style.borderRadius = '6px';
      img.style.maxWidth = '100%';
      img.onclick = (e) => {
        e.stopPropagation();
        if (img.naturalWidth) items[i].meta!.width = img.naturalWidth;
        if (img.naturalHeight) items[i].meta!.height = img.naturalHeight;
        setLightboxItems([...items]);
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
