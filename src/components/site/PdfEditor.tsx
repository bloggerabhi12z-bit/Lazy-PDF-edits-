import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftRight,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileCheck2,
  Loader2,
  Lock,
  Maximize2,
  PanelLeft,
  PanelRight,
  Redo2,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Square,
  Trash2,
  Undo2,
  UploadCloud,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/download";
import { publishResult } from "@/lib/result-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type EditorPage = {
  /** Stable id (survives reorder / duplication) */
  id: string;
  /** Original 0-based page index in the source PDF */
  originalIndex: number;
  /** Rotation delta in degrees, multiple of 90 */
  rotation: number;
  /** Selection flag */
  selected: boolean;
};

export type EditorApplyState = {
  pages: EditorPage[];
  selectedIds: Set<string>;
};

export type EditorApplyResult =
  | { blob: Blob; filename: string }
  | void
  | undefined;

type PdfPage = {
  getViewport: (o: { scale: number; rotation?: number }) => {
    width: number;
    height: number;
  };
  render: (o: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
};

type Mode = "select" | "reorder" | "rotate";

type Phase = "reading" | "rendering" | "ready" | "error";

interface PdfEditorProps {
  file: File;
  mode: Mode;
  /** Text shown for the primary action */
  actionLabel: string;
  busy?: boolean;
  selectionHint?: string;
  onReplace: () => void;
  onApply: (state: EditorApplyState) => Promise<EditorApplyResult> | EditorApplyResult;
}

const MAX_HISTORY = 50;
const PROGRESS_LABELS = ["Processing…", "Updating PDF…", "Optimizing…", "Almost done…"];

function pagesEqual(a: EditorPage[], b: EditorPage[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.originalIndex !== y.originalIndex ||
      x.rotation !== y.rotation ||
      x.selected !== y.selected
    )
      return false;
  }
  return true;
}

