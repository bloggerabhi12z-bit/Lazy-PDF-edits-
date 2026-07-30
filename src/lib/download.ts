import { publishResult } from "./result-store";

export function downloadBlob(bytes: Uint8Array | Blob, filename: string, mime = "application/pdf") {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  publishResult({
    name: filename,
    mime: blob.type || mime,
    size: blob.size,
    url,
    createdAt: Date.now(),
  });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
