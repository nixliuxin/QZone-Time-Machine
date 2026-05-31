import { useData } from '../hooks/useData';
import { usePagination } from '../hooks/usePagination';
import { Breadcrumb } from '../components/Breadcrumb';
import { Pagination } from '../components/Pagination';
import { QQLink } from '../components/QQLink';

interface VisitorEntry {
  name?: string;
  nickname?: string;
  uin?: number;
  time?: number;
  custom_time?: string;
  avatar?: string;
  shuoshuoes?: { name?: string; imgsrc?: string }[];
  blogs?: { name?: string }[];
  photoes?: { name?: string; imgsrc?: string }[];
  shares?: { name?: string; imgsrc?: string }[];
  uins?: { uin?: number; name?: string; time?: number }[];
}

export function Visitors() {
  const { data: raw, loading, error } = useData<VisitorEntry[] | { items: VisitorEntry[] }>('./data/visitors.json');
  const allVisitors = raw ? (Array.isArray(raw) ? raw : raw.items ?? []) : [];
  // Deduplicate by uin+time
  const visitors = allVisitors.filter((v, i, arr) => {
    const key = `${v.uin ?? ''}-${v.time ?? ''}-${v.custom_time ?? ''}`;
    return arr.findIndex(x => `${x.uin ?? ''}-${x.time ?? ''}-${x.custom_time ?? ''}` === key) === i;
  });
  const { paged, currentPage, totalPages, total: visitorTotal, setPage, pageSize } = usePagination(visitors);

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!visitors.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无访客记录</div>;

  // Group the current page items by date
  const groups = new Map<string, VisitorEntry[]>();
  for (const v of paged) {
    let dateStr = '未知';
    if (v.time && v.time > 100000) {
      const d = new Date(v.time * 1000);
      dateStr = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    } else if (v.custom_time) {
      dateStr = v.custom_time.split(' ')[0] || v.custom_time;
    }
    if (!groups.has(dateStr)) groups.set(dateStr, []);
    groups.get(dateStr)!.push(v);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Breadcrumb />
      <h2 className="text-xl font-bold mb-6 text-[hsl(var(--foreground))]">访客 ({visitorTotal})</h2>

      <div className="space-y-6">
        {[...groups.entries()].map(([dateStr, entries]) => (
          <section key={dateStr}>
            <div className="sticky top-0 z-10 bg-[hsl(var(--background))] py-2 mb-3 border-b border-[hsl(var(--border))]">
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{dateStr}</h3>
            </div>
            <div className="space-y-2 border-l-2 border-[hsl(var(--border))] pl-4 ml-2">
              {entries.map((v, i) => {
                const timeStr = v.time && v.time > 100000
                  ? new Date(v.time * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                  : v.custom_time || '';
                const displayName = v.name || v.nickname || `QQ ${v.uin || ''}`;
                const hasDetail = v.shuoshuoes?.length || v.blogs?.length || v.photoes?.length || v.shares?.length;

                return (
                  <div key={i} className="relative">
                    {/* Timeline dot */}
                    <div className="absolute -left-[1.3rem] top-3 w-2.5 h-2.5 rounded-full bg-[hsl(var(--primary))] border-2 border-[hsl(var(--background))]" />
                    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-sm">
                      <div className="flex items-center gap-3">
                        <QQLink uin={v.uin} className="shrink-0">
                          <img
                            src={v.uin ? `./media/avatars/${v.uin}.jpg` : ''}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover hover:ring-2 ring-[hsl(var(--border))] transition"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </QQLink>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <QQLink uin={v.uin} className="text-sm font-medium text-[hsl(var(--foreground))] truncate">{displayName}</QQLink>
                            <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">{timeStr}</span>
                          </div>
                          {!hasDetail && (
                            <p className="text-xs text-[hsl(var(--muted-foreground))]">访问了主页</p>
                          )}
                        </div>
                      </div>

                      {hasDetail && (
                        <div className="mt-2 pl-11 text-xs text-[hsl(var(--muted-foreground))] space-y-1">
                          {v.shuoshuoes?.map((s, j) => (
                            <div key={`s${j}`} className="flex items-center gap-1.5">
                              <span className="text-[hsl(var(--primary))]">💬</span>
                              <span className="truncate">查看了说说: {s.name || '...'}</span>
                            </div>
                          ))}
                          {v.blogs?.map((b, j) => (
                            <div key={`b${j}`} className="flex items-center gap-1.5">
                              <span className="text-[hsl(var(--primary))]">📝</span>
                              <span className="truncate">查看了日志: {b.name || '...'}</span>
                            </div>
                          ))}
                          {v.photoes?.map((p, j) => (
                            <div key={`p${j}`} className="flex items-center gap-1.5">
                              <span className="text-[hsl(var(--primary))]">📷</span>
                              <span className="truncate">查看了相册: {p.name || '...'}</span>
                            </div>
                          ))}
                          {v.shares?.map((sh, j) => (
                            <div key={`sh${j}`} className="flex items-center gap-1.5">
                              <span className="text-[hsl(var(--primary))]">🔗</span>
                              <span className="truncate">查看了分享: {sh.name || '...'}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {v.uins && v.uins.length > 0 && (
                        <div className="mt-2 pl-11 text-xs text-[hsl(var(--muted-foreground))]">
                          <span>同行: </span>
                          {v.uins.map((u, j) => (
                            <span key={j}>{u.name || `QQ${u.uin}`}{j < v.uins!.length - 1 ? '、' : ''}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Pagination currentPage={currentPage} totalPages={totalPages} total={visitorTotal} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
