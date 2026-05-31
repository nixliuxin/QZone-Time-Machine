import { formatQQContent } from '../utils/format';
import { QQLink } from './QQLink';

interface Comment {
  content?: string;
  name?: string;
  nick?: string;
  nickname?: string;
  create_time?: number;
  time?: number;
  createTime2?: string;
  custom_create_time?: string;
  replies?: Comment[];
  list?: Comment[];
  uin?: number;
}

interface CommentListProps {
  comments: Comment[];
  className?: string;
}

export function CommentList({ comments, className = '' }: CommentListProps) {
  if (!comments.length) return null;

  return (
    <div className={`space-y-2 ${className}`}>
      {comments.map((c, i) => (
        <CommentItem key={i} comment={c} />
      ))}
    </div>
  );
}

function CommentItem({ comment, depth = 0 }: { comment: Comment; depth?: number }) {
  const name = comment.nickname || comment.nick || comment.name || '匿名';
  const content = comment.content || '';
  const contentHtml = formatQQContent(content);
  let time = '';
  const ts = comment.create_time || comment.time;
  if (ts && ts > 100000) {
    time = new Date(ts * 1000).toLocaleString('zh-CN');
  } else if (comment.createTime2) {
    time = comment.createTime2;
  } else if (comment.custom_create_time) {
    time = comment.custom_create_time;
  }

  const replies = comment.replies || comment.list || [];

  const avatarUrl = comment.uin ? `./media/avatars/${comment.uin}.jpg` : '';

  return (
    <div className={depth > 0 ? 'ml-4 pl-3 border-l border-[hsl(var(--border))]' : ''}>
      <div className="flex gap-2">
        {avatarUrl && (
          <QQLink uin={comment.uin} className="shrink-0 mt-0.5">
            <img
              src={avatarUrl}
              alt=""
              className="w-6 h-6 rounded-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </QQLink>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs">
            <QQLink uin={comment.uin} className="font-medium text-[hsl(var(--foreground))] [&_.qq-emoji]:inline-block [&_.qq-emoji]:w-4 [&_.qq-emoji]:h-4 [&_.qq-emoji]:align-text-bottom">
              <span dangerouslySetInnerHTML={{ __html: formatQQContent(name) }} />
            </QQLink>
            {time && <span className="ml-2 text-[hsl(var(--muted-foreground))]">{time}</span>}
          </div>
          {contentHtml && (
            <div
              className="text-sm text-[hsl(var(--foreground))] mt-0.5 whitespace-pre-wrap [&_.qq-emoji]:inline-block [&_.qq-emoji]:w-5 [&_.qq-emoji]:h-5 [&_.qq-emoji]:align-text-bottom"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          )}
        </div>
      </div>
      {replies.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {replies.map((r, i) => (
            <CommentItem key={i} comment={r} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
