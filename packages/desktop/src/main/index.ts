import { app, BrowserWindow, ipcMain, session as electronSession, shell, WebContentsView } from 'electron';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import type { Cookie } from 'electron';

const LOGIN_TOPBAR = 44; // px reserved at the top for the cancel bar during inline login

/**
 * QZone web login widget (appid 549000912). Mirrors the URL the CLI's qr-login uses.
 * We render it in a REAL Electron Chromium window (no automation flags / no webdriver),
 * so the resulting session is indistinguishable from a human browser login.
 */
const XLOGIN_REFERER =
  'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?proxy_url=https%3A//qzs.qq.com/qzone/v6/portal/proxy.html' +
  '&daid=5&hide_title_bar=1&low_login=0&qlogin_auto_login=1&no_verifyimg=1' +
  '&link_target=blank&appid=549000912&style=22&target=self' +
  '&s_url=https%3A//qzs.qq.com/qzone/v5/loginsucc.html%3Fpara%3Dizone' +
  '&pt_qr_app=%E6%89%8B%E6%9C%BAQQ%E7%A9%BA%E9%97%B4&pt_qr_link=https%3A//z.qzone.com/download.html' +
  '&self_regurl=https%3A//qzs.qq.com/qzone/v6/reg/index.html' +
  '&pt_qr_help_link=https%3A//z.qzone.com/download.html&pt_no_auth=0';
const QZONE_HOME = 'https://user.qzone.qq.com';
const LOGIN_PARTITION = 'persist:qzone';

// ─── session helpers (byte-identical to packages/cli/engine/session.js) ───

function calcGtk(skey: string | undefined): number | undefined {
  if (!skey) return undefined;
  let hash = 5381;
  for (let i = 0, len = skey.length; i < len; ++i) {
    hash += (hash << 5) + skey.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}

type SimpleCookie = { name: string; value: string; domain?: string; path?: string };

function pickCookie(cookies: SimpleCookie[], name: string, preferDomainContains?: string): string | undefined {
  const matches = cookies.filter((c) => c.name === name);
  if (matches.length === 0) return undefined;
  if (preferDomainContains) {
    const preferred = matches.find((c) => (c.domain || '').includes(preferDomainContains));
    if (preferred) return preferred.value;
  }
  return matches[0].value;
}

function extractUin(cookies: SimpleCookie[]): number | undefined {
  const pUin = pickCookie(cookies, 'p_uin') || pickCookie(cookies, 'uin') || '';
  const m = /\d+/.exec(pUin);
  return m ? Number(m[0]) : undefined;
}

function toSimple(cookies: Cookie[]): SimpleCookie[] {
  return cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
}

// ─── control window (React renderer) ───

let controlWin: BrowserWindow | null = null;
let loginView: WebContentsView | null = null;

function createControlWindow(): void {
  controlWin = new BrowserWindow({
    width: 720,
    height: 560,
    title: 'QQ空间时光机 · 登录',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  });

  controlWin.on('resize', layoutLoginView);

  if (process.env.ELECTRON_RENDERER_URL) {
    controlWin.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    controlWin.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/** Keep the inline login view sized to fill the window below the cancel bar. */
function layoutLoginView(): void {
  if (!loginView || !controlWin) return;
  const [w, h] = controlWin.getContentSize();
  loginView.setBounds({ x: 0, y: LOGIN_TOPBAR, width: w, height: Math.max(0, h - LOGIN_TOPBAR) });
}

function teardownLoginView(): void {
  if (loginView && controlWin) {
    try {
      controlWin.contentView.removeChildView(loginView);
    } catch {
      /* ignore */
    }
    try {
      loginView.webContents.close();
    } catch {
      /* ignore */
    }
  }
  loginView = null;
}

// ─── login flow ───

interface LoginResult {
  ok: boolean;
  uin?: number;
  gtk?: number;
  cookieCount?: number;
  path?: string;
  error?: string;
}

let loginCancel: (() => void) | null = null;

function waitForLogin(part: Electron.Session, timeoutMs = 5 * 60 * 1000): Promise<SimpleCookie[]> {
  return new Promise((resolveP, rejectP) => {
    const t0 = Date.now();
    let done = false;
    loginCancel = () => {
      if (done) return;
      done = true;
      rejectP(new Error('已取消登录'));
    };
    const tick = async () => {
      if (done) return;
      if (Date.now() - t0 > timeoutMs) {
        done = true;
        rejectP(new Error('登录超时(5分钟)'));
        return;
      }
      try {
        const all = toSimple(await part.cookies.get({}));
        const pskey = pickCookie(all, 'p_skey', '.qzone.qq.com') || pickCookie(all, 'p_skey');
        const uin = extractUin(all);
        if (pskey && uin) {
          done = true;
          resolveP(all);
          return;
        }
      } catch {
        /* keep polling */
      }
      setTimeout(tick, 1200);
    };
    setTimeout(tick, 1200);
  });
}

async function doLogin(targetDir: string): Promise<LoginResult> {
  if (!controlWin) return { ok: false, error: '主窗口不可用' };
  if (loginView) return { ok: false, error: '登录已在进行中' };

  const part = electronSession.fromPartition(LOGIN_PARTITION);
  loginView = new WebContentsView({ webPreferences: { partition: LOGIN_PARTITION } });
  controlWin.contentView.addChildView(loginView);
  layoutLoginView();
  controlWin.webContents.send('login-state', 'started');

  try {
    await loginView.webContents.loadURL(XLOGIN_REFERER, { httpReferrer: QZONE_HOME });
    await waitForLogin(part);

    // Visit the zone home once to ensure all zone cookies (p_skey on .qzone.qq.com) are minted.
    try {
      await loginView.webContents.loadURL(QZONE_HOME);
      await new Promise((r) => setTimeout(r, 1500));
    } catch {
      /* non-fatal */
    }

    const all = toSimple(await part.cookies.get({}));
    const qq = all.filter((c) => (c.domain || '').includes('qq.com'));
    const uin = extractUin(qq);
    const pSkey = pickCookie(qq, 'p_skey', '.qzone.qq.com') || pickCookie(qq, 'p_skey');
    const seed = pSkey || pickCookie(qq, 'skey') || pickCookie(qq, 'rv2');
    const gtk = calcGtk(seed);

    if (!uin || !gtk) {
      return { ok: false, error: '未能从 cookie 中解析出 uin 或 g_tk(请确认已真正登录 QQ 空间)' };
    }

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'cookies.json'), JSON.stringify(qq, null, 2), 'utf8');
    writeFileSync(join(targetDir, 'auth.json'), JSON.stringify({ gtk, uin, pSkey }, null, 2), 'utf8');
    writeFileSync(
      join(targetDir, 'session_meta.json'),
      JSON.stringify({ createdAt: new Date().toISOString(), createdAtMs: Date.now() }, null, 2),
      'utf8',
    );

    return { ok: true, uin, gtk, cookieCount: qq.length, path: targetDir };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    loginCancel = null;
    teardownLoginView();
    if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('login-state', 'idle');
  }
}

// ─── IPC ───

ipcMain.handle('start-login', async (_evt, targetDir: string): Promise<LoginResult> => {
  const dir = (targetDir || '').trim();
  if (!dir) return { ok: false, error: '请填写目标目录' };
  return doLogin(dir);
});

ipcMain.handle('cancel-login', async () => {
  if (loginCancel) loginCancel();
});

ipcMain.handle('open-path', async (_evt, p: string) => {
  if (p) await shell.openPath(p);
});

// ─── app lifecycle ───

app.whenReady().then(() => {
  createControlWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
