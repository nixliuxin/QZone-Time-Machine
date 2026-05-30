import { useData } from '../hooks/useData';

interface UserCounts {
  uin?: number;
  nickname?: string;
  messages_count?: number;
  blogs_count?: number;
  photos_count?: number;
  videos_count?: number;
  boards_count?: number;
  friends_count?: number;
  diaries_count?: number;
  visitors_count?: number;
  favorites_count?: number;
  shares_count?: number;
}

interface MetaInfo {
  source?: string;
  sourceDir?: string;
  convertedAt?: string;
  backedUpAt?: string;
}

const MODULES = [
  { key: 'messages', label: '说说', dataPath: './data/messages.json', countable: true },
  { key: 'blogs', label: '日志', dataPath: './data/blogs.json', countable: true },
  { key: 'photos', label: '相册', dataPath: './data/photos/albums.json', countable: true },
  { key: 'videos', label: '视频', dataPath: './data/videos.json', countable: true },
  { key: 'boards', label: '留言板', dataPath: './data/boards.json', countable: true },
  { key: 'friends', label: '好友', dataPath: './data/friends.json', countable: true },
  { key: 'diaries', label: '私密日记', dataPath: './data/diaries.json', countable: true },
  { key: 'visitors', label: '访客', dataPath: './data/visitors.json', countable: false },
  { key: 'favorites', label: '收藏', dataPath: './data/favorites.json', countable: true },
  { key: 'shares', label: '分享', dataPath: './data/shares.json', countable: true },
];

function ModuleRow({ label, official, actual, countable = true }: { label: string; official: number; actual: number; countable?: boolean }) {
  const pct = official > 0 ? Math.round((actual / official) * 100) : (actual > 0 ? 100 : 0);
  const complete = countable && actual >= official && official > 0;
  const missing = countable && official > 0 && actual < official;

  return (
    <tr className="border-b border-[hsl(var(--border))]">
      <td className="py-2 px-3 text-sm font-medium text-[hsl(var(--foreground))]">{label}</td>
      <td className="py-2 px-3 text-sm tabular-nums text-right text-[hsl(var(--muted-foreground))]">{official || '-'}</td>
      <td className="py-2 px-3 text-sm tabular-nums text-right text-[hsl(var(--foreground))]">{actual}</td>
      <td className="py-2 px-3 text-right">
        {!countable ? (
          <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">参考</span>
        ) : official > 0 ? (
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
            complete
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : missing
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
          }`}>
            {complete ? '✓' : `${pct}%`}
          </span>
        ) : (
          <span className="text-xs text-[hsl(var(--muted-foreground))]">-</span>
        )}
      </td>
    </tr>
  );
}

export function DataReport() {
  const { data: user } = useData<UserCounts>('./data/user.json');
  const { data: meta } = useData<MetaInfo>('./meta.json');

  const { data: messages } = useData<unknown[]>('./data/messages.json');
  const { data: blogs } = useData<unknown[]>('./data/blogs.json');
  const { data: albums } = useData<{ total?: number }[]>('./data/photos/albums.json');
  const { data: videos } = useData<unknown[]>('./data/videos.json');
  const { data: boards } = useData<unknown[]>('./data/boards.json');
  const { data: friends } = useData<unknown[]>('./data/friends.json');
  const { data: diaries } = useData<unknown[]>('./data/diaries.json');
  const { data: visitors } = useData<unknown[]>('./data/visitors.json');
  const { data: favorites } = useData<unknown[]>('./data/favorites.json');
  const { data: shares } = useData<unknown[]>('./data/shares.json');

  const actualCounts: Record<string, number> = {
    messages: messages?.length ?? 0,
    blogs: blogs?.length ?? 0,
    photos: albums?.reduce((sum, a) => sum + (a.total || 0), 0) ?? 0,
    videos: videos?.length ?? 0,
    boards: boards?.length ?? 0,
    friends: friends?.length ?? 0,
    diaries: diaries?.length ?? 0,
    visitors: visitors?.length ?? 0,
    favorites: favorites?.length ?? 0,
    shares: shares?.length ?? 0,
  };

  const getOfficial = (key: string): number => {
    if (!user) return 0;
    return (user as Record<string, number | undefined>)[`${key}_count`] ?? (user as Record<string, number | undefined>)[key] ?? 0;
  };

  const countable = MODULES.filter(m => m.countable);
  const totalOfficial = countable.reduce((sum, m) => sum + getOfficial(m.key), 0);
  const totalActual = countable.reduce((sum, m) => sum + (actualCounts[m.key] || 0), 0);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-xl font-semibold text-[hsl(var(--foreground))] mb-1">数据完整性报告</h2>
      <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
        对比官方统计数字与实际存档数据量
      </p>

      {meta && (
        <div className="mb-6 p-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-xs space-y-1">
          <div className="flex gap-4 flex-wrap">
            <span><strong className="text-[hsl(var(--foreground))]">来源：</strong>{meta.source === 'backup' ? '直接备份' : '旧数据转换'}</span>
            {meta.convertedAt && <span><strong className="text-[hsl(var(--foreground))]">转换时间：</strong>{new Date(meta.convertedAt).toLocaleString('zh-CN')}</span>}
            {meta.backedUpAt && <span><strong className="text-[hsl(var(--foreground))]">备份时间：</strong>{new Date(meta.backedUpAt).toLocaleString('zh-CN')}</span>}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[hsl(var(--muted))]">
              <th className="py-2 px-3 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">模块</th>
              <th className="py-2 px-3 text-right text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">官方</th>
              <th className="py-2 px-3 text-right text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">已存</th>
              <th className="py-2 px-3 text-right text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">状态</th>
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => (
              <ModuleRow key={m.key} label={m.label} official={getOfficial(m.key)} actual={actualCounts[m.key] || 0} countable={m.countable} />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[hsl(var(--muted))]">
              <td className="py-2 px-3 text-sm font-semibold text-[hsl(var(--foreground))]">合计</td>
              <td className="py-2 px-3 text-sm font-semibold text-right tabular-nums text-[hsl(var(--muted-foreground))]">{totalOfficial}</td>
              <td className="py-2 px-3 text-sm font-semibold text-right tabular-nums text-[hsl(var(--foreground))]">{totalActual}</td>
              <td className="py-2 px-3 text-right">
                {totalOfficial > 0 && (
                  <span className="text-xs font-medium">{Math.round((totalActual / totalOfficial) * 100)}%</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-6 p-4 rounded-md bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
        <h4 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-2">说明</h4>
        <ul className="text-xs text-[hsl(var(--muted-foreground))] space-y-1 list-disc list-inside">
          <li><strong>官方</strong>：QQ 空间接口返回的统计数字</li>
          <li><strong>已存</strong>：本地存档中实际包含的条目数</li>
          <li>访客"官方"为历史累计访问量，"已存"为实际抓取的访问记录条数</li>
          <li>部分差异可能因权限限制、内容删除或接口限制导致</li>
        </ul>
      </div>

      <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))] text-center">
        快捷键：← → 翻页 · J/K 滚动 · Esc 返回
      </p>
    </div>
  );
}
