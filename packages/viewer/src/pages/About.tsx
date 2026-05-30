const GITHUB_URL = 'https://github.com/nixliuxin/QZone-Tools';

export function About() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-[hsl(var(--foreground))] mb-2">QZone-Tools</h1>
        <p className="text-lg text-[hsl(var(--muted-foreground))]">备份你的 QQ 空间回忆，在它们消失之前。</p>
      </div>

      <section className="space-y-6">
        <Card title="关于">
          <p className="text-sm text-[hsl(var(--foreground))] leading-relaxed">
            QZone-Tools 是一个开源的 QQ 空间数据备份工具。它能完整保存你的说说、日志、相册、视频、留言板等所有内容，
            并生成一个可以离线浏览的 HTML 文件——双击即可打开，无需联网，无需安装任何软件。
          </p>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-3 leading-relaxed">
            你的数据只属于你。所有备份都保存在本地，不会上传到任何服务器。
          </p>
        </Card>

        <Card title="链接">
          <div className="space-y-2.5">
            <ExtLink href={GITHUB_URL} label="GitHub 源代码" />
            <ExtLink href={`${GITHUB_URL}/issues`} label="问题反馈 & 功能建议" />
            <ExtLink href={`${GITHUB_URL}/releases`} label="版本下载" />
          </div>
        </Card>

        <Card title="声明">
          <div className="text-xs text-[hsl(var(--muted-foreground))] space-y-2 leading-relaxed">
            <p><strong className="text-[hsl(var(--foreground))]">安全</strong> — 本工具仅在本地运行，登录凭证保存在本地，不会上传至任何第三方服务器。</p>
            <p><strong className="text-[hsl(var(--foreground))]">隐私</strong> — 本工具仅用于备份你自己的 QQ 空间数据，请勿用于未经授权地获取他人数据。</p>
            <p><strong className="text-[hsl(var(--foreground))]">版权</strong> — QQ空间、QQ 等商标属于深圳市腾讯计算机系统有限公司，本工具与腾讯无关联。</p>
            <p><strong className="text-[hsl(var(--foreground))]">免责</strong> — 本工具按「原样」提供，不作任何保证。使用所产生的后果由用户自行承担。</p>
          </div>
        </Card>

        <div className="text-center pt-2 text-xs text-[hsl(var(--muted-foreground))]">
          <p>MIT License (c) 2026 Nix Liu Xin</p>
        </div>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">{title}</h2>
      {children}
    </div>
  );
}

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-sm text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] transition"
    >
      <svg className="w-4 h-4 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
      <span>{label}</span>
    </a>
  );
}
