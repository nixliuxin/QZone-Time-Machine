import { Link, useLocation } from 'react-router-dom';

const routeLabels: Record<string, string> = {
  '': '概览',
  messages: '说说',
  blogs: '日志',
  photos: '相册',
  videos: '视频',
  boards: '留言板',
  diaries: '私密日记',
  visitors: '访客',
  friends: '好友',
  favorites: '收藏',
  shares: '分享',
};

interface BreadcrumbProps {
  extra?: { label: string; href?: string }[];
}

export function Breadcrumb({ extra }: BreadcrumbProps) {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  const crumbs: { label: string; href?: string }[] = [
    { label: '概览', href: '/' },
  ];

  if (segments.length > 0) {
    const routeKey = segments[0];
    const label = routeLabels[routeKey] || routeKey;
    crumbs.push({ label, href: `/${routeKey}` });
  }

  if (extra) {
    crumbs.push(...extra);
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))] mb-4">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-xs">/</span>}
            {isLast || !crumb.href ? (
              <span className="text-[hsl(var(--foreground))] font-medium">{crumb.label}</span>
            ) : (
              <Link to={crumb.href} className="hover:text-[hsl(var(--foreground))] transition">{crumb.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