export function PdfEditor({
  file,
  mode,
  actionLabel,
  busy = false,
  selectionHint,
  onReplace,
  onApply,
}: PdfEditorProps) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState<EditorPage[]>([]);
  const [phase, setPhase] = useState<Phase>("reading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<"width" | "page" | "custom">("width");
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [firstPageDims, setFirstPageDims] = useState<{ w: number; h: number } | null>(null);
  const [pdfVersion, setPdfVersion] = useState<string | null>(null);
  const [encrypted, setEncrypted] = useState<boolean>(false);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);

  // History
  const historyRef = useRef<EditorPage[][]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [historyTick, setHistoryTick] = useState(0);
  const skipHistoryRef = useRef(false);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);

  // Success screen
  const [success, setSuccess] = useState<null | {
    blob: Blob;
    filename: string;
    thumb: string | null;
    pages: number;
  }>(null);

  const lastSelectedRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Load PDF
  useEffect(() => {
    let cancelled = false;
    setPhase("reading");
    setErrorMsg(null);
    setPdf(null);
    setPages([]);
    setThumbs({});
    setCurrent(0);
    setSuccess(null);
    historyRef.current = [];
    historyIndexRef.current = -1;

    (async () => {
      try {
        const { loadPdf } = await import("@/lib/pdf-render");
        const doc = (await loadPdf(file)) as unknown as PdfDoc & {
          _pdfInfo?: { version?: string };
          getMetadata?: () => Promise<{ info?: { PDFFormatVersion?: string; IsEncrypted?: boolean } }>;
        };
        if (cancelled) return;
        const initial: EditorPage[] = Array.from({ length: doc.numPages }, (_, i) => ({
          id: `p${i}`,
          originalIndex: i,
          rotation: 0,
          selected: false,
        }));
        setPdf(doc);
        setPages(initial);
        historyRef.current = [initial];
        historyIndexRef.current = 0;
        setPhase("rendering");

        // Metadata (best effort)
        try {
          const md = await doc.getMetadata?.();
          if (!cancelled) {
            setPdfVersion(md?.info?.PDFFormatVersion ?? null);
            setEncrypted(Boolean(md?.info?.IsEncrypted));
          }
        } catch {
          /* ignore */
        }

        // First page dims
        try {
          const p = await doc.getPage(1);
          const vp = p.getViewport({ scale: 1 });
          if (!cancelled) setFirstPageDims({ w: Math.round(vp.width), h: Math.round(vp.height) });
        } catch {
          /* ignore */
        }
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Could not read PDF.";
        const friendly = /password/i.test(message)
          ? "This PDF is password-protected. Unlock it first."
          : /invalid|corrupt|malformed/i.test(message)
            ? "This file looks corrupt or is not a valid PDF."
            : message;
        setErrorMsg(friendly);
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Progressive thumbnail rendering
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < pdf.numPages; i++) {
        if (cancelled) return;
        if (thumbs[i]) continue;
        try {
          const page = await pdf.getPage(i + 1);
          const viewport = page.getViewport({ scale: 0.3 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          const url = canvas.toDataURL("image/jpeg", 0.75);
          if (!cancelled) setThumbs((t) => ({ ...t, [i]: url }));
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf]); // eslint-disable-line react-hooks/exhaustive-deps

  // History management: push snapshot whenever pages change (unless suppressed)
  useEffect(() => {
    if (pages.length === 0) return;
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    const idx = historyIndexRef.current;
    const last = historyRef.current[idx];
    if (last && pagesEqual(last, pages)) return;
    // Drop redo tail
    const trimmed = historyRef.current.slice(0, idx + 1);
    trimmed.push(pages);
    // Cap
    while (trimmed.length > MAX_HISTORY) trimmed.shift();
    historyRef.current = trimmed;
    historyIndexRef.current = trimmed.length - 1;
    setHistoryTick((n) => n + 1);
  }, [pages]);

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  const undo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx <= 0) return;
    historyIndexRef.current = idx - 1;
    skipHistoryRef.current = true;
    setPages(historyRef.current[idx - 1]);
    setHistoryTick((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx >= historyRef.current.length - 1) return;
    historyIndexRef.current = idx + 1;
    skipHistoryRef.current = true;
    setPages(historyRef.current[idx + 1]);
    setHistoryTick((n) => n + 1);
  }, []);

  const reset = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const first = historyRef.current[0];
    historyIndexRef.current = 0;
    historyRef.current = [first];
    skipHistoryRef.current = true;
    setPages(first);
    setHistoryTick((n) => n + 1);
  }, []);

  // Selection helpers
  const selectAll = useCallback(() => {
    setPages((ps) => ps.map((p) => ({ ...p, selected: true })));
  }, []);
  const clearSelection = useCallback(() => {
    setPages((ps) => ps.map((p) => ({ ...p, selected: false })));
  }, []);

  const selectRange = useCallback((from: number, to: number) => {
    const [a, b] = from < to ? [from, to] : [to, from];
    setPages((ps) => ps.map((p, i) => ({ ...p, selected: p.selected || (i >= a && i <= b) })));
  }, []);

  const handleThumbClick = useCallback(
    (i: number, e: ReactMouseEvent) => {
      setCurrent(i);
      if (mode !== "select") {
        lastSelectedRef.current = i;
        return;
      }
      if (e.shiftKey && lastSelectedRef.current != null) {
        selectRange(lastSelectedRef.current, i);
      } else if (e.metaKey || e.ctrlKey) {
        setPages((ps) => ps.map((p, idx) => (idx === i ? { ...p, selected: !p.selected } : p)));
      } else {
        setPages((ps) => ps.map((p, idx) => ({ ...p, selected: idx === i ? !p.selected : p.selected })));
      }
      lastSelectedRef.current = i;
    },
    [mode, selectRange],
  );

  const rotatePage = useCallback((i: number, delta: number) => {
    setPages((ps) => ps.map((p, idx) => (idx === i ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p)));
  }, []);

  const rotateSelected = useCallback((delta: number) => {
    setPages((ps) => {
      const anySelected = ps.some((p) => p.selected);
      return ps.map((p, idx) => {
        const target = anySelected ? p.selected : idx === current;
        return target ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p;
      });
    });
  }, [current]);

  const deleteSelected = useCallback(() => {
    setPages((ps) => {
      const remaining = ps.filter((p) => !p.selected);
      if (remaining.length === 0) {
        toast.error("You can't delete every page.");
        return ps;
      }
      if (remaining.length === ps.length) {
        // nothing selected → delete current
        if (ps.length <= 1) return ps;
        return ps.filter((_, i) => i !== current);
      }
      return remaining;
    });
    setCurrent((c) => Math.max(0, c - 0));
  }, [current]);

  const duplicateSelected = useCallback(() => {
    setPages((ps) => {
      const out: EditorPage[] = [];
      const anySelected = ps.some((p) => p.selected);
      ps.forEach((p, idx) => {
        out.push(p);
        const target = anySelected ? p.selected : idx === current;
        if (target) {
          out.push({ ...p, id: `${p.id}-dup-${Date.now()}-${idx}`, selected: false });
        }
      });
      return out;
    });
  }, [current]);

  const movePages = useCallback((fromIndex: number, toIndex: number, multi: boolean) => {
    setPages((ps) => {
      const moving = multi
        ? ps.map((p, i) => ({ p, i })).filter((x) => x.p.selected)
        : [{ p: ps[fromIndex], i: fromIndex }];
      if (moving.length === 0) return ps;
      const movingIds = new Set(moving.map((x) => x.p.id));
      const kept = ps.filter((p) => !movingIds.has(p.id));
      let insertAt = toIndex;
      // Adjust insert index for removed items before it
      for (const m of moving) if (m.i < toIndex) insertAt--;
      insertAt = Math.max(0, Math.min(kept.length, insertAt));
      const moved = moving.map((m) => m.p);
      const next = [...kept.slice(0, insertAt), ...moved, ...kept.slice(insertAt)];
      return next;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      // Ignore when typing in inputs
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
        ev.preventDefault();
        undo();
      } else if ((mod && ev.key.toLowerCase() === "y") || (mod && ev.shiftKey && ev.key.toLowerCase() === "z")) {
        ev.preventDefault();
        redo();
      } else if (mod && ev.key.toLowerCase() === "a") {
        ev.preventDefault();
        selectAll();
      } else if (ev.key === "Delete" || ev.key === "Backspace") {
        if (mode === "select") {
          ev.preventDefault();
          deleteSelected();
        }
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowRight") {
        ev.preventDefault();
        setCurrent((c) => Math.min(pages.length - 1, c + 1));
      } else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        setCurrent((c) => Math.max(0, c - 1));
      } else if (ev.key === "Home") {
        ev.preventDefault();
        setCurrent(0);
      } else if (ev.key === "End") {
        ev.preventDefault();
        setCurrent(Math.max(0, pages.length - 1));
      } else if (ev.key === " " && mode === "select") {
        ev.preventDefault();
        setPages((ps) => ps.map((p, i) => (i === current ? { ...p, selected: !p.selected } : p)));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectAll, deleteSelected, pages.length, current, mode]);

  // Zoom controls
  const zoomIn = () => {
    setFitMode("custom");
    setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
  };
  const zoomOut = () => {
    setFitMode("custom");
    setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));
  };
  const fitWidth = () => setFitMode("width");
  const fitPage = () => setFitMode("page");

  // Selection count
  const selectedCount = useMemo(() => pages.filter((p) => p.selected).length, [pages]);

  // Progress ticker while processing
  useEffect(() => {
    if (!processing) return;
    setProgressIdx(0);
    const t = setInterval(() => setProgressIdx((i) => Math.min(i + 1, PROGRESS_LABELS.length - 1)), 800);
    return () => clearInterval(t);
  }, [processing]);

  // Apply
  async function apply() {
    if (processing || busy) return;
    setProcessing(true);
    try {
      const selectedIds = new Set(pages.filter((p) => p.selected).map((p) => p.id));
      const result = await onApply({ pages, selectedIds });
      if (result && "blob" in result) {
        // Render preview of first page of result
        let thumbUrl: string | null = null;
        let resultPageCount = pages.length;
        try {
          const { loadPdf, renderPdfPageToCanvas, canvasToBlob } = await import("@/lib/pdf-render");
          const f = new File([result.blob], result.filename, { type: "application/pdf" });
          const doc = await loadPdf(f);
          resultPageCount = doc.numPages;
          const canvas = await renderPdfPageToCanvas(doc, 1, 1.2);
          const b = await canvasToBlob(canvas, "image/png");
          thumbUrl = URL.createObjectURL(b);
        } catch {
          /* ignore preview failure */
        }
        setSuccess({ blob: result.blob, filename: result.filename, thumb: thumbUrl, pages: resultPageCount });
        // Also publish to global result store so the ResultPreview below is populated
        const url = URL.createObjectURL(result.blob);
        publishResult({
          name: result.filename,
          mime: "application/pdf",
          size: result.blob.size,
          url,
          createdAt: Date.now(),
        });
      }
    } finally {
      setProcessing(false);
    }
  }

  function editAgain() {
    if (success?.thumb) {
      try {
        URL.revokeObjectURL(success.thumb);
      } catch {
        /* noop */
      }
    }
    setSuccess(null);
  }

  // Error state
  if (phase === "error") {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-card p-8 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
          <Lock className="h-6 w-6" />
        </div>
        <h3 className="font-display text-xl">Couldn't open this PDF</h3>
        <p className="mt-2 text-sm text-muted-foreground">{errorMsg}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" onClick={onReplace}>
            Choose another file
          </Button>
        </div>
      </div>
    );
  }

  // Success screen
  if (success) {
    return (
      <SuccessScreen
        result={success}
        onDownload={() => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(success.blob);
          a.download = success.filename;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }}
        onEditAgain={editAgain}
        onNewFile={onReplace}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
      role="region"
      aria-label="PDF editor"
    >
      {/* File bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setShowLeft((s) => !s)}
            aria-label="Toggle thumbnails"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="truncate font-medium">{file.name}</div>
            <div className="text-xs text-muted-foreground">
              {formatBytes(file.size)} · {pdf ? `${pdf.numPages} pages` : "reading…"}
              {mode === "select" && selectedCount > 0 && ` · ${selectedCount} selected`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReplace}>
            <UploadCloud className="mr-1 h-4 w-4" /> Change file
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setShowRight((s) => !s)}
            aria-label="Toggle properties"
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <Toolbar
        current={current}
        totalPages={pages.length}
        onJump={setCurrent}
        onPrev={() => setCurrent((c) => Math.max(0, c - 1))}
        onNext={() => setCurrent((c) => Math.min(pages.length - 1, c + 1))}
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitWidth={fitWidth}
        onFitPage={fitPage}
        fitMode={fitMode}
        onRotateLeft={() => rotateSelected(-90)}
        onRotateRight={() => rotateSelected(90)}
        onDelete={mode === "select" ? deleteSelected : undefined}
        onDuplicate={duplicateSelected}
        selectionMode={mode === "select"}
        selectedCount={selectedCount}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onReset={reset}
      />

      {selectionHint && mode === "select" && (
        <div className="border-b border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          {selectionHint}
        </div>
      )}

      {/* Body */}
      <div
        className={cn(
          "grid gap-0",
          "lg:grid-cols-[220px_minmax(0,1fr)_280px]",
          !showLeft && "lg:grid-cols-[0px_minmax(0,1fr)_280px]",
          !showRight && "lg:grid-cols-[220px_minmax(0,1fr)_0px]",
          !showLeft && !showRight && "lg:grid-cols-[0px_minmax(0,1fr)_0px]",
        )}
      >
        {/* Left sidebar */}
        <aside
          className={cn(
            "border-b border-border bg-muted/10 md:border-b-0 lg:border-r",
            !showLeft && "hidden lg:block lg:overflow-hidden",
          )}
        >
          <ThumbnailRail
            pages={pages}
            current={current}
            thumbs={thumbs}
            mode={mode}
            phase={phase}
            onClickThumb={handleThumbClick}
            onMove={movePages}
            onRotate={(i) => rotatePage(i, 90)}
            onDelete={(i) => {
              setPages((ps) => (ps.length > 1 ? ps.filter((_, idx) => idx !== i) : ps));
            }}
            onDuplicate={(i) => {
              setPages((ps) => {
                const out = [...ps];
                out.splice(i + 1, 0, { ...ps[i], id: `${ps[i].id}-dup-${Date.now()}`, selected: false });
                return out;
              });
            }}
          />
        </aside>

        {/* Center preview */}
        <section className="min-w-0 bg-neutral-100 dark:bg-neutral-900/60">
          <PreviewCanvas
            pdf={pdf}
            pages={pages}
            zoom={zoom}
            fitMode={fitMode}
            current={current}
            onCurrentChange={setCurrent}
            phase={phase}
            onToggleSelect={(i) => {
              if (mode !== "select") return;
              setPages((ps) => ps.map((p, idx) => (idx === i ? { ...p, selected: !p.selected } : p)));
            }}
            selectionMode={mode === "select"}
          />
        </section>

        {/* Right sidebar */}
        <aside className={cn("border-t border-border bg-muted/5 lg:border-l lg:border-t-0", !showRight && "hidden lg:block lg:overflow-hidden")}>
          <PropertiesPanel
            file={file}
            totalPages={pages.length}
            selectedCount={selectedCount}
            firstPageDims={firstPageDims}
            pdfVersion={pdfVersion}
            encrypted={encrypted}
            mode={mode}
            actionLabel={actionLabel}
            processing={processing || busy}
            progressLabel={PROGRESS_LABELS[progressIdx]}
            onApply={apply}
          />
        </aside>
      </div>
    </div>
  );
}

