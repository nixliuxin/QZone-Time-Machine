export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
}

export type ModuleStatus = 'pending' | 'running' | 'done' | 'error' | 'rate_limited' | 'no_access';

export const MODULE_NAMES = [
  'common', 'messages', 'blogs', 'photos', 'boards', 'videos',
  'friends', 'diaries', 'favorites', 'shares', 'visitors',
] as const;

export type ModuleName = typeof MODULE_NAMES[number];
