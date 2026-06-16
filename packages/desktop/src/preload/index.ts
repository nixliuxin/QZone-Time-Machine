import { contextBridge, ipcRenderer } from 'electron';

export interface LoginResult {
  ok: boolean;
  uin?: number;
  gtk?: number;
  cookieCount?: number;
  path?: string;
  error?: string;
}

const api = {
  startLogin: (targetDir: string): Promise<LoginResult> => ipcRenderer.invoke('start-login', targetDir),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke('cancel-login'),
  openPath: (p: string): Promise<void> => ipcRenderer.invoke('open-path', p),
  onLoginState: (cb: (state: 'started' | 'idle') => void): (() => void) => {
    const handler = (_e: unknown, state: 'started' | 'idle') => cb(state);
    ipcRenderer.on('login-state', handler);
    return () => ipcRenderer.removeListener('login-state', handler);
  },
};

contextBridge.exposeInMainWorld('qz', api);

export type QzApi = typeof api;