/* -------------------------- Toolbar -------------------------- */

function Toolbar(props: {
  current: number;
  totalPages: number;
  onJump: (n: number) => void;
  onPrev: () => void;
  onNext: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  fitMode: "width" | "page" | "custom";
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onDelete?: () => void;
  onDuplicate: () => void;
  selectionMode: boolean;
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
}) {
  const [jumpValue, setJumpValue] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-3 py-2">
      {/* Navigation group */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card/50 p-1">
        <Button variant="ghost" size="icon" onClick={props.onPrev} disabled={props.current === 0} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(jumpValue, 10);
            if (!isNaN(n) && n >= 1 && n <= props.totalPages) props.onJump(n - 1);
            setJumpValue("");
          }}
          className="flex items-center gap-1 px-1"
        >
          <input
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            placeholder={`${props.current + 1}`}
            aria-label="Jump to page"
            className="h-7 w-10 rounded border border-border bg-background px-1 text-center text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">/ {props.totalPages || "—"}</span>
        </form>
        <Button variant="ghost" size="icon" onClick={props.onNext} disabled={props.current >= props.totalPages - 1} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Zoom group */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card/50 p-1">
        <Button variant="ghost" size="icon" onClick={props.onZoomOut} aria-label="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <div className="w-12 text-center text-xs tabular-nums">{Math.round(props.zoom * 100)}%</div>
        <Button variant="ghost" size="icon" onClick={props.onZoomIn} aria-label="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant={props.fitMode === "width" ? "secondary" : "ghost"}
          size="sm"
          onClick={props.onFitWidth}
          className="h-7 px-2 text-xs"
        >
          <ArrowLeftRight className="mr-1 h-3.5 w-3.5" /> Width
        </Button>
        <Button
          variant={props.fitMode === "page" ? "secondary" : "ghost"}
          size="sm"
          onClick={props.onFitPage}
          className="h-7 px-2 text-xs"
        >
          <Maximize2 className="mr-1 h-3.5 w-3.5" /> Page
        </Button>
      </div>

      {/* Editing group */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card/50 p-1">
        <Button variant="ghost" size="icon" onClick={props.onRotateLeft} aria-label="Rotate left">
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={props.onRotateRight} aria-label="Rotate right">
          <RotateCw className="h-4 w-4" />
        </Button>
        {props.onDelete && (
          <Button variant="ghost" size="icon" onClick={props.onDelete} aria-label="Delete selected">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={props.onDuplicate} aria-label="Duplicate page">
          <Copy className="h-4 w-4" />
        </Button>
      </div>

      {/* Selection group */}
      {props.selectionMode && (
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card/50 p-1">
          <Button variant="ghost" size="sm" onClick={props.onSelectAll} className="h-7 px-2 text-xs">
            <CheckSquare className="mr-1 h-3.5 w-3.5" /> All
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onClearSelection} className="h-7 px-2 text-xs">
            <Square className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
          <div className="px-2 text-xs text-muted-foreground tabular-nums">{props.selectedCount} selected</div>
        </div>
      )}

      {/* Undo/redo/reset */}
      <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-card/50 p-1">
        <Button variant="ghost" size="icon" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Redo">
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onReset} className="h-7 px-2 text-xs" aria-label="Reset all changes">
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reset
        </Button>
      </div>
    </div>
  );
}

