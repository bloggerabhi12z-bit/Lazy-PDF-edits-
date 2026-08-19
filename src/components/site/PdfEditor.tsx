import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlignLeft, AlignCenter, AlignRight, ArrowLeft, ArrowLeftRight, ArrowRight,
  Bold, Check, ChevronLeft, ChevronRight, Copy, Download, Eraser,
  FileCheck2, FilePlus, Hand, Highlighter, Image as ImageIcon, Italic,
  Loader2, Lock, Maximize2, MessageSquare, MoreHorizontal, MousePointer2,
  PenLine, PenTool, Plus, Redo2, RotateCw, Search, Square, Star,
  Trash2, Triangle, Type, Underline as UnderlineIcon, Undo2, X, ChevronDown, Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/download";
import { publishResult } from "@/lib/result-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  FONT_OPTIONS, ROTATABLE_TYPES, deleteSavedSignature, getSavedSignatures, makeId, saveSignature, stampElements,
  type AnyElement, type DrawElement, type FieldCheckboxElement, type FieldDropdownElement,
  type FieldRadioElement, type FieldTextElement, type HighlightElement, type ImageElement,
  type SavedSignature, type ShapeElement, type StickyElement, type TextElement,
} from "@/lib/pdf-annotations";

export type EditorPage = { id: string; originalIndex: number; rotation: number; selected: boolean; isBlank?: boolean };
export type EditorApplyState = { pages: EditorPage[]; selectedIds: Set<string> };
export type EditorApplyResult = { blob: Blob; filename: string } | void | undefined;

