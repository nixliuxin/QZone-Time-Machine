interface PaginationProps {
  currentPage: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, total, pageSize, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const rangeStart = (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);

  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="flex flex-col items-center gap-2 py-6">
      <div className="flex items-center gap-1">
        <button
          data-kbd="prev"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="px-3 py-1.5 rounded border border-[hsl(var(--border))] text-sm disabled:opacity-30 hover:bg-[hsl(var(--accent))] transition"
        >
          &lsaquo; 上一页
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dot-${i}`} className="px-2 text-[hsl(var(--muted-foreground))]">&hellip;</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`w-8 h-8 rounded text-sm transition ${
                p === currentPage
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold'
                  : 'border border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))]'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          data-kbd="next"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="px-3 py-1.5 rounded border border-[hsl(var(--border))] text-sm disabled:opacity-30 hover:bg-[hsl(var(--accent))] transition"
        >
          下一页 &rsaquo;
        </button>
      </div>
      <span className="text-xs text-[hsl(var(--muted-foreground))]">
        显示 {rangeStart}-{rangeEnd}，共 {total} 条
      </span>
    </div>
  );
}