/* -------------------------- Thumbnail rail -------------------------- */

function ThumbnailRail(props: {
  pages: EditorPage[];
  current: number;
  thumbs: Record<number, string>;
  mode: Mode;
  phase: Phase;
  onClickThumb: (i: number, e: ReactMouseEvent) => void;
  onMove: (from: number, to: number, multi: boolean) => void;
  onRotate: (i: number) => void;
  onDelete: (i: number) => void;
  onDuplicate: (i: number) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  return (
    <div className="relative h-[calc(100vh-260px)] min-h-[520px] overflow-auto p-3">
      {props.phase === "reading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading PDF…
        </div>
      )}
      <ul className="space-y-3" role="listbox" aria-label="Pages">
        {props.pages.map((p, i) => {
          const isActive = props.current === i;
          const showDropAbove = dragOver === i;
          return (
            <li
              key={p.id}
              draggable
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer.effectAllowed = "move";
                try {
                  e.dataTransfer.setData("text/plain", String(i));
                } catch {
                  /* noop */
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragging ?? parseInt(e.dataTransfer.getData("text/plain") || "-1", 10);
                setDragging(null);
                setDragOver(null);
                if (from < 0) return;
                const anyOtherSelected = props.pages.some((x, idx) => x.selected && idx !== from);
                props.onMove(from, i, props.pages[from]?.selected && anyOtherSelected ? true : false);
              }}
              onDragEnd={() => {
                setDragging(null);
                setDragOver(null);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, index: i });
              }}
              className={cn(
                "relative rounded-xl transition",
                showDropAbove && "before:absolute before:-top-1.5 before:left-2 before:right-2 before:h-0.5 before:rounded before:bg-signal",
                dragging === i && "opacity-40",
              )}
              role="option"
              aria-selected={p.selected}
            >
              <motion.div
                layout
                initial={false}
                animate={{
                  scale: isActive ? 1.02 : 1,
                }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                className={cn(
                  "group relative rounded-lg border-2 bg-white p-1 shadow-sm transition hover:shadow-md",
                  isActive ? "border-signal" : "border-transparent hover:border-border",
                  p.selected && "ring-2 ring-signal ring-offset-1 ring-offset-background",
                )}
              >
                <button
                  type="button"
                  onClick={(e) => props.onClickThumb(i, e)}
                  className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Page ${i + 1}${p.selected ? ", selected" : ""}`}
                >
                  <div
                    className="mx-auto grid aspect-[3/4] w-full place-items-center overflow-hidden rounded bg-muted"
                    style={{ transform: `rotate(${p.rotation}deg)` }}
                  >
                    {props.thumbs[p.originalIndex] ? (
                      <img
                        src={props.thumbs[p.originalIndex]}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="h-full w-full animate-pulse bg-gradient-to-b from-muted to-muted/60" />
                    )}
                  </div>
                </button>
                <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
                  <span className="tabular-nums">Page {i + 1}</span>
                  <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onRotate(i);
                      }}
                      aria-label={`Rotate page ${i + 1}`}
                      className="rounded p-0.5 hover:bg-muted"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                    {props.mode === "select" && (
                      <input
                        type="checkbox"
                        checked={p.selected}
                        onChange={(e) => {
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onClickThumb(i, e as unknown as ReactMouseEvent);
                        }}
                        aria-label={`Select page ${i + 1}`}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            </li>
          );
        })}
      </ul>

      {menu && (
        <div
          role="menu"
          style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 60 } as CSSProperties}
          className="min-w-40 rounded-md border border-border bg-popover p-1 text-sm shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem icon={<RotateCw className="h-3.5 w-3.5" />} onClick={() => { props.onRotate(menu.index); setMenu(null); }}>
            Rotate 90°
          </MenuItem>
          <MenuItem icon={<Copy className="h-3.5 w-3.5" />} onClick={() => { props.onDuplicate(menu.index); setMenu(null); }}>
            Duplicate
          </MenuItem>
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => { props.onDelete(menu.index); setMenu(null); }}
            danger
          >
            Delete page
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted",
        danger && "text-destructive hover:bg-destructive/10",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* -------------------------- Preview canvas -------------------------- */

function PreviewCanvas(props: {
  pdf: PdfDoc | null;
  pages: EditorPage[];
  zoom: number;
  fitMode: "width" | "page" | "custom";
  current: number;
  onCurrentChange: (n: number) => void;
  phase: Phase;
  onToggleSelect: (i: number) => void;
  selectionMode: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [pageIndicator, setPageIndicator] = useState<number>(props.current);
  const indicatorTimer = useRef<number | null>(null);

  // Container size
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Effective scale
  const scale = useMemo(() => {
    if (!props.pdf) return 1.5;
    if (props.fitMode === "custom") return 1.5 * props.zoom;
    // Approximate assuming first page dims (all pages same aspect assumption fallback)
    // We'll estimate from viewport width/height in child renderer; use zoom fallback here.
    return props.fitMode === "width" ? 1.5 : 1.2;
  }, [props.pdf, props.fitMode, props.zoom]);

  // Scroll to current page when it changes externally
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-page="${props.current}"]`);
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [props.current]);

  // Track visible pages for indicator
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-page]"));
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const en of entries) {
            const idx = parseInt(en.target.getAttribute("data-page") || "-1", 10);
            if (idx < 0) continue;
            if (en.isIntersecting) next.add(idx);
            else next.delete(idx);
          }
          return next;
        });
        // Update page indicator
        const topEntry = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (topEntry) {
          const idx = parseInt(topEntry.target.getAttribute("data-page") || "-1", 10);
          if (idx >= 0) {
            setPageIndicator(idx);
            props.onCurrentChange(idx);
            if (indicatorTimer.current) window.clearTimeout(indicatorTimer.current);
          }
        }
      },
      { root: el, rootMargin: "200px 0px", threshold: [0, 0.25, 0.75, 1] },
    );
    items.forEach((it) => io.observe(it));
    return () => io.disconnect();
  }, [props.pages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (props.phase === "reading") {
    return (
      <div className="grid h-[70vh] place-items-center text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin" />
          <div>Reading PDF…</div>
        </div>
      </div>
    );
  }

  if (!props.pdf) {
    return (
      <div className="grid h-[70vh] place-items-center text-sm text-muted-foreground">
        <div>Preparing editor…</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100vh-260px)] min-h-[520px] overflow-auto"
    >
      <div className="mx-auto flex flex-col items-center gap-8 px-6 py-10 sm:px-10 sm:py-12">
        {props.pages.map((p, i) => (
          <PagePane
            key={p.id}
            index={i}
            page={p}
            pdf={props.pdf!}
            visible={visible.has(i)}
            containerWidth={containerSize.w}
            containerHeight={containerSize.h}
            fitMode={props.fitMode}
            zoom={props.zoom}
            baseScale={scale}
            active={props.current === i}
            selectionMode={props.selectionMode}
            onToggleSelect={() => props.onToggleSelect(i)}
          />
        ))}
      </div>
      {/* Page indicator */}
      <div className="pointer-events-none sticky bottom-4 flex justify-center">
        <div className="rounded-full bg-foreground/85 px-3 py-1 text-xs font-medium text-background shadow-lg backdrop-blur">
          Page {pageIndicator + 1} of {props.pages.length}
        </div>
      </div>
    </div>
  );
}

