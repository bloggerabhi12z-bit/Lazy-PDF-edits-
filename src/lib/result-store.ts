import { useEffect, useState } from "react";

export type DownloadResult = {
  name: string;
  mime: string;
  size: number;
  url: string;
  createdAt: number;
};

let current: DownloadResult | null = null;
const listeners = new Set<(r: DownloadResult | null) => void>();

export function publishResult(r: DownloadResult | null) {
  if (current && current.url && current.url !== r?.url) {
    // revoke previous
    try { URL.revokeObjectURL(current.url); } catch { /* noop */ }
  }
  current = r;
  listeners.forEach((l) => l(current));
}

export function useLastResult() {
  const [r, setR] = useState<DownloadResult | null>(current);
  useEffect(() => {
    listeners.add(setR);
    return () => { listeners.delete(setR); };
  }, []);
  return r;
}
