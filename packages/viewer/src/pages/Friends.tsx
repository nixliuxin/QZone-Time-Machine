import { useData } from '../hooks/useData';
import { Breadcrumb } from '../components/Breadcrumb';
import { QQLink } from '../components/QQLink';

interface Friend {
  uin: number;
  name?: string;
  remark?: string;
  gpname?: string;
  groupname?: string;
  groupid?: number;
  img?: string;
  avatar?: string;
  intimacyScore?: number;
  care?: boolean;
  addTime?: number | string;
  common_group?: number;
  common_friend?: number;
}

export function Friends() {
  const { data: friends, loading, error } = useData<Friend[]>('./data/friends.json');

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!friends?.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无好友数据</div>;

  const groups = new Map<string, Friend[]>();
  for (const f of friends) {
    const g = f.gpname || f.groupname || '未分组';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(f);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Breadcrumb />
      <h2 className="text-xl font-bold mb-6 text-[hsl(var(--foreground))]">好友 ({friends.length})</h2>

      <div className="space-y-8">
        {[...groups.entries()].map(([groupName, members]) => (
          <section key={groupName}>
            <div className="sticky top-0 z-10 bg-[hsl(var(--background))] py-2 mb-3 border-b-2 border-[hsl(var(--primary)/0.3)]">
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                {groupName} <span className="font-normal text-[hsl(var(--muted-foreground))]">({members.length})</span>
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {members.map((f) => (
                <FriendCard key={f.uin} friend={f} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function FriendCard({ friend: f }: { friend: Friend }) {
  const displayName = f.remark || f.name || String(f.uin);
  const hasRemark = f.remark && f.name && f.remark !== f.name;

  return (
    <QQLink uin={f.uin} className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-sm hover:shadow-md transition no-underline">
      {(f.avatar || f.img) ? (
        <img src={f.avatar || f.img} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" loading="lazy" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[hsl(var(--muted))] shrink-0 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">👤</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate text-[hsl(var(--foreground))]">{displayName}</p>
          {f.care && <span className="text-xs text-amber-500" title="特别关心">★</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
          <span className="font-mono">{f.uin}</span>
          {hasRemark && <span>({f.name})</span>}
        </div>
        {(f.intimacyScore != null && f.intimacyScore > 0) && (
          <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">亲密度: {f.intimacyScore}</div>
        )}
      </div>
    </QQLink>
  );
}