function PagePane(props: {
  index: number;
  page: EditorPage;
  pdf: PdfDoc;
  visible: boolean;
  containerWidth: number;
  containerHeight: number;
  fitMode: "width" | "page" | "custom";
  zoom: number;
  baseScale: number;
  active: boolean;
  selectionMode: boolean;
  onToggleSelect: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState(false);
  const paneRef = useRef<HTMLDivElement | null>(null);

  // Load intrinsic viewport (at scale 1)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await props.pdf.getPage(props.page.originalIndex + 1);
        const vp = p.getViewport({ scale: 1, rotation: props.page.rotation });
        if (!cancelled) setDims({ w: vp.width, h: vp.height });
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.pdf, props.page.originalIndex, props.page.rotation]);

  const scale = useMemo(() => {
    if (!dims) return 1;
    if (props.fitMode === "custom") return props.baseScale;
    const padding = 48;
    if (props.fitMode === "width") {
      const target = Math.max(320, props.containerWidth - padding);
      return target / dims.w;
    }
    // fit page
    const targetW = Math.max(320, props.containerWidth - padding);
    const targetH = Math.max(320, props.containerHeight - padding);
    return Math.min(targetW / dims.w, targetH / dims.h);
  }, [dims, props.fitMode, props.baseScale, props.containerWidth, props.containerHeight]);

  const displayW = dims ? dims.w * scale : 600;
  const displayH = dims ? dims.h * scale : 800;

  // Render when visible
  useEffect(() => {
    if (!props.visible || !dims) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await props.pdf.getPage(props.page.originalIndex + 1);
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        // Boost internal render resolution so text stays crisp at any zoom.
        const renderScale = Math.max(scale, 1) * dpr;
        const viewport = page.getViewport({ scale: renderScale, rotation: props.page.rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${Math.ceil(displayW)}px`;
        canvas.style.height = `${Math.ceil(displayH)}px`;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;
        if (cancelled) return;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (!cancelled) setRendered(true);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.visible, dims, scale, props.pdf, props.page.originalIndex, props.page.rotation, displayW, displayH]);

  // Free memory when scrolled out of view
  useEffect(() => {
    if (props.visible) return;
    const canvas = canvasRef.current;
    if (canvas && rendered) {
      canvas.width = 0;
      canvas.height = 0;
      setRendered(false);
    }
  }, [props.visible, rendered]);

  return (
    <div
      ref={paneRef}
      data-page={props.index}
      className={cn(
        "group relative overflow-hidden rounded-md bg-white transition-shadow",
        "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_-8px_rgba(0,0,0,0.18)]",
        "hover:shadow-[0_2px_4px_rgba(0,0,0,0.08),0_16px_40px_-12px_rgba(0,0,0,0.25)]",
        props.active && "outline outline-2 outline-signal/70 outline-offset-2",
        props.page.selected && "outline outline-2 outline-signal outline-offset-2",
        props.selectionMode && "cursor-pointer",
      )}
      style={{ width: displayW, height: displayH }}
      onClick={props.onToggleSelect}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {!rendered && (
        <div className="absolute inset-0 grid animate-pulse place-items-center bg-gradient-to-b from-muted/40 to-muted/20 text-xs text-muted-foreground">
          Rendering page {props.index + 1}…
        </div>
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-foreground/70 px-2 py-0.5 text-[10px] font-medium text-background opacity-0 transition-opacity group-hover:opacity-100">
        {props.index + 1}
      </div>
    </div>
  );
}

/* -------------------------- Properties panel -------------------------- */

function PropertiesPanel(props: {
  file: File;
  totalPages: number;
  selectedCount: number;
  firstPageDims: { w: number; h: number } | null;
  pdfVersion: string | null;
  encrypted: boolean;
  mode: Mode;
  actionLabel: string;
  processing: boolean;
  progressLabel: string;
  onApply: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Document</div>
          <dl className="space-y-1.5 text-sm">
            <Info label="Name" value={<span className="break-all">{props.file.name}</span>} />
            <Info label="Size" value={formatBytes(props.file.size)} />
            <Info label="Pages" value={props.totalPages || "—"} />
            {props.firstPageDims && (
              <Info label="Page size" value={`${props.firstPageDims.w} × ${props.firstPageDims.h} pt`} />
            )}
            {props.pdfVersion && <Info label="PDF version" value={props.pdfVersion} />}
            <Info
              label="Security"
              value={
                props.encrypted ? (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <Lock className="h-3 w-3" /> Encrypted
                  </span>
                ) : (
                  "None"
                )
              }
            />
          </dl>
        </div>

        {props.mode === "select" && (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Selection</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{props.selectedCount}</div>
            <div className="text-xs text-muted-foreground">pages selected</div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Shortcuts</div>
          <ul className="space-y-0.5">
            <li>⌘/Ctrl+Z · Undo</li>
            <li>⌘/Ctrl+Y · Redo</li>
            <li>⌘/Ctrl+A · Select all</li>
            <li>Delete · Remove selected</li>
            <li>↑ ↓ · Navigate pages</li>
            <li>Space · Toggle selection</li>
          </ul>
        </div>
      </div>

      {/* Sticky action */}
      <div className="sticky bottom-0 border-t border-border bg-card/95 p-4 backdrop-blur">
        {props.processing && (
          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {props.progressLabel}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-signal" />
            </div>
          </div>
        )}
        <Button
          onClick={props.onApply}
          disabled={props.processing}
          size="lg"
          className="w-full bg-signal text-ink hover:bg-signal/90"
        >
          {props.processing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…
            </>
          ) : (
            props.actionLabel
          )}
        </Button>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  );
}

/* -------------------------- Success screen -------------------------- */

function SuccessScreen({
  result,
  onDownload,
  onEditAgain,
  onNewFile,
}: {
  result: { blob: Blob; filename: string; thumb: string | null; pages: number };
  onDownload: () => void;
  onEditAgain: () => void;
  onNewFile: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-signal/40 bg-card"
    >
      <div className="border-b border-border bg-signal-soft/50 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-signal text-ink">
            <FileCheck2 className="h-5 w-5" />
          </div>
          <div>
            <div className="font-display text-xl">PDF Updated Successfully</div>
            <div className="text-sm text-muted-foreground">
              {result.filename} · {formatBytes(result.blob.size)} · {result.pages} pages
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <div className="grid min-h-[320px] place-items-center overflow-hidden rounded-lg bg-white">
            {result.thumb ? (
              <img src={result.thumb} alt="Preview of first page" className="max-h-[420px] object-contain" />
            ) : (
              <div className="text-sm text-muted-foreground">Preview unavailable</div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Button size="lg" onClick={onDownload} className="w-full bg-signal text-ink hover:bg-signal/90">
            <Download className="mr-2 h-5 w-5" /> Download PDF
          </Button>
          <Button size="lg" variant="outline" onClick={onEditAgain} className="w-full">
            Edit again
          </Button>
          <Button size="lg" variant="ghost" onClick={onNewFile} className="w-full">
            <UploadCloud className="mr-2 h-4 w-4" /> Upload new PDF
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
