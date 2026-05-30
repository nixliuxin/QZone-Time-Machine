/**
 * Format a date value that could be:
 * - a string like "2017-01-09" or "2010-01-01 14:27:48" or ISO string
 * - a unix timestamp (number, seconds)
 * - 0 or falsy → empty string
 */
export function formatDate(val: string | number | undefined | null): string {
  if (!val || val === 0 || val === '0') return '';
  if (typeof val === 'string') {
    if (val.includes('T') || val.includes('-') || val.includes('/')) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN');
    }
    return val;
  }
  if (typeof val === 'number') {
    if (val < 100000) return '';
    const d = new Date(val * 1000);
    if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN');
  }
  return '';
}

export function formatDateShort(val: string | number | undefined | null): string {
  if (!val || val === 0 || val === '0') return '';
  if (typeof val === 'string') {
    if (val.includes('T')) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('zh-CN');
    }
    return val.split(' ')[0] || val;
  }
  if (typeof val === 'number') {
    if (val < 100000) return '';
    return new Date(val * 1000).toLocaleDateString('zh-CN');
  }
  return '';
}

/**
 * Convert QQ [em]eXXXXXX[/em] emotion codes to img tags.
 * QQ emotions use IDs from e100 to e500000+.
 * We map to a CDN URL or local fallback.
 */
export function formatQQContent(text: string): string {
  if (!text) return '';
  return text.replace(
    /\[em\](e\d+)\[\/em\]/g,
    (_match, code: string) => {
      return `<img class="qq-emoji" src="media/emoji/${code}.gif" alt="[${code}]" onerror="this.style.display='none';this.insertAdjacentText('afterend','[${code}]')" />`;
    }
  );
}

/**
 * Group items by a time field into year/month sections.
 */
export function groupByTime<T>(
  items: T[],
  getTime: (item: T) => string | number | undefined,
): { year: string; months: { month: string; items: T[] }[] }[] {
  const yearMap = new Map<string, Map<string, T[]>>();

  for (const item of items) {
    const raw = getTime(item);
    let d: Date | null = null;
    if (typeof raw === 'number' && raw > 100000) d = new Date(raw * 1000);
    else if (typeof raw === 'string' && raw) d = new Date(raw);
    
    const year = d && !isNaN(d.getTime()) ? String(d.getFullYear()) : '未知';
    const month = d && !isNaN(d.getTime()) ? `${d.getMonth() + 1}月` : '';

    if (!yearMap.has(year)) yearMap.set(year, new Map());
    const monthMap = yearMap.get(year)!;
    if (!monthMap.has(month)) monthMap.set(month, []);
    monthMap.get(month)!.push(item);
  }

  return [...yearMap.entries()]
    .sort((a, b) => (b[0] === '未知' ? -1 : Number(b[0]) - Number(a[0])))
    .map(([year, monthMap]) => ({
      year,
      months: [...monthMap.entries()].map(([month, items]) => ({ month, items })),
    }));
}
