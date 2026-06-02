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

const QQ_EMOJI: Record<string, string> = {
  e100:'😊',e101:'😖',e102:'😍',e103:'😳',e104:'😎',e105:'😭',e106:'☺️',
  e107:'🤐',e108:'😴',e109:'😢',e110:'😰',e111:'😡',e112:'😜',e113:'😬',
  e114:'😲',e115:'😞',e116:'🆒',e117:'😰',e118:'😱',e119:'🤮',e120:'🤭',
  e121:'😊',e122:'🙄',e123:'😤',e124:'😋',e125:'😪',e126:'😨',e127:'😅',
  e128:'😄',e129:'🪖',e130:'💪',e131:'🤬',e132:'❓',e133:'🤫',e134:'😵',
  e135:'😩',e136:'💀',e137:'💀',e138:'👊',e139:'👋',e140:'😰',e141:'🤏',
  e142:'👏',e143:'😳',e144:'😏',e145:'😒',e146:'😒',e147:'🥱',e148:'😤',
  e149:'😢',e150:'😭',e151:'😈',e152:'😘',e153:'😨',e154:'🥺',e155:'🔪',
  e156:'🍉',e157:'🍺',e158:'🏀',e159:'🏓',e160:'☕',e161:'🍚',e162:'🐷',
  e163:'🌹',e164:'🥀',e165:'💋',e166:'❤️',e167:'💔',e168:'🎂',e169:'⚡',
  e170:'💣',e171:'🔪',e172:'⚽',e173:'🐞',e174:'💩',e175:'🌙',e176:'☀️',
  e177:'🎁',e178:'🤗',e179:'👍',e180:'👎',e181:'🤝',e182:'✌️',e183:'🤛',
  e184:'☝️',e185:'✊',e186:'🤏',e187:'🤟',e188:'❌',e189:'✅',e190:'❤️',
  e191:'💋',e192:'🤸',e193:'😰',e194:'😤',e195:'🔄',e196:'🙇',e197:'🏃',
  e198:'🙈',e199:'💊',
};

/**
 * Convert QQ [em]eXXX[/em] emotion codes to emoji or img tags.
 * Uses Unicode emoji for the classic set (e100-e199).
 * For extended sticker IDs, tries local gif then falls back to placeholder.
 */
export function formatQQContent(text: string): string {
  if (!text) return '';
  let result = text
    .replace(
      /\[em\](e\d+)\[\/em\]/g,
      (_match, code: string) => {
        const unicode = QQ_EMOJI[code];
        if (unicode) return `<span class="qq-emoji" title="[${code}]">${unicode}</span>`;
        return `<img class="qq-emoji" src="media/emoji/${code}.gif" alt="[${code}]" onerror="this.style.display='none';this.insertAdjacentText('afterend','[sticker]')" />`;
      }
    )
    .replace(
      /@\{uin:(\d+),nick:([^,}]+),who:\d+\}/g,
      (_m, uin: string, nick: string) =>
        `<a class="qq-mention" href="https://user.qzone.qq.com/${uin}" target="_blank" rel="noopener" title="QQ ${uin}">@${nick}</a>`
    );
  return result;
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
