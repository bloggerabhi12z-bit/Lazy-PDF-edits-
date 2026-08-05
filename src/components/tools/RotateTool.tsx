import { useState, useCallback, useEffect } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/download";
import { publishResult } from "@/lib/result-store";
import {
  Loader2,
  RotateCcw,
  RotateCw,
  RotateCw as Rotate180,
  Undo2,
  Redo2,
  Download,
  UploadCloud,
  FileCheck2,
  Check,
  RefreshCw,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

type PageRotation = {
  index: number;
  originalIndex: number;
  rotation: number;
  thumbnail: string | null;
};

const ROTATION_OPTIONS = [
  { degrees: 90, icon: RotateCw, label: "90° CW" },
  { degrees: 180, icon: Rotate180, label: "180°" },
  { degrees: 270, icon: RotateCcw, label: "90° CCW" },
] as const;

export function RotateTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageRotation[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; filename: string } | null>(null);
  const [history, setHistory] = useState<PageRotation[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectAll, setSelectAll] = useState(true);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [pdfDoc, setPdfDoc] = useState<PDFDocument | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [pageCount, setPageCount] = useState(0);

  // Load PDF and generate thumbnails
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setPdfDoc(null);
    setFileSize(file.size);

    (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await PDFDocument.load(bytes);
        if (cancelled) return;
        setPdfDoc(doc);
        setPageCount(doc.getPageCount());

        const initial: PageRotation[] = Array.from({ length: doc.getPageCount() }, (_, i) => ({
          index: i,
          originalIndex: i,
          rotation: 0,
          thumbnail: null,
        }));
        setPages(initial);
        setHistory([initial]);
        setHistoryIndex(0);
        setSelectedPages(new Set(initial.map((_, i) => i)));

        // Generate thumbnails using canvas
        const { loadPdf } = await import("@/lib/pdf-render");
        const renderDoc = await loadPdf(file);
        for (let i = 0; i < renderDoc.numPages; i++) {
          if (cancelled) break;
          try {
            const page = await renderDoc.getPage(i + 1);
            const viewport = page.getViewport({ scale: 0.25 });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            await page.render({ canvas, canvasContext: ctx, viewport }).promise;
            const url = canvas.toDataURL("image/jpeg", 0.7);
            if (!cancelled) {
              setPages((prev) => prev.map((p) => (p.index === i ? { ...p, thumbnail: url } : p)));
            }
          } catch {
            // skip thumbnails that fail
          }
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Failed to read PDF.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [file]);

  const pushHistory = useCallback((newPages: PageRotation[]) => {
    setHistory((h) => {
      const trimmed = h.slice(0, historyIndex + 1);
      trimmed.push(newPages);
      if (trimmed.length > 50) trimmed.shift();
      return trimmed;
    });
    setHistoryIndex((i) => Math.min(i + 1, 49));
  }, [historyIndex]);

  const rotatePages = useCallback((delta: number) => {
    setPages((prev) => {
      const anySelected = selectedPages.size > 0;
      const next = prev.map((p) => {
        const target = anySelected ? selectedPages.has(p.index) : true;
        return target ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p;
      });
      pushHistory(next);
      return next;
    });
  }, [selectedPages, pushHistory]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIdx = historyIndex - 1;
    setHistoryIndex(newIdx);
    setPages(history[newIdx]);
  }, [historyIndex, history]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIdx = historyIndex + 1;
    setHistoryIndex(newIdx);
    setPages(history[newIdx]);
  }, [historyIndex, history]);

  const resetAll = useCallback(() => {
    const reset = pages.map((p) => ({ ...p, rotation: 0 }));
    pushHistory(reset);
    setPages(reset);
    toast.success("All rotations reset.");
  }, [pages, pushHistory]);

  const togglePage = useCallback((index: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectAll((prev) => {
      const next = !prev;
      if (next) {
        setSelectedPages(new Set(pages.map((_, i) => i)));
      } else {
        setSelectedPages(new Set());
      }
      return next;
    });
  }, [pages]);

  const applyRotation = useCallback(async () => {
    if (!file || !pdfDoc) return;
    setBusy(true);
    try {
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const totalPages = src.getPageCount();

      for (let i = 0; i < totalPages; i++) {
        const page = src.getPage(i);
        const rot = pages[i]?.rotation ?? 0;
        if (rot) {
          page.setRotation(degrees((page.getRotation().angle + rot) % 360));
        }
      }

      const bytes = await src.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const filename = `lazy-pdf-rotated-${file.name}`;

      setResult({ blob, filename });
      publishResult({
        name: filename,
        mime: "application/pdf",
        size: blob.size,
        url: URL.createObjectURL(blob),
        createdAt: Date.now(),
      });
      toast.success("Rotation applied successfully!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rotation failed.");
    } finally {
      setBusy(false);
    }
  }, [file, pdfDoc, pages]);

  const handleNewFile = useCallback(() => {
    setFile(null);
    setPages([]);
    setResult(null);
    setPdfDoc(null);
    setHistory([]);
    setHistoryIndex(-1);
    setSelectedPages(new Set());
    setSelectAll(true);
  }, []);

  const hasRotation = pages.some((p) => p.rotation !== 0);
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const selectedCount = selectedPages.size;

  // Success screen
  if (result) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="tool-surface overflow-hidden"
      >
        <div className="border-b border-border bg-signal-soft/30 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-signal text-white">
              <FileCheck2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">PDF Rotated Successfully</h2>
              <p className="text-sm text-muted-foreground">
                {result.filename} · {formatBytes(result.blob.size)} · {pageCount} pages
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:justify-center">
          <Button
            size="lg"
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(result.blob);
              a.download = result.filename;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}
            className="w-full rounded-xl bg-signal text-white hover:bg-signal/90 sm:w-auto"
          >
            <Download className="mr-2 h-5 w-5" /> Download PDF
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => setResult(null)}
            className="w-full rounded-xl border-border text-foreground hover:bg-muted sm:w-auto"
          >
            Edit again
          </Button>
          <Button
            size="lg"
            variant="ghost"
            onClick={handleNewFile}
            className="w-full rounded-xl text-foreground hover:bg-muted sm:w-auto"
          >
            <UploadCloud className="mr-2 h-4 w-4" /> Upload new PDF
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone
          onFiles={(fs) => setFile(fs[0] ?? null)}
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          hint="Drop a PDF to rotate its pages."
        />
      ) : (
        <div className="tool-surface overflow-hidden">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal">
                <RotateCw className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{file.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(fileSize)} · {pageCount} page{pageCount !== 1 ? "s" : ""}
                  {selectedCount > 0 && selectedCount < pageCount && ` · ${selectedCount} selected`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleNewFile}
                className="rounded-lg border-border text-foreground hover:bg-muted"
              >
                <UploadCloud className="mr-1.5 h-4 w-4" /> Change file
              </Button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-1">
              <span className="mr-1 text-xs font-medium text-muted-foreground">Rotate</span>
              {ROTATION_OPTIONS.map((opt) => (
                <button
                  key={opt.degrees}
                  type="button"
                  onClick={() => rotatePages(opt.degrees)}
                  disabled={selectedCount === 0}
                  title={opt.label}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                    "text-foreground hover:bg-card hover:shadow-sm",
                    "disabled:pointer-events-none disabled:opacity-40",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  )}
                >
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="mx-2 h-5 w-px bg-border" aria-hidden />

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                title="Undo"
                className={cn(
                  "rounded-lg p-1.5 text-muted-foreground transition-all",
                  "hover:bg-card hover:text-foreground hover:shadow-sm",
                  "disabled:pointer-events-none disabled:opacity-40",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                )}
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                title="Redo"
                className={cn(
                  "rounded-lg p-1.5 text-muted-foreground transition-all",
                  "hover:bg-card hover:text-foreground hover:shadow-sm",
                  "disabled:pointer-events-none disabled:opacity-40",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                )}
              >
                <Redo2 className="h-4 w-4" />
              </button>
              {hasRotation && (
                <button
                  type="button"
                  onClick={resetAll}
                  title="Reset all rotations"
                  className={cn(
                    "ml-1 rounded-lg p-1.5 text-muted-foreground transition-all",
                    "hover:bg-card hover:text-foreground hover:shadow-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  )}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="mx-2 h-5 w-px bg-border" aria-hidden />

            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground">
              <input
                type="checkbox"
                checked={selectAll}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 accent-signal"
              />
              {selectAll ? "All pages" : `${selectedCount} selected`}
            </label>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Reading PDF pages…</p>
            </div>
          )}

          {/* Page grid */}
          {!loading && (
            <div className="p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {pages.map((page) => {
                  const isSelected = selectedPages.has(page.index);
                  const hasPageRotation = page.rotation !== 0;
                  return (
                    <motion.div
                      key={page.index}
                      layout
                      initial={false}
                      animate={{ scale: 1 }}
                      className={cn(
                        "group relative cursor-pointer overflow-hidden rounded-xl border-2 bg-card transition-all duration-200",
                        isSelected
                          ? "border-signal shadow-[0_0_0_1px_rgba(255,255,255,0.5),0_4px_12px_-4px_rgba(0,0,0,0.15)]"
                          : "border-border hover:border-muted-foreground/30 hover:shadow-md",
                        hasPageRotation && "ring-1 ring-signal/30",
                      )}
                      onClick={() => togglePage(page.index)}
                    >
                      {/* Thumbnail */}
                      <div className="relative mx-auto aspect-[3/4] w-full overflow-hidden bg-muted">
                        {page.thumbnail ? (
                          <div
                            className="h-full w-full bg-cover bg-center transition-transform duration-300"
                            style={{
                              backgroundImage: `url(${page.thumbnail})`,
                              transform: `rotate(${page.rotation}deg)`,
                            }}
                          />
                        ) : (
                          <div className="flex h-full w-full animate-pulse items-center justify-center bg-gradient-to-b from-muted to-muted/50">
                            <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                          </div>
                        )}

                        {/* Selection overlay */}
                        {isSelected && (
                          <div className="absolute inset-0 bg-signal/5" />
                        )}

                        {/* Page number badge */}
                        <div className="absolute left-1.5 top-1.5 rounded-md bg-ink/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                          {page.index + 1}
                        </div>

                        {/* Rotation badge */}
                        {hasPageRotation && (
                          <div className="absolute right-1.5 top-1.5 rounded-md bg-signal/90 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                            {page.rotation}°
                          </div>
                        )}

                        {/* Checkmark on selected */}
                        {isSelected && (
                          <div className="absolute bottom-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-signal text-white shadow-sm">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </div>

                      {/* Quick rotate buttons */}
                      <div className="flex items-center justify-center gap-0.5 border-t border-border bg-card p-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPages((prev) => {
                              const next = prev.map((p) =>
                                p.index === page.index
                                  ? { ...p, rotation: (p.rotation + 90 + 360) % 360 }
                                  : p
                              );
                              pushHistory(next);
                              return next;
                            });
                          }}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Rotate 90° CW"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                          {page.rotation}°
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPages((prev) => {
                              const next = prev.map((p) =>
                                p.index === page.index
                                  ? { ...p, rotation: (p.rotation - 90 + 360) % 360 }
                                  : p
                              );
                              pushHistory(next);
                              return next;
                            });
                          }}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Rotate 90° CCW"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer with apply button */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-4 sm:px-6">
            <div className="text-xs text-muted-foreground">
              {hasRotation
                ? `${pages.filter((p) => p.rotation !== 0).length} page${pages.filter((p) => p.rotation !== 0).length !== 1 ? "s" : ""} will be rotated`
                : "No rotation applied yet"}
            </div>
            <Button
              size="lg"
              disabled={!hasRotation || busy || loading}
              onClick={applyRotation}
              className="rounded-xl bg-signal text-white hover:bg-signal/90 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Applying…
                </>
              ) : (
                <>
                  <RotateCw className="mr-2 h-4 w-4" /> Apply Rotation
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}