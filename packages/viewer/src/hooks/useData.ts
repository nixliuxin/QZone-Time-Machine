import { useState, useEffect } from 'react';

declare global {
  interface Window {
    __QZONE_DATA__?: Record<string, unknown>;
  }
}

function getEmbeddedData(path: string): { found: boolean; value: unknown } {
  const store = window.__QZONE_DATA__;
  if (!store) return { found: false, value: undefined };

  // Normalize path: "./data/messages.json" → "messages"
  // "./data/photos/albums.json" → "photos/albums"
  // "./data/photos/12345.json" → "photos/12345"
  const normalized = path
    .replace(/^\.\/data\//, '')
    .replace(/\.json$/, '');

  if (normalized in store) return { found: true, value: store[normalized] };
  return { found: false, value: undefined };
}

export function useData<T>(path: string): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    // Priority 1: embedded data (works with file:// protocol)
    const { found, value } = getEmbeddedData(path);
    if (found) {
      setData(value as T);
      setLoading(false);
      return;
    }

    // Priority 2: fetch from server (works with http:// protocol)
    const resolvedPath = new URL(path, window.location.href).href;

    fetch(resolvedPath)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { setData(d as T); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [path]);

  return { data, loading, error };
}
