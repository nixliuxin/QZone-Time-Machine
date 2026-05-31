import { useRef, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { QQLink } from './QQLink';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useData } from '../hooks/useData';

interface UserInfo {
  uin?: number;
  nickname?: string;
  avatar?: string;
  messages_count?: number; messages?: number;
  blogs_count?: number; blogs?: number;
  photos_count?: number; photos?: number;
  videos_count?: number; videos?: number;
  boards_count?: number; boards?: number;
  friends_count?: number; friends?: number;
  diaries_count?: number; diaries?: number;
  visitors_count?: number; visitors?: number;
  favorites_count?: number; favorites?: number;
  shares_count?: number; shares?: number;
}

const contentNavItems = [
  { to: '/', label: '概览', icon: '📊', countKey: null, ownerOnly: false },
  { to: '/messages', label: '说说', icon: '💬', countKey: 'messages', ownerOnly: false },
  { to: '/blogs', label: '日志', icon: '📝', countKey: 'blogs', ownerOnly: false },
  { to: '/photos', label: '相册', icon: '📷', countKey: 'photos', ownerOnly: false },
  { to: '/videos', label: '视频', icon: '🎬', countKey: 'videos', ownerOnly: false },
  { to: '/boards', label: '留言板', icon: '📮', countKey: 'boards', ownerOnly: false },
  { to: '/diaries', label: '私密日记', icon: '📓', countKey: 'diaries', ownerOnly: true },
  { to: '/visitors', label: '访客', icon: '👣', countKey: 'visitors', ownerOnly: false },
  { to: '/friends', label: '好友', icon: '👥', countKey: 'friends', ownerOnly: true },
  { to: '/favorites', label: '收藏', icon: '⭐', countKey: 'favorites', ownerOnly: false },
  { to: '/shares', label: '分享', icon: '🔗', countKey: 'shares', ownerOnly: true },
] as const;

const utilNavItems = [
  { to: '/report', label: '数据报告', icon: '📋' },
  { to: '/about', label: '关于', icon: 'ℹ️' },
] as const;

export function Layout() {
  useKeyboardNav();
  const { data: user } = useData<UserInfo>('./data/user.json');
  const { data: albums } = useData<{ total?: number }[]>('./data/photos/albums.json');
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const scrollPositions = useRef<Record<string, number>>({});

  const locationKey = location.pathname + location.search;

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const saved = scrollPositions.current[locationKey];
    if (saved != null) {
      requestAnimationFrame(() => { el.scrollTop = saved; });
    } else {
      el.scrollTop = 0;
    }
  }, [locationKey]);

  const handleScroll = () => {
    if (mainRef.current) {
      scrollPositions.current[locationKey] = mainRef.current.scrollTop;
    }
  };

  const getCount = (countKey: string | null): number | undefined => {
    if (!countKey || !user) return undefined;
    if (countKey === 'photos' && albums) {
      return albums.reduce((sum, a) => sum + (a.total || 0), 0) || undefined;
    }
    const obj = user as Record<string, unknown>;
    return (obj[`${countKey}_count`] as number | undefined) ?? (obj[countKey] as number | undefined) ?? undefined;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[hsl(var(--background))]">
      <aside className="w-56 shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col">
        {/* Profile section */}
        <div className="p-4 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <QQLink uin={user?.uin} className="shrink-0">
              <img
                src={user?.uin ? `./media/avatars/${user.uin}_qz.jpg` : ''}
                alt=""
                className="w-10 h-10 rounded-full object-cover ring-1 ring-[hsl(var(--border))] hover:ring-2 transition"
                onError={(e) => { const el = e.target as HTMLImageElement; if (!el.dataset.fallback) { el.dataset.fallback = '1'; el.src = user?.uin ? `./media/avatars/${user!.uin}.jpg` : ''; } else { el.style.display = 'none'; } }}
              />
            </QQLink>
            <div className="flex-1 min-w-0">
              <QQLink uin={user?.uin} className="text-sm font-semibold text-[hsl(var(--foreground))] truncate block">
                {user?.nickname || 'QZone Archive'}
              </QQLink>
              {user?.uin && <p className="text-xs text-[hsl(var(--muted-foreground))]">QQ {user.uin}</p>}
            </div>
            <ThemeToggle />
          </div>
        </div>

        {/* Content modules */}
        <nav className="flex-1 overflow-y-auto py-2">
          {contentNavItems.map(({ to, label, icon, countKey, ownerOnly }) => {
            const count = getCount(countKey);
            // Owner-only modules: hide if their count field doesn't exist in user.json
            if (ownerOnly && user && count === undefined) return null;
            // Non-owner modules: hide if count field exists and is 0
            if (!ownerOnly && countKey && user && count !== undefined && count <= 0) return null;
            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-medium'
                      : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]'
                  }`
                }
              >
                <span className="text-base">{icon}</span>
                <span className="flex-1">{label}</span>
                {count !== undefined && count > 0 && (
                  <span className="text-xs opacity-60 tabular-nums">{count}</span>
                )}
              </NavLink>
            );
          })}

          {/* Separator */}
          <div className="my-2 mx-4 border-t border-[hsl(var(--border))]" />

          {/* Utility links */}
          {utilNavItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-medium'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]'
                }`
              }
            >
              <span className="text-base">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main ref={mainRef} onScroll={handleScroll} className="flex-1 overflow-y-auto bg-[hsl(var(--background))]">
        <Outlet />
      </main>
    </div>
  );
}
