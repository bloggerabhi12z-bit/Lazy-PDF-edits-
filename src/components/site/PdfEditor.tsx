import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Bold,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Circle,
  Copy,
  Download,
  Eraser,
  FileCheck2,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  Maximize2,
  MessageSquare,
  Minus,
  MousePointer2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  PenLine,
  PenTool,
  Redo2,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Square,
  Strikethrough,
  Trash2,
  Type,
  Underline as UnderlineIcon,
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
import {
  FONT_OPTIONS,
  ROTATABLE_TYPES,
  deleteSavedSignature,
  getSavedSignatures,
  makeId,
  saveSignature,
  stampElements,
  type AnyElement,
  type DrawElement,
  type FieldCheckboxElement,
  type FieldDropdownElement,
  type FieldRadioElement,
  type FieldTextElement,
  type HighlightElement,
  type ImageElement,
  type SavedSignature,
  type ShapeElement,
  type StickyElement,
  type TextElement,
} from "@/lib/pdf-annotations";

export type EditorPage = {
  id: string;
  originalIndex: number;
  rotation: number;
  selected: boolean;
};

export type EditorApplyState = {
  pages: EditorPage[];
  selectedIds: Set<string>;
};

export type EditorApplyResult = { blob: Blob; filename: string } | void | undefined;

type PdfPage = {
  getViewport: (o: { scale: number; rotation?: number }) => { width: number; height: number };
  render: (o: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
  getTextContent?: () => Promise<{ items: { str: string }[] }>;
};

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };

type Mode = "select" | "reorder" | "rotate";
type Phase = "reading" | "rendering" | "ready" | "error";

type Tool =
  | "select"
  | "hand"
  | "text"
  | "draw"
  | "shape-rect"
  | "shape-ellipse"
  | "shape-line"
  | "highlight"
  | "underline"
  | "strikeout"
  | "squiggly"
  | "image"
  | "signature"
  | "whiteout"
  | "sticky"
  | "field-text"
  | "field-checkbox"
  | "field-radio"
  | "field-dropdown";

interface PdfEditorProps {
  file: File;
  mode: Mode;
  actionLabel: string;
  busy?: boolean;
  selectionHint?: string;
  onReplace: () => void;
  onApply: (state: EditorApplyState) => Promise<EditorApplyResult> | EditorApplyResult;
}

const MAX_HISTORY = 50;
const PROGRESS_LABELS = ["Processing…", "Updating PDF…", "Optimizing…", "Almost done…"];
const NUDGE = 1;
const NUDGE_FAST = 10;

