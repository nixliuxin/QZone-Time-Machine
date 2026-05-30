import { Link } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { QQLink } from '../components/QQLink';

interface UserInfo {
  uin?: number;
  nickname?: string;
  avatar?: string;
  messages_count?: number;
  messages?: number;
  blogs_count?: number;
  blogs?: number;
  photos_count?: number;
  photos?: number;
  videos_count?: number;
  videos?: number;
  boards_count?: number;
  boards?: number;
  friends_count?: number;
  friends?: number;
  diaries_count?: number;
  diaries?: number;
  visitors_count?: number;
  visitors?: number;
  favorites_count?: number;
  favorites?: number;
  shares_count?: number;
  shares?: number;
}

export function Dashboard() {
  const { data: user, loading } = useData<UserInfo>('./data/user.json');

  if (loading) return <LoadingScreen />;

  const c = (a?: number, b?: number) => a ?? b ?? 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <header className="flex items-center gap-4 mb-8">
        <QQLink uin={user?.uin} className="shrink-0">
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="w-16 h-16 rounded-full object-cover ring-2 ring-[hsl(var(--border))] hover:ring-4 transition" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center text-2xl">👤</div>
          )}
        </QQLink>
        <div>
          <QQLink uin={user?.uin} className="text-2xl font-semibold text-[hsl(var(--foreground))]">
            {user?.nickname || `QQ ${user?.uin || ''}`}
          </QQLink>
          {user?.uin && <p className="text-sm text-[hsl(var(--muted-foreground))]">QQ: {user.uin}</p>}
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <StatCard label="说说" count={c(user?.messages_count, user?.messages)} emoji="💬" to="/messages" />
        <StatCard label="日志" count={c(user?.blogs_count, user?.blogs)} emoji="📝" to="/blogs" />
        <StatCard label="相册" count={c(user?.photos_count, user?.photos)} emoji="📷" to="/photos" />
        <StatCard label="视频" count={c(user?.videos_count, user?.videos)} emoji="🎬" to="/videos" />
        <StatCard label="留言" count={c(user?.boards_count, user?.boards)} emoji="📮" to="/boards" />
        <StatCard label="好友" count={c(user?.friends_count, user?.friends)} emoji="👥" to="/friends" />
        <StatCard label="私密日记" count={c(user?.diaries_count, user?.diaries)} emoji="📓" to="/diaries" />
        <StatCard label="访客" count={c(user?.visitors_count, user?.visitors)} emoji="👣" to="/visitors" />
        <StatCard label="收藏" count={c(user?.favorites_count, user?.favorites)} emoji="⭐" to="/favorites" />
        <StatCard label="分享" count={c(user?.shares_count, user?.shares)} emoji="🔗" to="/shares" />
      </div>
    </div>
  );
}

function StatCard({ label, count, emoji, to }: { label: string; count: number; emoji: string; to: string }) {
  return (
    <Link to={to} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm hover:shadow-md transition block">
      <div className="flex items-center gap-2">
        <span className="text-lg">{emoji}</span>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{label}</p>
      </div>
      <p className="text-2xl font-semibold mt-1 text-[hsl(var(--foreground))]">{count || '-'}</p>
    </Link>
  );
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-pulse text-[hsl(var(--muted-foreground))]">加载中...</div>
    </div>
  );
}
