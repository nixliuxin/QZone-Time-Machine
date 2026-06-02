/**
 * Zero-install launcher entry point.
 *
 * Usage:
 *   qzone-launcher [archiveRoot] [--port N] [--no-open]
 *
 * When compiled to an exe and double-clicked, it serves the directory the exe
 * lives in (or the given root) and opens the default browser.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createArchiveServer } from './server.js';

function isPackaged(): boolean {
  try {
    // Node Single Executable Application API.
    const req = (globalThis as { require?: (m: string) => unknown }).require
      || (typeof require !== 'undefined' ? require : undefined);
    if (req) {
      const sea = req('node:sea') as { isSea?: () => boolean };
      if (sea && typeof sea.isSea === 'function' && sea.isSea()) return true;
    }
  } catch { /* not SEA */ }
  return !!(process as unknown as { pkg?: unknown }).pkg;
}

function resolveRoot(argRoot?: string): string {
  if (argRoot) return resolve(argRoot);
  // When packaged as an exe, serve the directory the executable sits in
  // (so a non-technical user just drops the exe into the archive and double-clicks).
  const exeDir = process.execPath ? dirname(process.execPath) : '';
  if (isPackaged() && exeDir) return exeDir;
  return process.cwd();
}

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    else if (platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* user can open manually */ }
}

function listen(server: import('node:http').Server, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let attempts = 0;
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attempts < 100) {
        attempts++; port++; setTimeout(tryListen, 0);
      } else {
        reject(err);
      }
    };
    const tryListen = () => {
      server.removeListener('error', onError);
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    };
    tryListen();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const noOpen = args.includes('--no-open');
  const portIdx = args.indexOf('--port');
  const startPort = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) || 7654 : 7654;
  const rootArg = args.find((a, i) => !a.startsWith('--') && (portIdx < 0 || i !== portIdx + 1));
  const root = resolveRoot(rootArg);

  const { server, userCount, singleId } = createArchiveServer(root);
  if (userCount === 0) {
    console.error(`\n  未在该位置找到任何归档：${root}`);
    console.error('  用法：把本程序放进包含 *.zip 的归档目录后双击，');
    console.error('  或把某个人的 .zip 文件拖到本程序上单独查看。\n');
    process.stdout.write('按回车键退出…');
    process.stdin.once('data', () => process.exit(1));
    return;
  }

  const port = await listen(server, startPort);
  const base = `http://127.0.0.1:${port}/`;
  // A single zip opens that person directly; a directory opens the list homepage.
  const url = singleId ? `${base}u/${encodeURIComponent(singleId)}/` : base;
  console.log(`\n  QQ空间时光机 已启动`);
  console.log(`  来源: ${root}`);
  console.log(singleId ? `  单人模式: ${singleId}` : `  共 ${userCount} 人`);
  console.log(`\n  浏览器地址: ${url}`);
  console.log(`  （关闭此窗口即停止服务）\n`);
  if (!noOpen) openBrowser(url);
}

main().catch((err) => { console.error('启动失败:', err); process.exit(1); });
