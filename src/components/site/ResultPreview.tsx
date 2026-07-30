import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLastResult } from "@/lib/result-store";
import { publishResult } from "@/lib/result-store";
import { formatBytes } from "@/lib/download";

export function ResultPreview() {
  const result = useLastResult();
  const [thumb, setThumb] = useState<string | null>(null);

  const recordDownload = () => {
    if (!result) return;
    void fetch("/.netlify/functions/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: result.name,
        mime: result.mime,
        size: result.size,
        tool: window.location.pathname.split("/").filter(Boolean).pop() ?? "pdf-tool",
      }),
    }).catch(() => undefined);
  };

  useEffect(() => {
    setThumb(null);
    if (!result) return;
    // Scroll preview into view so users can review before downloading
    setTimeout(() => {
      document.getElementById("result-preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    let cancelled = false;

    if (result.mime.startsWith("image/")) {
      setThumb(result.url);
      return;
    }

    if (result.mime === "application/pdf") {
      (async () => {
        try {
          const { loadPdf, renderPdfPageToCanvas, canvasToBlob } = await import("@/lib/pdf-render");
          const res = await fetch(result.url);
          const blob = await res.blob();
          const file = new File([blob], result.name, { type: "application/pdf" });
          const pdf = await loadPdf(file);
          const canvas = await renderPdfPageToCanvas(pdf, 1, 1.2);
          const previewBlob = await canvasToBlob(canvas, "image/png");
          if (!cancelled) setThumb(URL.createObjectURL(previewBlob));
        } catch {
          /* noop */
        }
      })();
    }
    return () => { cancelled = true; };
  }, [result]);

  return (
    <AnimatePresence>
      {result && (
        <motion.section
          id="result-preview"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="mt-8 overflow-hidden rounded-3xl border border-signal/40 bg-signal-soft/40 p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
                <FileCheck2 className="h-5 w-5" />
              </div>
              <div>
                <div className="font-display text-xl">Preview your file</div>
                <div className="text-sm text-muted-foreground">
                  {result.name} · {formatBytes(result.size)}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => publishResult(null)} aria-label="Dismiss preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Review the output below. When it looks right, tap Download.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="rounded-2xl border border-border bg-card/60 p-3">
              {result.mime === "application/pdf" ? (
                <PdfCanvasPreview url={result.url} name={result.name} />
              ) : result.mime.startsWith("image/") ? (
                <img src={result.url} alt={result.name} className="mx-auto max-h-[420px] rounded-xl bg-white object-contain" />
              ) : result.mime.startsWith("text/") ? (
                <TextPreview url={result.url} />
              ) : (
                <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">
                  No inline preview for this file type — download to view.
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-card/60 p-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Thumbnail</div>
              <div className="grid h-[220px] place-items-center overflow-hidden rounded-xl bg-white">
                {thumb ? (
                  <img src={thumb} alt="" className="max-h-full max-w-full object-contain" />
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {result.mime === "application/pdf" ? "Rendering…" : "—"}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="ghost" onClick={() => publishResult(null)}>
              Discard
            </Button>
            <Button asChild size="lg" className="sm:min-w-56">
              <a href={result.url} download={result.name} onClick={recordDownload}>
                <Download className="mr-2 h-5 w-5" /> Download {result.name}
              </a>
            </Button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    fetch(url).then((r) => r.text()).then((t) => { if (!cancelled) setText(t.slice(0, 8000)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [url]);
  return (
    <pre className="h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-white p-4 text-xs text-ink">
      {text || "Loading…"}
    </pre>
  );
}

function PdfCanvasPreview({ url, name }: { url: string; name: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPages([]);
    setLoading(true);

    (async () => {
      try {
        const { loadPdf, renderPdfPageToCanvas, canvasToBlob } = await import("@/lib/pdf-render");
        const res = await fetch(url);
        const blob = await res.blob();
        const file = new File([blob], name, { type: "application/pdf" });
        const pdf = await loadPdf(file);

        if (cancelled) return;
        setTotal(pdf.numPages);

        const previewCount = Math.min(pdf.numPages, 8);
        for (let i = 1; i <= previewCount; i++) {
          if (cancelled) return;

          const canvas = await renderPdfPageToCanvas(pdf, i, 1.3); // Balanced rendering resolution scale
          const b = await canvasToBlob(canvas, "image/jpeg", 0.8);
          const u = URL.createObjectURL(b);

          if (!cancelled) {
            setPages((prev) => [...prev, u]);
          }
        }
      } catch {
        if (!cancelled) setPages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url, name]);

  return (
    <div className="h-[460px] overflow-auto rounded-xl bg-white p-4 shadow-inner">
      {loading && pages.length === 0 && (
        <div className="grid h-full place-items-center text-xs text-muted-foreground animate-pulse">
          Generating core file previews...
        </div>
      )}
      <div className="flex flex-col items-center gap-4">
        {pages.map((src, i) => (
          <div key={i} className="relative w-full flex flex-col items-center">
            <img src={src} alt={`Page ${i + 1}`} className="max-w-full rounded shadow-md border border-border/40" />
            <span className="text-[10px] mt-1 text-muted-foreground font-medium">Page {i + 1} of {total}</span>
          </div>
        ))}
        {loading && pages.length > 0 && (
          <div className="text-xs text-signal font-medium animate-pulse mt-2">
            Rendering preview ({pages.length} / {Math.min(total, 8)})...
          </div>
        )}
        {!loading && total > 8 && (
          <div className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
            Preview shows the first 8 of {total} pages. The download includes every page.
          </div>
        )}
      </div>
    </div>
  );
}
