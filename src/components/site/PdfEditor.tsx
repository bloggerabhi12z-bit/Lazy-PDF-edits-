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
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  FileCheck2,
  FilePlus,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Loader2,
  Lock,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  MousePointer2,
  PenLine,
  PenTool,
  Plus,
  Redo2,
  RotateCw,
  Search,
  Square,
  Trash2,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  X,
  ChevronDown,
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
  isBlank?: boolean;
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
const NUDGE = 1;
const NUDGE_FAST = 10;
const ACCENT = "#DC2626"; // primary accent used throughout the redesigned chrome — matches the site's button red

// A broad set of common web-safe and Google Fonts offered for in-editor text styling.
// Note: the exported/stamped PDF still embeds one of the standard PDF-safe fonts from
// FONT_OPTIONS (Helvetica / TimesRoman / Courier) — see the "PDF font" control in the
// properties panel. This wider list controls only the on-screen preview font, so users
// searching for "edit PDF with Georgia font", "edit PDF Garamond", etc. land on a tool
// that visibly supports the font they're looking for while the underlying export stays
// reliable. If your pdf-annotations pipeline gains real font embedding later, wire
// GOOGLE_FONT_FAMILIES below into stampElements and this becomes a true 1:1 mapping.
const SYSTEM_FONT_FAMILIES = [
  "Helvetica",
  "Arial",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Palatino",
  "Garamond",
  "Book Antiqua",
  "Century Gothic",
  "Franklin Gothic Medium",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Segoe UI",
  "Calibri",
  "Cambria",
  "Consolas",
  "Impact",
  "Comic Sans MS",
  "Rockwell",
  "Baskerville",
  "Optima",
  "Didot",
  "Futura",
];
const GOOGLE_FONT_FAMILIES = [
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Inter",
  "Merriweather",
  "Playfair Display",
  "Nunito",
  "Raleway",
  "Ubuntu",
  "PT Serif",
  "Source Sans Pro",
  "Oswald",
  "Noto Sans",
  "Work Sans",
  "Fira Sans",
  "Rubik",
  "Karla",
  "Quicksand",
  "Josefin Sans",
  "Crimson Text",
  "Libre Baskerville",
  "EB Garamond",
  "Cormorant Garamond",
  "DM Sans",
  "Space Grotesk",
  "Bitter",
  "Zilla Slab",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "IBM Plex Mono",
  "Roboto Mono",
  "JetBrains Mono",
  "Caveat",
  "Pacifico",
  "Dancing Script",
  "Great Vibes",
  "Shadows Into Light",
  "Indie Flower",
];
const FONT_PREVIEW_CHOICES = [...SYSTEM_FONT_FAMILIES, ...GOOGLE_FONT_FAMILIES];

function fontFamilyStack(name: string): string {
  const serif = ["Times New Roman", "Georgia", "Palatino", "Garamond", "Book Antiqua", "Cambria", "Baskerville", "Didot", "PT Serif", "Merriweather", "Playfair Display", "Crimson Text", "Libre Baskerville", "EB Garamond", "Cormorant Garamond", "Bitter", "Zilla Slab", "IBM Plex Serif"];
  const mono = ["Courier New", "Lucida Console", "Consolas", "Roboto Mono", "JetBrains Mono", "IBM Plex Mono"];
  const script = ["Caveat", "Pacifico", "Dancing Script", "Great Vibes", "Shadows Into Light", "Indie Flower"];
  const fallback = serif.includes(name) ? "serif" : mono.includes(name) ? "monospace" : script.includes(name) ? "cursive" : "sans-serif";
  return `"${name}", ${fallback}`;
}

