  /**
   * Self-contained PDF editor — no @/lib/pdf-editor/* files required.
   * Deps: pdfjs-dist, pdf-lib, lucide-react, sonner, clsx/tailwind-merge (cn).
   */import type React from "react";
  import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
  } from "react";
  import { toast } from "sonner";
  import {
    ChevronLeft, ChevronRight, Circle, Download, Eraser, Highlighter, Loader2,
    Minus, MousePointer2, PenLine, Plus, RotateCw, Search, Square, Trash2, Type,
    Undo2, Redo2, Upload, X,
  } from "lucide-react";
  import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
  import { cn } from "@/lib/utils";

  /* ------------------------------------------------------------------ types */
  // Normalized coordinates: x/y/w/h are fractions of the page box (0..1),
  // so annotations survive zoom changes and export at any scale.
  export type Pt = { x: number; y: number };

  export type BaseEl = {
    id: string;
    page: number; // index into the *original* pdf page list
    color: string; // hex
    /** stroke width as a fraction of page width */
    size: number;
    opacity: number;
  };

  export type StrokeEl = BaseEl & {
    kind: "pen" | "highlight";
    points: Pt[];
  };

  export type ShapeEl = BaseEl & {
    kind: "rect" | "ellipse" | "line";
    x: number;
    y: number;
    w: number;
    h: number;
    fill: boolean;
  };

  export type TextEl = BaseEl & {
    kind: "text";
    x: number;
    y: number;
    text: string;
    /** font size as a fraction of page height */
    fontSize: number;
    bold: boolean;
    italic: boolean;
  };

  export type AnyEl = StrokeEl | ShapeEl | TextEl;

  export type Tool = "select" | "pen" | "highlight" | "eraser" | "text" | "rect" | "ellipse" | "line";

  export type PageMeta = {
    id: string;
    index: number; // original page index
    width: number;
    height: number;
  };

  export const PALETTE = [
    "#111827",
    "#ef4444",
    "#f59e0b",
    "#10b981",
    "#3b82f6",
    "#ec4899",
    "#ffffff",
  ];

  export const HIGHLIGHT_PALETTE = ["#fde047", "#86efac", "#93c5fd", "#fca5a5", "#f0abfc"];

  export const makeId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  export const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "");
    const n = parseInt(
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h,
      16,
    );
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  };

  /* ---------------------------------------------------------------- history */

  /**
   * History as *state* (not refs + a manual tick), so canUndo/canRedo are always
   * consistent with what is rendered. Snapshots are stored by reference — the
   * caller must treat values as immutable, which avoids the old
   * JSON.stringify-per-keystroke cost for base64-heavy elements.
   */
  export function useHistory<T>(initial: T, limit = 100) {
    const [state, setState] = useState<{ past: T[]; present: T; future: T[] }>({
      past: [],
      present: initial,
      future: [],
    });

    /** Commit a new value and push the previous one onto the undo stack. */
    const commit = useCallback((updater: T | ((prev: T) => T)) => {
      setState((s) => {
        const next =
          typeof updater === "function" ? (updater as (p: T) => T)(s.present) : updater;
        if (Object.is(next, s.present)) return s;
        const past = [...s.past, s.present];
        if (past.length > limit) past.shift();
        return { past, present: next, future: [] };
      });
    }, [limit]);

    /** Update without creating a history entry (e.g. live drag preview). */
    const replace = useCallback((updater: T | ((prev: T) => T)) => {
      setState((s) => {
        const next =
          typeof updater === "function" ? (updater as (p: T) => T)(s.present) : updater;
        if (Object.is(next, s.present)) return s;
        return { ...s, present: next };
      });
    }, []);

    const undo = useCallback(() => {
      setState((s) => {
        if (!s.past.length) return s;
        const present = s.past[s.past.length - 1]!;
        return {
          past: s.past.slice(0, -1),
          present,
          future: [s.present, ...s.future],
        };
      });
    }, []);

    const redo = useCallback(() => {
      setState((s) => {
        if (!s.future.length) return s;
        const [present, ...future] = s.future;
        return { past: [...s.past, s.present], present: present!, future };
      });
    }, []);

    const reset = useCallback((value: T) => {
      setState({ past: [], present: value, future: [] });
    }, []);

    return {
      value: state.present,
      commit,
      replace,
      undo,
      redo,
      reset,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    };
  }

  /* ------------------------------------------------------------ object urls */

  /**
   * Tracks every object URL created during the session and revokes them on
   * unmount (and on demand), fixing the leaks around export/preview URLs.
   */
  export function useObjectUrls() {
    const urls = useRef(new Set<string>());

    const create = useCallback((blob: Blob) => {
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      return url;
    }, []);

    const revoke = useCallback((url: string) => {
      if (urls.current.delete(url)) URL.revokeObjectURL(url);
    }, []);

    useEffect(() => {
      const set = urls.current;
      return () => {
        set.forEach((u) => URL.revokeObjectURL(u));
        set.clear();
      };
    }, []);

    return { create, revoke };
  }

  /* ---------------------------------------------------------------- search */

  export type SearchHit = { page: number; occurrence: number };

  type SearchDoc = {
    numPages: number;
    getPage: (n: number) => Promise<{
      getTextContent?: () => Promise<{ items: Array<{ str?: string }> }>;
    }>;
  };

  /**
   * Debounced + cancellable full-document text search.
   * Every run carries a token; stale runs discard their results, so a slow
   * earlier query can never overwrite a newer one. Records *every* occurrence,
   * matching the "n / total" navigation shown in the UI.
   */
  export function usePdfSearch(doc: SearchDoc | null, delay = 250) {
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<SearchHit[]>([]);
    const [activeIdx, setActiveIdx] = useState(0);
    const [searching, setSearching] = useState(false);
    const tokenRef = useRef(0);

    useEffect(() => {
      const token = ++tokenRef.current;
      const needle = query.trim().toLowerCase();
      if (!doc || needle.length < 2) {
        setHits([]);
        setActiveIdx(0);
        setSearching(false);
        return;
      }
      setSearching(true);
      const timer = setTimeout(async () => {
        const found: SearchHit[] = [];
        try {
          for (let p = 1; p <= doc.numPages; p++) {
            if (tokenRef.current !== token) return; // cancelled
            const page = await page_text(doc, p);
            let from = 0;
            let occ = 0;
            for (;;) {
              const at = page.indexOf(needle, from);
              if (at === -1) break;
              found.push({ page: p - 1, occurrence: occ++ });
              from = at + needle.length;
            }
          }
        } catch {
          /* ignore extraction failures on individual pages */
        }
        if (tokenRef.current !== token) return;
        setHits(found);
        setActiveIdx(0);
        setSearching(false);
      }, delay);

      return () => clearTimeout(timer);
    }, [doc, query, delay]);

    const step = useCallback(
      (dir: 1 | -1) =>
        setActiveIdx((i) => (hits.length ? (i + dir + hits.length) % hits.length : 0)),
      [hits.length],
    );

    return { query, setQuery, hits, activeIdx, step, searching };
  }

  async function page_text(doc: SearchDoc, n: number) {
    const page = await doc.getPage(n);
    const content = (await page.getTextContent?.()) ?? { items: [] };
    return content.items.map((i) => i.str ?? "").join(" ").toLowerCase();
  }

  /* ---------------------------------------------------------------- export */

  export type ExportInput = {
    /** original file bytes */
    bytes: ArrayBuffer;
    /** original page indices to keep, in output order */
    pageOrder: number[];
    /** rotation (deg) per original page index */
    rotations: Record<number, number>;
    elements: AnyEl[];
  };

  /**
   * Only the 14 standard PDF fonts are offered in the UI, so what is rendered
   * on screen matches what is embedded in the exported document.
   */
  export const FONTS = [
    { id: "helvetica", label: "Helvetica", css: "Helvetica, Arial, sans-serif" },
    { id: "times", label: "Times", css: "'Times New Roman', Times, serif" },
    { id: "courier", label: "Courier", css: "'Courier New', Courier, monospace" },
  ] as const;

  export async function buildPdf({ bytes, pageOrder, rotations, elements }: ExportInput) {
    const src = await PDFDocument.load(bytes);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, pageOrder);

    const fonts = {
      regular: await out.embedFont(StandardFonts.Helvetica),
      bold: await out.embedFont(StandardFonts.HelveticaBold),
      italic: await out.embedFont(StandardFonts.HelveticaOblique),
    };

    pageOrder.forEach((originalIndex, i) => {
      const page = copied[i]!;
      out.addPage(page);
      const { width, height } = page.getSize();
      const rot = rotations[originalIndex] ?? 0;
      if (rot) page.setRotation(degrees(rot));

      const forPage = elements.filter((el) => el.page === originalIndex);
      for (const el of forPage) {
        const c = hexToRgb(el.color);
        const color = rgb(c.r, c.g, c.b);
        const thickness = Math.max(0.4, el.size * width);

        if (el.kind === "pen" || el.kind === "highlight") {
          for (let p = 1; p < el.points.length; p++) {
            const a = el.points[p - 1]!;
            const b = el.points[p]!;
            page.drawLine({
              start: { x: a.x * width, y: (1 - a.y) * height },
              end: { x: b.x * width, y: (1 - b.y) * height },
              thickness: el.kind === "highlight" ? thickness * 3 : thickness,
              color,
              opacity: el.opacity,
              lineCap: 1,
            });
          }
        } else if (el.kind === "line") {
          page.drawLine({
            start: { x: el.x * width, y: (1 - el.y) * height },
            end: { x: (el.x + el.w) * width, y: (1 - (el.y + el.h)) * height },
            thickness,
            color,
            opacity: el.opacity,
          });
        } else if (el.kind === "rect") {
          page.drawRectangle({
            x: el.x * width,
            y: (1 - (el.y + el.h)) * height,
            width: el.w * width,
            height: el.h * height,
            borderColor: color,
            borderWidth: el.fill ? 0 : thickness,
            ...(el.fill ? { color, opacity: el.opacity } : {}),
            borderOpacity: el.opacity,
          });
        } else if (el.kind === "ellipse") {
          page.drawEllipse({
            x: (el.x + el.w / 2) * width,
            y: (1 - (el.y + el.h / 2)) * height,
            xScale: Math.abs(el.w / 2) * width,
            yScale: Math.abs(el.h / 2) * height,
            borderColor: color,
            borderWidth: el.fill ? 0 : thickness,
            ...(el.fill ? { color, opacity: el.opacity } : {}),
            borderOpacity: el.opacity,
          });
        } else if (el.kind === "text") {
          const font = el.bold ? fonts.bold : el.italic ? fonts.italic : fonts.regular;
          const size = el.fontSize * height;
          el.text.split("\n").forEach((line, li) => {
            page.drawText(line, {
              x: el.x * width,
              y: (1 - el.y) * height - size * (li + 1),
              size,
              font,
              color,
              opacity: el.opacity,
            });
          });
        }
      }
    });

    const saved = await out.save();
    const buf = new ArrayBuffer(saved.byteLength);
    new Uint8Array(buf).set(saved);
    return new Blob([buf], { type: "application/pdf" });
  }

  /* ---------------------------------------------------------------- editor */
  type Doc = {
    numPages: number;
    getPage: (n: number) => Promise<any>;
  };

  type EditorDoc = {
    elements: AnyEl[];
    pageOrder: number[];
    rotations: Record<number, number>;
  };

  const EMPTY: EditorDoc = { elements: [], pageOrder: [], rotations: {} };

  export default function PdfEditor() {
    const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
    const [fileName, setFileName] = useState("document.pdf");
    const [doc, setDoc] = useState<Doc | null>(null);
    const [pages, setPages] = useState<PageMeta[]>([]);
    const [loading, setLoading] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [current, setCurrent] = useState(0);
    const [exporting, setExporting] = useState(false);

    const [tool, setTool] = useState<Tool>("pen");
    const [color, setColor] = useState(PALETTE[1]!);
    const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_PALETTE[0]!);
    const [size, setSize] = useState(3);
    const [fill, setFill] = useState(false);
    const [fontSize, setFontSize] = useState(18);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    const history = useHistory<EditorDoc>(EMPTY);
    const { elements, pageOrder, rotations } = history.value;
    const { create: createUrl, revoke: revokeUrl } = useObjectUrls();
    const search = usePdfSearch(doc);

    const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
    const draftRef = useRef<AnyEl | null>(null);
    const [draft, setDraft] = useState<AnyEl | null>(null);

    /* ---------------------------------------------------------- load file */
    const openFile = useCallback(async (file: File) => {
      setLoading(true);
      try {
        const buf = await file.arrayBuffer();
        const pdfjs: any = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        // pdf.js transfers the buffer, so hand it a copy and keep ours for export
        const loaded = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
        const metas: PageMeta[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const p = await loaded.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          metas.push({ id: makeId(), index: i - 1, width: vp.width, height: vp.height });
        }
        setBytes(buf);
        setFileName(file.name);
        setDoc(loaded);
        setPages(metas);
        setCurrent(0);
        history.reset({
          elements: [],
          pageOrder: metas.map((m) => m.index),
          rotations: {},
        });
      } catch (e) {
        console.error(e);
        toast.error("Could not open that PDF");
      } finally {
        setLoading(false);
      }
    }, [history]);

    /* ------------------------------------------------------- element edit */
    const addElement = useCallback(
      (el: AnyEl) => history.commit((d) => ({ ...d, elements: [...d.elements, el] })),
      [history],
    );

    const updateElement = useCallback(
      (id: string, patch: Partial<AnyEl>, record = true) => {
        const fn = (d: EditorDoc) => ({
          ...d,
          elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as AnyEl) : e)),
        });
        record ? history.commit(fn) : history.replace(fn);
      },
      [history],
    );

    const removeElement = useCallback(
      (id: string) =>
        history.commit((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== id) })),
      [history],
    );

    const clearPage = useCallback(
      (pageIndex: number) =>
        history.commit((d) => ({
          ...d,
          elements: d.elements.filter((e) => e.page !== pageIndex),
        })),
      [history],
    );

    const rotatePage = useCallback(
      (pageIndex: number) =>
        history.commit((d) => ({
          ...d,
          rotations: { ...d.rotations, [pageIndex]: ((d.rotations[pageIndex] ?? 0) + 90) % 360 },
        })),
      [history],
    );

    const deletePage = useCallback(
      (pageIndex: number) =>
        history.commit((d) =>
          d.pageOrder.length <= 1
            ? d
            : {
                ...d,
                pageOrder: d.pageOrder.filter((p) => p !== pageIndex),
                elements: d.elements.filter((e) => e.page !== pageIndex),
              },
        ),
      [history],
    );

    /* --------------------------------------------------------- pointer io */
    const pointOn = (e: ReactPointerEvent, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };

    const eraseAt = useCallback(
      (pageIndex: number, x: number, y: number) => {
        const r = 0.015;
        history.replace((d) => {
          const keep = d.elements.filter((el) => {
            if (el.page !== pageIndex) return true;
            if (el.kind === "pen" || el.kind === "highlight")
              return !el.points.some((p) => Math.hypot(p.x - x, p.y - y) < r);
            if (el.kind === "text")
              return !(
                x > el.x - r &&
                x < el.x + 0.3 &&
                y > el.y - el.fontSize &&
                y < el.y + el.fontSize
              );
            if (el.kind !== "rect" && el.kind !== "ellipse" && el.kind !== "line") return true;
            const minX = Math.min(el.x, el.x + el.w);
            const minY = Math.min(el.y, el.y + el.h);
            return !(
              x > minX - r &&
              x < minX + Math.abs(el.w) + r &&
              y > minY - r &&
              y < minY + Math.abs(el.h) + r
            );
          });
          return keep.length === d.elements.length ? d : { ...d, elements: keep };
        });
      },
      [history],
    );

    const onPagePointerDown = (e: ReactPointerEvent<HTMLDivElement>, pageIndex: number) => {
      if (editingId) return;
      const host = e.currentTarget;
      const { x, y } = pointOn(e, host);
      setCurrent(pageOrder.indexOf(pageIndex));

      if (tool === "select") {
        setSelectedId(null);
        return;
      }
      host.setPointerCapture(e.pointerId);

      if (tool === "eraser") {
        history.commit((d) => d); // checkpoint before erasing
        eraseAt(pageIndex, x, y);
        return;
      }

      if (tool === "text") {
        const el: TextEl = {
          id: makeId(),
          kind: "text",
          page: pageIndex,
          x,
          y,
          text: "",
          color,
          size: 0,
          opacity: 1,
          fontSize: fontSize / (pages[pageIndex]?.height ?? 800),
          bold: false,
          italic: false,
        };
        addElement(el);
        setEditingId(el.id);
        setSelectedId(el.id);
        return;
      }

      const strokeSize = size / (pages[pageIndex]?.width ?? 600);
      if (tool === "pen" || tool === "highlight") {
        const el: StrokeEl = {
          id: makeId(),
          kind: tool,
          page: pageIndex,
          points: [{ x, y }],
          color: tool === "highlight" ? highlightColor : color,
          size: strokeSize,
          opacity: tool === "highlight" ? 0.35 : 1,
        };
        draftRef.current = el;
        setDraft(el);
        return;
      }

      const shape: ShapeEl = {
        id: makeId(),
        kind: tool,
        page: pageIndex,
        x,
        y,
        w: 0,
        h: 0,
        color,
        size: strokeSize,
        opacity: 1,
        fill,
      };
      draftRef.current = shape;
      setDraft(shape);
    };

    const onPagePointerMove = (e: ReactPointerEvent<HTMLDivElement>, pageIndex: number) => {
      const { x, y } = pointOn(e, e.currentTarget);
      if (tool === "eraser" && e.buttons === 1) {
        eraseAt(pageIndex, x, y);
        return;
      }
      const d = draftRef.current;
      if (!d) return;
      const next: AnyEl =
        d.kind === "pen" || d.kind === "highlight"
          ? { ...d, points: [...d.points, { x, y }] }
          : ({ ...(d as ShapeEl), w: x - (d as ShapeEl).x, h: y - (d as ShapeEl).y } as AnyEl);
      draftRef.current = next;
      setDraft(next);
    };

    const onPagePointerUp = () => {
      const d = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      if (!d) return;
      if ((d.kind === "pen" || d.kind === "highlight") && d.points.length < 2) return;
      if ((d.kind === "rect" || d.kind === "ellipse" || d.kind === "line") &&
          Math.abs(d.w) < 0.005 && Math.abs(d.h) < 0.005) return;
      addElement(d);
    };

    /* ---------------------------------------------------------- shortcuts */
    const onKeyDown = (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true']")) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? history.redo() : history.undo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeElement(selectedId);
        setSelectedId(null);
      } else if (e.key === "Escape") {
        setEditingId(null);
        setSelectedId(null);
      }
    };

    /* ------------------------------------------------------------- export */
    const exportPdf = async () => {
      if (!bytes) return;
      setExporting(true);
      try {
        const blob = await buildPdf({ bytes, pageOrder, rotations, elements });
        const url = createUrl(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName.replace(/\.pdf$/i, "") + "-edited.pdf";
        a.click();
        // release as soon as the download has been handed to the browser
        setTimeout(() => revokeUrl(url), 4000);
        toast.success("Exported your edited PDF");
      } catch (e) {
        console.error(e);
        toast.error("Export failed");
      } finally {
        setExporting(false);
      }
    };

    const visiblePages = useMemo(
      () => pageOrder.map((i) => pages.find((p) => p.index === i)!).filter(Boolean),
      [pageOrder, pages],
    );

    const searchPages = useMemo(
      () => new Set(search.hits.map((h) => h.page)),
      [search.hits],
    );

    useEffect(() => {
      const hit = search.hits[search.activeIdx];
      if (!hit) return;
      const idx = pageOrder.indexOf(hit.page);
      pageRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [search.activeIdx, search.hits, pageOrder]);

    /* ---------------------------------------------------------------- ui */
    if (!bytes) {
      return <Dropzone loading={loading} onFile={openFile} />;
    }

    const activeColor = tool === "highlight" ? highlightColor : color;

    return (
      <div
        className="flex h-screen flex-col bg-canvas outline-none"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <span className="mr-2 max-w-[14rem] truncate text-sm font-medium">{fileName}</span>

          <ToolGroup>
            <ToolBtn icon={MousePointer2} label="Select" active={tool === "select"} onClick={() => setTool("select")} />
            <ToolBtn icon={PenLine} label="Pen" active={tool === "pen"} onClick={() => setTool("pen")} />
            <ToolBtn icon={Highlighter} label="Highlighter" active={tool === "highlight"} onClick={() => setTool("highlight")} />
            <ToolBtn icon={Eraser} label="Eraser" active={tool === "eraser"} onClick={() => setTool("eraser")} />
            <ToolBtn icon={Type} label="Text" active={tool === "text"} onClick={() => setTool("text")} />
            <ToolBtn icon={Square} label="Rectangle" active={tool === "rect"} onClick={() => setTool("rect")} />
            <ToolBtn icon={Circle} label="Ellipse" active={tool === "ellipse"} onClick={() => setTool("ellipse")} />
            <ToolBtn icon={Minus} label="Line" active={tool === "line"} onClick={() => setTool("line")} />
          </ToolGroup>

          <ToolGroup>
            {(tool === "highlight" ? HIGHLIGHT_PALETTE : PALETTE).map((c) => (
              <button
                key={c}
                aria-label={`Colour ${c}`}
                onClick={() => (tool === "highlight" ? setHighlightColor(c) : setColor(c))}
                style={{ backgroundColor: c }}
                className={cn(
                  "size-5 rounded-full border border-border transition",
                  activeColor === c && "ring-2 ring-ring ring-offset-2 ring-offset-surface",
                )}
              />
            ))}
          </ToolGroup>

          {tool === "text" ? (
            <ToolGroup>
              <span className="text-xs text-muted-foreground">Size</span>
              <input
                type="range"
                min={8}
                max={72}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-24 accent-[var(--brand)]"
              />
              <span className="w-6 text-xs tabular-nums">{fontSize}</span>
            </ToolGroup>
          ) : (
            <ToolGroup>
              <span className="text-xs text-muted-foreground">Brush</span>
              <input
                type="range"
                min={1}
                max={24}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="w-24 accent-[var(--brand)]"
              />
              <span className="w-6 text-xs tabular-nums">{size}</span>
              {(tool === "rect" || tool === "ellipse") && (
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
                  Fill
                </label>
              )}
            </ToolGroup>
          )}

          <ToolGroup>
            <ToolBtn icon={Undo2} label="Undo" disabled={!history.canUndo} onClick={history.undo} />
            <ToolBtn icon={Redo2} label="Redo" disabled={!history.canRedo} onClick={history.redo} />
          </ToolGroup>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                value={search.query}
                onChange={(e) => search.setQuery(e.target.value)}
                placeholder="Search text"
                className="w-28 bg-transparent text-xs outline-none"
              />
              {search.searching ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : search.hits.length > 0 ? (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {search.activeIdx + 1}/{search.hits.length}
                  <button aria-label="Previous match" onClick={() => search.step(-1)}>
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <button aria-label="Next match" onClick={() => search.step(1)}>
                    <ChevronRight className="size-3.5" />
                  </button>
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              <ToolBtn icon={Minus} label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))} />
              <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <ToolBtn icon={Plus} label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.15))} />
            </div>

            <button onClick={exportPdf} disabled={exporting} className="btn-brand">
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Export
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-40 shrink-0 overflow-y-auto border-r border-border bg-surface p-2 md:block">
            {visiblePages.map((p, i) => (
              <div key={p.id} className="group relative mb-2">
                <button
                  onClick={() => pageRefs.current[i]?.scrollIntoView({ behavior: "smooth" })}
                  className={cn(
                    "flex aspect-[3/4] w-full items-center justify-center rounded-md border bg-background text-xs text-muted-foreground transition",
                    i === current ? "border-[var(--brand)]" : "border-border hover:border-ring",
                    searchPages.has(p.index) && "ring-1 ring-[var(--brand)]",
                  )}
                >
                  Page {i + 1}
                </button>
                <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                  <IconMini label="Rotate page" icon={RotateCw} onClick={() => rotatePage(p.index)} />
                  <IconMini label="Clear annotations" icon={X} onClick={() => clearPage(p.index)} />
                  <IconMini label="Delete page" icon={Trash2} onClick={() => deletePage(p.index)} />
                </div>
              </div>
            ))}
          </aside>

          <main className="flex-1 overflow-auto p-6">
            <div className="mx-auto flex w-fit flex-col items-center gap-6">
              {visiblePages.map((p, i) => (
                <PageView
                  key={p.id}
                  ref={(node) => {
                    pageRefs.current[i] = node;
                  }}
                  doc={doc}
                  meta={p}
                  rotation={rotations[p.index] ?? 0}
                  zoom={zoom}
                  tool={tool}
                  elements={elements.filter((e) => e.page === p.index)}
                  draft={draft && draft.page === p.index ? draft : null}
                  selectedId={selectedId}
                  editingId={editingId}
                  onSelect={setSelectedId}
                  onEdit={setEditingId}
                  onChangeText={(id, text) => updateElement(id, { text } as Partial<AnyEl>, false)}
                  onCommitText={(id, text) => {
                    if (!text.trim()) removeElement(id);
                    else updateElement(id, { text } as Partial<AnyEl>);
                    setEditingId(null);
                  }}
                  onPointerDown={(e) => onPagePointerDown(e, p.index)}
                  onPointerMove={(e) => onPagePointerMove(e, p.index)}
                  onPointerUp={onPagePointerUp}
                />
              ))}
            </div>
          </main>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ page */

  import { forwardRef } from "react";

  type PageViewProps = {
    doc: Doc | null;
    meta: PageMeta;
    rotation: number;
    zoom: number;
    tool: Tool;
    elements: AnyEl[];
    draft: AnyEl | null;
    selectedId: string | null;
    editingId: string | null;
    onSelect: (id: string | null) => void;
    onEdit: (id: string | null) => void;
    onChangeText: (id: string, text: string) => void;
    onCommitText: (id: string, text: string) => void;
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: () => void;
  };

  const PageView = forwardRef<HTMLDivElement, PageViewProps>(function PageView(props, ref) {
    const { doc, meta, rotation, zoom, tool, elements, draft } = props;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const width = (rotation % 180 === 0 ? meta.width : meta.height) * zoom;
    const height = (rotation % 180 === 0 ? meta.height : meta.width) * zoom;

    useEffect(() => {
      let cancelled = false;
      (async () => {
        if (!doc || !canvasRef.current) return;
        const page = await doc.getPage(meta.index + 1);
        if (cancelled || !canvasRef.current) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: zoom * dpr, rotation });
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      })();
      return () => {
        cancelled = true;
      };
    }, [doc, meta.index, zoom, rotation]);

    const editing = elements.find((e) => e.id === props.editingId && e.kind === "text") as
      | TextEl
      | undefined;

    return (
      <div
        ref={ref}
        className="relative shadow-page"
        style={{ width, height }}
        onPointerDown={props.onPointerDown}
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
        onPointerCancel={props.onPointerUp}
      >
        <canvas ref={canvasRef} className="block size-full rounded-sm bg-white" />
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className={cn(
            "absolute inset-0 size-full",
            tool === "select" ? "" : tool === "eraser" ? "cursor-cell" : "cursor-crosshair",
          )}
        >
          {[...elements, ...(draft ? [draft] : [])].map((el) => (
            <ElementView
              key={el.id}
              el={el}
              selected={el.id === props.selectedId}
              interactive={tool === "select"}
              onSelect={props.onSelect}
              onEdit={props.onEdit}
              hidden={el.id === props.editingId}
            />
          ))}
        </svg>

        {editing && (
          <textarea
            autoFocus
            value={editing.text}
            onChange={(e) => props.onChangeText(editing.id, e.target.value)}
            onBlur={(e) => props.onCommitText(editing.id, e.target.value)}
            style={{
              left: `${editing.x * 100}%`,
              top: `${editing.y * 100}%`,
              color: editing.color,
              fontSize: editing.fontSize * height,
              lineHeight: 1.1,
            }}
            className="absolute min-h-[1.4em] w-64 resize-none rounded border border-dashed border-[var(--brand)] bg-transparent p-0 font-sans outline-none"
          />
        )}
      </div>
    );
  });

  function ElementView({
    el,
    selected,
    interactive,
    hidden,
    onSelect,
    onEdit,
  }: {
    el: AnyEl;
    selected: boolean;
    interactive: boolean;
    hidden: boolean;
    onSelect: (id: string) => void;
    onEdit: (id: string) => void;
  }) {
    if (hidden) return null;
    const common = {
      onPointerDown: interactive
        ? (e: ReactPointerEvent) => {
            e.stopPropagation();
            onSelect(el.id);
          }
        : undefined,
      onDoubleClick: el.kind === "text" ? () => onEdit(el.id) : undefined,
      style: { pointerEvents: interactive ? ("auto" as const) : ("none" as const) },
      opacity: el.opacity,
      className: cn(selected && "outline outline-1 outline-[var(--brand)]"),
    };

    if (el.kind === "pen" || el.kind === "highlight") {
      return (
        <polyline
          {...common}
          points={el.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={el.color}
          strokeWidth={el.kind === "highlight" ? el.size * 3 : el.size}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={el.opacity}
        />
      );
    }

    if (el.kind === "line") {
      return (
        <line
          {...common}
          x1={el.x}
          y1={el.y}
          x2={el.x + el.w}
          y2={el.y + el.h}
          stroke={el.color}
          strokeWidth={el.size}
          strokeLinecap="round"
        />
      );
    }

    if (el.kind === "rect") {
      return (
        <rect
          {...common}
          x={Math.min(el.x, el.x + el.w)}
          y={Math.min(el.y, el.y + el.h)}
          width={Math.abs(el.w)}
          height={Math.abs(el.h)}
          fill={el.fill ? el.color : "none"}
          stroke={el.color}
          strokeWidth={el.fill ? 0 : el.size}
        />
      );
    }

    if (el.kind === "ellipse") {
      return (
        <ellipse
          {...common}
          cx={el.x + el.w / 2}
          cy={el.y + el.h / 2}
          rx={Math.abs(el.w / 2)}
          ry={Math.abs(el.h / 2)}
          fill={el.fill ? el.color : "none"}
          stroke={el.color}
          strokeWidth={el.fill ? 0 : el.size}
        />
      );
    }

    if (el.kind !== "text") return null;

    return (
      <text
        {...common}
        x={el.x}
        y={el.y + el.fontSize}
        fill={el.color}
        fontSize={el.fontSize}
        fontFamily="Helvetica, Arial, sans-serif"
        fontWeight={el.bold ? 700 : 400}
        fontStyle={el.italic ? "italic" : "normal"}
        style={{ ...common.style, whiteSpace: "pre" }}
      >
        {el.text}
      </text>
    );
  }

  /* ---------------------------------------------------------------- chrome */

  function ToolGroup({ children }: { children: React.ReactNode }) {
    return (
      <div className="flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1">
        {children}
      </div>
    );
  }

  function ToolBtn({
    icon: Icon,
    label,
    active,
    disabled,
    onClick,
  }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick?: () => void;
  }) {
    return (
      <button
        title={label}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "grid size-8 place-items-center rounded transition",
          active ? "bg-[var(--brand)] text-[var(--brand-foreground)]" : "hover:bg-accent",
          disabled && "opacity-35",
        )}
      >
        <Icon className="size-4" />
      </button>
    );
  }

  function IconMini({
    icon: Icon,
    label,
    onClick,
  }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
  }) {
    return (
      <button
        title={label}
        aria-label={label}
        onClick={onClick}
        className="grid size-6 place-items-center rounded bg-surface/90 text-foreground shadow hover:bg-accent"
      >
        <Icon className="size-3" />
      </button>
    );
  }

  function Dropzone({ loading, onFile }: { loading: boolean; onFile: (f: File) => void }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Ink — PDF editor</h1>
          <p className="mt-3 text-muted-foreground">
            Draw, highlight, erase, add text and shapes, rotate or remove pages, then export a
            real PDF. Everything happens in your browser.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
            className={cn(
              "mt-8 rounded-xl border-2 border-dashed p-12 transition",
              over ? "border-[var(--brand)] bg-surface" : "border-border",
            )}
          >
            {loading ? (
              <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Upload className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">Drop a PDF here</p>
                <button className="btn-brand mx-auto mt-5" onClick={() => inputRef.current?.click()}>
                  Choose file
                </button>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </div>
    );
  }
