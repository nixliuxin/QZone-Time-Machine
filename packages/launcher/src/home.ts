import type { UserMeta } from './server.js';

const COUNT_LABELS: Record<string, string> = {
  messages: '说说', blogs: '日志', photos: '照片', boards: '留言',
  videos: '视频', friends: '好友', shares: '分享', diaries: '日记',
};

/** Self-contained homepage listing every archived user. */
export function renderHome(users: UserMeta[]): string {
  const withData = users.filter((u) => u.counts && Object.keys(u.counts).length > 0);
  const data = JSON.stringify(users);
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QQ空间时光机 · 全部 ${users.length} 人</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    background: #f4f5f7; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #15171a; color: #e8e8e8; } header { background: #1c1f24 !important; border-color: #2a2e35 !important; } .card { background: #1c1f24 !important; border-color: #2a2e35 !important; } input { background: #14161a !important; color: #e8e8e8 !important; border-color: #2a2e35 !important; } }
  header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e5e7eb; padding: 16px 24px; z-index: 10; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  .sub { color: #888; font-size: 13px; }
  input { width: 100%; max-width: 420px; margin-top: 12px; padding: 9px 12px; border: 1px solid #ddd;
    border-radius: 8px; font-size: 14px; outline: none; }
  input:focus { border-color: #4a90d9; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; padding: 20px 24px; }
  a.card { display: flex; gap: 12px; align-items: center; padding: 12px; background: #fff; border: 1px solid #e5e7eb;
    border-radius: 12px; text-decoration: none; color: inherit; transition: transform .1s, box-shadow .1s; }
  a.card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.08); }
  .avatar { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: #d0d4da; flex-shrink: 0; }
  .ph { display: flex; align-items: center; justify-content: center; font-weight: 600; color: #fff; font-size: 18px; }
  .meta { min-width: 0; flex: 1; }
  .nm { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { font-size: 10px; padding: 1px 6px; border-radius: 6px; background: #4a90d9; color: #fff; margin-left: 6px; vertical-align: middle; }
  .ct { color: #888; font-size: 12px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { padding: 60px 24px; text-align: center; color: #999; }
</style></head>
<body>
<header>
  <h1>QQ空间时光机</h1>
  <div class="sub">共 ${users.length} 人，其中 ${withData.length} 人有归档内容</div>
  <input id="q" type="search" placeholder="搜索昵称…" autocomplete="off">
</header>
<div id="grid" class="grid"></div>
<div id="empty" class="empty" style="display:none">没有匹配的结果</div>
<script>
const USERS = ${data};
const LABELS = ${JSON.stringify(COUNT_LABELS)};
const COLORS = ['#e57373','#64b5f6','#81c784','#ffb74d','#ba68c8','#4db6ac','#f06292','#7986cb'];
function colorFor(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return COLORS[h%COLORS.length];}
function countText(c){ if(!c) return ''; return Object.keys(c).map(k=>(LABELS[k]||k)+' '+c[k]).join(' · '); }
function card(u){
  const a=document.createElement('a'); a.className='card'; a.href='/u/'+encodeURIComponent(u.id)+'/';
  const hasC=u.counts&&Object.keys(u.counts).length>0;
  const av=document.createElement(u.avatar?'img':'div'); av.className='avatar'+(u.avatar?'':' ph');
  if(u.avatar){av.src='/u/'+encodeURIComponent(u.id)+'/'+u.avatar; av.loading='lazy'; av.onerror=()=>{const d=document.createElement('div');d.className='avatar ph';d.style.background=colorFor(u.name);d.textContent=(u.name||'?').slice(0,1);av.replaceWith(d);};}
  else {av.style.background=colorFor(u.name); av.textContent=(u.name||'?').slice(0,1);}
  const meta=document.createElement('div'); meta.className='meta';
  const nm=document.createElement('div'); nm.className='nm'; nm.textContent=u.name||u.id;
  if(u.isOwner){const b=document.createElement('span');b.className='badge';b.textContent='我';nm.appendChild(b);}
  const ct=document.createElement('div'); ct.className='ct'; ct.textContent=hasC?countText(u.counts):'无归档内容';
  meta.appendChild(nm); meta.appendChild(ct); a.appendChild(av); a.appendChild(meta);
  return a;
}
const grid=document.getElementById('grid'), empty=document.getElementById('empty'), q=document.getElementById('q');
function render(list){ grid.innerHTML=''; empty.style.display=list.length?'none':'block';
  const frag=document.createDocumentFragment(); list.forEach(u=>frag.appendChild(card(u))); grid.appendChild(frag); }
// Sort: users with content first.
const sorted=[...USERS].sort((a,b)=>{const ca=a.counts?Object.keys(a.counts).length:0,cb=b.counts?Object.keys(b.counts).length:0; if(!!cb!==!!ca)return cb-ca; return (a.name||'').localeCompare(b.name||'','zh');});
render(sorted);
q.addEventListener('input',()=>{const t=q.value.trim().toLowerCase();
  render(t?sorted.filter(u=>(u.name||'').toLowerCase().includes(t)||(u.nickname||'').toLowerCase().includes(t)||(u.id||'').toLowerCase().includes(t)):sorted);});
</script>
</body></html>`;
}