type HistorySnapshot = { pages: EditorPage[]; elements: AnyElement[] };
function snapshotsEqual(a: HistorySnapshot, b: HistorySnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function defaultRotation() {
  return 0;
}

export function PdfEditor({ file, mode, actionLabel, busy = false, selectionHint, onReplace, onApply }: PdfEditorProps) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState<EditorPage[]>([]);
  const [elements, setElements] = useState<AnyElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [markupPickerOpen, setMarkupPickerOpen] = useState(false);
  const [formPickerOpen, setFormPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ pageIndex: number; snippet: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const textCacheRef = useRef<Record<number, string>>({});

  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureTab, setSignatureTab] = useState<"draw" | "type" | "saved">("draw");
  const [typedSignature, setTypedSignature] = useState("");
  const [saveSigAfterInsert, setSaveSigAfterInsert] = useState(true);
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigDrawingRef = useRef(false);

  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const historyRef = useRef<HistorySnapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [, setHistoryTick] = useState(0);
  const skipHistoryRef = useRef(false);

  const [processing, setProcessing] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);

  const [success, setSuccess] = useState<null | { blob: Blob; filename: string; thumb: string | null; pages: number }>(null);

  const lastSelectedRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panStateRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; el: HTMLElement } | null>(null);

  useEffect(() => {
    setSavedSignatures(getSavedSignatures());
  }, [signatureOpen]);

  // Load PDF
  useEffect(() => {
    let cancelled = false;
    setPhase("reading");
    setErrorMsg(null);
    setPdf(null);
    setPages([]);
    setElements([]);
    setSelectedIds(new Set());
    setThumbs({});
    setCurrent(0);
    setSuccess(null);
    historyRef.current = [];
    historyIndexRef.current = -1;
    textCacheRef.current = {};

    (async () => {
      try {
        const { loadPdf } = await import("@/lib/pdf-render");
        const doc = (await loadPdf(file)) as unknown as PdfDoc & {
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
        historyRef.current = [{ pages: initial, elements: [] }];
        historyIndexRef.current = 0;
        setPhase("rendering");

        try {
          const md = await doc.getMetadata?.();
          if (!cancelled) {
            setPdfVersion(md?.info?.PDFFormatVersion ?? null);
            setEncrypted(Boolean(md?.info?.IsEncrypted));
          }
        } catch {
          /* ignore */
        }
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

  // Thumbnails
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

  // History
  useEffect(() => {
    if (pages.length === 0) return;
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    const idx = historyIndexRef.current;
    const last = historyRef.current[idx];
    const next: HistorySnapshot = { pages, elements };
    if (last && snapshotsEqual(last, next)) return;
    const trimmed = historyRef.current.slice(0, idx + 1);
    trimmed.push(next);
    while (trimmed.length > MAX_HISTORY) trimmed.shift();
    historyRef.current = trimmed;
    historyIndexRef.current = trimmed.length - 1;
    setHistoryTick((n) => n + 1);
  }, [pages, elements]);

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  const applySnapshot = useCallback((snap: HistorySnapshot) => {
    skipHistoryRef.current = true;
    setPages(snap.pages);
    setElements(snap.elements);
  }, []);

  const undo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx <= 0) return;
    historyIndexRef.current = idx - 1;
    applySnapshot(historyRef.current[idx - 1]);
    setSelectedIds(new Set());
    setHistoryTick((n) => n + 1);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx >= historyRef.current.length - 1) return;
    historyIndexRef.current = idx + 1;
    applySnapshot(historyRef.current[idx + 1]);
    setSelectedIds(new Set());
    setHistoryTick((n) => n + 1);
  }, [applySnapshot]);

  const reset = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const first = historyRef.current[0];
    historyIndexRef.current = 0;
    historyRef.current = [first];
    applySnapshot(first);
    setSelectedIds(new Set());
    setHistoryTick((n) => n + 1);
  }, [applySnapshot]);

  const selectAllPages = useCallback(() => setPages((ps) => ps.map((p) => ({ ...p, selected: true }))), []);
  const clearPageSelection = useCallback(() => setPages((ps) => ps.map((p) => ({ ...p, selected: false }))), []);
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
      if (e.shiftKey && lastSelectedRef.current != null) selectRange(lastSelectedRef.current, i);
      else if (e.metaKey || e.ctrlKey) setPages((ps) => ps.map((p, idx) => (idx === i ? { ...p, selected: !p.selected } : p)));
      else setPages((ps) => ps.map((p, idx) => ({ ...p, selected: idx === i ? !p.selected : p.selected })));
      lastSelectedRef.current = i;
    },
    [mode, selectRange],
  );

  const rotatePage = useCallback((i: number, delta: number) => {
    setPages((ps) => ps.map((p, idx) => (idx === i ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p)));
  }, []);
  const rotateSelectedPages = useCallback(
    (delta: number) => {
      setPages((ps) => {
        const anySelected = ps.some((p) => p.selected);
        return ps.map((p, idx) => {
          const target = anySelected ? p.selected : idx === current;
          return target ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p;
        });
      });
    },
    [current],
  );
  const deleteSelectedPages = useCallback(() => {
    setPages((ps) => {
      const remaining = ps.filter((p) => !p.selected);
      if (remaining.length === 0) {
        toast.error("You can't delete every page.");
        return ps;
      }
      if (remaining.length === ps.length) {
        if (ps.length <= 1) return ps;
        return ps.filter((_, i) => i !== current);
      }
      return remaining;
    });
  }, [current]);
  const duplicateSelectedPages = useCallback(() => {
    setPages((ps) => {
      const out: EditorPage[] = [];
      const anySelected = ps.some((p) => p.selected);
      ps.forEach((p, idx) => {
        out.push(p);
        const target = anySelected ? p.selected : idx === current;
        if (target) out.push({ ...p, id: `${p.id}-dup-${Date.now()}-${idx}`, selected: false });
      });
      return out;
    });
  }, [current]);
  const movePages = useCallback((fromIndex: number, toIndex: number, multi: boolean) => {
    setPages((ps) => {
      const moving = multi ? ps.map((p, i) => ({ p, i })).filter((x) => x.p.selected) : [{ p: ps[fromIndex], i: fromIndex }];
      if (moving.length === 0) return ps;
      const movingIds = new Set(moving.map((x) => x.p.id));
      const kept = ps.filter((p) => !movingIds.has(p.id));
      let insertAt = toIndex;
      for (const m of moving) if (m.i < toIndex) insertAt--;
      insertAt = Math.max(0, Math.min(kept.length, insertAt));
      const moved = moving.map((m) => m.p);
      return [...kept.slice(0, insertAt), ...moved, ...kept.slice(insertAt)];
    });
  }, []);

  /* -------------------------- Element helpers -------------------------- */

  const addElement = useCallback((el: AnyElement) => {
    setElements((es) => [...es, el]);
    setSelectedIds(new Set([el.id]));
    setActiveTool("select");
  }, []);

  const addElementKeepTool = useCallback((el: AnyElement) => {
    setElements((es) => [...es, el]);
    setSelectedIds(new Set([el.id]));
  }, []);

  const updateElement = useCallback((id: string, patch: Partial<AnyElement>) => {
    setElements((es) => es.map((e) => (e.id === id ? ({ ...e, ...patch } as AnyElement) : e)));
  }, []);

  const updateElements = useCallback((ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => {
    setElements((es) => es.map((e) => (ids.has(e.id) ? ({ ...e, ...patchFn(e) } as AnyElement) : e)));
  }, []);

  const deleteElements = useCallback((ids: Set<string>) => {
    setElements((es) => es.filter((e) => !ids.has(e.id)));
    setSelectedIds(new Set());
  }, []);

  const duplicateElements = useCallback((ids: Set<string>) => {
    setElements((es) => {
      const toDup = es.filter((e) => ids.has(e.id));
      const clones = toDup.map((e) => ({ ...e, id: makeId("dup"), x: e.x + 14, y: e.y + 14 }) as AnyElement);
      setSelectedIds(new Set(clones.map((c) => c.id)));
      return [...es, ...clones];
    });
  }, []);

  const reorderZ = useCallback((ids: Set<string>, direction: "forward" | "backward" | "front" | "back") => {
    setElements((es) => {
      const next = [...es];
      const indices = next.map((e, i) => (ids.has(e.id) ? i : -1)).filter((i) => i >= 0);
      if (indices.length === 0) return es;
      if (direction === "front") {
        const items = indices.map((i) => next[i]);
        const rest = next.filter((_, i) => !indices.includes(i));
        return [...rest, ...items];
      }
      if (direction === "back") {
        const items = indices.map((i) => next[i]);
        const rest = next.filter((_, i) => !indices.includes(i));
        return [...items, ...rest];
      }
      const step = direction === "forward" ? 1 : -1;
      const order = direction === "forward" ? [...indices].reverse() : indices;
      for (const i of order) {
        const j = i + step;
        if (j < 0 || j >= next.length) continue;
        if (ids.has(next[j].id)) continue;
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  }, []);

  const selectedElements = useMemo(() => elements.filter((e) => selectedIds.has(e.id)), [elements, selectedIds]);
  const singleSelected = selectedElements.length === 1 ? selectedElements[0] : null;
  const currentPage = pages[current];

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
        ev.preventDefault();
        undo();
      } else if ((mod && ev.key.toLowerCase() === "y") || (mod && ev.shiftKey && ev.key.toLowerCase() === "z")) {
        ev.preventDefault();
        redo();
      } else if (mod && ev.key.toLowerCase() === "d") {
        ev.preventDefault();
        if (selectedIds.size > 0) duplicateElements(selectedIds);
      } else if (mod && ev.key.toLowerCase() === "a") {
        ev.preventDefault();
        if (elements.length > 0 && activeTool === "select") setSelectedIds(new Set(elements.filter((e) => e.pageId === currentPage?.id).map((e) => e.id)));
        else selectAllPages();
      } else if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        if (selectedIds.size > 0) deleteElements(selectedIds);
        else if (mode === "select") deleteSelectedPages();
      } else if (ev.key === "Escape") {
        setSelectedIds(new Set());
        setActiveTool("select");
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowRight" || ev.key === "ArrowUp" || ev.key === "ArrowLeft") {
        if (selectedIds.size > 0) {
          ev.preventDefault();
          const amt = ev.shiftKey ? NUDGE_FAST : NUDGE;
          const dx = ev.key === "ArrowRight" ? amt : ev.key === "ArrowLeft" ? -amt : 0;
          const dy = ev.key === "ArrowDown" ? amt : ev.key === "ArrowUp" ? -amt : 0;
          updateElements(selectedIds, (e) => ({ x: e.x + dx, y: e.y + dy }));
        } else if (ev.key === "ArrowDown" || ev.key === "ArrowRight") {
          ev.preventDefault();
          setCurrent((c) => Math.min(pages.length - 1, c + 1));
        } else {
          ev.preventDefault();
          setCurrent((c) => Math.max(0, c - 1));
        }
      } else if (ev.key === "Home") {
        ev.preventDefault();
        setCurrent(0);
      } else if (ev.key === "End") {
        ev.preventDefault();
        setCurrent(Math.max(0, pages.length - 1));
      } else if (ev.key === " " && mode === "select" && selectedIds.size === 0) {
        ev.preventDefault();
        setPages((ps) => ps.map((p, i) => (i === current ? { ...p, selected: !p.selected } : p)));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectAllPages, deleteSelectedPages, deleteElements, duplicateElements, updateElements, pages.length, current, mode, selectedIds, elements, activeTool, currentPage]);

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

  const selectedPageCount = useMemo(() => pages.filter((p) => p.selected).length, [pages]);

  useEffect(() => {
    if (!processing) return;
    setProgressIdx(0);
    const t = setInterval(() => setProgressIdx((i) => Math.min(i + 1, PROGRESS_LABELS.length - 1)), 800);
    return () => clearInterval(t);
  }, [processing]);

  async function runSearch(query: string) {
    setSearchQuery(query);
    if (!pdf || !query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results: { pageIndex: number; snippet: string }[] = [];
      for (let i = 0; i < pages.length; i++) {
        const oi = pages[i].originalIndex;
        let text = textCacheRef.current[oi];
        if (text == null) {
          try {
            const page = await pdf.getPage(oi + 1);
            const content = await page.getTextContent?.();
            text = content ? content.items.map((it) => it.str).join(" ") : "";
          } catch {
            text = "";
          }
          textCacheRef.current[oi] = text;
        }
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx >= 0) {
          const start = Math.max(0, idx - 30);
          results.push({ pageIndex: i, snippet: `${start > 0 ? "…" : ""}${text.slice(start, idx + query.length + 30)}…` });
        }
      }
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  }

  function onImageFileChosen(fileList: FileList | null) {
    const f = fileList?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const pageId = currentPage?.id;
        if (!pageId) return;
        const maxW = 220;
        const s = Math.min(1, maxW / img.width);
        addElement({
          id: makeId("img"),
          pageId,
          type: "image",
          x: 60,
          y: 60,
          width: img.width * s,
          height: img.height * s,
          opacity: 1,
          rotation: defaultRotation(),
          src,
        } as ImageElement);
      };
      img.src = src;
    };
    reader.readAsDataURL(f);
  }

  function openSignature() {
    setSignatureOpen(true);
    setSignatureTab("draw");
    setTypedSignature("");
  }
  function clearSignaturePad() {
    const c = sigCanvasRef.current;
    const ctx = c?.getContext("2d");
    ctx?.clearRect(0, 0, c!.width, c!.height);
  }
  function placeSignature(src: string) {
    const pageId = currentPage?.id;
    if (!pageId) return;
    addElement({
      id: makeId("sig"),
      pageId,
      type: "image",
      x: 80,
      y: 80,
      width: 180,
      height: 70,
      opacity: 1,
      rotation: defaultRotation(),
      src,
    } as ImageElement);
  }
  function insertSignature() {
    if (signatureTab === "draw") {
      const c = sigCanvasRef.current;
      if (!c) return;
      const src = c.toDataURL("image/png");
      if (saveSigAfterInsert) saveSignature(src);
      placeSignature(src);
    } else if (signatureTab === "type") {
      const name = typedSignature.trim() || "Signature";
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 140;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.font = "italic 52px 'Times New Roman', serif";
        ctx.fillStyle = "#111827";
        ctx.textBaseline = "middle";
        ctx.fillText(name, 16, 70);
      }
      const src = canvas.toDataURL("image/png");
      if (saveSigAfterInsert) saveSignature(src);
      placeSignature(src);
    }
    setSignatureOpen(false);
  }

  async function apply() {
    if (processing || busy) return;
    setProcessing(true);
    try {
      const selectedIdsForPages = new Set(pages.filter((p) => p.selected).map((p) => p.id));
      const result = await onApply({ pages, selectedIds: selectedIdsForPages });
      if (result && "blob" in result) {
        let finalBlob = result.blob;
        try {
          finalBlob = await stampElements(result.blob, pages, elements);
        } catch (e) {
          console.error("Failed to stamp annotations", e);
          toast.error("Page changes were saved, but annotations could not be applied.");
        }
        let thumbUrl: string | null = null;
        let resultPageCount = pages.length;
        try {
          const { loadPdf, renderPdfPageToCanvas, canvasToBlob } = await import("@/lib/pdf-render");
          const f = new File([finalBlob], result.filename, { type: "application/pdf" });
          const doc = await loadPdf(f);
          resultPageCount = doc.numPages;
          const canvas = await renderPdfPageToCanvas(doc, 1, 1.2);
          const b = await canvasToBlob(canvas, "image/png");
          thumbUrl = URL.createObjectURL(b);
        } catch {
          /* ignore preview failure */
        }
        setSuccess({ blob: finalBlob, filename: result.filename, thumb: thumbUrl, pages: resultPageCount });
        const url = URL.createObjectURL(finalBlob);
        publishResult({ name: result.filename, mime: "application/pdf", size: finalBlob.size, url, createdAt: Date.now() });
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

  if (phase === "error") {
    return (
      <div className="rounded-[14px] border border-[#E5E7EB] bg-white p-8 text-center shadow-[0_18px_50px_-32px_rgba(17,24,39,0.28)]">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600">
          <Lock className="h-6 w-6" />
        </div>
        <h3 className="text-xl font-semibold text-[#111827]">Couldn't open this PDF</h3>
        <p className="mt-2 text-sm text-[#6B7280]">{errorMsg}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" onClick={onReplace} className="rounded-[10px] border-[#E5E7EB] text-[#111827] hover:bg-[#F8F9FA]">
            Choose another file
          </Button>
        </div>
      </div>
    );
  }

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

  const annotateDisabled = !currentPage || currentPage.rotation !== 0;

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-[14px] border border-[#E5E7EB] bg-white shadow-[0_18px_50px_-32px_rgba(17,24,39,0.28)]"
      role="region"
      aria-label="PDF editor"
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          onImageFileChosen(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] bg-white px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-[10px] text-[#6B7280] hover:bg-[#F8F9FA] lg:hidden" onClick={() => setShowLeft((s) => !s)} aria-label="Toggle thumbnails">
            <PanelLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#111827]">{file.name}</div>
            <div className="text-xs text-[#6B7280]">
              {formatBytes(file.size)} · {pdf ? `${pdf.numPages} pages` : "reading…"}
              {mode === "select" && selectedPageCount > 0 && ` · ${selectedPageCount} page(s) selected`}
              {elements.length > 0 && ` · ${elements.length} annotation${elements.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSearch((s) => !s)} className="rounded-[10px] border-[#E5E7EB] text-[#111827] hover:bg-[#F8F9FA]">
            <Search className="mr-1 h-4 w-4" /> Search
          </Button>
          <Button variant="outline" size="sm" onClick={onReplace} className="rounded-[10px] border-[#E5E7EB] text-[#111827] hover:bg-[#F8F9FA]">
            <UploadCloud className="mr-1 h-4 w-4" /> Change file
          </Button>
          <Button variant="ghost" size="icon" className="rounded-[10px] text-[#6B7280] hover:bg-[#F8F9FA] lg:hidden" onClick={() => setShowRight((s) => !s)} aria-label="Toggle properties">
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {showSearch && (
        <div className="border-b border-[#E5E7EB] bg-[#F8F9FA] p-3">
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Search text in this PDF…"
            className="h-9 w-full rounded-[10px] border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/40"
          />
          {searching && <div className="mt-2 text-xs text-[#6B7280]">Searching…</div>}
          {!searching && searchQuery && (
            <div className="mt-2 max-h-40 space-y-1 overflow-auto">
              {searchResults.length === 0 ? (
                <div className="text-xs text-[#6B7280]">No matches.</div>
              ) : (
                searchResults.map((r, i) => (
                  <button key={i} onClick={() => { setCurrent(r.pageIndex); setShowSearch(false); }} className="block w-full rounded-[8px] px-2 py-1.5 text-left text-xs text-[#374151] hover:bg-white">
                    <span className="font-medium text-[#111827]">Page {r.pageIndex + 1}: </span>
                    {r.snippet}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

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
        onRotateLeft={() => rotateSelectedPages(-90)}
        onRotateRight={() => rotateSelectedPages(90)}
        onDeletePage={mode === "select" ? deleteSelectedPages : undefined}
        onDuplicatePage={duplicateSelectedPages}
        selectionMode={mode === "select"}
        selectedPageCount={selectedPageCount}
        onSelectAllPages={selectAllPages}
        onClearPageSelection={clearPageSelection}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        activeTool={activeTool}
        onSetTool={(t) => {
          setSelectedIds(new Set());
          setActiveTool(t);
        }}
        annotateDisabled={annotateDisabled}
        shapePickerOpen={shapePickerOpen}
        onToggleShapePicker={() => { setShapePickerOpen((s) => !s); setMarkupPickerOpen(false); setFormPickerOpen(false); }}
        markupPickerOpen={markupPickerOpen}
        onToggleMarkupPicker={() => { setMarkupPickerOpen((s) => !s); setShapePickerOpen(false); setFormPickerOpen(false); }}
        formPickerOpen={formPickerOpen}
        onToggleFormPicker={() => { setFormPickerOpen((s) => !s); setShapePickerOpen(false); setMarkupPickerOpen(false); }}
        onPickImage={() => { setSelectedIds(new Set()); setActiveTool("image"); imageInputRef.current?.click(); }}
        onOpenSignature={() => { setSelectedIds(new Set()); setActiveTool("signature"); openSignature(); }}
        moreOpen={moreOpen}
        onToggleMore={() => setMoreOpen((s) => !s)}
        onReset={() => { setMoreOpen(false); reset(); }}
        hasSelection={selectedIds.size > 0}
        onDuplicateElements={() => duplicateElements(selectedIds)}
        onDeleteElements={() => deleteElements(selectedIds)}
        onBringForward={() => reorderZ(selectedIds, "forward")}
        onSendBackward={() => reorderZ(selectedIds, "backward")}
        onBringToFront={() => reorderZ(selectedIds, "front")}
        onSendToBack={() => reorderZ(selectedIds, "back")}
      />

      {annotateDisabled && activeTool !== "select" && activeTool !== "hand" && (
        <div className="border-b border-[#E5E7EB] bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Annotation tools are disabled on a rotated page. Rotate it back to 0° to add annotations here.
        </div>
      )}
      {selectionHint && mode === "select" && (
        <div className="border-b border-[#E5E7EB] bg-[#F8F9FA] px-4 py-2 text-xs text-[#6B7280]">{selectionHint}</div>
      )}

      <div
        className={cn(
          "grid gap-0 bg-[#F8F9FA]",
          "lg:grid-cols-[200px_minmax(0,1fr)_260px]",
          !showLeft && "lg:grid-cols-[0px_minmax(0,1fr)_260px]",
          !showRight && "lg:grid-cols-[200px_minmax(0,1fr)_0px]",
          !showLeft && !showRight && "lg:grid-cols-[0px_minmax(0,1fr)_0px]",
        )}
      >
        <aside className={cn("border-b border-[#E5E7EB] bg-[#F8F9FA] transition-all duration-200 md:border-b-0 lg:border-r", !showLeft && "hidden lg:block lg:overflow-hidden")}>
          <ThumbnailRail
            pages={pages}
            current={current}
            thumbs={thumbs}
            mode={mode}
            phase={phase}
            onClickThumb={handleThumbClick}
            onMove={movePages}
            onRotate={(i) => rotatePage(i, 90)}
            onDelete={(i) => setPages((ps) => (ps.length > 1 ? ps.filter((_, idx) => idx !== i) : ps))}
            onDuplicate={(i) => setPages((ps) => { const out = [...ps]; out.splice(i + 1, 0, { ...ps[i], id: `${ps[i].id}-dup-${Date.now()}`, selected: false }); return out; })}
            onInsertBlank={(i) => {
              toast.info("Insert blank page isn't supported by the backend page pipeline yet — duplicate + delete content instead, or ask to add this to the export logic.");
            }}
            onExtract={(i) => {
              toast.info(`Page ${i + 1} noted for extraction — hook this into your export pipeline's "extract" mode to produce a standalone file.`);
            }}
          />
        </aside>

        <section className="min-w-0 bg-[#F8F9FA]">
          <PreviewCanvas
            pdf={pdf}
            pages={pages}
            zoom={zoom}
            fitMode={fitMode}
            current={current}
            onCurrentChange={setCurrent}
            phase={phase}
            onToggleSelect={(i) => {
              if (mode !== "select" || activeTool !== "select") return;
              setPages((ps) => ps.map((p, idx) => (idx === i ? { ...p, selected: !p.selected } : p)));
            }}
            selectionMode={mode === "select" && activeTool === "select"}
            elements={elements}
            activeTool={activeTool}
            selectedIds={selectedIds}
            onSetSelectedIds={setSelectedIds}
            onAddElement={addElement}
            onAddElementKeepTool={addElementKeepTool}
            onUpdateElement={updateElement}
            onUpdateElements={updateElements}
            onDuplicateElements={duplicateElements}
            panStateRef={panStateRef}
          />
        </section>

        <aside className={cn("border-t border-[#E5E7EB] bg-white transition-all duration-200 lg:border-l lg:border-t-0", !showRight && "hidden lg:block lg:overflow-hidden")}>
          <PropertiesPanel
            file={file}
            totalPages={pages.length}
            selectedPageCount={selectedPageCount}
            firstPageDims={firstPageDims}
            pdfVersion={pdfVersion}
            encrypted={encrypted}
            mode={mode}
            actionLabel={actionLabel}
            processing={processing || busy}
            progressLabel={PROGRESS_LABELS[progressIdx]}
            onApply={apply}
            selectedElements={selectedElements}
            singleSelected={singleSelected}
            onUpdateElement={updateElement}
            onUpdateElements={(patch) => updateElements(selectedIds, () => patch)}
            onDeleteElements={() => deleteElements(selectedIds)}
            onDuplicateElements={() => duplicateElements(selectedIds)}
            onImageReplace={() => imageInputRef.current?.click()}
          />
        </aside>
      </div>

      {signatureOpen && (
        <SignatureModal
          tab={signatureTab}
          onTabChange={setSignatureTab}
          typedSignature={typedSignature}
          onTypedChange={setTypedSignature}
          canvasRef={sigCanvasRef}
          drawingRef={sigDrawingRef}
          onClear={clearSignaturePad}
          onCancel={() => { setSignatureOpen(false); setActiveTool("select"); }}
          onInsert={insertSignature}
          saveAfterInsert={saveSigAfterInsert}
          onSaveAfterInsertChange={setSaveSigAfterInsert}
          savedSignatures={savedSignatures}
          onUseSaved={(src) => { placeSignature(src); setSignatureOpen(false); }}
          onDeleteSaved={(id) => { deleteSavedSignature(id); setSavedSignatures(getSavedSignatures()); }}
        />
      )}
    </div>
  );
}

/* -------------------------- Toolbar -------------------------- */

function ToolbarButton({ icon, label, onClick, disabled, active }: { icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-[10px] text-[#374151] transition-all duration-200",
        "hover:bg-[#F8F9FA] hover:text-[#111827]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        "disabled:pointer-events-none disabled:opacity-35",
        active && "bg-[#2563EB]/10 text-[#2563EB] hover:bg-[#2563EB]/15 hover:text-[#2563EB]",
      )}
    >
      {icon}
    </button>
  );
}
function ToolbarDivider() {
  return <div className="mx-1.5 h-6 w-px shrink-0 bg-[#E5E7EB]" aria-hidden />;
}

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
  onDeletePage?: () => void;
  onDuplicatePage: () => void;
  selectionMode: boolean;
  selectedPageCount: number;
  onSelectAllPages: () => void;
  onClearPageSelection: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  activeTool: Tool;
  onSetTool: (t: Tool) => void;
  annotateDisabled: boolean;
  shapePickerOpen: boolean;
  onToggleShapePicker: () => void;
  markupPickerOpen: boolean;
  onToggleMarkupPicker: () => void;
  formPickerOpen: boolean;
  onToggleFormPicker: () => void;
  onPickImage: () => void;
  onOpenSignature: () => void;
  moreOpen: boolean;
  onToggleMore: () => void;
  onReset: () => void;
  hasSelection: boolean;
  onDuplicateElements: () => void;
  onDeleteElements: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
}) {
  const [jumpValue, setJumpValue] = useState("");
  const shapeIcon = props.activeTool === "shape-ellipse" ? <Circle className="h-4 w-4" /> : props.activeTool === "shape-line" ? <Minus className="h-4 w-4" /> : <Square className="h-4 w-4" />;
  const markupIcon =
    props.activeTool === "strikeout" ? <Strikethrough className="h-4 w-4" /> : props.activeTool === "squiggly" ? <PenLine className="h-4 w-4" /> : <UnderlineIcon className="h-4 w-4" />;
  const formIcon =
    props.activeTool === "field-checkbox" ? <CheckSquare className="h-4 w-4" /> : props.activeTool === "field-radio" ? <Circle className="h-4 w-4" /> : props.activeTool === "field-dropdown" ? <ChevronDown className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />;

  return (
    <div className="sticky top-0 z-20 flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-[#E5E7EB] bg-white/95 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-0.5">
        <ToolbarButton icon={<MousePointer2 className="h-4 w-4" />} label="Select" onClick={() => props.onSetTool("select")} active={props.activeTool === "select"} />
        <ToolbarButton icon={<Hand className="h-4 w-4" />} label="Hand (pan)" onClick={() => props.onSetTool("hand")} active={props.activeTool === "hand"} />
        <ToolbarButton icon={<Type className="h-4 w-4" />} label="Text" onClick={() => props.onSetTool("text")} active={props.activeTool === "text"} disabled={props.annotateDisabled} />
        <ToolbarButton icon={<PenLine className="h-4 w-4" />} label="Draw" onClick={() => props.onSetTool("draw")} active={props.activeTool === "draw"} disabled={props.annotateDisabled} />
        <div className="relative">
          <ToolbarButton icon={shapeIcon} label="Shapes" onClick={props.onToggleShapePicker} active={props.activeTool.startsWith("shape-")} disabled={props.annotateDisabled} />
          {props.shapePickerOpen && (
            <div className="absolute left-0 top-10 z-30 flex gap-0.5 rounded-[10px] border border-[#E5E7EB] bg-white p-1 shadow-lg">
              <ToolbarButton icon={<Square className="h-4 w-4" />} label="Rectangle" onClick={() => props.onSetTool("shape-rect")} active={props.activeTool === "shape-rect"} />
              <ToolbarButton icon={<Circle className="h-4 w-4" />} label="Ellipse" onClick={() => props.onSetTool("shape-ellipse")} active={props.activeTool === "shape-ellipse"} />
              <ToolbarButton icon={<Minus className="h-4 w-4" />} label="Line" onClick={() => props.onSetTool("shape-line")} active={props.activeTool === "shape-line"} />
            </div>
          )}
        </div>
        <ToolbarButton icon={<Highlighter className="h-4 w-4" />} label="Highlight" onClick={() => props.onSetTool("highlight")} active={props.activeTool === "highlight"} disabled={props.annotateDisabled} />
        <div className="relative">
          <ToolbarButton icon={markupIcon} label="Underline / Strikeout / Squiggly" onClick={props.onToggleMarkupPicker} active={["underline", "strikeout", "squiggly"].includes(props.activeTool)} disabled={props.annotateDisabled} />
          {props.markupPickerOpen && (
            <div className="absolute left-0 top-10 z-30 flex gap-0.5 rounded-[10px] border border-[#E5E7EB] bg-white p-1 shadow-lg">
              <ToolbarButton icon={<UnderlineIcon className="h-4 w-4" />} label="Underline" onClick={() => props.onSetTool("underline")} active={props.activeTool === "underline"} />
              <ToolbarButton icon={<Strikethrough className="h-4 w-4" />} label="Strikeout" onClick={() => props.onSetTool("strikeout")} active={props.activeTool === "strikeout"} />
              <ToolbarButton icon={<PenLine className="h-4 w-4" />} label="Squiggly" onClick={() => props.onSetTool("squiggly")} active={props.activeTool === "squiggly"} />
            </div>
          )}
        </div>
        <ToolbarButton icon={<ImageIcon className="h-4 w-4" />} label="Image" onClick={props.onPickImage} active={props.activeTool === "image"} disabled={props.annotateDisabled} />
        <ToolbarButton icon={<PenTool className="h-4 w-4" />} label="Signature" onClick={props.onOpenSignature} active={props.activeTool === "signature"} disabled={props.annotateDisabled} />
        <ToolbarButton icon={<Eraser className="h-4 w-4" />} label="Whiteout" onClick={() => props.onSetTool("whiteout")} active={props.activeTool === "whiteout"} disabled={props.annotateDisabled} />
        <ToolbarButton icon={<MessageSquare className="h-4 w-4" />} label="Comment / Sticky note" onClick={() => props.onSetTool("sticky")} active={props.activeTool === "sticky"} disabled={props.annotateDisabled} />
        <div className="relative">
          <ToolbarButton icon={formIcon} label="Form fields" onClick={props.onToggleFormPicker} active={props.activeTool.startsWith("field-")} disabled={props.annotateDisabled} />
          {props.formPickerOpen && (
            <div className="absolute left-0 top-10 z-30 flex gap-0.5 rounded-[10px] border border-[#E5E7EB] bg-white p-1 shadow-lg">
              <ToolbarButton icon={<ListChecks className="h-4 w-4" />} label="Text field" onClick={() => props.onSetTool("field-text")} active={props.activeTool === "field-text"} />
              <ToolbarButton icon={<CheckSquare className="h-4 w-4" />} label="Checkbox" onClick={() => props.onSetTool("field-checkbox")} active={props.activeTool === "field-checkbox"} />
              <ToolbarButton icon={<Circle className="h-4 w-4" />} label="Radio button" onClick={() => props.onSetTool("field-radio")} active={props.activeTool === "field-radio"} />
              <ToolbarButton icon={<ChevronDown className="h-4 w-4" />} label="Dropdown" onClick={() => props.onSetTool("field-dropdown")} active={props.activeTool === "field-dropdown"} />
            </div>
          )}
        </div>
      </div>

      <ToolbarDivider />

      {props.hasSelection && (
        <>
          <div className="flex items-center gap-0.5">
            <ToolbarButton icon={<Copy className="h-4 w-4" />} label="Duplicate (Ctrl+D)" onClick={props.onDuplicateElements} />
            <ToolbarButton icon={<Trash2 className="h-4 w-4" />} label="Delete" onClick={props.onDeleteElements} />
            <ToolbarButton icon={<ChevronsUp className="h-4 w-4" />} label="Bring forward" onClick={props.onBringForward} />
            <ToolbarButton icon={<ChevronsDown className="h-4 w-4" />} label="Send backward" onClick={props.onSendBackward} />
          </div>
          <ToolbarDivider />
        </>
      )}

      <div className="flex items-center gap-0.5">
        <ToolbarButton icon={<ChevronLeft className="h-4 w-4" />} label="Previous page" onClick={props.onPrev} disabled={props.current === 0} />
        <form onSubmit={(e) => { e.preventDefault(); const n = parseInt(jumpValue, 10); if (!isNaN(n) && n >= 1 && n <= props.totalPages) props.onJump(n - 1); setJumpValue(""); }} className="flex items-center gap-1 px-1">
          <input value={jumpValue} onChange={(e) => setJumpValue(e.target.value)} placeholder={`${props.current + 1}`} aria-label="Jump to page" className="h-8 w-11 rounded-[8px] border border-[#E5E7EB] bg-white px-1 text-center text-xs tabular-nums text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/40" />
          <span className="text-xs text-[#6B7280]">/ {props.totalPages || "—"}</span>
        </form>
        <ToolbarButton icon={<ChevronRight className="h-4 w-4" />} label="Next page" onClick={props.onNext} disabled={props.current >= props.totalPages - 1} />
      </div>

      <ToolbarDivider />
      <div className="flex items-center gap-0.5">
        <ToolbarButton icon={<RotateCcw className="h-4 w-4" />} label="Rotate page left" onClick={props.onRotateLeft} />
        <ToolbarButton icon={<RotateCw className="h-4 w-4" />} label="Rotate page right" onClick={props.onRotateRight} />
        {props.onDeletePage && <ToolbarButton icon={<Trash2 className="h-4 w-4" />} label="Delete page" onClick={props.onDeletePage} />}
        <ToolbarButton icon={<Copy className="h-4 w-4" />} label="Duplicate page" onClick={props.onDuplicatePage} />
      </div>

      {props.selectionMode && (
        <>
          <ToolbarDivider />
          <div className="flex items-center gap-0.5">
            <ToolbarButton icon={<CheckSquare className="h-4 w-4" />} label="Select all pages" onClick={props.onSelectAllPages} />
            <ToolbarButton icon={<Square className="h-4 w-4" />} label="Clear page selection" onClick={props.onClearPageSelection} />
          </div>
          {props.selectedPageCount > 0 && <span className="ml-1 rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-xs font-medium tabular-nums text-[#2563EB]">{props.selectedPageCount} pages</span>}
        </>
      )}

      <ToolbarDivider />
      <div className="flex items-center gap-0.5">
        <ToolbarButton icon={<ZoomOut className="h-4 w-4" />} label="Zoom out" onClick={props.onZoomOut} />
        <div className="w-11 text-center text-xs font-medium tabular-nums text-[#374151]">{Math.round(props.zoom * 100)}%</div>
        <ToolbarButton icon={<ZoomIn className="h-4 w-4" />} label="Zoom in" onClick={props.onZoomIn} />
        <ToolbarButton icon={<ArrowLeftRight className="h-4 w-4" />} label="Fit width" onClick={props.onFitWidth} active={props.fitMode === "width"} />
        <ToolbarButton icon={<Maximize2 className="h-4 w-4" />} label="Fit page" onClick={props.onFitPage} active={props.fitMode === "page"} />
      </div>

      <div className="ml-auto flex items-center gap-0.5 pl-2">
        <ToolbarButton icon={<Undo2 className="h-4 w-4" />} label="Undo" onClick={props.onUndo} disabled={!props.canUndo} />
        <ToolbarButton icon={<Redo2 className="h-4 w-4" />} label="Redo" onClick={props.onRedo} disabled={!props.canRedo} />
        <ToolbarDivider />
        <div className="relative">
          <ToolbarButton icon={<MoreHorizontal className="h-4 w-4" />} label="More" onClick={props.onToggleMore} />
          {props.moreOpen && (
            <div className="absolute right-0 top-10 z-30 min-w-44 rounded-[10px] border border-[#E5E7EB] bg-white p-1 shadow-lg">
              {props.hasSelection && (
                <>
                  <button type="button" onClick={props.onBringToFront} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm text-[#111827] hover:bg-[#F8F9FA]">
                    <ChevronsUp className="h-3.5 w-3.5" /> Bring to front
                  </button>
                  <button type="button" onClick={props.onSendToBack} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm text-[#111827] hover:bg-[#F8F9FA]">
                    <ChevronsDown className="h-3.5 w-3.5" /> Send to back
                  </button>
                </>
              )}
              <button type="button" onClick={props.onReset} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm text-[#111827] hover:bg-[#F8F9FA]">
                <RefreshCw className="h-3.5 w-3.5" /> Reset all changes
              </button>
            </div>
          )}
        </div>
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
  onInsertBlank: (i: number) => void;
  onExtract: (i: number) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, [menu]);

  return (
    <div className="relative h-[calc(100vh-260px)] min-h-[520px] overflow-auto p-2.5">
      {props.phase === "reading" && (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-[#6B7280]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading PDF…
        </div>
      )}
      <ul className="space-y-2.5" role="listbox" aria-label="Pages">
        {props.pages.map((p, i) => {
          const isActive = props.current === i;
          const showDropAbove = dragOver === i;
          return (
            <li
              key={p.id}
              draggable
              onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch { /* noop */ } }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(i); }}
              onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
              onDrop={(e) => { e.preventDefault(); const from = dragging ?? parseInt(e.dataTransfer.getData("text/plain") || "-1", 10); setDragging(null); setDragOver(null); if (from < 0) return; const anyOtherSelected = props.pages.some((x, idx) => x.selected && idx !== from); props.onMove(from, i, props.pages[from]?.selected && anyOtherSelected ? true : false); }}
              onDragEnd={() => { setDragging(null); setDragOver(null); }}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, index: i }); }}
              className={cn("relative rounded-[10px] transition-all duration-200", showDropAbove && "before:absolute before:-top-1.5 before:left-2 before:right-2 before:h-0.5 before:rounded-full before:bg-[#2563EB]", dragging === i && "opacity-40")}
              role="option"
              aria-selected={p.selected}
            >
              <motion.div layout initial={false} animate={{ scale: isActive ? 1.02 : 1 }} transition={{ type: "spring", stiffness: 260, damping: 22 }} className={cn("group relative rounded-[10px] border-2 bg-white p-1 shadow-sm transition-all duration-200 hover:shadow-md", isActive ? "border-[#2563EB]" : "border-transparent hover:border-[#E5E7EB]", p.selected && "ring-2 ring-[#2563EB] ring-offset-1 ring-offset-[#F8F9FA]")}>
                <button type="button" onClick={(e) => props.onClickThumb(i, e)} className="block w-full rounded-[8px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50" aria-label={`Page ${i + 1}${p.selected ? ", selected" : ""}`}>
                  <div className="mx-auto grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-[6px] bg-[#F3F4F6] transition-transform duration-200" style={{ transform: `rotate(${p.rotation}deg)` }}>
                    {props.thumbs[p.originalIndex] ? (
                      <img src={props.thumbs[p.originalIndex]} alt="" loading="lazy" className="h-full w-full object-contain" />
                    ) : (
                      <div className="h-full w-full animate-pulse bg-gradient-to-b from-[#E5E7EB] to-[#F3F4F6]" />
                    )}
                  </div>
                </button>
                <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-[#6B7280]">
                  <span className="tabular-nums">{i + 1}</span>
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <button type="button" onClick={(e) => { e.stopPropagation(); props.onRotate(i); }} aria-label={`Rotate page ${i + 1}`} className="rounded p-0.5 hover:bg-[#F3F4F6]">
                      <RotateCw className="h-3 w-3" />
                    </button>
                    {props.mode === "select" && (
                      <input type="checkbox" checked={p.selected} onChange={() => {}} onClick={(e) => { e.stopPropagation(); props.onClickThumb(i, e as unknown as ReactMouseEvent); }} aria-label={`Select page ${i + 1}`} className="h-3.5 w-3.5 accent-[#2563EB]" />
                    )}
                  </div>
                </div>
              </motion.div>
            </li>
          );
        })}
      </ul>

      {menu && (
        <div role="menu" style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 60 } as CSSProperties} className="min-w-44 rounded-[10px] border border-[#E5E7EB] bg-white p-1 text-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<RotateCw className="h-3.5 w-3.5" />} onClick={() => { props.onRotate(menu.index); setMenu(null); }}>Rotate 90°</MenuItem>
          <MenuItem icon={<Copy className="h-3.5 w-3.5" />} onClick={() => { props.onDuplicate(menu.index); setMenu(null); }}>Duplicate</MenuItem>
          <MenuItem icon={<PanelLeft className="h-3.5 w-3.5" />} onClick={() => { props.onInsertBlank(menu.index); setMenu(null); }}>Insert blank page after</MenuItem>
          <MenuItem icon={<Download className="h-3.5 w-3.5" />} onClick={() => { props.onExtract(menu.index); setMenu(null); }}>Extract this page</MenuItem>
          <MenuItem icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { props.onDelete(menu.index); setMenu(null); }} danger>Delete page</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[#111827] transition-colors duration-200 hover:bg-[#F8F9FA]", danger && "text-red-600 hover:bg-red-50")}>
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
  elements: AnyElement[];
  activeTool: Tool;
  selectedIds: Set<string>;
  onSetSelectedIds: (ids: Set<string>) => void;
  onAddElement: (el: AnyElement) => void;
  onAddElementKeepTool: (el: AnyElement) => void;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => void;
  onDuplicateElements: (ids: Set<string>) => void;
  panStateRef: React.MutableRefObject<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; el: HTMLElement } | null>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [pageIndicator, setPageIndicator] = useState<number>(props.current);
  const indicatorTimer = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (!props.pdf) return 1.5;
    if (props.fitMode === "custom") return 1.5 * props.zoom;
    return props.fitMode === "width" ? 1.5 : 1.2;
  }, [props.pdf, props.fitMode, props.zoom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-page="${props.current}"]`);
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [props.current]);

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
        const topEntry = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
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

  function onContainerMouseDown(e: ReactMouseEvent) {
    if (props.activeTool !== "hand") return;
    const el = containerRef.current;
    if (!el) return;
    props.panStateRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, el };
    function onMove(ev: MouseEvent) {
      const st = props.panStateRef.current;
      if (!st) return;
      st.el.scrollLeft = st.scrollLeft - (ev.clientX - st.startX);
      st.el.scrollTop = st.scrollTop - (ev.clientY - st.startY);
    }
    function onUp() {
      props.panStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (props.phase === "reading") {
    return (
      <div className="grid h-[70vh] place-items-center text-sm text-[#6B7280]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin" />
          <div>Reading PDF…</div>
        </div>
      </div>
    );
  }
  if (!props.pdf) {
    return (
      <div className="grid h-[70vh] place-items-center text-sm text-[#6B7280]">
        <div>Preparing editor…</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={onContainerMouseDown}
      className="relative h-[calc(100vh-260px)] min-h-[520px] overflow-auto"
      style={{ cursor: props.activeTool === "hand" ? "grab" : undefined }}
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
            elements={props.elements.filter((e) => e.pageId === p.id)}
            activeTool={props.activeTool}
            selectedIds={props.selectedIds}
            onSetSelectedIds={props.onSetSelectedIds}
            onAddElement={props.onAddElement}
            onAddElementKeepTool={props.onAddElementKeepTool}
            onUpdateElement={props.onUpdateElement}
            onUpdateElements={props.onUpdateElements}
            onDuplicateElements={props.onDuplicateElements}
          />
        ))}
      </div>
      <div className="pointer-events-none sticky bottom-4 flex justify-center">
        <div className="rounded-full bg-[#111827]/90 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur">Page {pageIndicator + 1} of {props.pages.length}</div>
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
  elements: AnyElement[];
  activeTool: Tool;
  selectedIds: Set<string>;
  onSetSelectedIds: (ids: Set<string>) => void;
  onAddElement: (el: AnyElement) => void;
  onAddElementKeepTool: (el: AnyElement) => void;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => void;
  onDuplicateElements: (ids: Set<string>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState(false);
  const paneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await props.pdf.getPage(props.page.originalIndex + 1);
        const vp = p.getViewport({ scale: 1, rotation: props.page.rotation });
        if (!cancelled) setDims({ w: vp.width, h: vp.height });
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [props.pdf, props.page.originalIndex, props.page.rotation]);

  const scale = useMemo(() => {
    if (!dims) return 1;
    if (props.fitMode === "custom") return props.baseScale;
    const padding = 48;
    if (props.fitMode === "width") return Math.max(320, props.containerWidth - padding) / dims.w;
    const targetW = Math.max(320, props.containerWidth - padding);
    const targetH = Math.max(320, props.containerHeight - padding);
    return Math.min(targetW / dims.w, targetH / dims.h);
  }, [dims, props.fitMode, props.baseScale, props.containerWidth, props.containerHeight]);

  const displayW = dims ? dims.w * scale : 600;
  const displayH = dims ? dims.h * scale : 800;

  useEffect(() => {
    if (!props.visible || !dims) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await props.pdf.getPage(props.page.originalIndex + 1);
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
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
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [props.visible, dims, scale, props.pdf, props.page.originalIndex, props.page.rotation, displayW, displayH]);

  useEffect(() => {
    if (props.visible) return;
    const canvas = canvasRef.current;
    if (canvas && rendered) { canvas.width = 0; canvas.height = 0; setRendered(false); }
  }, [props.visible, rendered]);

  const canAnnotate = props.page.rotation === 0;

  return (
    <div
      ref={paneRef}
      data-page={props.index}
      className={cn(
        "group relative overflow-hidden rounded-[10px] bg-white transition-shadow duration-200",
        "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_-8px_rgba(0,0,0,0.18)]",
        "hover:shadow-[0_2px_4px_rgba(0,0,0,0.08),0_16px_40px_-12px_rgba(0,0,0,0.25)]",
        props.active && "outline outline-2 outline-[#2563EB]/70 outline-offset-2",
        props.selectionMode && "cursor-pointer",
      )}
      style={{ width: displayW, height: displayH }}
      onClick={props.selectionMode ? props.onToggleSelect : undefined}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {!rendered && (
        <div className="absolute inset-0 grid animate-pulse place-items-center bg-gradient-to-b from-[#F3F4F6] to-[#F8F9FA] text-xs text-[#6B7280]">Rendering page {props.index + 1}…</div>
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-[#111827]/75 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">{props.index + 1}</div>
      {canAnnotate && dims && (
        <AnnotationLayer
          pageId={props.page.id}
          scale={scale}
          elements={props.elements}
          activeTool={props.activeTool}
          selectedIds={props.selectedIds}
          onSetSelectedIds={props.onSetSelectedIds}
          onAddElement={props.onAddElement}
          onAddElementKeepTool={props.onAddElementKeepTool}
          onUpdateElement={props.onUpdateElement}
          onUpdateElements={props.onUpdateElements}
          onDuplicateElements={props.onDuplicateElements}
          interactive={props.activeTool !== "hand"}
        />
      )}
    </div>
  );
}

/* -------------------------- Annotation overlay -------------------------- */

function elementBounds(el: AnyElement) {
  return { x1: el.x, y1: el.y, x2: el.x + el.width, y2: el.y + el.height };
}
function rectsIntersect(a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function AnnotationLayer(props: {
  pageId: string;
  scale: number;
  elements: AnyElement[];
  activeTool: Tool;
  selectedIds: Set<string>;
  onSetSelectedIds: (ids: Set<string>) => void;
  onAddElement: (el: AnyElement) => void;
  onAddElementKeepTool: (el: AnyElement) => void;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => void;
  onDuplicateElements: (ids: Set<string>) => void;
  interactive: boolean;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStateRef = useRef<{ startPt: { x: number; y: number } } | null>(null);
  const moveStateRef = useRef<{ ids: string[]; offsets: Record<string, { x: number; y: number }> } | null>(null);
  const resizeStateRef = useRef<{ id: string; startW: number; startH: number } | null>(null);
  const rotateStateRef = useRef<{ id: string; centerX: number; centerY: number; startAngle: number; startRotation: number } | null>(null);

  const toPt = useCallback((clientX: number, clientY: number) => {
    const rect = layerRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / props.scale, y: (clientY - rect.top) / props.scale };
  }, [props.scale]);

  const nonCreationTools: Tool[] = ["select", "hand", "image", "signature"];
  const isCreationTool = props.interactive && !nonCreationTools.includes(props.activeTool);
  const isFieldTool = props.activeTool.startsWith("field-");

  function makeFieldDefault(): AnyElement | null {
    const base = { id: makeId(props.activeTool), pageId: props.pageId, opacity: 1, rotation: 0 } as const;
    if (props.activeTool === "field-text") return { ...base, type: "field-text", width: 180, height: 26, name: "text_field", value: "", placeholder: "Enter text", required: false } as FieldTextElement;
    if (props.activeTool === "field-checkbox") return { ...base, type: "field-checkbox", width: 18, height: 18, name: "checkbox", checked: false, required: false } as FieldCheckboxElement;
    if (props.activeTool === "field-radio") return { ...base, type: "field-radio", width: 18, height: 18, groupName: "radio_group", value: "option_1", checked: false, required: false } as FieldRadioElement;
    if (props.activeTool === "field-dropdown") return { ...base, type: "field-dropdown", width: 160, height: 26, name: "dropdown", options: ["Option 1", "Option 2"], value: "Option 1", required: false } as FieldDropdownElement;
    return null;
  }

  function onLayerMouseDown(e: ReactMouseEvent) {
    if (!props.interactive) return;
    if (!isCreationTool) {
      if (e.target === layerRef.current) {
        if (e.shiftKey || e.metaKey || e.ctrlKey) return; // keep existing selection, start marquee-union below
        props.onSetSelectedIds(new Set());
        // marquee select
        const start = toPt(e.clientX, e.clientY);
        setMarquee({ x: start.x, y: start.y, w: 0, h: 0 });
        function onMove(ev: MouseEvent) {
          const p = toPt(ev.clientX, ev.clientY);
          setMarquee({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
        }
        function onUp(ev: MouseEvent) {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          const p = toPt(ev.clientX, ev.clientY);
          const rect = { x1: Math.min(start.x, p.x), y1: Math.min(start.y, p.y), x2: Math.max(start.x, p.x), y2: Math.max(start.y, p.y) };
          if (Math.abs(rect.x2 - rect.x1) > 3 || Math.abs(rect.y2 - rect.y1) > 3) {
            const hit = props.elements.filter((el) => rectsIntersect(rect, elementBounds(el))).map((el) => el.id);
            props.onSetSelectedIds(new Set(hit));
          }
          setMarquee(null);
        }
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }
      return;
    }

    const pt = toPt(e.clientX, e.clientY);

    if (props.activeTool === "text") {
      props.onAddElement({
        id: makeId("txt"), pageId: props.pageId, type: "text", x: pt.x, y: pt.y, width: 180, height: 28, opacity: 1, rotation: 0,
        text: "Text", font: "Helvetica", fontSize: 14, bold: false, italic: false, underline: false, color: "#111827", align: "left",
        letterSpacing: 0, lineSpacing: 1.25,
      } as TextElement);
      return;
    }
    if (props.activeTool === "sticky") {
      props.onAddElement({ id: makeId("sticky"), pageId: props.pageId, type: "sticky", x: pt.x, y: pt.y, width: 140, height: 100, opacity: 1, rotation: 0, color: "#FEF08A", note: "" } as StickyElement);
      return;
    }
    if (isFieldTool) {
      const el = makeFieldDefault();
      if (el) props.onAddElement({ ...el, x: pt.x, y: pt.y } as AnyElement);
      return;
    }

    dragStateRef.current = { startPt: pt };
    if (props.activeTool === "draw") setDrawPoints([pt]);
    else setDraft({ x: pt.x, y: pt.y, w: 0, h: 0 });

    function onMove(ev: MouseEvent) {
      const p = toPt(ev.clientX, ev.clientY);
      if (props.activeTool === "draw") {
        setDrawPoints((pts) => (pts ? [...pts, p] : [p]));
      } else {
        const start = dragStateRef.current!.startPt;
        setDraft({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
      }
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const p = toPt(ev.clientX, ev.clientY);
      const start = dragStateRef.current?.startPt ?? p;
      dragStateRef.current = null;

      if (props.activeTool === "draw") {
        setDrawPoints((pts) => {
          if (pts && pts.length > 1) {
            const xs = pts.map((pp) => pp.x); const ys = pts.map((pp) => pp.y);
            const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
            props.onAddElement({
              id: makeId("draw"), pageId: props.pageId, type: "draw", x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), opacity: 1, rotation: 0,
              stroke: "#2563EB", strokeWidth: 2, points: pts.map((pp) => ({ x: pp.x - minX, y: pp.y - minY })),
            } as DrawElement);
          }
          return null;
        });
        return;
      }

      const x = Math.min(start.x, p.x); const y = Math.min(start.y, p.y);
      const w = Math.max(8, Math.abs(p.x - start.x)); const h = Math.max(8, Math.abs(p.y - start.y));
      setDraft(null);

      if (props.activeTool === "shape-rect" || props.activeTool === "shape-ellipse" || props.activeTool === "shape-line") {
        props.onAddElement({
          id: makeId("shape"), pageId: props.pageId, type: props.activeTool === "shape-rect" ? "rect" : props.activeTool === "shape-ellipse" ? "ellipse" : "line",
          x, y, width: w, height: h, opacity: 1, rotation: 0, stroke: "#2563EB", strokeWidth: 2, fill: null,
        } as ShapeElement);
      } else if (props.activeTool === "highlight" || props.activeTool === "underline" || props.activeTool === "strikeout" || props.activeTool === "squiggly") {
        props.onAddElement({
          id: makeId("markup"), pageId: props.pageId, type: props.activeTool, x, y, width: w, height: h, opacity: props.activeTool === "highlight" ? 0.35 : 1, rotation: 0, color: "#FDE047",
        } as HighlightElement);
      } else if (props.activeTool === "whiteout") {
        props.onAddElement({ id: makeId("wo"), pageId: props.pageId, type: "whiteout", x, y, width: w, height: h, opacity: 1, rotation: 0, color: "#ffffff" });
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startMove(e: ReactMouseEvent, el: AnyElement) {
    e.stopPropagation();
    if (!props.interactive || props.activeTool !== "select") return;
    let ids = props.selectedIds;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = new Set(ids);
      if (next.has(el.id)) next.delete(el.id); else next.add(el.id);
      props.onSetSelectedIds(next);
      ids = next;
    } else if (!ids.has(el.id)) {
      ids = new Set([el.id]);
      props.onSetSelectedIds(ids);
    }
    if (!ids.has(el.id)) return;

    if (e.altKey) {
      props.onDuplicateElements(ids);
      return; // clones become selected; next drag will move them
    }

    const pt = toPt(e.clientX, e.clientY);
    const offsets: Record<string, { x: number; y: number }> = {};
    for (const id of ids) {
      const found = props.elements.find((x) => x.id === id);
      if (found) offsets[id] = { x: pt.x - found.x, y: pt.y - found.y };
    }
    moveStateRef.current = { ids: Array.from(ids), offsets };
    function onMove(ev: MouseEvent) {
      const p = toPt(ev.clientX, ev.clientY);
      const st = moveStateRef.current;
      if (!st) return;
      props.onUpdateElements(new Set(st.ids), (e2) => ({ x: p.x - st.offsets[e2.id].x, y: p.y - st.offsets[e2.id].y }));
    }
    function onUp() {
      moveStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startResize(e: ReactMouseEvent, el: AnyElement) {
    e.stopPropagation();
    resizeStateRef.current = { id: el.id, startW: el.width, startH: el.height };
    const startClient = { x: e.clientX, y: e.clientY };
    function onMove(ev: MouseEvent) {
      const st = resizeStateRef.current;
      if (!st) return;
      const dx = (ev.clientX - startClient.x) / props.scale;
      const dy = (ev.clientY - startClient.y) / props.scale;
      props.onUpdateElement(st.id, { width: Math.max(12, st.startW + dx), height: Math.max(12, st.startH + dy) });
    }
    function onUp() {
      resizeStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startRotate(e: ReactMouseEvent, el: AnyElement) {
    e.stopPropagation();
    const rect = layerRef.current!.getBoundingClientRect();
    const centerX = rect.left + (el.x + el.width / 2) * props.scale;
    const centerY = rect.top + (el.y + el.height / 2) * props.scale;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    rotateStateRef.current = { id: el.id, centerX, centerY, startAngle, startRotation: el.rotation };
    function onMove(ev: MouseEvent) {
      const st = rotateStateRef.current;
      if (!st) return;
      const angle = Math.atan2(ev.clientY - st.centerY, ev.clientX - st.centerX);
      const deltaDeg = ((angle - st.startAngle) * 180) / Math.PI;
      let rotation = Math.round(st.startRotation + deltaDeg);
      if (ev.shiftKey) rotation = Math.round(rotation / 15) * 15;
      props.onUpdateElement(st.id, { rotation: ((rotation % 360) + 360) % 360 });
    }
    function onUp() {
      rotateStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div ref={layerRef} className="absolute inset-0" style={{ cursor: isCreationTool ? "crosshair" : props.activeTool === "hand" ? undefined : "default", pointerEvents: props.interactive ? "auto" : "none" }} onMouseDown={onLayerMouseDown}>
      {props.elements.map((el) => {
        const selected = props.selectedIds.has(el.id);
        const canRotateHandle = selected && props.activeTool === "select" && ROTATABLE_TYPES.has(el.type) && props.selectedIds.size === 1;
        const style: CSSProperties = {
          position: "absolute",
          left: el.x * props.scale,
          top: el.y * props.scale,
          width: el.width * props.scale,
          height: el.height * props.scale,
          opacity: el.opacity,
          transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
          transformOrigin: "center center",
        };

        let body: React.ReactNode = null;
        if (el.type === "text") {
          const t = el as TextElement;
          body = (
            <div
              contentEditable={selected && props.activeTool === "select" && props.selectedIds.size === 1}
              suppressContentEditableWarning
              onBlur={(e2) => props.onUpdateElement(el.id, { text: e2.currentTarget.textContent || "" })}
              style={{
                width: "100%", height: "100%",
                fontFamily: t.font === "TimesRoman" ? "Times New Roman, serif" : t.font === "Courier" ? "monospace" : "Helvetica, Arial, sans-serif",
                fontSize: t.fontSize * props.scale, fontWeight: t.bold ? 700 : 400, fontStyle: t.italic ? "italic" : "normal",
                textDecoration: t.underline ? "underline" : "none", color: t.color, textAlign: t.align, whiteSpace: "pre-wrap",
                outline: "none", lineHeight: t.lineSpacing, letterSpacing: `${t.letterSpacing * props.scale}px`, cursor: "text",
              }}
            >
              {t.text}
            </div>
          );
        } else if (el.type === "rect") {
          const s = el as ShapeElement;
          body = <div style={{ width: "100%", height: "100%", border: `${s.strokeWidth}px solid ${s.stroke}`, background: s.fill ?? "transparent" }} />;
        } else if (el.type === "ellipse") {
          const s = el as ShapeElement;
          body = <div style={{ width: "100%", height: "100%", borderRadius: "50%", border: `${s.strokeWidth}px solid ${s.stroke}`, background: s.fill ?? "transparent" }} />;
        } else if (el.type === "line") {
          const s = el as ShapeElement;
          body = <svg width="100%" height="100%" style={{ overflow: "visible" }}><line x1={0} y1={el.height * props.scale} x2={el.width * props.scale} y2={0} stroke={s.stroke} strokeWidth={s.strokeWidth} /></svg>;
        } else if (el.type === "draw") {
          const d = el as DrawElement;
          const pts = d.points.map((p) => `${p.x * props.scale},${p.y * props.scale}`).join(" ");
          body = <svg width="100%" height="100%" style={{ overflow: "visible" }}><polyline points={pts} fill="none" stroke={d.stroke} strokeWidth={d.strokeWidth} strokeLinecap="round" strokeLinejoin="round" /></svg>;
        } else if (el.type === "highlight") {
          body = <div style={{ width: "100%", height: "100%", background: (el as HighlightElement).color }} />;
        } else if (el.type === "underline") {
          body = <div style={{ width: "100%", height: 2, marginTop: (el.height * props.scale) - 2, background: (el as HighlightElement).color }} />;
        } else if (el.type === "strikeout") {
          body = <div style={{ width: "100%", height: 2, marginTop: (el.height * props.scale) / 2, background: (el as HighlightElement).color }} />;
        } else if (el.type === "squiggly") {
          body = (
            <svg width="100%" height="100%" style={{ overflow: "visible" }}>
              <polyline
                points={Array.from({ length: 10 }, (_, i) => `${(i * (el.width / 9)) * props.scale},${(el.height * props.scale) - (i % 2 === 0 ? 0 : 4)}`).join(" ")}
                fill="none" stroke={(el as HighlightElement).color} strokeWidth={1.6}
              />
            </svg>
          );
        } else if (el.type === "whiteout") {
          body = <div style={{ width: "100%", height: "100%", background: (el as { color: string }).color || "#ffffff" }} />;
        } else if (el.type === "image") {
          body = <img src={(el as ImageElement).src} draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill" }} />;
        } else if (el.type === "sticky") {
          const s = el as StickyElement;
          body = (
            <div style={{ width: "100%", height: "100%", background: s.color, border: "1px solid rgba(0,0,0,0.15)", borderRadius: 4, boxShadow: "0 2px 6px rgba(0,0,0,0.15)", padding: 4, overflow: "hidden" }}>
              <textarea
                value={s.note}
                onChange={(e2) => props.onUpdateElement(el.id, { note: e2.target.value })}
                onMouseDown={(e2) => e2.stopPropagation()}
                placeholder="Note…"
                style={{ width: "100%", height: "100%", background: "transparent", border: "none", outline: "none", resize: "none", fontSize: 11, color: "#3F3300" }}
              />
            </div>
          );
        } else if (el.type === "field-text") {
          const f = el as FieldTextElement;
          body = (
            <input
              value={f.value}
              placeholder={f.placeholder}
              onChange={(e2) => props.onUpdateElement(el.id, { value: e2.target.value })}
              onMouseDown={(e2) => e2.stopPropagation()}
              style={{ width: "100%", height: "100%", border: `1.5px ${f.required ? "solid #DC2626" : "solid #2563EB"}`, borderRadius: 4, background: "rgba(37,99,235,0.05)", fontSize: 12, padding: "0 6px", outline: "none" }}
            />
          );
        } else if (el.type === "field-checkbox") {
          const f = el as FieldCheckboxElement;
          body = (
            <div onMouseDown={(e2) => { e2.stopPropagation(); props.onUpdateElement(el.id, { checked: !f.checked }); }} style={{ width: "100%", height: "100%", border: `1.5px solid ${f.required ? "#DC2626" : "#2563EB"}`, borderRadius: 3, background: f.checked ? "#2563EB" : "rgba(37,99,235,0.05)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {f.checked && <Check className="h-3 w-3 text-white" />}
            </div>
          );
        } else if (el.type === "field-radio") {
          const f = el as FieldRadioElement;
          body = (
            <div onMouseDown={(e2) => { e2.stopPropagation(); props.onUpdateElement(el.id, { checked: !f.checked }); }} style={{ width: "100%", height: "100%", borderRadius: "50%", border: `1.5px solid ${f.required ? "#DC2626" : "#2563EB"}`, background: "rgba(37,99,235,0.05)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {f.checked && <div style={{ width: "55%", height: "55%", borderRadius: "50%", background: "#2563EB" }} />}
            </div>
          );
        } else if (el.type === "field-dropdown") {
          const f = el as FieldDropdownElement;
          body = (
            <select value={f.value} onChange={(e2) => props.onUpdateElement(el.id, { value: e2.target.value })} onMouseDown={(e2) => e2.stopPropagation()} style={{ width: "100%", height: "100%", border: `1.5px solid ${f.required ? "#DC2626" : "#2563EB"}`, borderRadius: 4, background: "rgba(37,99,235,0.05)", fontSize: 12 }}>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        }

        return (
          <div key={el.id} style={style} onMouseDown={(e) => startMove(e, el)} className={cn(selected && props.activeTool === "select" && "outline outline-2 outline-[#2563EB] outline-offset-1")}>
            {body}
            {selected && props.activeTool === "select" && props.selectedIds.size === 1 && el.type !== "draw" && el.type !== "sticky" && !el.type.startsWith("field-") && (
              <div onMouseDown={(e) => startResize(e, el)} style={{ position: "absolute", right: -5, bottom: -5, width: 10, height: 10, borderRadius: 3, background: "#2563EB", cursor: "nwse-resize" }} />
            )}
            {canRotateHandle && (
              <div onMouseDown={(e) => startRotate(e, el)} style={{ position: "absolute", left: "50%", top: -22, width: 10, height: 10, marginLeft: -5, borderRadius: "50%", background: "#2563EB", cursor: "grab" }} />
            )}
          </div>
        );
      })}

      {draft && (
        <div style={{ position: "absolute", left: draft.x * props.scale, top: draft.y * props.scale, width: draft.w * props.scale, height: draft.h * props.scale, border: "1.5px dashed #2563EB", background: props.activeTool === "highlight" ? "rgba(253,224,71,0.35)" : "rgba(37,99,235,0.06)", pointerEvents: "none" }} />
      )}
      {drawPoints && drawPoints.length > 1 && (
        <svg className="absolute inset-0" style={{ pointerEvents: "none" }}>
          <polyline points={drawPoints.map((p) => `${p.x * props.scale},${p.y * props.scale}`).join(" ")} fill="none" stroke="#2563EB" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {marquee && (
        <div style={{ position: "absolute", left: marquee.x * props.scale, top: marquee.y * props.scale, width: marquee.w * props.scale, height: marquee.h * props.scale, border: "1px dashed #2563EB", background: "rgba(37,99,235,0.08)", pointerEvents: "none" }} />
      )}
    </div>
  );
}

/* -------------------------- Properties panel -------------------------- */

function PropertiesPanel(props: {
  file: File;
  totalPages: number;
  selectedPageCount: number;
  firstPageDims: { w: number; h: number } | null;
  pdfVersion: string | null;
  encrypted: boolean;
  mode: Mode;
  actionLabel: string;
  processing: boolean;
  progressLabel: string;
  onApply: () => void;
  selectedElements: AnyElement[];
  singleSelected: AnyElement | null;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (patch: Partial<AnyElement>) => void;
  onDeleteElements: () => void;
  onDuplicateElements: () => void;
  onImageReplace: () => void;
}) {
  const hasPageSelection = props.mode === "select" && props.selectedPageCount > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {props.selectedElements.length > 1 ? (
          <div className="space-y-2 rounded-[10px] border border-[#E5E7EB] bg-white p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Selection</div>
            <div className="text-2xl font-semibold tabular-nums text-[#111827]">{props.selectedElements.length}</div>
            <div className="text-xs text-[#6B7280]">elements selected</div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={props.onDuplicateElements} className="h-8 rounded-[8px] border border-[#E5E7EB] text-xs font-medium text-[#111827] hover:bg-[#F8F9FA]">Duplicate</button>
              <button onClick={props.onDeleteElements} className="h-8 rounded-[8px] border border-[#E5E7EB] text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
            </div>
            <Field label="Opacity (all)">
              <input type="range" min={0.1} max={1} step={0.05} onChange={(e) => props.onUpdateElements({ opacity: Number(e.target.value) })} className="w-full" />
            </Field>
          </div>
        ) : props.singleSelected ? (
          <ElementProperties element={props.singleSelected} onUpdate={props.onUpdateElement} onDelete={props.onDeleteElements} onImageReplace={props.onImageReplace} />
        ) : hasPageSelection ? (
          <div className="rounded-[10px] border border-[#E5E7EB] bg-white p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Selection</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-[#111827]">{props.selectedPageCount}</div>
            <div className="text-xs text-[#6B7280]">pages selected</div>
          </div>
        ) : (
          <div className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F8F9FA] p-3 text-xs text-[#6B7280]">Select an element to edit its properties.</div>
        )}

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[#6B7280]">Document</div>
          <dl className="space-y-1.5 text-sm">
            <Info label="Name" value={<span className="break-all text-[#111827]">{props.file.name}</span>} />
            <Info label="Size" value={formatBytes(props.file.size)} />
            <Info label="Pages" value={props.totalPages || "—"} />
            {props.firstPageDims && <Info label="Page size" value={`${props.firstPageDims.w} × ${props.firstPageDims.h} pt`} />}
            {props.pdfVersion && <Info label="PDF version" value={props.pdfVersion} />}
            <Info label="Security" value={props.encrypted ? <span className="inline-flex items-center gap-1 text-red-600"><Lock className="h-3 w-3" /> Encrypted</span> : "None"} />
          </dl>
        </div>

        <div className="rounded-[10px] border border-[#E5E7EB] bg-[#F8F9FA] p-3 text-xs text-[#6B7280]">
          <div className="mb-1 font-medium text-[#111827]">Keyboard shortcuts</div>
          <ul className="space-y-0.5">
            <li>⌘/Ctrl+Z · Undo &nbsp; ⌘/Ctrl+Shift+Z · Redo</li>
            <li>⌘/Ctrl+D · Duplicate selection</li>
            <li>⌘/Ctrl+A · Select all (elements or pages)</li>
            <li>Delete · Remove selected</li>
            <li>Arrow keys · Nudge (Shift = 10pt)</li>
            <li>Alt+drag · Duplicate while moving</li>
            <li>Shift/Ctrl+click · Add to selection</li>
            <li>Drag empty canvas · Marquee select</li>
            <li>Esc · Deselect / back to select tool</li>
          </ul>
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-[#E5E7EB] bg-white/95 p-4 backdrop-blur">
        {props.processing && (
          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> {props.progressLabel}</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E7EB]"><div className="h-full w-1/2 animate-pulse rounded-full bg-[#2563EB]" /></div>
          </div>
        )}
        <Button onClick={props.onApply} disabled={props.processing} size="lg" className="w-full rounded-[10px] bg-[#2563EB] text-white hover:bg-[#2563EB]/90">
          {props.processing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…</> : props.actionLabel}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-[#6B7280]">{label}</div>
      {children}
    </div>
  );
}

function ElementProperties({ element, onUpdate, onDelete, onImageReplace }: { element: AnyElement; onUpdate: (id: string, patch: Partial<AnyElement>) => void; onDelete: () => void; onImageReplace: () => void }) {
  const inputCls = "h-8 w-full rounded-[8px] border border-[#E5E7EB] bg-white px-2 text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/40";
  const typeLabel: Record<string, string> = {
    rect: "Rectangle", ellipse: "Ellipse", line: "Line", draw: "Drawing", highlight: "Highlight",
    underline: "Underline", strikeout: "Strikeout", squiggly: "Squiggly", whiteout: "Whiteout", image: "Image",
    sticky: "Sticky note", "field-text": "Text field", "field-checkbox": "Checkbox", "field-radio": "Radio button", "field-dropdown": "Dropdown", text: "Text",
  };

  return (
    <div className="space-y-3 rounded-[10px] border border-[#E5E7EB] bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">{typeLabel[element.type] ?? element.type}</div>
        <button onClick={onDelete} aria-label="Delete element" className="rounded-[8px] p-1 text-[#6B7280] hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      {element.type === "text" && <TextProperties element={element as TextElement} onUpdate={onUpdate} inputCls={inputCls} />}
      {(element.type === "rect" || element.type === "ellipse" || element.type === "line") && <ShapeProperties element={element as ShapeElement} onUpdate={onUpdate} inputCls={inputCls} />}

      {element.type === "draw" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Stroke color"><input type="color" value={(element as DrawElement).stroke} onChange={(e) => onUpdate(element.id, { stroke: e.target.value })} className="h-8 w-full rounded-[8px] border border-[#E5E7EB]" /></Field>
          <Field label="Width"><input type="number" min={1} max={20} value={(element as DrawElement).strokeWidth} onChange={(e) => onUpdate(element.id, { strokeWidth: Number(e.target.value) })} className={inputCls} /></Field>
        </div>
      )}

      {(element.type === "highlight" || element.type === "underline" || element.type === "strikeout" || element.type === "squiggly") && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Color"><input type="color" value={(element as HighlightElement).color} onChange={(e) => onUpdate(element.id, { color: e.target.value })} className="h-8 w-full rounded-[8px] border border-[#E5E7EB]" /></Field>
          <Field label="Opacity"><input type="range" min={0.1} max={1} step={0.05} value={element.opacity} onChange={(e) => onUpdate(element.id, { opacity: Number(e.target.value) })} className="w-full" /></Field>
        </div>
      )}

      {element.type === "whiteout" && (
        <Field label="Color">
          <div className="flex gap-1">
            {["#ffffff", "#000000"].map((c) => (
              <button key={c} onClick={() => onUpdate(element.id, { color: c })} className="h-8 w-8 rounded-[8px] border border-[#E5E7EB]" style={{ background: c }} aria-label={c === "#ffffff" ? "White" : "Black"} />
            ))}
            <input type="color" value={(element as { color: string }).color} onChange={(e) => onUpdate(element.id, { color: e.target.value })} className="h-8 w-8 rounded-[8px] border border-[#E5E7EB]" />
          </div>
        </Field>
      )}

      {element.type === "image" && <ImageProperties element={element as ImageElement} onUpdate={onUpdate} onReplace={onImageReplace} />}
      {element.type === "sticky" && (
        <Field label="Note color">
          <div className="flex gap-1">
            {["#FEF08A", "#BFDBFE", "#BBF7D0", "#FBCFE8"].map((c) => (
              <button key={c} onClick={() => onUpdate(element.id, { color: c })} className="h-7 w-7 rounded-full border border-[#E5E7EB]" style={{ background: c }} aria-label="Sticky color" />
            ))}
          </div>
        </Field>
      )}
      {element.type === "field-text" && <FieldTextProperties element={element as FieldTextElement} onUpdate={onUpdate} inputCls={inputCls} />}
      {element.type === "field-checkbox" && <FieldCheckboxProperties element={element as FieldCheckboxElement} onUpdate={onUpdate} inputCls={inputCls} />}
      {element.type === "field-radio" && <FieldRadioProperties element={element as FieldRadioElement} onUpdate={onUpdate} inputCls={inputCls} />}
      {element.type === "field-dropdown" && <FieldDropdownProperties element={element as FieldDropdownElement} onUpdate={onUpdate} inputCls={inputCls} />}

      {(element.type === "rect" || element.type === "image" || element.type === "text") && (
        <Field label="Rotation">
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={359} value={element.rotation} onChange={(e) => onUpdate(element.id, { rotation: Number(e.target.value) })} className="w-full" />
            <span className="w-10 text-right text-[11px] tabular-nums text-[#6B7280]">{element.rotation}°</span>
          </div>
        </Field>
      )}
    </div>
  );
}

function TextProperties({ element, onUpdate, inputCls }: { element: TextElement; onUpdate: (id: string, patch: Partial<AnyElement>) => void; inputCls: string }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Font">
          <select value={element.font} onChange={(e) => onUpdate(element.id, { font: e.target.value as TextElement["font"] })} className={inputCls}>
            {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f === "TimesRoman" ? "Times New Roman" : f}</option>)}
          </select>
        </Field>
        <Field label="Size"><input type="number" min={6} max={96} value={element.fontSize} onChange={(e) => onUpdate(element.id, { fontSize: Number(e.target.value) })} className={inputCls} /></Field>
      </div>
      <Field label="Style">
        <div className="flex gap-1">
          <ToggleBtn active={element.bold} onClick={() => onUpdate(element.id, { bold: !element.bold })}><Bold className="h-3.5 w-3.5" /></ToggleBtn>
          <ToggleBtn active={element.italic} onClick={() => onUpdate(element.id, { italic: !element.italic })}><Italic className="h-3.5 w-3.5" /></ToggleBtn>
          <ToggleBtn active={element.underline} onClick={() => onUpdate(element.id, { underline: !element.underline })}><UnderlineIcon className="h-3.5 w-3.5" /></ToggleBtn>
        </div>
      </Field>
      <Field label="Align">
        <div className="flex gap-1">
          {(["left", "center", "right"] as const).map((a) => <ToggleBtn key={a} active={element.align === a} onClick={() => onUpdate(element.id, { align: a })}>{a[0].toUpperCase()}</ToggleBtn>)}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Letter spacing"><input type="number" step={0.1} min={-2} max={10} value={element.letterSpacing} onChange={(e) => onUpdate(element.id, { letterSpacing: Number(e.target.value) })} className={inputCls} /></Field>
        <Field label="Line spacing"><input type="number" step={0.05} min={0.8} max={3} value={element.lineSpacing} onChange={(e) => onUpdate(element.id, { lineSpacing: Number(e.target.value) })} className={inputCls} /></Field>
      </div>
      <Field label="Text color"><input type="color" value={element.color} onChange={(e) => onUpdate(element.id, { color: e.target.value })} className="h-8 w-full rounded-[8px] border border-[#E5E7EB]" /></Field>
      <Field label="Opacity"><input type="range" min={0.1} max={1} step={0.05} value={element.opacity} onChange={(e) => onUpdate(element.id, { opacity: Number(e.target.value) })} className="w-full" /></Field>
    </div>
  );
}

function ShapeProperties({ element, onUpdate, inputCls }: { element: ShapeElement; onUpdate: (id: string, patch: Partial<AnyElement>) => void; inputCls: string }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Stroke"><input type="color" value={element.stroke} onChange={(e) => onUpdate(element.id, { stroke: e.target.value })} className="h-8 w-full rounded-[8px] border border-[#E5E7EB]" /></Field>
        <Field label="Border width"><input type="number" min={0} max={20} value={element.strokeWidth} onChange={(e) => onUpdate(element.id, { strokeWidth: Number(e.target.value) })} className={inputCls} /></Field>
      </div>
      {element.type !== "line" && (
        <div className="grid grid-cols-2 items-end gap-2">
          <Field label="Fill"><input type="color" value={element.fill ?? "#ffffff"} onChange={(e) => onUpdate(element.id, { fill: e.target.value })} className="h-8 w-full rounded-[8px] border border-[#E5E7EB]" /></Field>
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-[#374151]">
            <input type="checkbox" checked={element.fill === null} onChange={(e) => onUpdate(element.id, { fill: e.target.checked ? null : "#ffffff" })} className="accent-[#2563EB]" />
            No fill
          </label>
        </div>
      )}
      <Field label="Opacity"><input type="range" min={0.1} max={1} step={0.05} value={element.opacity} onChange={(e) => onUpdate(element.id, { opacity: Number(e.target.value) })} className="w-full" /></Field>
    </div>
  );
}

function ImageProperties({ element, onUpdate, onReplace }: { element: ImageElement; onUpdate: (id: string, patch: Partial<AnyElement>) => void; onReplace: () => void }) {
  return (
    <div className="space-y-2">
      <button onClick={onReplace} className="h-8 w-full rounded-[8px] border border-[#E5E7EB] text-xs font-medium text-[#111827] hover:bg-[#F8F9FA]">Replace image</button>
      <Field label="Opacity"><input type="range" min={0.1} max={1} step={0.05} value={element.opacity} onChange={(e) => onUpdate(element.id, { opacity: Number(e.target.value) })} className="w-full" /></Field>
      <div className="text-[11px] text-[#6B7280]">Crop isn't supported yet — resize the frame using the corner handle instead. Rotate with the handle above the element or the slider below.</div>
    </div>
  );
}

function FieldTextProperties({ element, onUpdate, inputCls }: { element: FieldTextElement; onUpdate: (id: string, patch: Partial<AnyElement>) => void; inputCls: string }) {
  return (
    <div className="space-y-2">
      <Field label="Field name"><input value={element.name} onChange={(e) => onUpdate(element.id, { name: e.target.value })} className={inputCls} /></Field>
      <Field label="Placeholder"><input value={element.placeholder} onChange={(e) => onUpdate(element.id, { placeholder: e.target.value })} className={inputCls} /></Field>
      <Field label="Default value"><input value={element.value} onChange={(e) => onUpdate(element.id, { value: e.target.value })} className={inputCls} /></Field>
      <label className="flex items-center gap-2 text-xs text-[#374151]"><input type="checkbox" checked={element.required} onChange={(e) => onUpdate(element.id, { required: e.target.checked })} className="accent-[#2563EB]" /> Required</label>
    </div>
  );
}
function FieldCheckboxProperties({ element, onUpdate }: { element: FieldCheckboxElement; onUpdate: (id: string, patch: Partial<AnyElement>) => void; inputCls: string }) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-[#374151]"><input type="checkbox" checked={element.checked} onChange={(e) => onUpdate(element.id, { checked: e.target.checked })} className="accent-[#2563EB]" /> Checked by default</label>
      <label className="flex items-center gap-2 text-xs text-[#374151]"><input type="checkbox" checked={element.required} onChange={(e) => onUpdate(element.id, { required: e.target.checked })} className="accent-[#2563EB]" /> Required</label>
    </div>
  );
}
function FieldRadioProperties({ element, onUpdate, inputCls }: { element: FieldRadioElement; onUpdate: (id: string, patch: Partial<AnyElement>) => void; inputCls: string }) {
  return (
    <div className="space-y-2">
      <Field label="Group name"><input value={element.groupName} onChange={(e) => onUpdate(element.id, { groupName: e.target.value })} className={inputCls} /></Field>
      <Field label="Option value"><input value={element.value} onChange={(e) => onUpdate(element.id, { value: e.target.value })} className={inputCls} /></Field>
      <label className="flex items-center gap-2 text-xs text-[#374151]"><input type="checkbox" checked={element.checked} onChange={(e) => onUpdate(element.id, { checked: e.target.checked })} className="accent-[#2563EB]" /> Selected by default</label>
      <div className="text-[11px] text-[#6B7280]">Radio buttons sharing the same group name act as one choice group in the exported PDF.</div>
    </div>
  );
}
function FieldDropdownProperties({ element, onUpdate, inputCls }: { element: FieldDropdownElement; onUpdate: (id: string, patch: Partial<AnyElement>) => void; inputCls: string }) {
  return (
    <div className="space-y-2">
      <Field label="Field name"><input value={element.name} onChange={(e) => onUpdate(element.id, { name: e.target.value })} className={inputCls} /></Field>
      <Field label="Options (comma-separated)">
        <input
          defaultValue={element.options.join(", ")}
          onBlur={(e) => {
            const opts = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onUpdate(element.id, { options: opts.length ? opts : ["Option 1"], value: opts[0] ?? "Option 1" });
          }}
          className={inputCls}
        />
      </Field>
      <Field label="Default value">
        <select value={element.value} onChange={(e) => onUpdate(element.id, { value: e.target.value })} className={inputCls}>
          {element.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-xs text-[#374151]"><input type="checkbox" checked={element.required} onChange={(e) => onUpdate(element.id, { required: e.target.checked })} className="accent-[#2563EB]" /> Required</label>
    </div>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("grid h-8 w-8 place-items-center rounded-[8px] border text-xs font-semibold transition-colors duration-200", active ? "border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB]" : "border-[#E5E7EB] text-[#374151] hover:bg-[#F8F9FA]")}>
      {children}
    </button>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-[#6B7280]">{label}</dt>
      <dd className="text-right text-sm text-[#111827]">{value}</dd>
    </div>
  );
}

/* -------------------------- Signature modal -------------------------- */

function SignatureModal(props: {
  tab: "draw" | "type" | "saved";
  onTabChange: (t: "draw" | "type" | "saved") => void;
  typedSignature: string;
  onTypedChange: (s: string) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  drawingRef: React.RefObject<boolean>;
  onClear: () => void;
  onCancel: () => void;
  onInsert: () => void;
  saveAfterInsert: boolean;
  onSaveAfterInsertChange: (v: boolean) => void;
  savedSignatures: SavedSignature[];
  onUseSaved: (src: string) => void;
  onDeleteSaved: (id: string) => void;
}) {
  function startDraw(e: ReactMouseEvent<HTMLCanvasElement>) { props.drawingRef.current = true; draw(e); }
  function draw(e: ReactMouseEvent<HTMLCanvasElement>) {
    if (!props.drawingRef.current) return;
    const canvas = props.canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#111827";
    ctx.beginPath(); ctx.arc(e.clientX - rect.left, e.clientY - rect.top, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  }
  function endDraw() { props.drawingRef.current = false; }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={props.onCancel}>
      <div className="w-full max-w-md rounded-[14px] border border-[#E5E7EB] bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-sm font-semibold text-[#111827]">Add signature</div>
        <div className="mb-3 flex gap-1 rounded-[10px] bg-[#F8F9FA] p-1">
          <button onClick={() => props.onTabChange("draw")} className={cn("flex-1 rounded-[8px] py-1.5 text-xs font-medium", props.tab === "draw" ? "bg-white text-[#111827] shadow-sm" : "text-[#6B7280]")}>Draw</button>
          <button onClick={() => props.onTabChange("type")} className={cn("flex-1 rounded-[8px] py-1.5 text-xs font-medium", props.tab === "type" ? "bg-white text-[#111827] shadow-sm" : "text-[#6B7280]")}>Type</button>
          <button onClick={() => props.onTabChange("saved")} className={cn("flex-1 rounded-[8px] py-1.5 text-xs font-medium", props.tab === "saved" ? "bg-white text-[#111827] shadow-sm" : "text-[#6B7280]")}>Saved ({props.savedSignatures.length})</button>
        </div>

        {props.tab === "draw" && (
          <div>
            <canvas ref={props.canvasRef} width={420} height={160} className="w-full cursor-crosshair rounded-[10px] border border-[#E5E7EB] bg-[#F8F9FA]" onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw} />
            <div className="mt-2 flex items-center justify-between">
              <button onClick={props.onClear} className="text-xs text-[#6B7280] hover:text-[#111827]">Clear</button>
              <label className="flex items-center gap-1.5 text-xs text-[#374151]"><input type="checkbox" checked={props.saveAfterInsert} onChange={(e) => props.onSaveAfterInsertChange(e.target.checked)} className="accent-[#2563EB]" /> Save for reuse</label>
            </div>
          </div>
        )}
        {props.tab === "type" && (
          <div>
            <input autoFocus value={props.typedSignature} onChange={(e) => props.onTypedChange(e.target.value)} placeholder="Type your name" className="h-24 w-full rounded-[10px] border border-[#E5E7EB] bg-[#F8F9FA] px-3 text-center font-serif text-3xl italic text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/40" />
            <label className="mt-2 flex items-center justify-end gap-1.5 text-xs text-[#374151]"><input type="checkbox" checked={props.saveAfterInsert} onChange={(e) => props.onSaveAfterInsertChange(e.target.checked)} className="accent-[#2563EB]" /> Save for reuse</label>
          </div>
        )}
        {props.tab === "saved" && (
          <div className="grid max-h-64 grid-cols-2 gap-2 overflow-auto">
            {props.savedSignatures.length === 0 && <div className="col-span-2 py-6 text-center text-xs text-[#6B7280]">No saved signatures yet.</div>}
            {props.savedSignatures.map((s) => (
              <div key={s.id} className="group relative rounded-[10px] border border-[#E5E7EB] bg-[#F8F9FA] p-2">
                <img src={s.src} alt="Saved signature" className="h-16 w-full object-contain" />
                <div className="mt-1 flex gap-1">
                  <button onClick={() => props.onUseSaved(s.src)} className="h-7 flex-1 rounded-[6px] bg-[#2563EB] text-[11px] font-medium text-white hover:bg-[#2563EB]/90">Use</button>
                  <button onClick={() => props.onDeleteSaved(s.id)} className="h-7 w-7 rounded-[6px] border border-[#E5E7EB] text-[#6B7280] hover:bg-red-50 hover:text-red-600"><Trash2 className="mx-auto h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={props.onCancel} className="rounded-[10px] border-[#E5E7EB] text-[#111827] hover:bg-[#F8F9FA]">Cancel</Button>
          {props.tab !== "saved" && <Button onClick={props.onInsert} className="rounded-[10px] bg-[#2563EB] text-white hover:bg-[#2563EB]/90">Insert</Button>}
        </div>
      </div>
    </div>
  );
}

/* -------------------------- Success screen -------------------------- */

function SuccessScreen({ result, onDownload, onEditAgain, onNewFile }: { result: { blob: Blob; filename: string; thumb: string | null; pages: number }; onDownload: () => void; onEditAgain: () => void; onNewFile: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-[14px] border border-[#E5E7EB] bg-white shadow-[0_18px_50px_-32px_rgba(17,24,39,0.28)]">
      <div className="border-b border-[#E5E7EB] bg-[#2563EB]/5 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-[#2563EB] text-white"><FileCheck2 className="h-5 w-5" /></div>
          <div>
            <div className="text-xl font-semibold text-[#111827]">PDF Updated Successfully</div>
            <div className="text-sm text-[#6B7280]">{result.filename} · {formatBytes(result.blob.size)} · {result.pages} pages</div>
          </div>
        </div>
      </div>
      <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-[10px] border border-[#E5E7EB] bg-[#F8F9FA] p-4">
          <div className="grid min-h-[320px] place-items-center overflow-hidden rounded-[8px] bg-white">
            {result.thumb ? <img src={result.thumb} alt="Preview of first page" className="max-h-[420px] object-contain" /> : <div className="text-sm text-[#6B7280]">Preview unavailable</div>}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Button size="lg" onClick={onDownload} className="w-full rounded-[10px] bg-[#2563EB] text-white hover:bg-[#2563EB]/90"><Download className="mr-2 h-5 w-5" /> Download PDF</Button>
          <Button size="lg" variant="outline" onClick={onEditAgain} className="w-full rounded-[10px] border-[#E5E7EB] text-[#111827] hover:bg-[#F8F9FA]">Edit again</Button>
          <Button size="lg" variant="ghost" onClick={onNewFile} className="w-full rounded-[10px] text-[#111827] hover:bg-[#F8F9FA]"><UploadCloud className="mr-2 h-4 w-4" /> Upload new PDF</Button>
        </div>
      </div>
    </motion.div>
  );
}