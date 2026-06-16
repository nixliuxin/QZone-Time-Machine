import { useEffect, useState } from 'react';

interface LoginResult {
  ok: boolean;
  uin?: number;
  gtk?: number;
  cookieCount?: number;
  path?: string;
  error?: string;
}

declare global {
  interface Window {
    qz: {
      startLogin: (targetDir: string) => Promise<LoginResult>;
      cancelLogin: () => Promise<void>;
      openPath: (p: string) => Promise<void>;
      onLoginState: (cb: (state: 'started' | 'idle') => void) => () => void;
    };
  }
}

export function App() {
  const [targetDir, setTargetDir] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState(false);
  const [result, setResult] = useState<LoginResult | null>(null);

  useEffect(() => {
    return window.qz.onLoginState((state) => setLogging(state === 'started'));
  }, []);

  async function handleLogin() {
    setBusy(true);
    setResult(null);
    try {
      const r = await window.qz.startLogin(targetDir);
      setResult(r);
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  // While logging in, the QQ login page is embedded below this bar (same window).
  if (logging) {
    return (
      <div className="loginbar">
        <button className="cancel" onClick={() => window.qz.cancelLogin()}>← 取消登录</button>
        <span className="loginbar-title">在下方完成 QQ 空间登录(扫码 / 账号)</span>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="logo">QQ空间时光机</div>
        <div className="subtitle">真实浏览器登录 · 无自动化指纹</div>
      </header>

      <section className="card">
        <p className="lead">
          在同一窗口内完成 QQ 空间登录(扫码 / 账号),登录态会写入<b>项目文件夹</b>的
          <code> cookies.json</code> / <code>auth.json</code>。该文件夹同时用于保存抓取的内容与登录元数据。
        </p>

        <label className="field">
          <span>项目文件夹(内容 + 登录信息)</span>
          <input
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            spellCheck={false}
            disabled={busy}
          />
        </label>

        <button className="primary" onClick={handleLogin} disabled={busy}>
          {busy ? '等待登录中…' : '登录 QQ 空间'}
        </button>

        {result && result.ok && (
          <div className="status ok">
            <div>✅ 登录成功</div>
            <div>QQ 号:<b>{result.uin}</b></div>
            <div>g_tk:{result.gtk}</div>
            <div>已写入 {result.cookieCount} 条 cookie 到:</div>
            <div className="path" onClick={() => result.path && window.qz.openPath(result.path)}>
              {result.path}
            </div>
          </div>
        )}
        {result && !result.ok && (
          <div className="status err">❌ {result.error}</div>
        )}
      </section>

      <footer className="foot">
        登录环节使用真实浏览器会话,不带 webdriver / 自动化标志。cookie 约 24 小时过期,导出后尽快开始抓取。
      </footer>
    </div>
  );
}