type HistorySnapshot = { pages: EditorPage[]; elements: AnyElement[] };
function snapshotsEqual(a: HistorySnapshot, b: HistorySnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function defaultRotation() {
  return 0;
}

export function PdfEditor({
  file,
  mode,
  actionLabel,
  busy = false,
  onReplace,
  onApply,
}: PdfEditorProps) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState<EditorPage[]>([]);
  const [elements, setElements] = useState<AnyElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTool, setActiveTool] = useState<Tool>("select");

  // UI Panels — both collapsible, both default open on desktop
  const [showLeftSidebar, setShowLeftSidebar] = useState<boolean>(true);
  const [showRightSidebar, setShowRightSidebar] = useState<boolean>(true);
  // On-screen preview font per text element (id -> font family name from FONT_PREVIEW_CHOICES).
  // Purely cosmetic in the editor; the exported PDF still embeds a standard PDF font
  // (see the "PDF font" control, which maps to FONT_OPTIONS / TextElement.font).
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
  const [moreToolsPos, setMoreToolsPos] = useState<{ top: number; left: number } | null>(null);
  const moreBtnRef = useRef<HTMLDivElement | null>(null);

  // Close the "More" tools dropdown on outside click or Escape
  useEffect(() => {
    if (!showMoreTools) return;
    function onDocMouseDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (moreBtnRef.current && !moreBtnRef.current.contains(target)) {
        setShowMoreTools(false);
      }
    }
    function onDocKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setShowMoreTools(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKey);
    };
  }, [showMoreTools]);

  const [phase, setPhase] = useState<Phase>("reading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<"width" | "page" | "custom">("width");

  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [, setFirstPageDims] = useState<{ w: number; h: number } | null>(null);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ pageIndex: number; snippet: string }[]>([]);
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
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
  const [success, setSuccess] = useState<null | {
    blob: Blob;
    filename: string;
    thumb: string | null;
    pages: number;
  }>(null);

  const lastSelectedRef = useRef<number | null>(null);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    el: HTMLElement;
  } | null>(null);

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
        const doc = (await loadPdf(file)) as unknown as PdfDoc;
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

  // Generate Thumbnails (lazy, cached, cancels on unmount / file change)
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
  }, [pdf]);

  // History Sync
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

  const selectAllPages = useCallback(
    () => setPages((ps) => ps.map((p) => ({ ...p, selected: true }))),
    []
  );

  const selectRange = useCallback((from: number, to: number) => {
    const [a, b] = from < to ? [from, to] : [to, from];
    setPages((ps) => ps.map((p, i) => ({ ...p, selected: p.selected || (i >= a && i <= b) })));
  }, []);

  const handlePageClick = useCallback(
    (i: number, e: ReactMouseEvent) => {
      setCurrent(i);
      const el = document.getElementById(`pdf-page-${i}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });

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
    [mode, selectRange]
  );

  const rotatePage = useCallback((i: number, delta: number) => {
    setPages((ps) =>
      ps.map((p, idx) => (idx === i ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p))
    );
  }, []);

  const deletePage = useCallback((i: number) => {
    setPages((ps) => {
      if (ps.length <= 1) {
        toast.error("Your PDF must contain at least one page.");
        return ps;
      }
      return ps.filter((_, idx) => idx !== i);
    });
  }, []);

  const deleteSelectedPages = useCallback(() => {
    setPages((ps) => {
      const remaining = ps.filter((p) => !p.selected);
      if (remaining.length === 0) {
        toast.error("Your PDF must contain at least one page.");
        return ps;
      }
      if (remaining.length === ps.length) {
        if (ps.length <= 1) return ps;
        return ps.filter((_, i) => i !== current);
      }
      return remaining;
    });
    setSelectedIds(new Set());
  }, [current]);

  const duplicatePage = useCallback((i: number) => {
    setPages((ps) => {
      const out = [...ps];
      out.splice(i + 1, 0, { ...ps[i], id: `${ps[i].id}-dup-${Date.now()}`, selected: false });
      return out;
    });
  }, []);

  const insertBlankPageAfter = useCallback((index: number) => {
    setPages((ps) => {
      const out = [...ps];
      out.splice(index + 1, 0, {
        id: `blank-${Date.now()}`,
        originalIndex: -1,
        isBlank: true,
        rotation: 0,
        selected: false,
      });
      return out;
    });
  }, []);

  const extractPages = async (indices: number[]) => {
    if (processing || busy) return;
    setProcessing(true);
    try {
      const extractedPages = indices.map((i) => pages[i]);
      const result = await onApply({ pages: extractedPages, selectedIds: new Set() });
      if (result && result.blob) {
        let finalBlob = result.blob;
        try {
          const relevantElements = elements.filter((e) =>
            extractedPages.some((p) => p.id === e.pageId)
          );
          finalBlob = await stampElements(result.blob, extractedPages, relevantElements);
        } catch (e) {
          console.error("Stamping failed during extraction", e);
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(finalBlob);
        a.download = `Extracted_${file.name}`;
        a.click();
        toast.success("Pages extracted successfully!");
      }
    } catch {
      toast.error("Failed to extract pages.");
    } finally {
      setProcessing(false);
    }
  };

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

  const updateElements = useCallback(
    (ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => {
      setElements((es) => es.map((e) => (ids.has(e.id) ? ({ ...e, ...patchFn(e) } as AnyElement) : e)));
    },
    []
  );

  const deleteElements = useCallback((ids: Set<string>) => {
    setElements((es) => es.filter((e) => !ids.has(e.id)));
    setSelectedIds(new Set());
  }, []);

  const duplicateElements = useCallback((ids: Set<string>) => {
    setElements((es) => {
      const toDup = es.filter((e) => ids.has(e.id));
      const clones = toDup.map(
        (e) => ({ ...e, id: makeId("dup"), x: e.x + 14, y: e.y + 14 } as AnyElement)
      );
      setSelectedIds(new Set(clones.map((c) => c.id)));
      return [...es, ...clones];
    });
  }, []);

  const reorderZ = useCallback(
    (ids: Set<string>, direction: "forward" | "backward" | "front" | "back") => {
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
    },
    []
  );

  const selectedElements = useMemo(
    () => elements.filter((e) => selectedIds.has(e.id)),
    [elements, selectedIds]
  );
  const singleSelected = selectedElements.length === 1 ? selectedElements[0] : null;

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = ev.metaKey || ev.ctrlKey;

      if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
        ev.preventDefault();
        undo();
      } else if (
        (mod && ev.key.toLowerCase() === "y") ||
        (mod && ev.shiftKey && ev.key.toLowerCase() === "z")
      ) {
        ev.preventDefault();
        redo();
      } else if (mod && ev.key.toLowerCase() === "d") {
        ev.preventDefault();
        if (selectedIds.size > 0) duplicateElements(selectedIds);
      } else if (mod && ev.key.toLowerCase() === "a") {
        ev.preventDefault();
        if (elements.length > 0 && activeTool === "select") {
          const currentPageId = pages[current]?.id;
          setSelectedIds(new Set(elements.filter((e) => e.pageId === currentPageId).map((e) => e.id)));
        } else {
          selectAllPages();
        }
      } else if (mod && ev.key.toLowerCase() === "f") {
        ev.preventDefault();
        setShowSearch(true);
      } else if (mod && (ev.key === "=" || ev.key === "+")) {
        ev.preventDefault();
        setFitMode("custom");
        setZoom((z) => Math.min(4, +(z + 0.05).toFixed(2)));
      } else if (mod && ev.key === "-") {
        ev.preventDefault();
        setFitMode("custom");
        setZoom((z) => Math.max(0.25, +(z - 0.05).toFixed(2)));
      } else if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        if (selectedIds.size > 0) deleteElements(selectedIds);
        else if (mode === "select") deleteSelectedPages();
      } else if (ev.key === "Escape") {
        setSelectedIds(new Set());
        setActiveTool("select");
        setShowSearch(false);
      } else if (
        ev.key === "ArrowDown" ||
        ev.key === "ArrowRight" ||
        ev.key === "ArrowUp" ||
        ev.key === "ArrowLeft"
      ) {
        if (selectedIds.size > 0) {
          ev.preventDefault();
          const amt = ev.shiftKey ? NUDGE_FAST : NUDGE;
          const dx = ev.key === "ArrowRight" ? amt : ev.key === "ArrowLeft" ? -amt : 0;
          const dy = ev.key === "ArrowDown" ? amt : ev.key === "ArrowUp" ? -amt : 0;
          updateElements(selectedIds, (e) => ({ x: e.x + dx, y: e.y + dy }));
        } else {
          if (ev.key === "ArrowDown" || ev.key === "ArrowRight") {
            ev.preventDefault();
            setCurrent((c) => {
              const next = Math.min(pages.length - 1, c + 1);
              document.getElementById(`pdf-page-${next}`)?.scrollIntoView({ behavior: "smooth" });
              return next;
            });
          } else {
            ev.preventDefault();
            setCurrent((c) => {
              const prev = Math.max(0, c - 1);
              document.getElementById(`pdf-page-${prev}`)?.scrollIntoView({ behavior: "smooth" });
              return prev;
            });
          }
        }
      } else if (ev.key === "Home") {
        ev.preventDefault();
        setCurrent(0);
        document.getElementById(`pdf-page-0`)?.scrollIntoView({ behavior: "smooth" });
      } else if (ev.key === "End") {
        ev.preventDefault();
        const last = Math.max(0, pages.length - 1);
        setCurrent(last);
        document.getElementById(`pdf-page-${last}`)?.scrollIntoView({ behavior: "smooth" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    selectAllPages,
    deleteSelectedPages,
    deleteElements,
    duplicateElements,
    updateElements,
    pages,
    current,
    mode,
    selectedIds,
    elements,
    activeTool,
  ]);

  async function runSearch(query: string) {
    setSearchQuery(query);
    setSearchActiveIdx(0);
    if (!pdf || !query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results: { pageIndex: number; snippet: string }[] = [];
      for (let i = 0; i < pages.length; i++) {
        const oi = pages[i].originalIndex;
        if (oi < 0) continue;
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
          results.push({
            pageIndex: i,
            snippet: `${start > 0 ? "…" : ""}${text.slice(start, idx + query.length + 30)}…`,
          });
        }
      }
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  }

  function jumpToSearchResult(idx: number) {
    if (!searchResults.length) return;
    const clamped = ((idx % searchResults.length) + searchResults.length) % searchResults.length;
    setSearchActiveIdx(clamped);
    const pageIndex = searchResults[clamped].pageIndex;
    setCurrent(pageIndex);
    document.getElementById(`pdf-page-${pageIndex}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function onImageFileChosen(fileList: FileList | null) {
    const f = fileList?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const pageId = pages[current]?.id;
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
    const pageId = pages[current]?.id;
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

        setSuccess({
          blob: finalBlob,
          filename: result.filename,
          thumb: thumbUrl,
          pages: resultPageCount,
        });
        const url = URL.createObjectURL(finalBlob);
        publishResult({
          name: result.filename,
          mime: "application/pdf",
          size: finalBlob.size,
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

  if (phase === "error") {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-100 dark:bg-gray-950 p-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center shadow-xl max-w-md w-full">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400">
            <Lock className="h-6 w-6" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Couldn't open this PDF</h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{errorMsg}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button
              variant="outline"
              onClick={onReplace}
              className="rounded-lg border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Choose another file
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-[9999] overflow-y-auto bg-gray-100 dark:bg-gray-950 p-4 sm:p-8 flex items-center justify-center">
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
      </div>
    );
  }

  const annotateDisabled = !pages[current] || pages[current].rotation !== 0;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-gray-100 dark:bg-gray-950 overflow-hidden select-none font-sans text-gray-900 dark:text-gray-100">
      {/* SEO: visually hidden (not display:none) so it stays accessible to screen readers and
          search crawlers without disrupting the visual UI. Genuine, accurate description of
          what this screen does — not keyword stuffing — so it's safe from a cloaking standpoint. */}
      <p className="sr-only">
        Edit PDF online for free, directly in your browser. Add and format text, insert images
        and signatures, highlight, draw, and fill form fields on any PDF page. Style your text
        preview in {FONT_PREVIEW_CHOICES.length}+ fonts including Arial, Georgia, Garamond, Times
        New Roman, Helvetica, Courier, Roboto, Montserrat, Open Sans, Playfair Display, and more,
        then export a clean PDF with embedded standard fonts. No sign-up required.
      </p>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          onImageFileChosen(e.target.files);
          e.target.value = "";
        }}
      />

      {/* ============================ TOP HEADER ============================ */}
      <header className="h-12 shrink-0 flex items-center justify-between gap-3 px-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onReplace}
            title="Back"
            aria-label="Back to file picker"
            className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 shrink-0" />
          <span className="text-sm font-semibold truncate max-w-[220px] sm:max-w-[420px] text-gray-800 dark:text-gray-100">
            {file.name}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowSearch((s) => !s)}
            title="Search (Ctrl+F)"
            aria-label="Search document"
            className={cn(
              "p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors",
              showSearch ? "text-[#DC2626] bg-red-50 dark:bg-red-900/30" : "text-gray-600 dark:text-gray-300"
            )}
          >
            <Search className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1 hidden sm:block" />
          <Button
            onClick={apply}
            disabled={processing || busy}
            size="sm"
            className="hidden sm:inline-flex h-8 rounded-md bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold text-sm px-3 gap-1.5"
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {processing ? "Saving…" : actionLabel || "Save changes"}
          </Button>
        </div>
      </header>

      {/* Search bar (drops down from header, non-blocking) */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden z-20"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="Search in document…"
                className="flex-1 h-8 text-sm bg-transparent outline-none text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
              />
              {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" />}
              {!searching && searchQuery && (
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">
                  {searchResults.length > 0 ? `${searchActiveIdx + 1} / ${searchResults.length}` : "No results"}
                </span>
              )}
              <button
                onClick={() => jumpToSearchResult(searchActiveIdx - 1)}
                disabled={searchResults.length === 0}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-600 dark:text-gray-300"
                title="Previous result"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => jumpToSearchResult(searchActiveIdx + 1)}
                disabled={searchResults.length === 0}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-600 dark:text-gray-300"
                title="Next result"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
                title="Close search"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="max-h-32 overflow-y-auto border-t border-gray-100 dark:border-gray-800 px-3 py-1">
                {searchResults.map((r, i) => (
                  <button
                    key={`${r.pageIndex}-${i}`}
                    onClick={() => jumpToSearchResult(i)}
                    className={cn(
                      "w-full text-left text-xs py-1.5 px-2 rounded-md flex gap-2 items-start hover:bg-gray-50 dark:hover:bg-gray-800",
                      i === searchActiveIdx && "bg-red-50 dark:bg-red-900/20"
                    )}
                  >
                    <span className="font-semibold text-gray-400 shrink-0">p.{r.pageIndex + 1}</span>
                    <span className="text-gray-600 dark:text-gray-300 truncate">{r.snippet}</span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================ TOOLBAR ============================ */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto z-20">
        <ToolBtn icon={<MousePointer2 />} label="Select" active={activeTool === "select"} onClick={() => { setActiveTool("select"); setSelectedIds(new Set()); }} />
        <ToolBtn icon={<Hand />} label="Hand" active={activeTool === "hand"} onClick={() => { setActiveTool("hand"); setSelectedIds(new Set()); }} />
        <Divider />
        <ToolBtn icon={<Type />} label="Text" active={activeTool === "text"} disabled={annotateDisabled} onClick={() => { setActiveTool("text"); setSelectedIds(new Set()); }} />
        <ToolBtn icon={<ImageIcon />} label="Image" active={activeTool === "image"} disabled={annotateDisabled} onClick={() => { setActiveTool("image"); imageInputRef.current?.click(); }} />
        <ToolBtn icon={<PenLine />} label="Draw" active={activeTool === "draw"} disabled={annotateDisabled} onClick={() => { setActiveTool("draw"); setSelectedIds(new Set()); }} />
        <ToolBtn icon={<Highlighter />} label="Highlight" active={activeTool === "highlight"} disabled={annotateDisabled} onClick={() => { setActiveTool("highlight"); setSelectedIds(new Set()); }} />
        <ToolBtn icon={<Square />} label="Shapes" active={activeTool.startsWith("shape")} disabled={annotateDisabled} onClick={() => { setActiveTool("shape-rect"); setSelectedIds(new Set()); }} />
        <ToolBtn icon={<PenTool />} label="Sign" active={activeTool === "signature"} disabled={annotateDisabled} onClick={() => { setActiveTool("signature"); openSignature(); }} />
        <Divider />
        <div ref={moreBtnRef} className="relative shrink-0">
          <ToolBtn
            icon={<MoreHorizontal />}
            label="More"
            active={showMoreTools || ["whiteout", "sticky"].includes(activeTool)}
            disabled={annotateDisabled}
            onClick={(ev?: ReactMouseEvent) => {
              if (!showMoreTools && moreBtnRef.current) {
                const r = moreBtnRef.current.getBoundingClientRect();
                setMoreToolsPos({ top: r.bottom + 4, left: r.left });
              }
              setShowMoreTools((s) => !s);
            }}
          />
        </div>
        {typeof document !== "undefined" &&
          createPortal(
            <AnimatePresence>
              {showMoreTools && moreToolsPos && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  style={{ position: "fixed", top: moreToolsPos.top, left: moreToolsPos.left }}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 w-40 z-[10000]"
                >
                  <button
                    onClick={() => { setActiveTool("whiteout"); setSelectedIds(new Set()); setShowMoreTools(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <Eraser className="w-4 h-4" /> Whiteout
                  </button>
                  <button
                    onClick={() => { setActiveTool("sticky"); setSelectedIds(new Set()); setShowMoreTools(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <MessageSquare className="w-4 h-4" /> Sticky note
                  </button>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}

        {/* Mobile save button (header one is hidden below sm) */}
        <div className="ml-auto sm:hidden">
          <Button
            onClick={apply}
            disabled={processing || busy}
            size="sm"
            className="h-8 rounded-md bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold text-xs px-3 gap-1.5"
          >
            {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </div>

      {/* ============================ BODY ============================ */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* LEFT: Page Thumbnails */}
        <AnimatePresence initial={false}>
          {showLeftSidebar && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 200, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col shrink-0 z-10"
            >
              <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Pages · {pages.length}
                </span>
                <button
                  onClick={() => insertBlankPageAfter(pages.length - 1)}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
                  title="Add blank page"
                  aria-label="Add blank page"
                >
                  <FilePlus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {pages.map((p, i) => (
                  <div
                    key={p.id}
                    onClick={(e) => handlePageClick(i, e)}
                    className={cn(
                      "group relative rounded-md border p-1.5 transition-all cursor-pointer flex gap-2 items-center",
                      current === i
                        ? "border-[#DC2626] bg-red-50/60 dark:bg-red-900/20"
                        : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800"
                    )}
                  >
                    <div
                      className="w-11 aspect-[3/4] bg-white border border-gray-200 dark:border-gray-700 overflow-hidden relative shrink-0 flex items-center justify-center rounded"
                      style={{ transform: `rotate(${p.rotation}deg)` }}
                    >
                      {p.isBlank ? (
                        <div className="w-full h-full bg-white" />
                      ) : thumbs[p.originalIndex] ? (
                        <img
                          src={thumbs[p.originalIndex]}
                          alt={`Page ${i + 1}`}
                          className="w-full h-full object-contain pointer-events-none"
                        />
                      ) : (
                        <div className="w-full h-full animate-pulse bg-gray-100 dark:bg-gray-800" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 flex items-center justify-between">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          current === i ? "text-[#DC2626]" : "text-gray-600 dark:text-gray-300"
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e: ReactMouseEvent) => { e.stopPropagation(); duplicatePage(i); }}
                          className="p-1 rounded hover:bg-white dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-100"
                          title="Duplicate page"
                          aria-label="Duplicate page"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e: ReactMouseEvent) => { e.stopPropagation(); rotatePage(i, 90); }}
                          className="p-1 rounded hover:bg-white dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-100"
                          title="Rotate page"
                          aria-label="Rotate page"
                        >
                          <RotateCw className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e: ReactMouseEvent) => { e.stopPropagation(); deletePage(i); }}
                          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600"
                          title="Delete page"
                          aria-label="Delete page"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => insertBlankPageAfter(pages.length - 1)}
                  className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 dark:border-gray-700 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 hover:border-[#DC2626] hover:text-[#DC2626] transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> Add page
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Collapse handle for left sidebar */}
        <button
          onClick={() => setShowLeftSidebar((s) => !s)}
          className="absolute top-1/2 -translate-y-1/2 z-30 bg-[#DC2626] hover:bg-[#B91C1C] border border-[#B91C1C] rounded-r-lg py-3 px-1.5 text-white shadow-md transition-colors"
          style={{ left: showLeftSidebar ? 200 : 0 }}
          title={showLeftSidebar ? "Hide pages panel" : "Show pages panel"}
          aria-label={showLeftSidebar ? "Hide pages panel" : "Show pages panel"}
        >
          {showLeftSidebar ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* CENTER: PDF Canvas */}
        <main className="flex-1 relative overflow-hidden flex flex-col bg-[#EDEEF1] dark:bg-gray-950">
          {phase === "reading" || phase === "rendering" ? (
            <div className="m-auto flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400">
              <Loader2 className="h-7 w-7 animate-spin text-[#DC2626]" />
              <span className="text-sm font-medium">Rendering document…</span>
            </div>
          ) : (
            <PreviewCanvas
              pdf={pdf}
              pages={pages}
              zoom={zoom}
              fitMode={fitMode}
              current={current}
              onCurrentChange={setCurrent}
              phase="ready"
              onToggleSelect={() => {}}
              selectionMode={false}
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
              textPreviewFonts={textPreviewFonts}
            />
          )}

          {/* FLOATING BOTTOM CONTROL BAR */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#1F2937]/95 text-white px-2.5 py-1.5 rounded-lg shadow-lg flex items-center gap-2 z-30 backdrop-blur-sm text-xs">
            <button
              onClick={() => {
                const next = Math.max(0, current - 1);
                setCurrent(next);
                document.getElementById(`pdf-page-${next}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              disabled={current === 0}
              className="p-1 rounded hover:bg-white/20 disabled:opacity-30"
              title="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="font-medium px-1 tabular-nums">{current + 1} / {pages.length}</span>
            <button
              onClick={() => {
                const next = Math.min(pages.length - 1, current + 1);
                setCurrent(next);
                document.getElementById(`pdf-page-${next}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              disabled={current === pages.length - 1}
              className="p-1 rounded hover:bg-white/20 disabled:opacity-30"
              title="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>

            <div className="w-px h-4 bg-white/20" />

            <button
              onClick={() => { setFitMode("custom"); setZoom((z) => Math.max(0.25, +(z - 0.05).toFixed(2))); }}
              className="p-1 rounded hover:bg-white/20"
              title="Zoom out"
            >
              <span className="sr-only">Zoom out</span>
              <ZoomOutIcon />
            </button>
            <span className="font-medium w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => { setFitMode("custom"); setZoom((z) => Math.min(4, +(z + 0.05).toFixed(2))); }}
              className="p-1 rounded hover:bg-white/20"
              title="Zoom in"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <div className="w-px h-4 bg-white/20" />

            <button
              onClick={() => setFitMode("width")}
              className={cn("p-1 rounded hover:bg-white/20", fitMode === "width" && "bg-white/25")}
              title="Fit to width"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setFitMode("page")}
              className={cn("p-1 rounded hover:bg-white/20", fitMode === "page" && "bg-white/25")}
              title="Fit entire page"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </main>

        {/* Collapse handle for right sidebar */}
        <button
          onClick={() => setShowRightSidebar((s) => !s)}
          className="absolute top-1/2 -translate-y-1/2 z-30 bg-[#DC2626] hover:bg-[#B91C1C] border border-[#B91C1C] rounded-l-lg py-3 px-1.5 text-white shadow-md transition-colors"
          style={{ right: showRightSidebar ? 260 : 0 }}
          title={showRightSidebar ? "Hide properties panel" : "Show properties panel"}
          aria-label={showRightSidebar ? "Hide properties panel" : "Show properties panel"}
        >
          {showRightSidebar ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        {/* RIGHT: Contextual properties panel */}
        <AnimatePresence initial={false}>
          {showRightSidebar && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 flex flex-col shrink-0 z-10"
            >
              <div className="flex-1 overflow-y-auto">
                <ContextPropertiesPanel
                  selectedElements={selectedElements}
                  singleSelected={singleSelected}
                  activeTool={activeTool}
                  onUpdateElement={updateElement}
                  onUpdateElements={(patch: Partial<AnyElement>) => updateElements(selectedIds, () => patch)}
                  onDeleteElements={() => deleteElements(selectedIds)}
                  onDuplicateElements={() => duplicateElements(selectedIds)}
                  onImageReplace={() => imageInputRef.current?.click()}
                  onBringToFront={() => reorderZ(selectedIds, "front")}
                  onSendToBack={() => reorderZ(selectedIds, "back")}
                  onRotatePage={() => rotatePage(current, 90)}
                  onDuplicatePage={() => duplicatePage(current)}
                  onExtractPage={() => extractPages([current])}
                  textPreviewFonts={textPreviewFonts}
                  onSetPreviewFont={setPreviewFont}
                />
              </div>

              <div className="p-3 border-t border-gray-200 dark:border-gray-800 shrink-0">
                <Button
                  onClick={apply}
                  disabled={processing || busy}
                  className="w-full h-11 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold text-sm shadow-sm flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <span>{actionLabel || "Save changes"}</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* SIGNATURE MODAL */}
      {signatureOpen && (
        <SignatureModal
          tab={signatureTab}
          onTabChange={setSignatureTab}
          typedSignature={typedSignature}
          onTypedChange={setTypedSignature}
          canvasRef={sigCanvasRef}
          drawingRef={sigDrawingRef}
          onClear={clearSignaturePad}
          onCancel={() => {
            setSignatureOpen(false);
            setActiveTool("select");
          }}
          onInsert={insertSignature}
          saveAfterInsert={saveSigAfterInsert}
          onSaveAfterInsertChange={setSaveSigAfterInsert}
          savedSignatures={savedSignatures}
          onUseSaved={(src: string) => {
            placeSignature(src);
            setSignatureOpen(false);
          }}
          onDeleteSaved={(id: string) => {
            deleteSavedSignature(id);
            setSavedSignatures(getSavedSignatures());
          }}
        />
      )}
    </div>
  );
}

/* small inline icon since lucide's "Minus" was repurposed visually as zoom-out */
function ZoomOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/* =========================================================
   COMPACT TOOLBAR BUTTON
   ========================================================= */
function ToolBtn({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (ev?: ReactMouseEvent) => void;
}) {
  return (
    <button
      onClick={(ev) => onClick(ev)}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#DC2626]",
        active
          ? "bg-red-50 text-[#DC2626] dark:bg-red-900/30 dark:text-red-300"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
        disabled && "opacity-35 pointer-events-none"
      )}
    >
      <span className="w-4 h-4 flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
function Divider() {
  return <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1 shrink-0" />;
}

/* =========================================================
   PREVIEW CANVAS (Renders Continuous Scrolling Pages)
   ========================================================= */

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
  panStateRef: React.MutableRefObject<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    el: HTMLElement;
  } | null>;
  textPreviewFonts: Record<string, string>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  const [visible, setVisible] = useState<Set<number>>(new Set([0]));

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
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-page-index]"));
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          entries.forEach((en) => {
            const idx = parseInt(en.target.getAttribute("data-page-index") || "-1", 10);
            if (en.isIntersecting) next.add(idx);
            else next.delete(idx);
          });
          return next;
        });
        const topEntry = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (topEntry) {
          const idx = parseInt(topEntry.getAttribute("data-page-index") || "-1", 10);
          if (idx >= 0) props.onCurrentChange(idx);
        }
      },
      { root: el, rootMargin: "50% 0px", threshold: 0 }
    );
    items.forEach((it) => io.observe(it));
    return () => io.disconnect();
  }, [props.pages.length, props.onCurrentChange]);

  function onContainerMouseDown(e: ReactMouseEvent) {
    if (props.activeTool !== "hand") return;
    const el = containerRef.current;
    if (!el) return;
    props.panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      el,
    };
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

  return (
    <div
      ref={containerRef}
      onMouseDown={onContainerMouseDown}
      className="w-full h-full overflow-auto flex flex-col items-center py-6 px-2 sm:px-4"
      style={{ cursor: props.activeTool === "hand" ? "grab" : undefined }}
    >
      <div className="flex flex-col items-center gap-8 pb-32">
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
            textPreviewFonts={props.textPreviewFonts}
          />
        ))}
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
  textPreviewFonts: Record<string, string>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState(false);
  const paneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (props.page.isBlank) {
      setDims({ w: 595, h: 842 });
      setRendered(true);
      return;
    }
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
  }, [props.pdf, props.page.originalIndex, props.page.rotation, props.page.isBlank]);

  const scale = useMemo(() => {
    if (!dims) return 1;
    if (props.fitMode === "custom") return props.baseScale;
    const padding = 16;
    if (props.fitMode === "width") return Math.max(320, props.containerWidth - padding) / dims.w;
    const targetW = Math.max(320, props.containerWidth - padding);
    const targetH = Math.max(320, props.containerHeight - padding);
    return Math.min(targetW / dims.w, targetH / dims.h);
  }, [dims, props.fitMode, props.baseScale, props.containerWidth, props.containerHeight]);

  const displayW = dims ? dims.w * scale : 600;
  const displayH = dims ? dims.h * scale : 800;

  useEffect(() => {
    if (!props.visible || !dims || props.page.isBlank) return;
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
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    props.visible,
    dims,
    scale,
    props.pdf,
    props.page.originalIndex,
    props.page.rotation,
    displayW,
    displayH,
    props.page.isBlank,
  ]);

  const canAnnotate = props.page.rotation === 0;

  return (
    <div
      ref={paneRef}
      id={`pdf-page-${props.index}`}
      data-page-index={props.index}
      className={cn(
        "group relative overflow-hidden bg-white shadow-[0_1px_10px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_10px_rgba(0,0,0,0.5)] mb-8 border border-gray-200 dark:border-gray-800 transition-shadow",
        props.selectionMode && "cursor-pointer"
      )}
      style={{ width: displayW, height: displayH }}
      onClick={props.selectionMode ? props.onToggleSelect : undefined}
    >
      <canvas ref={canvasRef} className="block h-full w-full bg-white" />
      {!rendered && !props.page.isBlank && (
        <div className="absolute inset-0 grid animate-pulse place-items-center bg-[#F8F9FA] text-xs text-gray-400">
          Rendering page…
        </div>
      )}
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
          textPreviewFonts={props.textPreviewFonts}
        />
      )}
    </div>
  );
}

/* Annotation Layer & Vector Manipulation */
function elementBounds(el: AnyElement) {
  return { x1: el.x, y1: el.y, x2: el.x + el.width, y2: el.y + el.height };
}
function rectsIntersect(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number }
) {
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
  textPreviewFonts: Record<string, string>;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStateRef = useRef<{ startPt: { x: number; y: number } } | null>(null);
  const moveStateRef = useRef<{ ids: string[]; offsets: Record<string, { x: number; y: number }> } | null>(null);
  const resizeStateRef = useRef<{ id: string; startW: number; startH: number } | null>(null);
  const rotateStateRef = useRef<{
    id: string;
    centerX: number;
    centerY: number;
    startAngle: number;
    startRotation: number;
  } | null>(null);

  const toPt = useCallback(
    (clientX: number, clientY: number) => {
      const rect = layerRef.current!.getBoundingClientRect();
      return { x: (clientX - rect.left) / props.scale, y: (clientY - rect.top) / props.scale };
    },
    [props.scale]
  );

  const nonCreationTools: Tool[] = ["select", "hand", "image", "signature"];
  const isCreationTool = props.interactive && !nonCreationTools.includes(props.activeTool);
  const isFieldTool = props.activeTool.startsWith("field-");

  function makeFieldDefault(): AnyElement | null {
    const base = { id: makeId(props.activeTool), pageId: props.pageId, opacity: 1, rotation: 0 } as const;
    if (props.activeTool === "field-text")
      return {
        ...base,
        type: "field-text",
        width: 180,
        height: 26,
        name: "text_field",
        value: "",
        placeholder: "Enter text",
        required: false,
      } as FieldTextElement;
    if (props.activeTool === "field-checkbox")
      return {
        ...base,
        type: "field-checkbox",
        width: 18,
        height: 18,
        name: "checkbox",
        checked: false,
        required: false,
      } as FieldCheckboxElement;
    if (props.activeTool === "field-radio")
      return {
        ...base,
        type: "field-radio",
        width: 18,
        height: 18,
        groupName: "radio_group",
        value: "option_1",
        checked: false,
        required: false,
      } as FieldRadioElement;
    if (props.activeTool === "field-dropdown")
      return {
        ...base,
        type: "field-dropdown",
        width: 160,
        height: 26,
        name: "dropdown",
        options: ["Option 1", "Option 2"],
        value: "Option 1",
        required: false,
      } as FieldDropdownElement;
    return null;
  }

  function onLayerMouseDown(e: ReactMouseEvent) {
    if (!props.interactive) return;
    if (!isCreationTool) {
      if (e.target === layerRef.current) {
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        props.onSetSelectedIds(new Set());
        const start = toPt(e.clientX, e.clientY);
        setMarquee({ x: start.x, y: start.y, w: 0, h: 0 });
        function onMove(ev: MouseEvent) {
          const p = toPt(ev.clientX, ev.clientY);
          setMarquee({
            x: Math.min(start.x, p.x),
            y: Math.min(start.y, p.y),
            w: Math.abs(p.x - start.x),
            h: Math.abs(p.y - start.y),
          });
        }
        function onUp(ev: MouseEvent) {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          const p = toPt(ev.clientX, ev.clientY);
          const rect = {
            x1: Math.min(start.x, p.x),
            y1: Math.min(start.y, p.y),
            x2: Math.max(start.x, p.x),
            y2: Math.max(start.y, p.y),
          };
          if (Math.abs(rect.x2 - rect.x1) > 3 || Math.abs(rect.y2 - rect.y1) > 3) {
            const hit = props.elements
              .filter((el: AnyElement) => rectsIntersect(rect, elementBounds(el)))
              .map((el: AnyElement) => el.id);
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
        id: makeId("txt"),
        pageId: props.pageId,
        type: "text",
        x: pt.x,
        y: pt.y,
        width: 180,
        height: 28,
        opacity: 1,
        rotation: 0,
        text: "Click to edit text",
        font: "Helvetica",
        fontSize: 14,
        bold: false,
        italic: false,
        underline: false,
        color: "#111827",
        align: "left",
        letterSpacing: 0,
        lineSpacing: 1.25,
      } as TextElement);
      return;
    }
    if (props.activeTool === "sticky") {
      props.onAddElement({
        id: makeId("sticky"),
        pageId: props.pageId,
        type: "sticky",
        x: pt.x,
        y: pt.y,
        width: 140,
        height: 100,
        opacity: 1,
        rotation: 0,
        color: "#FEF08A",
        note: "",
      } as StickyElement);
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
        setDraft({
          x: Math.min(start.x, p.x),
          y: Math.min(start.y, p.y),
          w: Math.abs(p.x - start.x),
          h: Math.abs(p.y - start.y),
        });
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
            const xs = pts.map((pp) => pp.x);
            const ys = pts.map((pp) => pp.y);
            const minX = Math.min(...xs),
              minY = Math.min(...ys),
              maxX = Math.max(...xs),
              maxY = Math.max(...ys);
            props.onAddElement({
              id: makeId("draw"),
              pageId: props.pageId,
              type: "draw",
              x: minX,
              y: minY,
              width: Math.max(1, maxX - minX),
              height: Math.max(1, maxY - minY),
              opacity: 1,
              rotation: 0,
              stroke: "#DC2626",
              strokeWidth: 2,
              points: pts.map((pp) => ({ x: pp.x - minX, y: pp.y - minY })),
            } as DrawElement);
          }
          return null;
        });
        return;
      }

      const x = Math.min(start.x, p.x);
      const y = Math.min(start.y, p.y);
      const w = Math.max(8, Math.abs(p.x - start.x));
      const h = Math.max(8, Math.abs(p.y - start.y));
      setDraft(null);

      if (
        props.activeTool === "shape-rect" ||
        props.activeTool === "shape-ellipse" ||
        props.activeTool === "shape-line"
      ) {
        props.onAddElement({
          id: makeId("shape"),
          pageId: props.pageId,
          type:
            props.activeTool === "shape-rect"
              ? "rect"
              : props.activeTool === "shape-ellipse"
              ? "ellipse"
              : "line",
          x,
          y,
          width: w,
          height: h,
          opacity: 1,
          rotation: 0,
          stroke: "#DC2626",
          strokeWidth: 2,
          fill: null,
        } as ShapeElement);
      } else if (
        props.activeTool === "highlight" ||
        props.activeTool === "underline" ||
        props.activeTool === "strikeout" ||
        props.activeTool === "squiggly"
      ) {
        props.onAddElement({
          id: makeId("markup"),
          pageId: props.pageId,
          type: props.activeTool,
          x,
          y,
          width: w,
          height: h,
          opacity: props.activeTool === "highlight" ? 0.35 : 1,
          rotation: 0,
          color: "#FDE047",
        } as HighlightElement);
      } else if (props.activeTool === "whiteout") {
        props.onAddElement({
          id: makeId("wo"),
          pageId: props.pageId,
          type: "whiteout",
          x,
          y,
          width: w,
          height: h,
          opacity: 1,
          rotation: 0,
          color: "#ffffff",
        });
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
      if (next.has(el.id)) next.delete(el.id);
      else next.add(el.id);
      props.onSetSelectedIds(next);
      ids = next;
    } else if (!ids.has(el.id)) {
      ids = new Set([el.id]);
      props.onSetSelectedIds(ids);
    }
    if (!ids.has(el.id)) return;

    if (e.altKey) {
      props.onDuplicateElements(ids);
      return;
    }

    const pt = toPt(e.clientX, e.clientY);
    const offsets: Record<string, { x: number; y: number }> = {};
    for (const id of ids) {
      const found = props.elements.find((x: AnyElement) => x.id === id);
      if (found) offsets[id] = { x: pt.x - found.x, y: pt.y - found.y };
    }
    moveStateRef.current = { ids: Array.from(ids) as string[], offsets };
    function onMove(ev: MouseEvent) {
      const p = toPt(ev.clientX, ev.clientY);
      const st = moveStateRef.current;
      if (!st) return;
      props.onUpdateElements(new Set(st.ids), (e2: AnyElement) => ({
        x: p.x - st.offsets[e2.id].x,
        y: p.y - st.offsets[e2.id].y,
      }));
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
      props.onUpdateElement(st.id, {
        width: Math.max(12, st.startW + dx),
        height: Math.max(12, st.startH + dy),
      });
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
    rotateStateRef.current = {
      id: el.id,
      centerX,
      centerY,
      startAngle,
      startRotation: el.rotation,
    };
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
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{
        cursor: isCreationTool ? "crosshair" : props.activeTool === "hand" ? undefined : "default",
        pointerEvents: props.interactive ? "auto" : "none",
      }}
      onMouseDown={onLayerMouseDown}
    >
      {props.elements.map((el: AnyElement) => {
        const selected = props.selectedIds.has(el.id);
        const canRotateHandle =
          selected &&
          props.activeTool === "select" &&
          ROTATABLE_TYPES.has(el.type) &&
          props.selectedIds.size === 1;
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
                width: "100%",
                height: "100%",
                fontFamily: props.textPreviewFonts[el.id]
                  ? fontFamilyStack(props.textPreviewFonts[el.id])
                  : t.font === "TimesRoman"
                  ? "Times New Roman, serif"
                  : t.font === "Courier"
                  ? "monospace"
                  : "Helvetica, Arial, sans-serif",
                fontSize: t.fontSize * props.scale,
                fontWeight: t.bold ? 700 : 400,
                fontStyle: t.italic ? "italic" : "normal",
                textDecoration: t.underline ? "underline" : "none",
                color: t.color,
                textAlign: t.align,
                whiteSpace: "pre-wrap",
                outline: "none",
                lineHeight: t.lineSpacing,
                letterSpacing: `${t.letterSpacing * props.scale}px`,
                cursor: "text",
              }}
            >
              {t.text}
            </div>
          );
        } else if (el.type === "rect") {
          const s = el as ShapeElement;
          body = (
            <div
              style={{
                width: "100%",
                height: "100%",
                border: `${s.strokeWidth * props.scale}px solid ${s.stroke}`,
                background: s.fill ?? "transparent",
              }}
            />
          );
        } else if (el.type === "ellipse") {
          const s = el as ShapeElement;
          body = (
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                border: `${s.strokeWidth * props.scale}px solid ${s.stroke}`,
                background: s.fill ?? "transparent",
              }}
            />
          );
        } else if (el.type === "line") {
          const s = el as ShapeElement;
          body = (
            <svg width="100%" height="100%" style={{ overflow: "visible" }}>
              <line
                x1={0}
                y1={el.height * props.scale}
                x2={el.width * props.scale}
                y2={0}
                stroke={s.stroke}
                strokeWidth={s.strokeWidth * props.scale}
              />
            </svg>
          );
        } else if (el.type === "draw") {
          const d = el as DrawElement;
          const pts = d.points.map((p) => `${p.x * props.scale},${p.y * props.scale}`).join(" ");
          body = (
            <svg width="100%" height="100%" style={{ overflow: "visible" }}>
              <polyline
                points={pts}
                fill="none"
                stroke={d.stroke}
                strokeWidth={d.strokeWidth * props.scale}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          );
        } else if (el.type === "highlight") {
          body = <div style={{ width: "100%", height: "100%", background: (el as HighlightElement).color }} />;
        } else if (el.type === "underline") {
          body = (
            <div
              style={{
                width: "100%",
                height: Math.max(1, 2 * props.scale),
                marginTop: el.height * props.scale - 2 * props.scale,
                background: (el as HighlightElement).color,
              }}
            />
          );
        } else if (el.type === "strikeout") {
          body = (
            <div
              style={{
                width: "100%",
                height: Math.max(1, 2 * props.scale),
                marginTop: (el.height * props.scale) / 2,
                background: (el as HighlightElement).color,
              }}
            />
          );
        } else if (el.type === "squiggly") {
          body = (
            <svg width="100%" height="100%" style={{ overflow: "visible" }}>
              <polyline
                points={Array.from(
                  { length: 10 },
                  (_, i) =>
                    `${i * (el.width / 9) * props.scale},${
                      el.height * props.scale - (i % 2 === 0 ? 0 : 4 * props.scale)
                    }`
                ).join(" ")}
                fill="none"
                stroke={(el as HighlightElement).color}
                strokeWidth={1.6 * props.scale}
              />
            </svg>
          );
        } else if (el.type === "whiteout") {
          body = (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: (el as { color: string }).color || "#ffffff",
              }}
            />
          );
        } else if (el.type === "image") {
          body = (
            <img
              src={(el as ImageElement).src}
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "fill" }}
            />
          );
        } else if (el.type === "sticky") {
          const s = el as StickyElement;
          body = (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: s.color,
                border: "1px solid rgba(0,0,0,0.15)",
                borderRadius: 4,
                boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                padding: 4 * props.scale,
                overflow: "hidden",
              }}
            >
              <textarea
                value={s.note}
                onChange={(e2) => props.onUpdateElement(el.id, { note: e2.target.value })}
                onMouseDown={(e2) => e2.stopPropagation()}
                placeholder="Note…"
                style={{
                  width: "100%",
                  height: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  fontSize: 11 * Math.max(1, props.scale),
                  color: "#3F3300",
                }}
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
              style={{
                width: "100%",
                height: "100%",
                border: `${1.5 * props.scale}px ${f.required ? "solid #DC2626" : "solid #DC2626"}`,
                borderRadius: 4,
                background: "rgba(220,38,38,0.05)",
                fontSize: 12 * Math.max(1, props.scale),
                padding: `0 ${6 * props.scale}px`,
                outline: "none",
              }}
            />
          );
        } else if (el.type === "field-checkbox") {
          const f = el as FieldCheckboxElement;
          body = (
            <div
              onMouseDown={(e2) => {
                e2.stopPropagation();
                props.onUpdateElement(el.id, { checked: !f.checked });
              }}
              style={{
                width: "100%",
                height: "100%",
                border: `${1.5 * props.scale}px solid ${f.required ? "#DC2626" : "#DC2626"}`,
                borderRadius: 3,
                background: f.checked ? "#DC2626" : "rgba(220,38,38,0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              {f.checked && <Check style={{ width: "80%", height: "80%" }} className="text-white" />}
            </div>
          );
        } else if (el.type === "field-radio") {
          const f = el as FieldRadioElement;
          body = (
            <div
              onMouseDown={(e2) => {
                e2.stopPropagation();
                props.onUpdateElement(el.id, { checked: !f.checked });
              }}
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                border: `${1.5 * props.scale}px solid ${f.required ? "#DC2626" : "#DC2626"}`,
                background: "rgba(220,38,38,0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              {f.checked && (
                <div style={{ width: "55%", height: "55%", borderRadius: "50%", background: "#DC2626" }} />
              )}
            </div>
          );
        } else if (el.type === "field-dropdown") {
          const f = el as FieldDropdownElement;
          body = (
            <select
              value={f.value}
              onChange={(e2) => props.onUpdateElement(el.id, { value: e2.target.value })}
              onMouseDown={(e2) => e2.stopPropagation()}
              style={{
                width: "100%",
                height: "100%",
                border: `${1.5 * props.scale}px solid ${f.required ? "#DC2626" : "#DC2626"}`,
                borderRadius: 4,
                background: "rgba(220,38,38,0.05)",
                fontSize: 12 * Math.max(1, props.scale),
              }}
            >
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        }

        return (
          <div
            key={el.id}
            style={style}
            onMouseDown={(e) => startMove(e, el)}
            className={cn(
              selected &&
                props.activeTool === "select" &&
                "outline outline-2 outline-[#DC2626] outline-offset-1"
            )}
          >
            {body}
            {selected &&
              props.activeTool === "select" &&
              props.selectedIds.size === 1 &&
              el.type !== "draw" &&
              el.type !== "sticky" &&
              !el.type.startsWith("field-") && (
                <div
                  onMouseDown={(e) => startResize(e, el)}
                  style={{
                    position: "absolute",
                    right: -5,
                    bottom: -5,
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: "#DC2626",
                    cursor: "nwse-resize",
                  }}
                />
              )}
            {canRotateHandle && (
              <div
                onMouseDown={(e) => startRotate(e, el)}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: -22,
                  width: 10,
                  height: 10,
                  marginLeft: -5,
                  borderRadius: "50%",
                  background: "#DC2626",
                  cursor: "grab",
                }}
              />
            )}
          </div>
        );
      })}

      {draft && (
        <div
          style={{
            position: "absolute",
            left: draft.x * props.scale,
            top: draft.y * props.scale,
            width: draft.w * props.scale,
            height: draft.h * props.scale,
            border: "1.5px dashed #DC2626",
            background:
              props.activeTool === "highlight" ? "rgba(253,224,71,0.35)" : "rgba(220,38,38,0.06)",
            pointerEvents: "none",
          }}
        />
      )}
      {drawPoints && drawPoints.length > 1 && (
        <svg className="absolute inset-0" style={{ pointerEvents: "none" }}>
          <polyline
            points={drawPoints.map((p) => `${p.x * props.scale},${p.y * props.scale}`).join(" ")}
            fill="none"
            stroke="#DC2626"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {marquee && (
        <div
          style={{
            position: "absolute",
            left: marquee.x * props.scale,
            top: marquee.y * props.scale,
            width: marquee.w * props.scale,
            height: marquee.h * props.scale,
            border: "1px dashed #DC2626",
            background: "rgba(220,38,38,0.08)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

/* =========================================================
   CONTEXTUAL PROPERTIES PANEL (Right Sidebar)
   ========================================================= */

function ContextPropertiesPanel({
  selectedElements,
  singleSelected,
  activeTool,
  onUpdateElement,
  onUpdateElements,
  onDeleteElements,
  onDuplicateElements,
  onImageReplace,
  onBringToFront,
  onSendToBack,
  onRotatePage,
  onDuplicatePage,
  onExtractPage,
  textPreviewFonts,
  onSetPreviewFont,
}: {
  selectedElements: AnyElement[];
  singleSelected: AnyElement | null;
  activeTool: Tool;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (patch: Partial<AnyElement>) => void;
  onDeleteElements: () => void;
  onDuplicateElements: () => void;
  onImageReplace: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onRotatePage: () => void;
  onDuplicatePage: () => void;
  onExtractPage: () => void;
  textPreviewFonts: Record<string, string>;
  onSetPreviewFont: (id: string, family: string) => void;
}) {
  const colorSwatches = ["#000000", "#FFFFFF", "#DC2626", "#2563EB", "#16A34A", "#EAB308", "#9333EA", "#6B7280"];

  if (selectedElements.length > 1) {
    return (
      <div className="p-4 space-y-5">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800 pb-2">
          {selectedElements.length} elements selected
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onDuplicateElements} className="rounded-md text-xs h-8"><Copy className="w-3.5 h-3.5 mr-1.5" /> Duplicate</Button>
          <Button variant="outline" size="sm" onClick={onDeleteElements} className="rounded-md text-xs h-8 border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"><Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete</Button>
        </div>
        <PropRow label="Layer order">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={onBringToFront} className="rounded-md text-xs h-8">Bring forward</Button>
            <Button variant="outline" size="sm" onClick={onSendToBack} className="rounded-md text-xs h-8">Send back</Button>
          </div>
        </PropRow>
        <PropRow label="Opacity">
          <input type="range" min={0.1} max={1} step={0.05} onChange={(e) => onUpdateElements({ opacity: Number(e.target.value) })} className="w-full accent-[#DC2626]" />
        </PropRow>
      </div>
    );
  }

  if (singleSelected) {
    const el = singleSelected;
    const title =
      el.type === "text" ? "Text" :
      el.type === "image" ? "Image" :
      el.type === "draw" ? "Drawing" :
      el.type.startsWith("shape") || el.type === "rect" || el.type === "ellipse" || el.type === "line" ? "Shape" :
      el.type === "sticky" ? "Sticky note" :
      el.type === "highlight" || el.type === "underline" || el.type === "strikeout" || el.type === "squiggly" ? "Highlight" :
      "Element";

    return (
      <div className="p-4 space-y-5">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{title}</h3>
          <div className="flex items-center gap-0.5">
            <button onClick={onDuplicateElements} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400" title="Duplicate" aria-label="Duplicate"><Copy className="w-3.5 h-3.5" /></button>
            <button onClick={onDeleteElements} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-500 dark:text-gray-400 hover:text-red-600" title="Delete" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        {el.type === "text" && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Font style
                <span className="ml-1 font-normal text-gray-400" title="Any font here previews on screen. The PDF font below controls what's embedded in your downloaded file.">
                  ({FONT_PREVIEW_CHOICES.length}+ available)
                </span>
              </div>
              <select
                value={textPreviewFonts[el.id] || (el as TextElement).font}
                onChange={(e) => onSetPreviewFont(el.id, e.target.value)}
                className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:border-[#DC2626]"
              >
                <optgroup label="Standard">
                  {SYSTEM_FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
                </optgroup>
                <optgroup label="Google Fonts">
                  {GOOGLE_FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="flex gap-2">
              <select
                value={(el as TextElement).font}
                onChange={(e) => onUpdateElement(el.id, { font: e.target.value as TextElement["font"] })}
                title="PDF export font — the font actually embedded in the downloaded file"
                className="flex-1 h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:border-[#DC2626]"
              >
                {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f === "TimesRoman" ? "Times New Roman" : f} (PDF)</option>)}
              </select>
              <input
                type="number"
                min={6} max={96}
                value={(el as TextElement).fontSize}
                onChange={(e) => onUpdateElement(el.id, { fontSize: Number(e.target.value) })}
                className="w-14 h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-1 text-xs text-center text-gray-800 dark:text-gray-100 focus:outline-none focus:border-[#DC2626]"
              />
            </div>
            <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-800 p-1 rounded-md border border-gray-200 dark:border-gray-700">
              <button onClick={() => onUpdateElement(el.id, { bold: !(el as TextElement).bold })} className={cn("flex-1 h-7 rounded flex items-center justify-center", (el as TextElement).bold ? "bg-white dark:bg-gray-700 text-[#DC2626] shadow-sm" : "text-gray-500 dark:text-gray-400")}><Bold className="w-3.5 h-3.5" /></button>
              <button onClick={() => onUpdateElement(el.id, { italic: !(el as TextElement).italic })} className={cn("flex-1 h-7 rounded flex items-center justify-center", (el as TextElement).italic ? "bg-white dark:bg-gray-700 text-[#DC2626] shadow-sm" : "text-gray-500 dark:text-gray-400")}><Italic className="w-3.5 h-3.5" /></button>
              <button onClick={() => onUpdateElement(el.id, { underline: !(el as TextElement).underline })} className={cn("flex-1 h-7 rounded flex items-center justify-center", (el as TextElement).underline ? "bg-white dark:bg-gray-700 text-[#DC2626] shadow-sm" : "text-gray-500 dark:text-gray-400")}><UnderlineIcon className="w-3.5 h-3.5" /></button>
            </div>
            <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-800 p-1 rounded-md border border-gray-200 dark:border-gray-700">
              <button onClick={() => onUpdateElement(el.id, { align: "left" })} className={cn("flex-1 h-7 rounded flex items-center justify-center", (el as TextElement).align === "left" ? "bg-white dark:bg-gray-700 text-[#DC2626] shadow-sm" : "text-gray-500 dark:text-gray-400")}><AlignLeft className="w-3.5 h-3.5" /></button>
              <button onClick={() => onUpdateElement(el.id, { align: "center" })} className={cn("flex-1 h-7 rounded flex items-center justify-center", (el as TextElement).align === "center" ? "bg-white dark:bg-gray-700 text-[#DC2626] shadow-sm" : "text-gray-500 dark:text-gray-400")}><AlignCenter className="w-3.5 h-3.5" /></button>
              <button onClick={() => onUpdateElement(el.id, { align: "right" })} className={cn("flex-1 h-7 rounded flex items-center justify-center", (el as TextElement).align === "right" ? "bg-white dark:bg-gray-700 text-[#DC2626] shadow-sm" : "text-gray-500 dark:text-gray-400")}><AlignRight className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}

        {el.type === "image" && (
          <Button onClick={onImageReplace} variant="outline" className="w-full rounded-md text-xs h-8">Replace image</Button>
        )}

        {(el.type === "draw" || el.type === "rect" || el.type === "ellipse" || el.type === "line") && (
          <div className="space-y-4">
            <PropRow label="Stroke width">
              <input type="number" min={1} max={20} value={(el as DrawElement | ShapeElement).strokeWidth} onChange={(e) => onUpdateElement(el.id, { strokeWidth: Number(e.target.value) })} className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 text-xs outline-none focus:border-[#DC2626] text-gray-800 dark:text-gray-100" />
            </PropRow>
            {(el.type === "rect" || el.type === "ellipse") && (
              <PropRow label="Fill color">
                <div className="flex items-center gap-2">
                  <input type="color" value={(el as ShapeElement).fill ?? "#ffffff"} onChange={(e) => onUpdateElement(el.id, { fill: e.target.value })} className="w-8 h-8 rounded cursor-pointer border border-gray-200 dark:border-gray-700 p-0.5 bg-white dark:bg-gray-800" />
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={(el as ShapeElement).fill === null} onChange={(e) => onUpdateElement(el.id, { fill: e.target.checked ? null : "#ffffff" })} className="accent-[#DC2626]" /> No fill
                  </label>
                </div>
              </PropRow>
            )}
          </div>
        )}

        {el.type !== "image" && (
          <PropRow label="Color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={(el as TextElement).color || (el as ShapeElement).stroke || (el as HighlightElement).color || "#000000"}
                onChange={(e) => {
                  if (el.type === "text" || el.type.startsWith("field-") || el.type === "squiggly" || el.type === "strikeout" || el.type === "underline" || el.type === "highlight") {
                    onUpdateElement(el.id, { color: e.target.value });
                  } else {
                    onUpdateElement(el.id, { stroke: e.target.value });
                  }
                }}
                className="w-8 h-8 rounded-full cursor-pointer border border-gray-200 dark:border-gray-700 p-0.5 bg-white dark:bg-gray-800 shrink-0"
              />
              <div className="flex-1 flex flex-wrap gap-1.5">
                {colorSwatches.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      if (el.type === "text" || el.type.startsWith("field-") || el.type === "squiggly" || el.type === "strikeout" || el.type === "underline" || el.type === "highlight") {
                        onUpdateElement(el.id, { color });
                      } else {
                        onUpdateElement(el.id, { stroke: color });
                      }
                    }}
                    className="w-5 h-5 rounded-full border border-gray-200 dark:border-gray-700 hover:scale-110 transition-transform"
                    style={{ background: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </PropRow>
        )}

        <PropRow label="Opacity">
          <input type="range" min={0.1} max={1} step={0.05} value={el.opacity} onChange={(e) => onUpdateElement(el.id, { opacity: Number(e.target.value) })} className="w-full accent-[#DC2626]" />
        </PropRow>

        {el.type !== "draw" && el.type !== "sticky" && !el.type.startsWith("field-") && el.type !== "highlight" && el.type !== "underline" && el.type !== "strikeout" && el.type !== "squiggly" && (
          <PropRow label="Rotation">
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={359} value={el.rotation} onChange={(e) => onUpdateElement(el.id, { rotation: Number(e.target.value) })} className="flex-1 accent-[#DC2626]" />
              <span className="text-xs text-gray-500 dark:text-gray-400 w-9 text-right tabular-nums">{el.rotation}°</span>
            </div>
          </PropRow>
        )}

        <PropRow label="Layer order">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={onBringToFront} className="rounded-md text-xs h-8">Bring forward</Button>
            <Button variant="outline" size="sm" onClick={onSendToBack} className="rounded-md text-xs h-8">Send back</Button>
          </div>
        </PropRow>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">Edit PDF</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Use the toolbar to add text, images, and annotations. Select any element on the page to edit its style here.
        </p>
      </div>
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
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

/* =========================================================
   SIGNATURE & SUCCESS MODALS
   ========================================================= */

function SignatureModal({
  tab,
  onTabChange,
  typedSignature,
  onTypedChange,
  canvasRef,
  drawingRef,
  onClear,
  onCancel,
  onInsert,
  saveAfterInsert,
  onSaveAfterInsertChange,
  savedSignatures,
  onUseSaved,
  onDeleteSaved,
}: {
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
  function startDraw(e: ReactMouseEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    draw(e);
  }
  function draw(e: ReactMouseEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(e.clientX - rect.left, e.clientY - rect.top, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  }
  function endDraw() {
    drawingRef.current = false;
  }

  return (
    <div
      className="fixed inset-0 z-[999999] grid place-items-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#E5E7EB] dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-2xl"
        onClick={(e: ReactMouseEvent) => e.stopPropagation()}
      >
        <div className="mb-4 text-lg font-bold text-[#111827] dark:text-gray-100">Add signature</div>
        <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-800">
          <button
            onClick={() => onTabChange("draw")}
            className={cn(
              "flex-1 pb-2 text-sm font-semibold transition-all border-b-2",
              tab === "draw" ? "border-[#DC2626] text-[#DC2626]" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
            )}
          >
            Draw
          </button>
          <button
            onClick={() => onTabChange("type")}
            className={cn(
              "flex-1 pb-2 text-sm font-semibold transition-all border-b-2",
              tab === "type" ? "border-[#DC2626] text-[#DC2626]" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
            )}
          >
            Type
          </button>
          <button
            onClick={() => onTabChange("saved")}
            className={cn(
              "flex-1 pb-2 text-sm font-semibold transition-all border-b-2",
              tab === "saved" ? "border-[#DC2626] text-[#DC2626]" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
            )}
          >
            Saved ({savedSignatures.length})
          </button>
        </div>

        {tab === "draw" && (
          <div>
            <canvas
              ref={canvasRef}
              width={420}
              height={160}
              className="w-full cursor-crosshair rounded-lg border border-[#E5E7EB] dark:border-gray-700 bg-[#F8F9FA] dark:bg-gray-800"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
            />
            <div className="mt-3 flex items-center justify-between">
              <button onClick={onClear} className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-300">
                Clear
              </button>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAfterInsert}
                  onChange={(e) => onSaveAfterInsertChange(e.target.checked)}
                  className="accent-[#DC2626] w-4 h-4"
                />{" "}
                Save signature
              </label>
            </div>
          </div>
        )}
        {tab === "type" && (
          <div>
            <input
              autoFocus
              value={typedSignature}
              onChange={(e) => onTypedChange(e.target.value)}
              placeholder="Type your name"
              className="h-32 w-full rounded-lg border border-[#E5E7EB] dark:border-gray-700 bg-[#F8F9FA] dark:bg-gray-800 px-4 text-center font-serif text-4xl italic text-[#111827] dark:text-gray-100 focus:outline-none focus:border-[#DC2626] transition-colors"
            />
            <label className="mt-3 flex items-center justify-end gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={saveAfterInsert}
                onChange={(e) => onSaveAfterInsertChange(e.target.checked)}
                className="accent-[#DC2626] w-4 h-4"
              />{" "}
              Save signature
            </label>
          </div>
        )}
        {tab === "saved" && (
          <div className="grid max-h-64 grid-cols-2 gap-3 overflow-auto">
            {savedSignatures.length === 0 && (
              <div className="col-span-2 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                You haven't saved any signatures yet.
              </div>
            )}
            {savedSignatures.map((s) => (
              <div key={s.id} className="group relative rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-2 flex flex-col items-center">
                <img src={s.src} alt="Saved signature" className="h-16 w-full object-contain mb-2 bg-white" />
                <div className="flex w-full gap-1">
                  <button
                    onClick={() => onUseSaved(s.src)}
                    className="flex-1 py-1.5 rounded bg-[#DC2626] text-xs font-bold text-white hover:bg-[#B91C1C]"
                  >
                    Insert
                  </button>
                  <button
                    onClick={() => onDeleteSaved(s.id)}
                    className="w-8 flex items-center justify-center rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-900"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} className="rounded-lg border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800">
            Cancel
          </Button>
          {tab !== "saved" && (
            <Button onClick={onInsert} className="rounded-lg bg-[#DC2626] text-white hover:bg-[#B91C1C] font-bold px-6">
              Apply
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

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
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-2xl mx-auto my-auto overflow-hidden rounded-xl border border-[#E5E7EB] dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl"
    >
      <div className="border-b border-[#E5E7EB] dark:border-gray-800 bg-red-50/50 dark:bg-red-900/10 px-8 py-6">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-[#DC2626] text-white shadow-sm">
            <FileCheck2 className="h-7 w-7" />
          </div>
          <div>
            <div className="text-2xl font-bold text-[#111827] dark:text-gray-100">PDF ready to download</div>
            <div className="text-sm text-[#6B7280] dark:text-gray-400 mt-1 font-medium">
              {result.filename} <span className="mx-1">•</span> {formatBytes(result.blob.size)} <span className="mx-1">•</span> {result.pages} pages
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-8 p-8 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-xl border border-[#E5E7EB] dark:border-gray-800 bg-[#F8F9FA] dark:bg-gray-800 p-4 flex items-center justify-center">
          {result.thumb ? (
            <img src={result.thumb} alt="Preview of page 1" className="max-h-[380px] object-contain shadow-lg rounded border border-gray-200 dark:border-gray-700 bg-white" />
          ) : (
            <div className="text-sm font-medium text-[#6B7280] dark:text-gray-400">Preview unavailable</div>
          )}
        </div>
        <div className="flex flex-col gap-3 justify-center">
          <Button
            size="lg"
            onClick={onDownload}
            className="w-full rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white font-bold h-14 shadow-md text-base"
          >
            <Download className="mr-2 h-5 w-5" /> Download PDF
          </Button>
          <div className="h-px bg-gray-100 dark:bg-gray-800 my-2" />
          <Button
            size="lg"
            variant="outline"
            onClick={onEditAgain}
            className="w-full rounded-lg border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold h-12 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Continue editing
          </Button>
          <Button
            size="lg"
            variant="ghost"
            onClick={onNewFile}
            className="w-full rounded-lg text-gray-500 dark:text-gray-400 font-semibold h-12 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Upload new file
          </Button>
        </div>
      </div>
    </motion.div>
  );
}