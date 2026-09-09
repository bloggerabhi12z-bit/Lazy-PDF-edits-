import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X, FileCheck2, FileText, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLastResult } from "@/lib/result-store";
import { publishResult } from "@/lib/result-store";
import { formatBytes } from "@/lib/download";

export function ResultPreview() {
  const result = useLastResult();

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
    if (!result) return;
    // Scroll preview into view so users can review before downloading
    setTimeout(() => {
      document.getElementById("result-preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, [result]);

  return (
    <AnimatePresence>
      {result && (
        <motion.section
          id="result-preview"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="mt-8 w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_70px_-40px_var(--ink)] sm:mt-10 sm:rounded-3xl"
        >
          {/* Header */}
          <div className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-5">
            <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
              <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-signal-soft text-foreground sm:h-11 sm:w-11">
                <FileCheck2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-xl leading-tight sm:text-2xl">Your file is ready</div>
                <div className="mt-0.5 text-sm text-muted-foreground">Review the result before downloading.</div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => publishResult(null)} className="shrink-0">
                <RotateCcw className="mr-2 h-4 w-4" />
                Start over
              </Button>
              <Button variant="ghost" size="icon" onClick={() => publishResult(null)} aria-label="Dismiss preview" className="shrink-0">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="grid w-full max-w-full grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* Preview pane */}
            <div className="min-w-0 max-w-full border-b border-border bg-secondary/35 p-3 sm:p-6 lg:border-b-0 lg:border-r">
              {result.mime === "application/pdf" ? (
                <PdfCanvasPreview url={result.url} name={result.name} />
              ) : result.mime.startsWith("image/") ? (
                <div className="grid min-h-[220px] w-full max-w-full place-items-center rounded-xl bg-white p-4 shadow-inner sm:min-h-[300px] sm:p-5">
                  <img src={result.url} alt={result.name} className="max-h-[60vh] w-full max-w-full object-contain sm:max-h-[420px]" />
                </div>
              ) : result.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? (
                <DocxPreview url={result.url} />
              ) : result.mime.startsWith("text/") ? (
                <TextPreview url={result.url} />
              ) : (
                <div className="grid min-h-[220px] w-full place-items-center rounded-xl bg-secondary px-4 text-center text-sm text-muted-foreground sm:min-h-[300px]">
                  No inline preview for this file type — download to view.
                </div>
              )}
            </div>

            {/* Details / actions pane */}
            <aside className="flex w-full max-w-full flex-col justify-between gap-6 p-4 sm:gap-8 sm:p-7">
              <div className="min-w-0">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:mb-4">
                  <FileText className="h-4 w-4 flex-shrink-0" />
                  Output file
                </div>
                <div className="break-words text-base font-semibold leading-snug sm:text-lg">{result.name}</div>
                <dl className="mt-4 divide-y divide-border border-y border-border text-sm sm:mt-5">
                  <div className="flex justify-between gap-4 py-2.5 sm:py-3">
                    <dt className="text-muted-foreground">Format</dt>
                    <dd className="font-medium uppercase">{result.mime.split("/").pop()}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2.5 sm:py-3">
                    <dt className="text-muted-foreground">Size</dt>
                    <dd className="font-medium">{formatBytes(result.size)}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex gap-2 text-xs leading-relaxed text-muted-foreground sm:mt-5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-signal" />
                  Files are processed in your browser and are not stored.
                </div>
              </div>

              {/* Desktop / tablet download button — hidden on mobile in favor of the sticky bar below */}
              <Button asChild size="lg" className="hidden w-full sm:flex">
                <a href={result.url} download={result.name} onClick={recordDownload}>
                  <Download className="mr-2 h-5 w-5" />
                  Download file
                </a>
              </Button>
            </aside>
          </div>

          <div className="hidden items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground sm:flex sm:px-7">
            <span>Output generated successfully</span>
            <span>Ready to use</span>
          </div>

          {/* Sticky mobile download bar — keeps the primary action reachable without scrolling past the preview */}
          <div className="sticky bottom-0 z-10 border-t border-border bg-card px-4 py-3 sm:hidden">
            <Button asChild size="lg" className="w-full">
              <a href={result.url} download={result.name} onClick={recordDownload}>
                <Download className="mr-2 h-5 w-5" />
                Download file
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
    fetch(url)
      .then((r) => r.text())
      .then((t) => {
        if (!cancelled) setText(t.slice(0, 8000));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <pre className="h-[60vh] max-h-[420px] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-3 text-xs text-ink sm:h-[420px] sm:p-4">
      {text || "Loading…"}
    </pre>
  );
}

function DocxPreview({ url }: { url: string }) {
  const [html, setHtml] = useState<string>("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml("");
    setFailed(false);

    (async () => {
      try {
        const { default: mammoth } = await import("mammoth/mammoth.browser");
        const response = await fetch(url);
        const result = await mammoth.convertToHtml({ arrayBuffer: await response.arrayBuffer() });
        if (!cancelled) setHtml(result.value);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="h-[65vh] max-h-[520px] w-full max-w-full overflow-auto rounded-xl bg-slate-200/70 shadow-inner sm:h-[620px] sm:max-h-none sm:p-4">
      {failed ? (
        <div className="grid h-full min-h-[220px] place-items-center px-4 text-center text-sm text-muted-foreground sm:min-h-[300px]">
          This Word document could not be previewed. Download it to view.
        </div>
      ) : html ? (
        <article className="prose prose-sm mx-auto min-h-full w-full max-w-full break-words bg-white px-4 py-6 text-ink shadow-lg prose-headings:font-display prose-headings:text-ink prose-p:text-ink prose-a:break-all prose-a:text-signal sm:max-w-3xl sm:px-8 sm:py-10">
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      ) : (
        <div className="grid h-full min-h-[220px] place-items-center text-xs text-muted-foreground animate-pulse sm:min-h-[300px]">
          Generating Word preview...
        </div>
      )}
    </div>
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

    return () => {
      cancelled = true;
    };
  }, [url, name]);

  return (
    <div className="h-[65vh] max-h-[520px] w-full max-w-full overflow-auto rounded-xl bg-slate-200/70 p-3 shadow-inner sm:h-[620px] sm:max-h-none sm:p-4">
      {loading && pages.length === 0 && (
        <div className="grid h-full place-items-center px-4 text-center text-xs text-muted-foreground animate-pulse">
          Generating core file previews...
        </div>
      )}
      <div className="flex w-full max-w-full flex-col items-center gap-4 sm:gap-5">
        {pages.map((src, i) => (
          <div key={i} className="relative flex w-full max-w-full flex-col items-center">
            <div className="w-full max-w-md rounded-sm bg-white p-1 shadow-lg">
              <img src={src} alt={`Page ${i + 1}`} className="block h-auto w-full border border-border/40" />
            </div>
            <span className="mt-1 text-[10px] font-medium text-muted-foreground">
              Page {i + 1} of {total}
            </span>
          </div>
        ))}
        {loading && pages.length > 0 && (
          <div className="mt-2 animate-pulse text-xs font-medium text-signal">
            Rendering preview ({pages.length} / {Math.min(total, 8)})...
          </div>
        )}
        {!loading && total > 8 && (
          <div className="rounded-full bg-secondary px-3 py-1.5 text-center text-xs text-muted-foreground">
            Preview shows the first 8 of {total} pages. The download includes every page.
          </div>
        )}
      </div>
    </div>
  );
}