type PdfPage = {
  getViewport: (o: { scale: number; rotation?: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
  getTextContent?: () => Promise<{ items: { str: string }[] }>;
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type Phase = "reading" | "rendering" | "ready" | "error";
type Tool =
  | "select" | "hand" | "text" | "draw" | "eraser"
  | "shape-rect" | "shape-ellipse" | "shape-line" | "shape-arrow"
  | "shape-triangle" | "shape-star" | "shape-rounded-rect" | "shape-speech"
  | "highlight" | "underline" | "strikeout" | "squiggly"
  | "image" | "signature" | "whiteout" | "sticky"
  | "field-text" | "field-checkbox" | "field-radio" | "field-dropdown";

const MAX_HISTORY = 50;
const NUDGE = 1, NUDGE_FAST = 10;

const SYSTEM_FONT_FAMILIES = [
  "Helvetica","Arial","Times New Roman","Georgia","Courier New","Verdana","Tahoma",
  "Trebuchet MS","Palatino","Garamond","Book Antiqua","Century Gothic","Franklin Gothic Medium",
  "Lucida Console","Lucida Sans Unicode","Segoe UI","Calibri","Cambria","Consolas","Impact",
  "Comic Sans MS","Rockwell","Baskerville","Optima","Didot","Futura",
];
const GOOGLE_FONT_FAMILIES = [
  "Roboto","Open Sans","Lato","Montserrat","Poppins","Inter","Merriweather","Playfair Display",
  "Nunito","Raleway","Ubuntu","PT Serif","Source Sans Pro","Oswald","Noto Sans","Work Sans",
  "Fira Sans","Rubik","Karla","Quicksand","Josefin Sans","Crimson Text","Libre Baskerville",
  "EB Garamond","Cormorant Garamond","DM Sans","Space Grotesk","Bitter","Zilla Slab",
  "IBM Plex Sans","IBM Plex Serif","IBM Plex Mono","Roboto Mono","JetBrains Mono",
  "Caveat","Pacifico","Dancing Script","Great Vibes","Shadows Into Light","Indie Flower",
];
const FONT_PREVIEW_CHOICES = [...SYSTEM_FONT_FAMILIES, ...GOOGLE_FONT_FAMILIES];

const SIG_FONTS = [
  { family: "Dancing Script", label: "Elegant" },
  { family: "Great Vibes", label: "Formal" },
  { family: "Pacifico", label: "Bold" },
  { family: "Caveat", label: "Casual" },
  { family: "Shadows Into Light", label: "Written" },
  { family: "Indie Flower", label: "Fun" },
];

function fontFamilyStack(name: string): string {
  const serif = ["Times New Roman","Georgia","Palatino","Garamond","Book Antiqua","Cambria","Baskerville","Didot","PT Serif","Merriweather","Playfair Display","Crimson Text","Libre Baskerville","EB Garamond","Cormorant Garamond","Bitter","Zilla Slab","IBM Plex Serif"];
  const mono = ["Courier New","Lucida Console","Consolas","Roboto Mono","JetBrains Mono","IBM Plex Mono"];
  const script = ["Caveat","Pacifico","Dancing Script","Great Vibes","Shadows Into Light","Indie Flower"];
  const fallback = serif.includes(name) ? "serif" : mono.includes(name) ? "monospace" : script.includes(name) ? "cursive" : "sans-serif";
  return `"${name}", ${fallback}`;
}

type HistorySnapshot = { pages: EditorPage[]; elements: AnyElement[] };
function snapshotsEqual(a: HistorySnapshot, b: HistorySnapshot) { return JSON.stringify(a) === JSON.stringify(b); }

// Partial stroke erasure: splits DrawElement point arrays at erased positions
function eraseFromDrawElements(
  eraserPt: { x: number; y: number }, radius: number, drawEls: DrawElement[]
): { toRemove: string[]; toAdd: DrawElement[] } {
  const toRemove: string[] = [], toAdd: DrawElement[] = [];
  for (const el of drawEls) {
    const margin = radius + 1;
    if (eraserPt.x < el.x - margin || eraserPt.x > el.x + el.width + margin ||
        eraserPt.y < el.y - margin || eraserPt.y > el.y + el.height + margin) continue;
    const hasHit = el.points.some((p) => Math.hypot(p.x + el.x - eraserPt.x, p.y + el.y - eraserPt.y) <= radius);
    if (!hasHit) continue;
    toRemove.push(el.id);
    const segments: { x: number; y: number }[][] = [];
    let current: { x: number; y: number }[] = [];
    for (const p of el.points) {
      if (Math.hypot(p.x + el.x - eraserPt.x, p.y + el.y - eraserPt.y) <= radius) {
        if (current.length >= 2) segments.push([...current]);
        current = [];
      } else current.push(p);
    }
    if (current.length >= 2) segments.push(current);
    for (const seg of segments) {
      const absXs = seg.map((p) => p.x + el.x), absYs = seg.map((p) => p.y + el.y);
      const minX = Math.min(...absXs), minY = Math.min(...absYs);
      const maxX = Math.max(...absXs), maxY = Math.max(...absYs);
      toAdd.push({ ...el, id: makeId("draw"), x: minX, y: minY,
        width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY),
        points: seg.map((p) => ({ x: p.x + el.x - minX, y: p.y + el.y - minY })) });
    }
  }
  return { toRemove, toAdd };
}

function starSvgPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(" ");
}

export function PdfEditor({ file, mode, actionLabel, busy = false, onReplace, onApply }: {
  file: File; mode: string; actionLabel: string; busy?: boolean;
  onReplace: () => void; onApply: (state: EditorApplyState) => Promise<EditorApplyResult> | EditorApplyResult;
}) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState<EditorPage[]>([]);
  const [elements, setElements] = useState<AnyElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [activeShape, setActiveShape] = useState<Tool>("shape-rect");
  const [showShapePicker, setShowShapePicker] = useState(false);
  const [drawStroke, setDrawStroke] = useState<{ color: string; width: number }>({ color: "#DC2626", width: 2 });
  const [eraserSize, setEraserSize] = useState(15);
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [textPreviewFonts, setTextPreviewFonts] = useState<Record<string, string>>({});
  const loadedGoogleFontsRef = useRef<Set<string>>(new Set());
  const setPreviewFont = useCallback((id: string, family: string) => {
    setTextPreviewFonts((m) => ({ ...m, [id]: family }));
    if (GOOGLE_FONT_FAMILIES.includes(family) && !loadedGoogleFontsRef.current.has(family)) {
      loadedGoogleFontsRef.current.add(family);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;700&display=swap`;
      document.head.appendChild(link);
    }
  }, []);
  const [showMoreTools, setShowMoreTools] = useState(false);
  const moreBtnRef = useRef<HTMLDivElement | null>(null);
  const shapeBtnRef = useRef<HTMLDivElement | null>(null);
  const [moreToolsPos, setMoreToolsPos] = useState<{ top: number; left: number } | null>(null);
  const [shapePickerPos, setShapePickerPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!showMoreTools) return;
    const onDown = (ev: MouseEvent) => { if (moreBtnRef.current && !moreBtnRef.current.contains(ev.target as Node)) setShowMoreTools(false); };
    document.addEventListener("mousedown", onDown); return () => document.removeEventListener("mousedown", onDown);
  }, [showMoreTools]);
  useEffect(() => {
    if (!showShapePicker) return;
    const onDown = (ev: MouseEvent) => { if (shapeBtnRef.current && !shapeBtnRef.current.contains(ev.target as Node)) setShowShapePicker(false); };
    document.addEventListener("mousedown", onDown); return () => document.removeEventListener("mousedown", onDown);
  }, [showShapePicker]);

  const [phase, setPhase] = useState<Phase>("reading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<"width" | "page" | "custom">("width");
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ pageIndex: number; snippet: string }[]>([]);
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const textCacheRef = useRef<Record<number, string>>({});
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<HistorySnapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [, setHistoryTick] = useState(0);
  const skipHistoryRef = useRef(false);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState<null | { blob: Blob; filename: string; thumb: string | null; pages: number }>(null);
  const lastSelectedRef = useRef<number | null>(null);
  const panStateRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; el: HTMLElement } | null>(null);

  useEffect(() => { setSavedSignatures(getSavedSignatures()); }, [signatureOpen]);

  useEffect(() => {
    let cancelled = false;
    setPhase("reading"); setErrorMsg(null); setPdf(null); setPages([]); setElements([]);
    setSelectedIds(new Set()); setThumbs({}); setCurrent(0); setSuccess(null);
    historyRef.current = []; historyIndexRef.current = -1; textCacheRef.current = {};
    (async () => {
      try {
        const { loadPdf } = await import("@/lib/pdf-render");
        const doc = (await loadPdf(file)) as unknown as PdfDoc;
        if (cancelled) return;
        const initial: EditorPage[] = Array.from({ length: doc.numPages }, (_, i) => ({ id: `p${i}`, originalIndex: i, rotation: 0, selected: false }));
        setPdf(doc); setPages(initial);
        historyRef.current = [{ pages: initial, elements: [] }]; historyIndexRef.current = 0;
        setPhase("rendering");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not read PDF.";
        setErrorMsg(/password/i.test(msg) ? "This PDF is password-protected." : /invalid|corrupt/i.test(msg) ? "This file appears corrupt." : msg);
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < pdf.numPages; i++) {
        if (cancelled) return;
        if (thumbs[i]) continue;
        try {
          const page = await pdf.getPage(i + 1);
          const vp = page.getViewport({ scale: 0.3 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext("2d"); if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
          if (!cancelled) setThumbs((t) => ({ ...t, [i]: canvas.toDataURL("image/jpeg", 0.75) }));
        } catch { /**/ }
      }
      if (!cancelled) setPhase("ready");
    })();
    return () => { cancelled = true; };
  }, [pdf]);

  useEffect(() => {
    if (pages.length === 0) return;
    if (skipHistoryRef.current) { skipHistoryRef.current = false; return; }
    const idx = historyIndexRef.current;
    const last = historyRef.current[idx];
    const next: HistorySnapshot = { pages, elements };
    if (last && snapshotsEqual(last, next)) return;
    const trimmed = historyRef.current.slice(0, idx + 1);
    trimmed.push(next);
    while (trimmed.length > MAX_HISTORY) trimmed.shift();
    historyRef.current = trimmed; historyIndexRef.current = trimmed.length - 1;
    setHistoryTick((n) => n + 1);
  }, [pages, elements]);

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;
  const applySnapshot = useCallback((snap: HistorySnapshot) => { skipHistoryRef.current = true; setPages(snap.pages); setElements(snap.elements); }, []);
  const undo = useCallback(() => { const idx = historyIndexRef.current; if (idx <= 0) return; historyIndexRef.current = idx - 1; applySnapshot(historyRef.current[idx - 1]); setSelectedIds(new Set()); setHistoryTick((n) => n + 1); }, [applySnapshot]);
  const redo = useCallback(() => { const idx = historyIndexRef.current; if (idx >= historyRef.current.length - 1) return; historyIndexRef.current = idx + 1; applySnapshot(historyRef.current[idx + 1]); setSelectedIds(new Set()); setHistoryTick((n) => n + 1); }, [applySnapshot]);

  const selectAllPages = useCallback(() => setPages((ps) => ps.map((p) => ({ ...p, selected: true }))), []);
  const handlePageClick = useCallback((i: number, e: ReactMouseEvent) => {
    setCurrent(i); document.getElementById(`pdf-page-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    lastSelectedRef.current = i;
  }, []);
  const rotatePage = useCallback((i: number, delta: number) => setPages((ps) => ps.map((p, idx) => (idx === i ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p))), []);
  const deletePage = useCallback((i: number) => setPages((ps) => { if (ps.length <= 1) { toast.error("PDF must have at least one page."); return ps; } return ps.filter((_, idx) => idx !== i); }), []);
  const duplicatePage = useCallback((i: number) => setPages((ps) => { const out = [...ps]; out.splice(i + 1, 0, { ...ps[i], id: `${ps[i].id}-dup-${Date.now()}`, selected: false }); return out; }), []);
  const insertBlankPage = useCallback((after: number) => setPages((ps) => { const out = [...ps]; out.splice(after + 1, 0, { id: `blank-${Date.now()}`, originalIndex: -1, isBlank: true, rotation: 0, selected: false }); return out; }), []);

  const addElement = useCallback((el: AnyElement) => { setElements((es) => [...es, el]); setSelectedIds(new Set([el.id])); setActiveTool("select"); }, []);
  const addElementKeepTool = useCallback((el: AnyElement) => { setElements((es) => [...es, el]); setSelectedIds(new Set([el.id])); }, []);
  const updateElement = useCallback((id: string, patch: Partial<AnyElement>) => setElements((es) => es.map((e) => (e.id === id ? ({ ...e, ...patch } as AnyElement) : e))), []);
  const updateElements = useCallback((ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => setElements((es) => es.map((e) => (ids.has(e.id) ? ({ ...e, ...patchFn(e) } as AnyElement) : e))), []);
  const deleteElements = useCallback((ids: Set<string>) => { setElements((es) => es.filter((e) => !ids.has(e.id))); setSelectedIds(new Set()); }, []);
  const duplicateElements = useCallback((ids: Set<string>) => {
    setElements((es) => { const toDup = es.filter((e) => ids.has(e.id)); const clones = toDup.map((e) => ({ ...e, id: makeId("dup"), x: e.x + 14, y: e.y + 14 } as AnyElement)); setSelectedIds(new Set(clones.map((c) => c.id))); return [...es, ...clones]; });
  }, []);
  const replaceElements = useCallback((toRemove: string[], toAdd: AnyElement[]) => setElements((es) => [...es.filter((e) => !toRemove.includes(e.id)), ...toAdd]), []);
  const reorderZ = useCallback((ids: Set<string>, dir: "forward" | "backward" | "front" | "back") => {
    setElements((es) => {
      const next = [...es];
      const indices = next.map((e, i) => (ids.has(e.id) ? i : -1)).filter((i) => i >= 0);
      if (!indices.length) return es;
      if (dir === "front") { const items = indices.map((i) => next[i]); return [...next.filter((_, i) => !indices.includes(i)), ...items]; }
      if (dir === "back") { const items = indices.map((i) => next[i]); return [...items, ...next.filter((_, i) => !indices.includes(i))]; }
      const step = dir === "forward" ? 1 : -1;
      const order = dir === "forward" ? [...indices].reverse() : indices;
      for (const i of order) { const j = i + step; if (j < 0 || j >= next.length || ids.has(next[j].id)) continue; [next[i], next[j]] = [next[j], next[i]]; }
      return next;
    });
  }, []);

  const selectedElements = useMemo(() => elements.filter((e) => selectedIds.has(e.id)), [elements, selectedIds]);
  const singleSelected = selectedElements.length === 1 ? selectedElements[0] : null;

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); }
      else if ((mod && ev.key.toLowerCase() === "y") || (mod && ev.shiftKey && ev.key.toLowerCase() === "z")) { ev.preventDefault(); redo(); }
      else if (mod && ev.key.toLowerCase() === "d") { ev.preventDefault(); if (selectedIds.size > 0) duplicateElements(selectedIds); }
      else if (mod && ev.key.toLowerCase() === "a") {
        ev.preventDefault();
        if (elements.length > 0 && activeTool === "select") { const pid = pages[current]?.id; setSelectedIds(new Set(elements.filter((e) => e.pageId === pid).map((e) => e.id))); }
        else selectAllPages();
      } else if (mod && ev.key.toLowerCase() === "f") { ev.preventDefault(); setShowSearch(true); }
      else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); if (selectedIds.size > 0) deleteElements(selectedIds); }
      else if (ev.key === "Escape") { setSelectedIds(new Set()); setActiveTool("select"); setShowSearch(false); }
      else if (["ArrowDown","ArrowRight","ArrowUp","ArrowLeft"].includes(ev.key) && selectedIds.size > 0) {
        ev.preventDefault();
        const amt = ev.shiftKey ? NUDGE_FAST : NUDGE;
        const dx = ev.key === "ArrowRight" ? amt : ev.key === "ArrowLeft" ? -amt : 0;
        const dy = ev.key === "ArrowDown" ? amt : ev.key === "ArrowUp" ? -amt : 0;
        updateElements(selectedIds, (e) => ({ x: e.x + dx, y: e.y + dy }));
      }
    }
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectAllPages, deleteElements, duplicateElements, updateElements, pages, current, selectedIds, elements, activeTool]);

  async function runSearch(query: string) {
    setSearchQuery(query); setSearchActiveIdx(0);
    if (!pdf || !query.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const results: { pageIndex: number; snippet: string }[] = [];
      for (let i = 0; i < pages.length; i++) {
        const oi = pages[i].originalIndex; if (oi < 0) continue;
        let text = textCacheRef.current[oi];
        if (text == null) { try { const p = await pdf.getPage(oi + 1); const c = await p.getTextContent?.(); text = c ? c.items.map((it) => it.str).join(" ") : ""; } catch { text = ""; } textCacheRef.current[oi] = text; }
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx >= 0) { const s = Math.max(0, idx - 30); results.push({ pageIndex: i, snippet: `${s > 0 ? "…" : ""}${text.slice(s, idx + query.length + 30)}…` }); }
      }
      setSearchResults(results);
    } finally { setSearching(false); }
  }
  function jumpToResult(idx: number) {
    if (!searchResults.length) return;
    const c = ((idx % searchResults.length) + searchResults.length) % searchResults.length;
    setSearchActiveIdx(c); const pi = searchResults[c].pageIndex; setCurrent(pi);
    document.getElementById(`pdf-page-${pi}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function onImageChosen(fl: FileList | null) {
    const f = fl?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result); const img = new Image();
      img.onload = () => { const pid = pages[current]?.id; if (!pid) return; const s = Math.min(1, 220 / img.width); addElement({ id: makeId("img"), pageId: pid, type: "image", x: 60, y: 60, width: img.width * s, height: img.height * s, opacity: 1, rotation: 0, src } as ImageElement); };
      img.src = src;
    };
    reader.readAsDataURL(f);
  }

  function placeSignature(src: string) {
    const pid = pages[current]?.id; if (!pid) return;
    addElement({ id: makeId("sig"), pageId: pid, type: "image", x: 80, y: 80, width: 180, height: 70, opacity: 1, rotation: 0, src } as ImageElement);
  }
  function handleSignatureInsert(src: string, save: boolean) { if (save) saveSignature(src); placeSignature(src); setSignatureOpen(false); }

  async function apply() {
    if (processing || busy) return; setProcessing(true);
    try {
      const result = await onApply({ pages, selectedIds: new Set(pages.filter((p) => p.selected).map((p) => p.id)) });
      if (result && "blob" in result) {
        let finalBlob = result.blob;
        try { finalBlob = await stampElements(result.blob, pages, elements); } catch (e) { console.error("Stamp failed", e); toast.error("Saved, but annotations could not be embedded."); }
        let thumbUrl: string | null = null; let pageCount = pages.length;
        try {
          const { loadPdf, renderPdfPageToCanvas, canvasToBlob } = await import("@/lib/pdf-render");
          const doc = await loadPdf(new File([finalBlob], result.filename, { type: "application/pdf" })); pageCount = doc.numPages;
          const canvas = await renderPdfPageToCanvas(doc, 1, 1.2); const b = await canvasToBlob(canvas, "image/png"); thumbUrl = URL.createObjectURL(b);
        } catch { /**/ }
        setSuccess({ blob: finalBlob, filename: result.filename, thumb: thumbUrl, pages: pageCount });
        const url = URL.createObjectURL(finalBlob);
        publishResult({ name: result.filename, mime: "application/pdf", size: finalBlob.size, url, createdAt: Date.now() });
      }
    } finally { setProcessing(false); }
  }

  if (phase === "error") {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-100 dark:bg-gray-950 p-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center shadow-xl max-w-md w-full">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600"><Lock className="h-6 w-6" /></div>
          <h3 className="text-xl font-bold">Couldn't open this PDF</h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{errorMsg}</p>
          <Button variant="outline" onClick={onReplace} className="mt-5">Choose another file</Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-[9999] overflow-y-auto bg-gray-100 dark:bg-gray-950 p-4 sm:p-8 flex items-center justify-center">
        <SuccessScreen result={success} onDownload={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(success.blob); a.download = success.filename; a.click(); }} onEditAgain={() => setSuccess(null)} onNewFile={onReplace} />
      </div>
    );
  }

  const annotateDisabled = !pages[current] || pages[current].rotation !== 0;
  const shapeTools: { tool: Tool; icon: React.ReactNode; label: string }[] = [
    { tool: "shape-rect", icon: <Square className="w-4 h-4" />, label: "Rectangle" },
    { tool: "shape-ellipse", icon: <span className="w-4 h-4 flex items-center justify-center"><svg width="14" height="14"><ellipse cx="7" cy="7" rx="6" ry="6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></span>, label: "Ellipse" },
    { tool: "shape-line", icon: <Minus className="w-4 h-4" />, label: "Line" },
    { tool: "shape-arrow", icon: <ArrowRight className="w-4 h-4" />, label: "Arrow" },
    { tool: "shape-triangle", icon: <Triangle className="w-4 h-4" />, label: "Triangle" },
    { tool: "shape-star", icon: <Star className="w-4 h-4" />, label: "Star" },
    { tool: "shape-rounded-rect", icon: <span className="w-4 h-4 flex items-center justify-center"><svg width="14" height="14"><rect x="1" y="2" width="12" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></span>, label: "Rounded" },
    { tool: "shape-speech", icon: <MessageSquare className="w-4 h-4" />, label: "Bubble" },
  ];
  const activeShapeEntry = shapeTools.find((s) => s.tool === activeShape);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-gray-100 dark:bg-gray-950 overflow-hidden select-none font-sans">
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e: React.ChangeEvent<HTMLInputElement>) => { onImageChosen(e.target.files); e.target.value = ""; }} />

      {/* HEADER */}
      <header className="h-12 shrink-0 flex items-center justify-between gap-3 px-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onReplace} className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowLeft className="w-4 h-4" /></button>
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
          <span className="text-sm font-semibold truncate max-w-[220px] sm:max-w-[420px]">{file.name}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={undo} disabled={!canUndo} className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none" title="Undo (Ctrl+Z)"><Undo2 className="w-4 h-4" /></button>
          <button onClick={redo} disabled={!canRedo} className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none" title="Redo (Ctrl+Shift+Z)"><Redo2 className="w-4 h-4" /></button>
          <button onClick={() => setShowSearch((s) => !s)} className={cn("p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800", showSearch ? "text-[#DC2626] bg-red-50 dark:bg-red-900/30" : "text-gray-600 dark:text-gray-300")} title="Search (Ctrl+F)"><Search className="w-4 h-4" /></button>
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1 hidden sm:block" />
          <Button onClick={apply} disabled={processing || busy} size="sm" className="hidden sm:inline-flex h-8 rounded-md bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold text-sm px-3 gap-1.5">
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {processing ? "Saving…" : actionLabel || "Save changes"}
          </Button>
        </div>
      </header>

      {/* SEARCH BAR */}
      <AnimatePresence>
        {showSearch && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden z-20">
            <div className="flex items-center gap-2 px-3 py-2">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input autoFocus value={searchQuery} onChange={(e) => runSearch(e.target.value)} placeholder="Search in document…" className="flex-1 h-8 text-sm bg-transparent outline-none text-gray-800 dark:text-gray-100 placeholder:text-gray-400" />
              {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" />}
              {!searching && searchQuery && <span className="text-xs text-gray-500 shrink-0">{searchResults.length > 0 ? `${searchActiveIdx + 1} / ${searchResults.length}` : "No results"}</span>}
              <button onClick={() => jumpToResult(searchActiveIdx - 1)} disabled={!searchResults.length} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-600 dark:text-gray-300"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => jumpToResult(searchActiveIdx + 1)} disabled={!searchResults.length} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-600 dark:text-gray-300"><ChevronRight className="w-4 h-4" /></button>
              <button onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOOLBAR */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto z-20">
        <ToolBtn icon={<MousePointer2 />} label="Select" active={activeTool === "select"} onClick={() => { setActiveTool("select"); setSelectedIds(new Set()); }} />
        <ToolBtn icon={<Hand />} label="Hand" active={activeTool === "hand"} onClick={() => { setActiveTool("hand"); setSelectedIds(new Set()); }} />
        <Divider />
        <ToolBtn icon={<Type />} label="Text" active={activeTool === "text"} disabled={annotateDisabled} onClick={() => { setActiveTool("text"); setSelectedIds(new Set()); }} />
        <ToolBtn icon={<ImageIcon />} label="Image" active={activeTool === "image"} disabled={annotateDisabled} onClick={() => { setActiveTool("image"); imageInputRef.current?.click(); }} />
        <ToolBtn icon={<PenLine />} label="Draw" active={activeTool === "draw"} disabled={annotateDisabled} onClick={() => { setActiveTool("draw"); setSelectedIds(new Set()); }} />
        <ToolBtn icon={<Eraser />} label="Eraser" active={activeTool === "eraser"} disabled={annotateDisabled} onClick={() => { setActiveTool("eraser"); setSelectedIds(new Set()); }} />
        <ToolBtn icon={<Highlighter />} label="Highlight" active={activeTool === "highlight"} disabled={annotateDisabled} onClick={() => { setActiveTool("highlight"); setSelectedIds(new Set()); }} />

        {/* Shape picker button */}
        <div ref={shapeBtnRef} className="relative shrink-0">
          <button disabled={annotateDisabled} onClick={() => {
            if (!showShapePicker && shapeBtnRef.current) { const r = shapeBtnRef.current.getBoundingClientRect(); setShapePickerPos({ top: r.bottom + 4, left: r.left }); }
            setShowShapePicker((s) => !s);
          }} className={cn("flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium shrink-0 transition-colors", activeTool.startsWith("shape") ? "bg-red-50 text-[#DC2626] dark:bg-red-900/30" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800", annotateDisabled && "opacity-35 pointer-events-none")}>
            <span className="w-4 h-4 flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4">{activeShapeEntry?.icon ?? <Square className="w-4 h-4" />}</span>
            <span className="hidden md:inline">Shapes</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        <ToolBtn icon={<PenTool />} label="Sign" active={activeTool === "signature"} disabled={annotateDisabled} onClick={() => { setActiveTool("signature"); setSignatureOpen(true); }} />
        <Divider />
        <div ref={moreBtnRef} className="relative shrink-0">
          <ToolBtn icon={<MoreHorizontal />} label="More" active={showMoreTools || ["whiteout","sticky"].includes(activeTool)} disabled={annotateDisabled}
            onClick={() => { if (!showMoreTools && moreBtnRef.current) { const r = moreBtnRef.current.getBoundingClientRect(); setMoreToolsPos({ top: r.bottom + 4, left: r.left }); } setShowMoreTools((s) => !s); }} />
        </div>

        {/* Draw settings inline */}
        {activeTool === "draw" && (
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-gray-200 dark:border-gray-700">
            <span className="text-xs text-gray-400 hidden sm:block">Ink</span>
            <input type="color" value={drawStroke.color} onChange={(e) => setDrawStroke((s) => ({ ...s, color: e.target.value }))} className="w-6 h-6 rounded cursor-pointer border border-gray-200 p-0" />
            <input type="range" min={1} max={20} value={drawStroke.width} onChange={(e) => setDrawStroke((s) => ({ ...s, width: Number(e.target.value) }))} className="w-16 accent-[#DC2626]" />
            <span className="text-xs text-gray-400 w-4">{drawStroke.width}</span>
          </div>
        )}
        {activeTool === "eraser" && (
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-gray-200 dark:border-gray-700">
            <span className="text-xs text-gray-400 hidden sm:block">Size</span>
            <input type="range" min={5} max={60} value={eraserSize} onChange={(e) => setEraserSize(Number(e.target.value))} className="w-16 accent-[#DC2626]" />
            <span className="text-xs text-gray-400 w-4">{eraserSize}</span>
          </div>
        )}
        <div className="ml-auto sm:hidden">
          <Button onClick={apply} disabled={processing || busy} size="sm" className="h-8 rounded-md bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold text-xs px-3 gap-1.5">
            {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Save
          </Button>
        </div>
      </div>

      {/* Portals */}
      {typeof document !== "undefined" && createPortal(
        <>
          <AnimatePresence>
            {showMoreTools && moreToolsPos && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} style={{ position: "fixed", top: moreToolsPos.top, left: moreToolsPos.left }} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 w-44 z-[10000]">
                <button onClick={() => { setActiveTool("whiteout"); setSelectedIds(new Set()); setShowMoreTools(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"><Eraser className="w-4 h-4" /> Whiteout</button>
                <button onClick={() => { setActiveTool("sticky"); setSelectedIds(new Set()); setShowMoreTools(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"><MessageSquare className="w-4 h-4" /> Sticky note</button>
                <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                {(["field-text","field-checkbox","field-radio","field-dropdown"] as Tool[]).map((t) => (
                  <button key={t} onClick={() => { setActiveTool(t); setSelectedIds(new Set()); setShowMoreTools(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">{t.replace("field-", "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {showShapePicker && shapePickerPos && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} style={{ position: "fixed", top: shapePickerPos.top, left: shapePickerPos.left }} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 z-[10000] grid grid-cols-4 gap-1 w-52">
                {shapeTools.map((s) => (
                  <button key={s.tool} title={s.label} onClick={() => { setActiveShape(s.tool); setActiveTool(s.tool); setSelectedIds(new Set()); setShowShapePicker(false); }}
                    className={cn("flex flex-col items-center gap-1 p-2 rounded-md text-xs transition-colors", activeTool === s.tool ? "bg-red-50 text-[#DC2626] dark:bg-red-900/30" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800")}>
                    <span className="w-4 h-4 flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4">{s.icon}</span>
                    <span className="leading-none text-center">{s.label}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body
      )}

      {/* BODY */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* LEFT SIDEBAR */}
        <AnimatePresence initial={false}>
          {showLeftSidebar && (
            <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 200, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col shrink-0 z-10">
              <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Pages · {pages.length}</span>
                <button onClick={() => insertBlankPage(pages.length - 1)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500" title="Add blank page"><FilePlus className="h-3.5 w-3.5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {pages.map((p, i) => (
                  <div key={p.id} onClick={(e) => handlePageClick(i, e)} className={cn("group relative rounded-md border p-1.5 cursor-pointer flex gap-2 items-center", current === i ? "border-[#DC2626] bg-red-50/60 dark:bg-red-900/20" : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800")}>
                    <div className="w-11 aspect-[3/4] bg-white border border-gray-200 dark:border-gray-700 overflow-hidden rounded shrink-0 flex items-center justify-center" style={{ transform: `rotate(${p.rotation}deg)` }}>
                      {thumbs[p.originalIndex] ? <img src={thumbs[p.originalIndex]} alt={`Page ${i + 1}`} className="w-full h-full object-contain pointer-events-none" /> : <div className="w-full h-full animate-pulse bg-gray-100 dark:bg-gray-800" />}
                    </div>
                    <div className="flex-1 min-w-0 flex items-center justify-between">
                      <span className={cn("text-xs font-medium", current === i ? "text-[#DC2626]" : "text-gray-600 dark:text-gray-300")}>{i + 1}</span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e: ReactMouseEvent) => { e.stopPropagation(); duplicatePage(i); }} className="p-1 rounded hover:bg-white dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700" title="Duplicate"><Copy className="h-3 w-3" /></button>
                        <button onClick={(e: ReactMouseEvent) => { e.stopPropagation(); rotatePage(i, 90); }} className="p-1 rounded hover:bg-white dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700" title="Rotate"><RotateCw className="h-3 w-3" /></button>
                        <button onClick={(e: ReactMouseEvent) => { e.stopPropagation(); deletePage(i); }} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600" title="Delete"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={() => insertBlankPage(pages.length - 1)} className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 dark:border-gray-700 py-2 text-xs font-medium text-gray-500 hover:border-[#DC2626] hover:text-[#DC2626] transition-colors"><Plus className="h-3.5 w-3.5" /> Add page</button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
        <button onClick={() => setShowLeftSidebar((s) => !s)} className="absolute top-1/2 -translate-y-1/2 z-30 bg-[#DC2626] hover:bg-[#B91C1C] rounded-r-lg py-3 px-1.5 text-white shadow-md" style={{ left: showLeftSidebar ? 200 : 0 }}>
          {showLeftSidebar ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* CENTER */}
        <main className="flex-1 relative overflow-hidden flex flex-col bg-[#EDEEF1] dark:bg-gray-950">
          {phase === "reading" || phase === "rendering" ? (
            <div className="m-auto flex flex-col items-center gap-3 text-gray-500"><Loader2 className="h-7 w-7 animate-spin text-[#DC2626]" /><span className="text-sm font-medium">Rendering…</span></div>
          ) : (
            <PreviewCanvas pdf={pdf} pages={pages} zoom={zoom} fitMode={fitMode} current={current} onCurrentChange={setCurrent} phase="ready"
              onToggleSelect={() => {}} selectionMode={false} elements={elements} activeTool={activeTool}
              selectedIds={selectedIds} onSetSelectedIds={setSelectedIds} onAddElement={addElement}
              onAddElementKeepTool={addElementKeepTool} onUpdateElement={updateElement}
              onUpdateElements={updateElements} onDuplicateElements={duplicateElements}
              onReplaceElements={replaceElements} panStateRef={panStateRef}
              textPreviewFonts={textPreviewFonts} drawStroke={drawStroke} eraserSize={eraserSize}
            />
          )}
          {/* BOTTOM BAR */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#1F2937]/95 text-white px-2.5 py-1.5 rounded-lg shadow-lg flex items-center gap-2 z-30 backdrop-blur-sm text-xs">
            <button onClick={() => { const n = Math.max(0, current - 1); setCurrent(n); document.getElementById(`pdf-page-${n}`)?.scrollIntoView({ behavior: "smooth" }); }} disabled={current === 0} className="p-1 rounded hover:bg-white/20 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="font-medium px-1 tabular-nums">{current + 1} / {pages.length}</span>
            <button onClick={() => { const n = Math.min(pages.length - 1, current + 1); setCurrent(n); document.getElementById(`pdf-page-${n}`)?.scrollIntoView({ behavior: "smooth" }); }} disabled={current === pages.length - 1} className="p-1 rounded hover:bg-white/20 disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
            <div className="w-px h-4 bg-white/20" />
            <button onClick={() => { setFitMode("custom"); setZoom((z) => Math.max(0.25, +(z - 0.05).toFixed(2))); }} className="p-1 rounded hover:bg-white/20" title="Zoom out"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg></button>
            <span className="font-medium w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button onClick={() => { setFitMode("custom"); setZoom((z) => Math.min(4, +(z + 0.05).toFixed(2))); }} className="p-1 rounded hover:bg-white/20" title="Zoom in"><Plus className="h-3.5 w-3.5" /></button>
            <div className="w-px h-4 bg-white/20" />
            <button onClick={() => setFitMode("width")} className={cn("p-1 rounded hover:bg-white/20", fitMode === "width" && "bg-white/25")} title="Fit width"><ArrowLeftRight className="h-3.5 w-3.5" /></button>
            <button onClick={() => setFitMode("page")} className={cn("p-1 rounded hover:bg-white/20", fitMode === "page" && "bg-white/25")} title="Fit page"><Maximize2 className="h-3.5 w-3.5" /></button>
          </div>
        </main>

        <button onClick={() => setShowRightSidebar((s) => !s)} className="absolute top-1/2 -translate-y-1/2 z-30 bg-[#DC2626] hover:bg-[#B91C1C] rounded-l-lg py-3 px-1.5 text-white shadow-md" style={{ right: showRightSidebar ? 260 : 0 }}>
          {showRightSidebar ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        {/* RIGHT SIDEBAR */}
        <AnimatePresence initial={false}>
          {showRightSidebar && (
            <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 260, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 flex flex-col shrink-0 z-10">
              <div className="flex-1 overflow-y-auto">
                <ContextPropertiesPanel selectedElements={selectedElements} singleSelected={singleSelected} activeTool={activeTool}
                  eraserSize={eraserSize} onEraserSizeChange={setEraserSize}
                  onUpdateElement={updateElement} onUpdateElements={(patch) => updateElements(selectedIds, () => patch)}
                  onDeleteElements={() => deleteElements(selectedIds)} onDuplicateElements={() => duplicateElements(selectedIds)}
                  onImageReplace={() => imageInputRef.current?.click()}
                  onBringToFront={() => reorderZ(selectedIds, "front")} onSendToBack={() => reorderZ(selectedIds, "back")}
                  onRotatePage={() => rotatePage(current, 90)} onDuplicatePage={() => duplicatePage(current)}
                  onExtractPage={() => {}}
                  textPreviewFonts={textPreviewFonts} onSetPreviewFont={setPreviewFont}
                />
              </div>
              <div className="p-3 border-t border-gray-200 dark:border-gray-800">
                <Button onClick={apply} disabled={processing || busy} className="w-full h-11 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold text-sm shadow-sm flex items-center justify-center gap-2">
                  {processing ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <>{actionLabel || "Save changes"}<ArrowRight className="h-4 w-4" /></>}
                </Button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {signatureOpen && (
        <SignatureModal savedSignatures={savedSignatures} onInsert={handleSignatureInsert}
          onCancel={() => { setSignatureOpen(false); setActiveTool("select"); }}
          onDeleteSaved={(id: string) => { deleteSavedSignature(id); setSavedSignatures(getSavedSignatures()); }}
        />
      )}
    </div>
  );
}

function ToolBtn({ icon, label, active, disabled, onClick }: { icon: React.ReactNode; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={active}
      className={cn("flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium shrink-0 transition-colors", active ? "bg-red-50 text-[#DC2626] dark:bg-red-900/30" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800", disabled && "opacity-35 pointer-events-none")}>
      <span className="w-4 h-4 flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
function Divider() { return <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1 shrink-0" />; }

/* =========================================================  PREVIEW CANVAS  ========================================================= */
function PreviewCanvas(props: {
  pdf: PdfDoc | null; pages: EditorPage[]; zoom: number; fitMode: "width" | "page" | "custom";
  current: number; onCurrentChange: (n: number) => void; phase: Phase;
  onToggleSelect: (i: number) => void; selectionMode: boolean; elements: AnyElement[];
  activeTool: Tool; selectedIds: Set<string>; onSetSelectedIds: (ids: Set<string>) => void;
  onAddElement: (el: AnyElement) => void; onAddElementKeepTool: (el: AnyElement) => void;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => void;
  onDuplicateElements: (ids: Set<string>) => void;
  onReplaceElements: (toRemove: string[], toAdd: AnyElement[]) => void;
  panStateRef: React.MutableRefObject<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; el: HTMLElement } | null>;
  textPreviewFonts: Record<string, string>; drawStroke: { color: string; width: number }; eraserSize: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [visible, setVisible] = useState<Set<number>>(new Set([0]));
  useLayoutEffect(() => { const el = containerRef.current; if (!el) return; const ro = new ResizeObserver(() => setContainerSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setContainerSize({ w: el.clientWidth, h: el.clientHeight }); return () => ro.disconnect(); }, []);
  const scale = useMemo(() => { if (!props.pdf) return 1.5; if (props.fitMode === "custom") return 1.5 * props.zoom; return props.fitMode === "width" ? 1.5 : 1.2; }, [props.pdf, props.fitMode, props.zoom]);
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-page-index]"));
    const io = new IntersectionObserver((entries) => {
      setVisible((prev) => { const next = new Set(prev); entries.forEach((en) => { const idx = parseInt((en.target as Element).getAttribute("data-page-index") || "-1", 10); if (en.isIntersecting) next.add(idx); else next.delete(idx); }); return next; });
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) { const idx = parseInt(top.getAttribute("data-page-index") || "-1", 10); if (idx >= 0) props.onCurrentChange(idx); }
    }, { root: el, rootMargin: "50% 0px", threshold: 0 });
    items.forEach((it) => io.observe(it)); return () => io.disconnect();
  }, [props.pages.length, props.onCurrentChange]);

  function onContainerPointerDown(e: ReactPointerEvent) {
    if (props.activeTool !== "hand") return;
    const el = containerRef.current; if (!el) return;
    props.panStateRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, el };
    const onMove = (ev: PointerEvent) => { const st = props.panStateRef.current; if (!st) return; st.el.scrollLeft = st.scrollLeft - (ev.clientX - st.startX); st.el.scrollTop = st.scrollTop - (ev.clientY - st.startY); };
    const onUp = () => { props.panStateRef.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  }

  return (
    <div ref={containerRef} onPointerDown={onContainerPointerDown} className="w-full h-full overflow-auto flex flex-col items-center py-6 px-2 sm:px-4" style={{ cursor: props.activeTool === "hand" ? "grab" : undefined }}>
      <div className="flex flex-col items-center gap-8 pb-32">
        {props.pages.map((p, i) => (
          <PagePane key={p.id} index={i} page={p} pdf={props.pdf!} visible={visible.has(i)}
            containerWidth={containerSize.w} containerHeight={containerSize.h} fitMode={props.fitMode}
            zoom={props.zoom} baseScale={scale} active={props.current === i}
            selectionMode={props.selectionMode} onToggleSelect={() => props.onToggleSelect(i)}
            elements={props.elements.filter((e) => e.pageId === p.id)} activeTool={props.activeTool}
            selectedIds={props.selectedIds} onSetSelectedIds={props.onSetSelectedIds}
            onAddElement={props.onAddElement} onAddElementKeepTool={props.onAddElementKeepTool}
            onUpdateElement={props.onUpdateElement} onUpdateElements={props.onUpdateElements}
            onDuplicateElements={props.onDuplicateElements} onReplaceElements={props.onReplaceElements}
            textPreviewFonts={props.textPreviewFonts} drawStroke={props.drawStroke} eraserSize={props.eraserSize}
          />
        ))}
      </div>
    </div>
  );
}

function PagePane(props: {
  index: number; page: EditorPage; pdf: PdfDoc; visible: boolean;
  containerWidth: number; containerHeight: number; fitMode: "width" | "page" | "custom";
  zoom: number; baseScale: number; active: boolean; selectionMode: boolean;
  onToggleSelect: () => void; elements: AnyElement[]; activeTool: Tool;
  selectedIds: Set<string>; onSetSelectedIds: (ids: Set<string>) => void;
  onAddElement: (el: AnyElement) => void; onAddElementKeepTool: (el: AnyElement) => void;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => void;
  onDuplicateElements: (ids: Set<string>) => void;
  onReplaceElements: (toRemove: string[], toAdd: AnyElement[]) => void;
  textPreviewFonts: Record<string, string>; drawStroke: { color: string; width: number }; eraserSize: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (props.page.isBlank) { setDims({ w: 595, h: 842 }); setRendered(true); return; }
    (async () => { try { const p = await props.pdf.getPage(props.page.originalIndex + 1); const vp = p.getViewport({ scale: 1, rotation: props.page.rotation }); if (!cancelled) setDims({ w: vp.width, h: vp.height }); } catch { /**/ } })();
    return () => { cancelled = true; };
  }, [props.pdf, props.page.originalIndex, props.page.rotation, props.page.isBlank]);

  const scale = useMemo(() => {
    if (!dims) return 1;
    if (props.fitMode === "custom") return props.baseScale;
    const pad = 16;
    if (props.fitMode === "width") return Math.max(320, props.containerWidth - pad) / dims.w;
    return Math.min(Math.max(320, props.containerWidth - pad) / dims.w, Math.max(320, props.containerHeight - pad) / dims.h);
  }, [dims, props.fitMode, props.baseScale, props.containerWidth, props.containerHeight]);

  const displayW = dims ? dims.w * scale : 600, displayH = dims ? dims.h * scale : 800;

  useEffect(() => {
    if (!props.visible || !dims || props.page.isBlank) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await props.pdf.getPage(props.page.originalIndex + 1);
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        const vp = page.getViewport({ scale: Math.max(scale, 1) * dpr, rotation: props.page.rotation });
        const canvas = canvasRef.current; if (!canvas) return;
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        canvas.style.width = `${Math.ceil(displayW)}px`; canvas.style.height = `${Math.ceil(displayH)}px`;
        const ctx = canvas.getContext("2d", { alpha: false }); if (!ctx || cancelled) return;
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        if (!cancelled) setRendered(true);
      } catch { /**/ }
    })();
    return () => { cancelled = true; };
  }, [props.visible, dims, scale, props.pdf, props.page.originalIndex, props.page.rotation, displayW, displayH, props.page.isBlank]);

  return (
    <div id={`pdf-page-${props.index}`} data-page-index={props.index}
      className={cn("group relative overflow-hidden bg-white shadow-[0_1px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_10px_rgba(0,0,0,0.5)] mb-8 border border-gray-200 dark:border-gray-800", props.selectionMode && "cursor-pointer")}
      style={{ width: displayW, height: displayH }} onClick={props.selectionMode ? props.onToggleSelect : undefined}>
      <canvas ref={canvasRef} className="block h-full w-full bg-white" />
      {!rendered && !props.page.isBlank && <div className="absolute inset-0 grid animate-pulse place-items-center bg-gray-50 text-xs text-gray-400">Rendering…</div>}
      {props.page.rotation === 0 && dims && (
        <AnnotationLayer pageId={props.page.id} scale={scale} elements={props.elements} activeTool={props.activeTool}
          selectedIds={props.selectedIds} onSetSelectedIds={props.onSetSelectedIds}
          onAddElement={props.onAddElement} onAddElementKeepTool={props.onAddElementKeepTool}
          onUpdateElement={props.onUpdateElement} onUpdateElements={props.onUpdateElements}
          onDuplicateElements={props.onDuplicateElements} onReplaceElements={props.onReplaceElements}
          interactive={props.activeTool !== "hand"} textPreviewFonts={props.textPreviewFonts}
          drawStroke={props.drawStroke} eraserSize={props.eraserSize}
        />
      )}
    </div>
  );
}

/* =========================================================  ANNOTATION LAYER  ========================================================= */
function AnnotationLayer(props: {
  pageId: string; scale: number; elements: AnyElement[]; activeTool: Tool;
  selectedIds: Set<string>; onSetSelectedIds: (ids: Set<string>) => void;
  onAddElement: (el: AnyElement) => void; onAddElementKeepTool: (el: AnyElement) => void;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => void;
  onDuplicateElements: (ids: Set<string>) => void;
  onReplaceElements: (toRemove: string[], toAdd: AnyElement[]) => void;
  interactive: boolean; textPreviewFonts: Record<string, string>;
  drawStroke: { color: string; width: number }; eraserSize: number;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{ startPt: { x: number; y: number } } | null>(null);
  const moveStateRef = useRef<{ ids: string[]; offsets: Record<string, { x: number; y: number }> } | null>(null);
  const resizeStateRef = useRef<{ id: string; startW: number; startH: number } | null>(null);
  const rotateStateRef = useRef<{ id: string; centerX: number; centerY: number; startAngle: number; startRotation: number } | null>(null);

  const toPt = useCallback((clientX: number, clientY: number) => {
    const rect = layerRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / props.scale, y: (clientY - rect.top) / props.scale };
  }, [props.scale]);

  const nonCreationTools: Tool[] = ["select", "hand", "image", "signature", "eraser"];
  const isCreationTool = props.interactive && !nonCreationTools.includes(props.activeTool);
  const isShapeTool = props.activeTool.startsWith("shape-");
  const isFieldTool = props.activeTool.startsWith("field-");

  function onLayerPointerDown(e: ReactPointerEvent) {
    if (!props.interactive) return;

    // ERASER TOOL
    if (props.activeTool === "eraser") {
      e.preventDefault();
      const pt = toPt(e.clientX, e.clientY);
      setEraserPos(pt);
      const drawEls = props.elements.filter((el) => el.type === "draw") as DrawElement[];
      const { toRemove, toAdd } = eraseFromDrawElements(pt, props.eraserSize, drawEls);
      if (toRemove.length > 0) props.onReplaceElements(toRemove, toAdd);
      const onMove = (ev: PointerEvent) => {
        const p = toPt(ev.clientX, ev.clientY); setEraserPos(p);
        // Note: props.elements is captured at pointerdown; for real-time erasure use ref pattern
        const curr = props.elements.filter((el) => el.type === "draw") as DrawElement[];
        const res = eraseFromDrawElements(p, props.eraserSize, curr);
        if (res.toRemove.length > 0) props.onReplaceElements(res.toRemove, res.toAdd);
      };
      const onUp = () => { setEraserPos(null); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
      window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
      return;
    }

    // SELECT / MARQUEE
    if (!isCreationTool) {
      if (e.target === layerRef.current) {
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        props.onSetSelectedIds(new Set());
        const start = toPt(e.clientX, e.clientY);
        setMarquee({ x: start.x, y: start.y, w: 0, h: 0 });
        const onMove = (ev: PointerEvent) => { const p = toPt(ev.clientX, ev.clientY); setMarquee({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }); };
        const onUp = (ev: PointerEvent) => {
          window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
          const p = toPt(ev.clientX, ev.clientY);
          const r = { x1: Math.min(start.x, p.x), y1: Math.min(start.y, p.y), x2: Math.max(start.x, p.x), y2: Math.max(start.y, p.y) };
          if (Math.abs(r.x2 - r.x1) > 3 || Math.abs(r.y2 - r.y1) > 3) props.onSetSelectedIds(new Set(props.elements.filter((el) => { const b = { x1: el.x, y1: el.y, x2: el.x + el.width, y2: el.y + el.height }; return r.x1 < b.x2 && r.x2 > b.x1 && r.y1 < b.y2 && r.y2 > b.y1; }).map((el) => el.id)));
          setMarquee(null);
        };
        window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
      }
      return;
    }

    const pt = toPt(e.clientX, e.clientY);

    // Single-click tools
    if (props.activeTool === "text") { props.onAddElement({ id: makeId("txt"), pageId: props.pageId, type: "text", x: pt.x, y: pt.y, width: 180, height: 28, opacity: 1, rotation: 0, text: "Click to edit text", font: "Helvetica", fontSize: 14, bold: false, italic: false, underline: false, color: "#111827", align: "left", letterSpacing: 0, lineSpacing: 1.25 } as TextElement); return; }
    if (props.activeTool === "sticky") { props.onAddElement({ id: makeId("sticky"), pageId: props.pageId, type: "sticky", x: pt.x, y: pt.y, width: 140, height: 100, opacity: 1, rotation: 0, color: "#FEF08A", note: "" } as StickyElement); return; }
    if (isFieldTool) {
      const base = { id: makeId(props.activeTool), pageId: props.pageId, opacity: 1, rotation: 0, x: pt.x, y: pt.y } as const;
      let el: AnyElement | null = null;
      if (props.activeTool === "field-text") el = { ...base, type: "field-text", width: 180, height: 26, name: "text_field", value: "", placeholder: "Enter text", required: false } as FieldTextElement;
      else if (props.activeTool === "field-checkbox") el = { ...base, type: "field-checkbox", width: 18, height: 18, name: "checkbox", checked: false, required: false } as FieldCheckboxElement;
      else if (props.activeTool === "field-radio") el = { ...base, type: "field-radio", width: 18, height: 18, groupName: "radio_group", value: "option_1", checked: false, required: false } as FieldRadioElement;
      else if (props.activeTool === "field-dropdown") el = { ...base, type: "field-dropdown", width: 160, height: 26, name: "dropdown", options: ["Option 1", "Option 2"], value: "Option 1", required: false } as FieldDropdownElement;
      if (el) props.onAddElement(el); return;
    }

    // Drag-based tools
    dragStateRef.current = { startPt: pt };
    if (props.activeTool === "draw") setDrawPoints([pt]);
    else setDraft({ x: pt.x, y: pt.y, w: 0, h: 0 });

    const onMove = (ev: PointerEvent) => {
      const p = toPt(ev.clientX, ev.clientY);
      if (props.activeTool === "draw") setDrawPoints((pts) => pts ? [...pts, p] : [p]);
      else { const s = dragStateRef.current!.startPt; setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }); }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
      const p = toPt(ev.clientX, ev.clientY);
      const start = dragStateRef.current?.startPt ?? p;
      dragStateRef.current = null;

      if (props.activeTool === "draw") {
        setDrawPoints((pts) => {
          if (pts && pts.length > 1) {
            const xs = pts.map((pp) => pp.x), ys = pts.map((pp) => pp.y);
            const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
            props.onAddElement({ id: makeId("draw"), pageId: props.pageId, type: "draw", x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), opacity: 1, rotation: 0, stroke: props.drawStroke.color, strokeWidth: props.drawStroke.width, points: pts.map((pp) => ({ x: pp.x - minX, y: pp.y - minY })) } as DrawElement);
          }
          return null;
        });
        return;
      }

      const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
      const w = Math.max(8, Math.abs(p.x - start.x)), h = Math.max(8, Math.abs(p.y - start.y));
      setDraft(null);

      if (isShapeTool) {
        const flipDiag = (start.x < p.x) !== (start.y < p.y);
        props.onAddElement({ id: makeId("shape"), pageId: props.pageId, type: props.activeTool.replace("shape-", ""), x, y, width: w, height: h, opacity: 1, rotation: 0, stroke: "#DC2626", strokeWidth: 2, fill: null, flipDiag } as unknown as ShapeElement);
      } else if (["highlight","underline","strikeout","squiggly"].includes(props.activeTool)) {
        props.onAddElement({ id: makeId("markup"), pageId: props.pageId, type: props.activeTool, x, y, width: w, height: h, opacity: props.activeTool === "highlight" ? 0.35 : 1, rotation: 0, color: "#FDE047" } as HighlightElement);
      } else if (props.activeTool === "whiteout") {
        props.onAddElement({ id: makeId("wo"), pageId: props.pageId, type: "whiteout", x, y, width: w, height: h, opacity: 1, rotation: 0, color: "#ffffff" });
      }
    };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  }

  function startMove(e: ReactPointerEvent, el: AnyElement) {
    e.stopPropagation();
    if (!props.interactive || props.activeTool !== "select") return;
    let ids = props.selectedIds;
    if (e.shiftKey || e.metaKey || e.ctrlKey) { const n = new Set(ids); if (n.has(el.id)) n.delete(el.id); else n.add(el.id); props.onSetSelectedIds(n); ids = n; }
    else if (!ids.has(el.id)) { ids = new Set([el.id]); props.onSetSelectedIds(ids); }
    if (!ids.has(el.id)) return;
    if (e.altKey) { props.onDuplicateElements(ids); return; }
    const pt = toPt(e.clientX, e.clientY);
    const offsets: Record<string, { x: number; y: number }> = {};
    for (const id of ids) { const f = props.elements.find((x) => x.id === id); if (f) offsets[id] = { x: pt.x - f.x, y: pt.y - f.y }; }
    moveStateRef.current = { ids: Array.from(ids), offsets };
    const onMove = (ev: PointerEvent) => { const p = toPt(ev.clientX, ev.clientY); const st = moveStateRef.current; if (!st) return; props.onUpdateElements(new Set(st.ids), (e2) => ({ x: p.x - st.offsets[e2.id].x, y: p.y - st.offsets[e2.id].y })); };
    const onUp = () => { moveStateRef.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  }

  function startResize(e: ReactPointerEvent, el: AnyElement) {
    e.stopPropagation();
    resizeStateRef.current = { id: el.id, startW: el.width, startH: el.height };
    const sc = { x: e.clientX, y: e.clientY };
    const onMove = (ev: PointerEvent) => { const st = resizeStateRef.current; if (!st) return; props.onUpdateElement(st.id, { width: Math.max(12, st.startW + (ev.clientX - sc.x) / props.scale), height: Math.max(12, st.startH + (ev.clientY - sc.y) / props.scale) }); };
    const onUp = () => { resizeStateRef.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  }

  function startRotate(e: ReactPointerEvent, el: AnyElement) {
    e.stopPropagation();
    const rect = layerRef.current!.getBoundingClientRect();
    const cx = rect.left + (el.x + el.width / 2) * props.scale, cy = rect.top + (el.y + el.height / 2) * props.scale;
    const sa = Math.atan2(e.clientY - cy, e.clientX - cx);
    rotateStateRef.current = { id: el.id, centerX: cx, centerY: cy, startAngle: sa, startRotation: el.rotation };
    const onMove = (ev: PointerEvent) => { const st = rotateStateRef.current; if (!st) return; const a = Math.atan2(ev.clientY - st.centerY, ev.clientX - st.centerX); let rot = Math.round(st.startRotation + (a - st.startAngle) * 180 / Math.PI); if (ev.shiftKey) rot = Math.round(rot / 15) * 15; props.onUpdateElement(st.id, { rotation: ((rot % 360) + 360) % 360 }); };
    const onUp = () => { rotateStateRef.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  }

  const isInteractiveDrawing = props.activeTool === "draw" || props.activeTool === "eraser" || isCreationTool;

  return (
    <div ref={layerRef} className="absolute inset-0"
      style={{ cursor: props.activeTool === "eraser" ? "none" : isCreationTool ? "crosshair" : "default", pointerEvents: props.interactive ? "auto" : "none", touchAction: isInteractiveDrawing ? "none" : undefined }}
      onPointerDown={onLayerPointerDown}>

      {props.elements.map((el) => {
        const selected = props.selectedIds.has(el.id);
        const canRotate = selected && props.activeTool === "select" && ROTATABLE_TYPES.has(el.type) && props.selectedIds.size === 1;
        const s = el as ShapeElement & { flipDiag?: boolean };
        const sw = el.width * props.scale, sh = el.height * props.scale;
        const style: CSSProperties = { position: "absolute", left: el.x * props.scale, top: el.y * props.scale, width: sw, height: sh, opacity: el.opacity, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, transformOrigin: "center center" };

        let body: React.ReactNode = null;
        if (el.type === "text") {
          const t = el as TextElement;
          body = (<div contentEditable={selected && props.activeTool === "select" && props.selectedIds.size === 1} suppressContentEditableWarning onBlur={(e2) => props.onUpdateElement(el.id, { text: e2.currentTarget.textContent || "" })} style={{ width: "100%", height: "100%", fontFamily: props.textPreviewFonts[el.id] ? fontFamilyStack(props.textPreviewFonts[el.id]) : t.font === "TimesRoman" ? "Times New Roman, serif" : t.font === "Courier" ? "monospace" : "Helvetica, Arial, sans-serif", fontSize: t.fontSize * props.scale, fontWeight: t.bold ? 700 : 400, fontStyle: t.italic ? "italic" : "normal", textDecoration: t.underline ? "underline" : "none", color: t.color, textAlign: t.align, whiteSpace: "pre-wrap", outline: "none", lineHeight: t.lineSpacing, letterSpacing: `${t.letterSpacing * props.scale}px`, cursor: "text" }}>{t.text}</div>);
        } else if (el.type === "rect") {
          body = <div style={{ width: "100%", height: "100%", border: `${s.strokeWidth * props.scale}px solid ${s.stroke}`, background: s.fill ?? "transparent" }} />;
        } else if (el.type === "rounded-rect") {
          body = <div style={{ width: "100%", height: "100%", borderRadius: 12 * props.scale, border: `${s.strokeWidth * props.scale}px solid ${s.stroke}`, background: s.fill ?? "transparent" }} />;
        } else if (el.type === "ellipse") {
          body = <div style={{ width: "100%", height: "100%", borderRadius: "50%", border: `${s.strokeWidth * props.scale}px solid ${s.stroke}`, background: s.fill ?? "transparent" }} />;
        } else if (el.type === "line") {
          const flip = (s as any).flipDiag;
          body = (<svg width="100%" height="100%" style={{ overflow: "visible" }}><line x1={0} y1={flip ? sh : 0} x2={sw} y2={flip ? 0 : sh} stroke={s.stroke} strokeWidth={s.strokeWidth * props.scale} strokeLinecap="round" /></svg>);
        } else if (el.type === "arrow") {
          const aw = Math.max(10, Math.min(sw * 0.25, sh * 0.8));
          const ah = aw * 0.65;
          body = (<svg width="100%" height="100%" viewBox={`0 0 ${sw} ${sh}`} style={{ overflow: "visible" }}>
            <line x1={0} y1={sh / 2} x2={sw - aw * 0.8} y2={sh / 2} stroke={s.stroke} strokeWidth={s.strokeWidth * props.scale} strokeLinecap="round" />
            <polygon points={`${sw - aw},${sh / 2 - ah / 2} ${sw},${sh / 2} ${sw - aw},${sh / 2 + ah / 2}`} fill={s.stroke} />
          </svg>);
        } else if (el.type === "triangle") {
          body = (<svg width="100%" height="100%" viewBox={`0 0 ${sw} ${sh}`} style={{ overflow: "visible" }}>
            <polygon points={`${sw / 2},0 ${sw},${sh} 0,${sh}`} fill={s.fill ?? "none"} stroke={s.stroke} strokeWidth={s.strokeWidth * props.scale} strokeLinejoin="round" />
          </svg>);
        } else if (el.type === "star") {
          const cx = sw / 2, cy = sh / 2, outerR = Math.min(cx, cy) * 0.98, innerR = outerR * 0.42;
          body = (<svg width="100%" height="100%" viewBox={`0 0 ${sw} ${sh}`} style={{ overflow: "visible" }}>
            <polygon points={starSvgPoints(cx, cy, outerR, innerR)} fill={s.fill ?? "none"} stroke={s.stroke} strokeWidth={s.strokeWidth * props.scale} strokeLinejoin="round" />
          </svg>);
        } else if (el.type === "speech") {
          const r = Math.min(10, sw * 0.05, sh * 0.08);
          const tailH = sh * 0.22, bubH = sh - tailH;
          body = (<svg width="100%" height="100%" viewBox={`0 0 ${sw} ${sh}`} style={{ overflow: "visible" }}>
            <path d={`M ${r},0 L ${sw - r},0 Q ${sw},0 ${sw},${r} L ${sw},${bubH - r} Q ${sw},${bubH} ${sw - r},${bubH} L ${sw * 0.38},${bubH} L ${sw * 0.22},${sh} L ${sw * 0.3},${bubH} L ${r},${bubH} Q 0,${bubH} 0,${bubH - r} L 0,${r} Q 0,0 ${r},0 Z`} fill={s.fill ?? "white"} stroke={s.stroke} strokeWidth={s.strokeWidth * props.scale} strokeLinejoin="round" />
          </svg>);
        } else if (el.type === "draw") {
          const d = el as DrawElement;
          const pts = d.points.map((p) => `${p.x * props.scale},${p.y * props.scale}`).join(" ");
          body = (<svg className="absolute inset-0 w-full h-full" style={{ overflow: "visible" }}>
            <polyline points={pts} fill="none" stroke={d.stroke} strokeWidth={d.strokeWidth * props.scale} strokeLinecap="round" strokeLinejoin="round" />
          </svg>);
        } else if (el.type === "highlight") {
          body = <div style={{ width: "100%", height: "100%", background: (el as HighlightElement).color }} />;
        } else if (el.type === "underline") {
          body = <div style={{ width: "100%", height: Math.max(1, 2 * props.scale), marginTop: el.height * props.scale - 2 * props.scale, background: (el as HighlightElement).color }} />;
        } else if (el.type === "strikeout") {
          body = <div style={{ width: "100%", height: Math.max(1, 2 * props.scale), marginTop: (el.height * props.scale) / 2, background: (el as HighlightElement).color }} />;
        } else if (el.type === "squiggly") {
          body = (<svg width="100%" height="100%" style={{ overflow: "visible" }}>
            <polyline points={Array.from({ length: 10 }, (_, i) => `${i * (el.width / 9) * props.scale},${el.height * props.scale - (i % 2 === 0 ? 0 : 4 * props.scale)}`).join(" ")} fill="none" stroke={(el as HighlightElement).color} strokeWidth={1.6 * props.scale} />
          </svg>);
        } else if (el.type === "whiteout") {
          body = <div style={{ width: "100%", height: "100%", background: (el as { color: string }).color || "#ffffff" }} />;
        } else if (el.type === "image") {
          body = <img src={(el as ImageElement).src} draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill" }} />;
        } else if (el.type === "sticky") {
          const st = el as StickyElement;
          body = (<div style={{ width: "100%", height: "100%", background: st.color, border: "1px solid rgba(0,0,0,0.15)", borderRadius: 4, boxShadow: "0 2px 6px rgba(0,0,0,0.15)", padding: 4 * props.scale, overflow: "hidden" }}>
            <textarea value={st.note} onChange={(e2) => props.onUpdateElement(el.id, { note: e2.target.value })} onPointerDown={(e2) => e2.stopPropagation()} placeholder="Note…" style={{ width: "100%", height: "100%", background: "transparent", border: "none", outline: "none", resize: "none", fontSize: 11 * Math.max(1, props.scale), color: "#3F3300" }} />
          </div>);
        } else if (el.type === "field-text") {
          const f = el as FieldTextElement;
          body = <input value={f.value} placeholder={f.placeholder} onChange={(e2) => props.onUpdateElement(el.id, { value: e2.target.value })} onPointerDown={(e2) => e2.stopPropagation()} style={{ width: "100%", height: "100%", border: `${1.5 * props.scale}px solid #DC2626`, borderRadius: 4, background: "rgba(220,38,38,0.05)", fontSize: 12 * Math.max(1, props.scale), padding: `0 ${6 * props.scale}px`, outline: "none" }} />;
        } else if (el.type === "field-checkbox") {
          const f = el as FieldCheckboxElement;
          body = (<div onPointerDown={(e2) => { e2.stopPropagation(); props.onUpdateElement(el.id, { checked: !f.checked }); }} style={{ width: "100%", height: "100%", border: `${1.5 * props.scale}px solid #DC2626`, borderRadius: 3, background: f.checked ? "#DC2626" : "rgba(220,38,38,0.05)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            {f.checked && <Check style={{ width: "80%", height: "80%" }} className="text-white" />}
          </div>);
        } else if (el.type === "field-radio") {
          const f = el as FieldRadioElement;
          body = (<div onPointerDown={(e2) => { e2.stopPropagation(); props.onUpdateElement(el.id, { checked: !f.checked }); }} style={{ width: "100%", height: "100%", borderRadius: "50%", border: `${1.5 * props.scale}px solid #DC2626`, background: "rgba(220,38,38,0.05)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            {f.checked && <div style={{ width: "55%", height: "55%", borderRadius: "50%", background: "#DC2626" }} />}
          </div>);
        } else if (el.type === "field-dropdown") {
          const f = el as FieldDropdownElement;
          body = (<select value={f.value} onChange={(e2) => props.onUpdateElement(el.id, { value: e2.target.value })} onPointerDown={(e2) => e2.stopPropagation()} style={{ width: "100%", height: "100%", border: `${1.5 * props.scale}px solid #DC2626`, borderRadius: 4, background: "rgba(220,38,38,0.05)", fontSize: 12 * Math.max(1, props.scale) }}>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>);
        }

        return (
          <div key={el.id} style={style} onPointerDown={(e) => startMove(e, el)}
            className={cn(selected && props.activeTool === "select" && "outline outline-2 outline-[#DC2626] outline-offset-1")}>
            {body}
            {selected && props.activeTool === "select" && props.selectedIds.size === 1 && el.type !== "draw" && el.type !== "sticky" && !el.type.startsWith("field-") && (
              <div onPointerDown={(e) => startResize(e, el)} style={{ position: "absolute", right: -5, bottom: -5, width: 10, height: 10, borderRadius: 3, background: "#DC2626", cursor: "nwse-resize" }} />
            )}
            {canRotate && (<div onPointerDown={(e) => startRotate(e, el)} style={{ position: "absolute", left: "50%", top: -22, width: 10, height: 10, marginLeft: -5, borderRadius: "50%", background: "#DC2626", cursor: "grab" }} />)}
          </div>
        );
      })}

      {draft && (<div style={{ position: "absolute", left: draft.x * props.scale, top: draft.y * props.scale, width: draft.w * props.scale, height: draft.h * props.scale, border: "1.5px dashed #DC2626", background: props.activeTool === "highlight" ? "rgba(253,224,71,0.35)" : "rgba(220,38,38,0.06)", pointerEvents: "none" }} />)}
      {drawPoints && drawPoints.length > 1 && (
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none", overflow: "visible" }}>
          <polyline points={drawPoints.map((p) => `${p.x * props.scale},${p.y * props.scale}`).join(" ")} fill="none" stroke={props.drawStroke.color} strokeWidth={props.drawStroke.width * props.scale} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {marquee && (<div style={{ position: "absolute", left: marquee.x * props.scale, top: marquee.y * props.scale, width: marquee.w * props.scale, height: marquee.h * props.scale, border: "1px dashed #DC2626", background: "rgba(220,38,38,0.08)", pointerEvents: "none" }} />)}
      {eraserPos && (<div style={{ position: "absolute", left: (eraserPos.x - props.eraserSize) * props.scale, top: (eraserPos.y - props.eraserSize) * props.scale, width: props.eraserSize * 2 * props.scale, height: props.eraserSize * 2 * props.scale, borderRadius: "50%", border: "2px solid #DC2626", background: "rgba(220,38,38,0.08)", pointerEvents: "none" }} />)}
    </div>
  );
}

/* =========================================================  PROPERTIES PANEL  ========================================================= */
function ContextPropertiesPanel({ selectedElements, singleSelected, activeTool, eraserSize, onEraserSizeChange, onUpdateElement, onUpdateElements, onDeleteElements, onDuplicateElements, onImageReplace, onBringToFront, onSendToBack, onRotatePage, onDuplicatePage, onExtractPage, textPreviewFonts, onSetPreviewFont }: {
  selectedElements: AnyElement[]; singleSelected: AnyElement | null; activeTool: Tool;
  eraserSize: number; onEraserSizeChange: (n: number) => void;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (patch: Partial<AnyElement>) => void;
  onDeleteElements: () => void; onDuplicateElements: () => void; onImageReplace: () => void;
  onBringToFront: () => void; onSendToBack: () => void;
  onRotatePage: () => void; onDuplicatePage: () => void; onExtractPage: () => void;
  textPreviewFonts: Record<string, string>; onSetPreviewFont: (id: string, family: string) => void;
}) {
  const colorSwatches = ["#000000","#FFFFFF","#DC2626","#2563EB","#16A34A","#EAB308","#9333EA","#6B7280"];
  const filledShapes = ["rect","ellipse","triangle","star","rounded-rect","speech"];

  if (activeTool === "eraser") {
    return (
      <div className="p-4 space-y-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800 pb-2">Eraser</h3>
        <PropRow label="Eraser radius (PDF units)">
          <div className="flex items-center gap-2">
            <input type="range" min={5} max={60} value={eraserSize} onChange={(e) => onEraserSizeChange(Number(e.target.value))} className="flex-1 accent-[#DC2626]" />
            <span className="text-xs text-gray-500 w-5">{eraserSize}</span>
          </div>
        </PropRow>
        <p className="text-xs text-gray-400 leading-relaxed">Drag over freehand strokes to partially erase them. Other elements are unaffected.</p>
      </div>
    );
  }

  if (selectedElements.length > 1) {
    return (
      <div className="p-4 space-y-5">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800 pb-2">{selectedElements.length} elements selected</h3>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onDuplicateElements} className="rounded-md text-xs h-8"><Copy className="w-3.5 h-3.5 mr-1.5" /> Duplicate</Button>
          <Button variant="outline" size="sm" onClick={onDeleteElements} className="rounded-md text-xs h-8 border-red-200 text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete</Button>
        </div>
        <PropRow label="Layer order"><div className="grid grid-cols-2 gap-2"><Button variant="outline" size="sm" onClick={onBringToFront} className="rounded-md text-xs h-8">Bring forward</Button><Button variant="outline" size="sm" onClick={onSendToBack} className="rounded-md text-xs h-8">Send back</Button></div></PropRow>
        <PropRow label="Opacity"><input type="range" min={0.1} max={1} step={0.05} onChange={(e) => onUpdateElements({ opacity: Number(e.target.value) })} className="w-full accent-[#DC2626]" /></PropRow>
      </div>
    );
  }

  if (singleSelected) {
    const el = singleSelected;
    const isShape = ["rect","ellipse","line","arrow","triangle","star","rounded-rect","speech"].includes(el.type);
    const title = el.type === "text" ? "Text" : el.type === "image" ? "Image" : el.type === "draw" ? "Drawing" : isShape ? "Shape" : el.type === "sticky" ? "Sticky note" : ["highlight","underline","strikeout","squiggly"].includes(el.type) ? "Highlight" : "Element";

    return (
      <div className="p-4 space-y-5">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{title}</h3>
          <div className="flex items-center gap-0.5">
            <button onClick={onDuplicateElements} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500" title="Duplicate"><Copy className="w-3.5 h-3.5" /></button>
            <button onClick={onDeleteElements} className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        {el.type === "text" && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1.5">Font style</div>
              <select value={textPreviewFonts[el.id] || (el as TextElement).font} onChange={(e) => onSetPreviewFont(el.id, e.target.value)} className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:border-[#DC2626]">
                <optgroup label="Standard">{SYSTEM_FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
                <optgroup label="Google Fonts">{GOOGLE_FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
              </select>
            </div>
            <div className="flex gap-2">
              <select value={(el as TextElement).font} onChange={(e) => onUpdateElement(el.id, { font: e.target.value as TextElement["font"] })} className="flex-1 h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:border-[#DC2626]">
                {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f === "TimesRoman" ? "Times New Roman" : f} (PDF)</option>)}
              </select>
              <input type="number" min={6} max={96} value={(el as TextElement).fontSize} onChange={(e) => onUpdateElement(el.id, { fontSize: Number(e.target.value) })} className="w-14 h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-1 text-xs text-center focus:outline-none focus:border-[#DC2626]" />
            </div>
            <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-800 p-1 rounded-md border border-gray-200 dark:border-gray-700">
              {[["bold","B",Bold],["italic","I",Italic],["underline","U",UnderlineIcon]].map(([k, , Icon]: any) => (
                <button key={k} onClick={() => onUpdateElement(el.id, { [k]: !(el as TextElement)[k as keyof TextElement] })} className={cn("flex-1 h-7 rounded flex items-center justify-center", (el as TextElement)[k as keyof TextElement] ? "bg-white dark:bg-gray-700 text-[#DC2626] shadow-sm" : "text-gray-500")}><Icon className="w-3.5 h-3.5" /></button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-800 p-1 rounded-md border border-gray-200 dark:border-gray-700">
              {[["left",AlignLeft],["center",AlignCenter],["right",AlignRight]].map(([a, Icon]: any) => (
                <button key={a} onClick={() => onUpdateElement(el.id, { align: a })} className={cn("flex-1 h-7 rounded flex items-center justify-center", (el as TextElement).align === a ? "bg-white dark:bg-gray-700 text-[#DC2626] shadow-sm" : "text-gray-500")}><Icon className="w-3.5 h-3.5" /></button>
              ))}
            </div>
          </div>
        )}

        {el.type === "image" && <Button onClick={onImageReplace} variant="outline" className="w-full rounded-md text-xs h-8">Replace image</Button>}

        {(el.type === "draw" || isShape) && (
          <div className="space-y-4">
            <PropRow label="Stroke width"><input type="number" min={1} max={20} value={(el as DrawElement | ShapeElement).strokeWidth} onChange={(e) => onUpdateElement(el.id, { strokeWidth: Number(e.target.value) })} className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 text-xs outline-none focus:border-[#DC2626]" /></PropRow>
            {isShape && filledShapes.includes(el.type) && (
              <PropRow label="Fill color">
                <div className="flex items-center gap-2">
                  <input type="color" value={(el as ShapeElement).fill ?? "#ffffff"} onChange={(e) => onUpdateElement(el.id, { fill: e.target.value })} className="w-8 h-8 rounded cursor-pointer border border-gray-200 p-0.5" />
                  <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={(el as ShapeElement).fill === null} onChange={(e) => onUpdateElement(el.id, { fill: e.target.checked ? null : "#ffffff" })} className="accent-[#DC2626]" /> No fill</label>
                </div>
              </PropRow>
            )}
          </div>
        )}

        {el.type !== "image" && (
          <PropRow label="Color">
            <div className="flex items-center gap-2">
              <input type="color" value={(el as TextElement).color || (el as ShapeElement).stroke || (el as HighlightElement).color || "#000000"}
                onChange={(e) => {
                  if (el.type === "text" || el.type.startsWith("field-") || ["squiggly","strikeout","underline","highlight"].includes(el.type)) onUpdateElement(el.id, { color: e.target.value });
                  else onUpdateElement(el.id, { stroke: e.target.value });
                }} className="w-8 h-8 rounded-full cursor-pointer border border-gray-200 p-0.5 shrink-0" />
              <div className="flex-1 flex flex-wrap gap-1.5">
                {colorSwatches.map((color) => (
                  <button key={color} onClick={() => {
                    if (el.type === "text" || el.type.startsWith("field-") || ["squiggly","strikeout","underline","highlight"].includes(el.type)) onUpdateElement(el.id, { color });
                    else onUpdateElement(el.id, { stroke: color });
                  }} className="w-5 h-5 rounded-full border border-gray-200 hover:scale-110 transition-transform" style={{ background: color }} />
                ))}
              </div>
            </div>
          </PropRow>
        )}

        <PropRow label="Opacity"><input type="range" min={0.1} max={1} step={0.05} value={el.opacity} onChange={(e) => onUpdateElement(el.id, { opacity: Number(e.target.value) })} className="w-full accent-[#DC2626]" /></PropRow>
        {el.type !== "draw" && el.type !== "sticky" && !el.type.startsWith("field-") && !["highlight","underline","strikeout","squiggly"].includes(el.type) && (
          <PropRow label="Rotation">
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={359} value={el.rotation} onChange={(e) => onUpdateElement(el.id, { rotation: Number(e.target.value) })} className="flex-1 accent-[#DC2626]" />
              <span className="text-xs text-gray-500 w-9 text-right tabular-nums">{el.rotation}°</span>
            </div>
          </PropRow>
        )}
        <PropRow label="Layer order"><div className="grid grid-cols-2 gap-2"><Button variant="outline" size="sm" onClick={onBringToFront} className="rounded-md text-xs h-8">Bring forward</Button><Button variant="outline" size="sm" onClick={onSendToBack} className="rounded-md text-xs h-8">Send back</Button></div></PropRow>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      <div><h3 className="text-sm font-semibold mb-1">Edit PDF</h3><p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">Use the toolbar to add text, images, and annotations. Select any element to edit its properties here.</p></div>
      <div>
        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Page actions</h4>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <Button variant="outline" size="sm" onClick={onRotatePage} className="rounded-md text-xs h-8"><RotateCw className="w-3.5 h-3.5 mr-1.5" /> Rotate</Button>
          <Button variant="outline" size="sm" onClick={onDuplicatePage} className="rounded-md text-xs h-8"><Copy className="w-3.5 h-3.5 mr-1.5" /> Duplicate</Button>
        </div>
        <Button variant="outline" size="sm" onClick={onExtractPage} className="w-full rounded-md text-xs h-8"><Download className="w-3.5 h-3.5 mr-1.5" /> Extract current page</Button>
      </div>
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{label}</div>{children}</div>;
}

/* =========================================================  SIGNATURE MODAL — fixed, self-contained, smooth drawing  ========================================================= */
function SignatureModal({ onInsert, onCancel, savedSignatures, onDeleteSaved }: {
  onInsert: (src: string, save: boolean) => void; onCancel: () => void;
  savedSignatures: SavedSignature[]; onDeleteSaved: (id: string) => void;
}) {
  const [tab, setTab] = useState<"draw" | "type" | "saved">("draw");
  const [typedName, setTypedName] = useState("");
  const [sigFont, setSigFont] = useState("Dancing Script");
  const [sigColor, setSigColor] = useState("#111827");
  const [sigSize, setSigSize] = useState(52);
  const [saveAfterInsert, setSaveAfterInsert] = useState(true);
  const [hasDrawing, setHasDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Load Google Fonts for signatures
  useEffect(() => {
    SIG_FONTS.forEach(({ family }) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;700&display=swap`;
      document.head.appendChild(link);
    });
  }, []);

  function getPointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    isDrawing.current = true;
    const pos = getPointerPos(e);
    lastPos.current = pos;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.strokeStyle = sigColor; ctx.fillStyle = sigColor;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    // Draw initial dot so single taps are visible
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
    setHasDrawing(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current || !lastPos.current) return;
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const pos = getPointerPos(e);
    // Smooth with midpoint quadratic bezier — eliminates jagged lines
    const midX = (lastPos.current.x + pos.x) / 2;
    const midY = (lastPos.current.y + pos.y) / 2;
    ctx.strokeStyle = sigColor;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.quadraticCurveTo(lastPos.current.x, lastPos.current.y, midX, midY);
    ctx.stroke();
    lastPos.current = pos;
  }

  function onPointerUp() { isDrawing.current = false; lastPos.current = null; }

  function clearCanvas() {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawing(false);
  }

  async function handleInsert() {
    if (tab === "draw") {
      if (!hasDrawing) { toast.error("Please draw your signature first."); return; }
      const canvas = canvasRef.current; if (!canvas) return;
      onInsert(canvas.toDataURL("image/png"), saveAfterInsert);
    } else if (tab === "type") {
      const name = typedName.trim() || "Signature";
      const canvas = document.createElement("canvas");
      canvas.width = 480; canvas.height = 140;
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      await document.fonts.ready;
      ctx.font = `${sigSize}px '${sigFont}', cursive`;
      ctx.fillStyle = sigColor; ctx.textBaseline = "middle";
      const w = ctx.measureText(name).width;
      ctx.fillText(name, Math.max(8, (480 - w) / 2), 70);
      onInsert(canvas.toDataURL("image/png"), saveAfterInsert);
    }
  }

  return (
    <div className="fixed inset-0 z-[999999] grid place-items-center bg-black/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-2xl" onClick={(e: ReactMouseEvent) => e.stopPropagation()}>
        <div className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">Add signature</div>

        <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-800">
          {(["draw","type","saved"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("flex-1 pb-2 text-sm font-semibold transition-all border-b-2", tab === t ? "border-[#DC2626] text-[#DC2626]" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300")}>
              {t === "saved" ? `Saved (${savedSignatures.length})` : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "draw" && (
          <div>
            <canvas ref={canvasRef} width={460} height={160}
              className="w-full cursor-crosshair rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
              style={{ touchAction: "none" }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
            />
            <div className="mt-3 flex items-center gap-3">
              <label className="text-xs text-gray-500">Ink color</label>
              <input type="color" value={sigColor} onChange={(e) => setSigColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-gray-200" />
              <button onClick={clearCanvas} className="ml-auto text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 font-medium">Clear</button>
            </div>
          </div>
        )}

        {tab === "type" && (
          <div className="space-y-4">
            <input autoFocus value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Type your name"
              className="w-full h-16 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 text-center focus:outline-none focus:border-[#DC2626] transition-colors"
              style={{ fontFamily: `'${sigFont}', cursive`, fontSize: Math.min(sigSize * 0.7, 42), color: sigColor }} />
            <div>
              <div className="text-xs font-medium text-gray-500 mb-2">Style</div>
              <div className="grid grid-cols-3 gap-2">
                {SIG_FONTS.map((f) => (
                  <button key={f.family} onClick={() => setSigFont(f.family)}
                    className={cn("py-3 px-2 rounded-lg border text-center transition-all overflow-hidden min-h-[56px]", sigFont === f.family ? "border-[#DC2626] bg-red-50 dark:bg-red-900/20" : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800")}
                    style={{ fontFamily: `'${f.family}', cursive`, fontSize: 22, color: sigColor }}>
                    {typedName || "Sign"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs text-gray-500">Color</label>
              <input type="color" value={sigColor} onChange={(e) => setSigColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-gray-200" />
              <label className="text-xs text-gray-500 ml-2">Size</label>
              <input type="range" min={24} max={80} value={sigSize} onChange={(e) => setSigSize(Number(e.target.value))} className="flex-1 min-w-[80px] accent-[#DC2626]" />
            </div>
          </div>
        )}

        {tab === "saved" && (
          <div className="grid max-h-64 grid-cols-2 gap-3 overflow-auto">
            {savedSignatures.length === 0 && <div className="col-span-2 py-8 text-center text-sm text-gray-500">No saved signatures yet.</div>}
            {savedSignatures.map((s) => (
              <div key={s.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2">
                <img src={s.src} alt="Saved signature" className="h-16 w-full object-contain mb-2" />
                <div className="flex gap-1">
                  <button onClick={() => onInsert(s.src, false)} className="flex-1 py-1.5 rounded bg-[#DC2626] text-xs font-bold text-white hover:bg-[#B91C1C]">Insert</button>
                  <button onClick={() => onDeleteSaved(s.id)} className="w-8 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab !== "saved" && (
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={saveAfterInsert} onChange={(e) => setSaveAfterInsert(e.target.checked)} className="accent-[#DC2626] w-4 h-4" /> Save signature for later
          </label>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} className="rounded-lg border-gray-300 dark:border-gray-700 font-semibold">Cancel</Button>
          {tab !== "saved" && <Button onClick={handleInsert} className="rounded-lg bg-[#DC2626] text-white hover:bg-[#B91C1C] font-bold px-6">Insert</Button>}
        </div>
      </div>
    </div>
  );
}

/* =========================================================  SUCCESS SCREEN  ========================================================= */
function SuccessScreen({ result, onDownload, onEditAgain, onNewFile }: { result: { blob: Blob; filename: string; thumb: string | null; pages: number }; onDownload: () => void; onEditAgain: () => void; onNewFile: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="max-w-2xl mx-auto overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl">
      <div className="border-b border-gray-200 dark:border-gray-800 bg-red-50/50 dark:bg-red-900/10 px-8 py-6">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-[#DC2626] text-white shadow-sm"><FileCheck2 className="h-7 w-7" /></div>
          <div>
            <div className="text-2xl font-bold">PDF ready to download</div>
            <div className="text-sm text-gray-500 mt-1">{result.filename} · {formatBytes(result.blob.size)} · {result.pages} pages</div>
          </div>
        </div>
      </div>
      <div className="grid gap-8 p-8 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4 flex items-center justify-center">
          {result.thumb ? <img src={result.thumb} alt="Page 1 preview" className="max-h-[380px] object-contain shadow-lg rounded border border-gray-200 bg-white" /> : <div className="text-sm text-gray-500">Preview unavailable</div>}
        </div>
        <div className="flex flex-col gap-3 justify-center">
          <Button size="lg" onClick={onDownload} className="w-full rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white font-bold h-14 shadow-md text-base"><Download className="mr-2 h-5 w-5" /> Download PDF</Button>
          <div className="h-px bg-gray-100 dark:bg-gray-800 my-2" />
          <Button size="lg" variant="outline" onClick={onEditAgain} className="w-full rounded-lg border-gray-300 dark:border-gray-700 font-semibold h-12">Continue editing</Button>
          <Button size="lg" variant="ghost" onClick={onNewFile} className="w-full rounded-lg text-gray-500 font-semibold h-12">Upload new file</Button>
        </div>
      </div>
    </motion.div>
  );
}