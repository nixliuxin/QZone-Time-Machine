import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const DEFAULT_PAGE_SIZE = 50;

export function usePagination<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paged = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );

  const setPage = (p: number) => {
    const params = new URLSearchParams(searchParams);
    if (p <= 1) {
      params.delete('page');
    } else {
      params.set('page', String(p));
    }
    setSearchParams(params, { replace: true });
    document.querySelector('main')?.scrollTo(0, 0);
  };

  const goNext = () => { if (safePage < totalPages) setPage(safePage + 1); };
  const goPrev = () => { if (safePage > 1) setPage(safePage - 1); };

  return { paged, currentPage: safePage, totalPages, total, setPage, goNext, goPrev, pageSize };
}
