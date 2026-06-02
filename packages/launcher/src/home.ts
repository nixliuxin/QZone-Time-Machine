import type { UserMeta } from './server.js';

const COUNT_LABELS: Record<string, string> = {
  messages: '说说', blogs: '日志', photos: '照片', boards: '留言',
  videos: '视频', friends: '好友', shares: '分享', diaries: '日记',
};

// Classic QQ emoji set (e100-e199), mirrors packages/viewer/src/utils/format.ts.
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

/** Self-contained homepage listing every archived user, themed like the viewer. */
export function renderHome(users: UserMeta[]): string {
  const withData = users.filter((u) => u.counts && Object.keys(u.counts).length > 0);
  const data = JSON.stringify(users);
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QQ空间时光机 · 全部 ${users.length} 人</title>
<style>
  /* Palette mirrors the viewer (packages/viewer/src/index.css). */
  :root {
    --background: 0 0% 100%; --foreground: 0 0% 3.9%;
    --card: 0 0% 100%; --muted: 0 0% 96.1%; --muted-foreground: 0 0% 45.1%;
    --accent: 0 0% 96.1%; --border: 0 0% 89.8%;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: 0 0% 3.9%; --foreground: 0 0% 98%;
      --card: 0 0% 5.5%; --muted: 0 0% 14.9%; --muted-foreground: 0 0% 63.9%;
      --accent: 0 0% 14.9%; --border: 0 0% 14.9%;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: hsl(var(--background)); color: hsl(var(--foreground));
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  header {
    position: sticky; top: 0; z-index: 10; padding: 16px 24px;
    background: hsl(var(--background) / 0.9); backdrop-filter: blur(8px);
    border-bottom: 1px solid hsl(var(--border));
  }
  h1 { margin: 0; font-size: 17px; font-weight: 600; }
  .sub { color: hsl(var(--muted-foreground)); font-size: 13px; margin-top: 3px; }
  .tools { display: flex; gap: 10px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
  input[type=search] {
    flex: 1; min-width: 200px; max-width: 420px; padding: 9px 12px;
    background: hsl(var(--muted)); color: hsl(var(--foreground));
    border: 1px solid hsl(var(--border)); border-radius: 8px; font-size: 14px; outline: none;
  }
  input[type=search]:focus { border-color: hsl(var(--foreground) / 0.4); }
  .toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: hsl(var(--muted-foreground)); cursor: pointer; user-select: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; padding: 20px 24px; align-items: start; }
  a.card {
    display: flex; gap: 12px; padding: 14px; text-decoration: none; color: inherit;
    background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 12px;
    transition: border-color .12s, transform .12s, box-shadow .12s;
  }
  a.card:hover { border-color: hsl(var(--foreground) / 0.3); transform: translateY(-2px); box-shadow: 0 6px 20px hsl(var(--foreground) / 0.06); }
  .avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; background: hsl(var(--muted)); flex-shrink: 0; }
  .ph { display: flex; align-items: center; justify-content: center; font-weight: 600; color: #fff; font-size: 20px; }
  .meta { min-width: 0; flex: 1; }
  .nm { font-weight: 600; font-size: 15px; line-height: 1.3; word-break: break-word; }
  .badge { font-size: 10px; padding: 1px 6px; border-radius: 6px; background: hsl(var(--foreground)); color: hsl(var(--background)); margin-left: 6px; vertical-align: middle; font-weight: 500; }
  .nick { font-size: 12.5px; color: hsl(var(--muted-foreground)); margin-top: 2px; word-break: break-word; }
  .qq { font-size: 12px; color: hsl(var(--muted-foreground)); margin-top: 2px; font-variant-numeric: tabular-nums; }
  .counts { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 8px; }
  .chip { font-size: 11.5px; padding: 2px 7px; border-radius: 6px; background: hsl(var(--muted)); color: hsl(var(--foreground)); white-space: nowrap; }
  .none { font-size: 12px; color: hsl(var(--muted-foreground)); margin-top: 8px; }
  .empty { padding: 60px 24px; text-align: center; color: hsl(var(--muted-foreground)); }
</style></head>
<body>
<header>
  <h1>QQ空间时光机</h1>
  <div class="sub">共 ${users.length} 人 · ${withData.length} 人有归档内容</div>
  <div class="tools">
    <input id="q" type="search" placeholder="搜索 昵称 / 备注 / QQ号…" autocomplete="off">
    <label class="toggle"><input id="onlyData" type="checkbox"> 只看有内容</label>
  </div>
</header>
<div id="grid" class="grid"></div>
<div id="empty" class="empty" style="display:none">没有匹配的结果</div>
<script>
const USERS = ${data};
const LABELS = ${JSON.stringify(COUNT_LABELS)};
const EMOJI = ${JSON.stringify(QQ_EMOJI)};
// Decode QQ nickname markup to plain text: classic [em]eNNN[/em] -> emoji,
// unknown sticker ids dropped, @{uin,nick} mentions -> @nick.
function decodeQQ(s){
  if(!s) return '';
  return String(s)
    .replace(/\\[em\\](e\\d+)\\[\\/em\\]/g, (_,c)=> EMOJI[c]||'')
    .replace(/@\\{uin:\\d+,nick:([^,}]+),who:\\d+\\}/g, (_,n)=>'@'+n)
    .trim();
}
const COLORS = ['#e57373','#64b5f6','#81c784','#ffb74d','#ba68c8','#4db6ac','#f06292','#7986cb','#9575cd','#4dd0e1'];
function colorFor(s){let h=0;for(let i=0;i<(s||'').length;i++)h=(h*31+s.charCodeAt(i))>>>0;return COLORS[h%COLORS.length];}
function hasCounts(u){ return u.counts && Object.keys(u.counts).length>0; }
function card(u){
  const a=document.createElement('a'); a.className='card'; a.href='/u/'+encodeURIComponent(u.id)+'/';
  const title=decodeQQ(u.remark||u.nickname||u.name||'')||String(u.uin||'?');
  // Avatar
  let av;
  if(u.avatar){ av=document.createElement('img'); av.className='avatar'; av.src='/u/'+encodeURIComponent(u.id)+'/'+u.avatar; av.loading='lazy';
    av.onerror=function(){ const d=document.createElement('div'); d.className='avatar ph'; d.style.background=colorFor(title); d.textContent=(title||'?').slice(0,1); av.replaceWith(d); }; }
  else { av=document.createElement('div'); av.className='avatar ph'; av.style.background=colorFor(title); av.textContent=(title||'?').slice(0,1); }
  const meta=document.createElement('div'); meta.className='meta';
  const nm=document.createElement('div'); nm.className='nm'; nm.textContent=title;
  if(u.isOwner){ const b=document.createElement('span'); b.className='badge'; b.textContent='我'; nm.appendChild(b); }
  meta.appendChild(nm);
  if(u.remark && u.nickname && u.remark!==u.nickname){ const nk=document.createElement('div'); nk.className='nick'; nk.textContent='昵称：'+(decodeQQ(u.nickname)||u.nickname); meta.appendChild(nk); }
  if(u.uin){ const qq=document.createElement('div'); qq.className='qq'; qq.textContent='QQ '+u.uin; meta.appendChild(qq); }
  if(hasCounts(u)){ const c=document.createElement('div'); c.className='counts';
    Object.keys(u.counts).forEach(k=>{ const s=document.createElement('span'); s.className='chip'; s.textContent=(LABELS[k]||k)+' '+u.counts[k]; c.appendChild(s); });
    meta.appendChild(c);
  } else { const n=document.createElement('div'); n.className='none'; n.textContent='无归档内容'; meta.appendChild(n); }
  a.appendChild(av); a.appendChild(meta);
  return a;
}
const grid=document.getElementById('grid'), empty=document.getElementById('empty'), q=document.getElementById('q'), onlyData=document.getElementById('onlyData');
const sorted=[...USERS].sort((a,b)=>{ const ca=hasCounts(a)?1:0, cb=hasCounts(b)?1:0; if(cb!==ca)return cb-ca; return decodeQQ(a.remark||a.nickname||'').localeCompare(decodeQQ(b.remark||b.nickname||''),'zh'); });
function apply(){
  const t=q.value.trim().toLowerCase(); const od=onlyData.checked;
  let list=sorted;
  if(od) list=list.filter(hasCounts);
  if(t) list=list.filter(u=>[u.remark,u.nickname,u.name,decodeQQ(u.remark||u.nickname||u.name||''),String(u.uin||'')].some(v=>(v||'').toLowerCase().includes(t)));
  grid.innerHTML=''; empty.style.display=list.length?'none':'block';
  const frag=document.createDocumentFragment(); list.forEach(u=>frag.appendChild(card(u))); grid.appendChild(frag);
}
q.addEventListener('input',apply); onlyData.addEventListener('change',apply); apply();
</script>
</body></html>`;
}
