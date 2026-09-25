import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import type { AnyElement } from "@/lib/pdf-annotations";
import { AnnotationLayer } from "./AnnotationLayer";
import type { EditorPage, Phase, Tool } from "./editor-types";

type PdfPage = {
  getViewport: (o: { scale: number; rotation?: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };

type DrawStroke = { color: string; width: number };
type HighlightSettings = { color: string; opacity: number };
type ShapeDefaults = { stroke: string; strokeWidth: number; fill: string | null; dash: "solid" | "dashed" | "dotted" };

type Props = {
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
  onAddTextAt: (pageId: string, x: number, y: number) => void;
  onBeginTextEdit: (id: string) => void;
  onFinishTextEdit: (id: string, text: string, cancel?: boolean) => void;
  editingTextId: string | null;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => void;
  onDuplicateElements: (ids: Set<string>) => void;
  onReplaceElements: (toRemove: string[], toAdd: AnyElement[]) => void;
  onSelectionRectChange: (rect: DOMRect | null) => void;
  onZoomChange: (zoom: number) => void;
  onFitWidth: () => void;
  panStateRef: MutableRefObject<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; el: HTMLElement } | null>;
  drawStroke: DrawStroke;
  eraserSize: number;
  highlightSettings: HighlightSettings;
  shapeDefaults: ShapeDefaults;
};

export function EditorCanvas(props: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [visible, setVisible] = useState<Set<number>>(new Set([0]));

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const baseScale = useMemo(() => {
    if (!props.pdf) return 1.5;
    if (props.fitMode === "custom") return 1.5 * props.zoom;
    return props.fitMode === "width" ? 1.5 : 1.2;
  }, [props.pdf, props.fitMode, props.zoom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-page-index]")) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      setVisible((prev) => {
        const next = new Set(prev);
        entries.forEach((entry) => {
          const idx = Number.parseInt((entry.target as Element).getAttribute("data-page-index") || "-1", 10);
          if (idx < 0) return;
          if (entry.isIntersecting) next.add(idx); else next.delete(idx);
        });
        return next;
      });
      const top = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) {
        const idx = Number.parseInt((top.target as Element).getAttribute("data-page-index") || "-1", 10);
        if (idx >= 0) props.onCurrentChange(idx);
      }
    }, { root: el, rootMargin: "50% 0px", threshold: 0 });
    items.forEach((item) => io.observe(item));
    return () => io.disconnect();
  }, [props.pages.length, props.onCurrentChange]);

  function onContainerPointerDown(e: ReactPointerEvent) {
    if (props.activeTool !== "hand") return;
    const el = containerRef.current;
    if (!el) return;
    props.panStateRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, el };
    const onMove = (event: PointerEvent) => {
      const state = props.panStateRef.current;
      if (!state) return;
      state.el.scrollLeft = state.scrollLeft - (event.clientX - state.startX);
      state.el.scrollTop = state.scrollTop - (event.clientY - state.startY);
    };
    const cleanup = () => {
      props.panStateRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  return (
    <div ref={containerRef} onPointerDown={onContainerPointerDown} className="relative h-full w-full overflow-auto bg-[#f4f5f7] dark:bg-slate-950" style={{ cursor: props.activeTool === "hand" ? "grab" : undefined }}>
      <div className="flex min-h-full flex-col items-center gap-8 px-4 py-10 pb-36">
        {props.pages.map((page, index) => (
          <PagePane
            key={page.id}
            index={index}
            page={page}
            pdf={props.pdf!}
            visible={visible.has(index)}
            containerWidth={containerSize.w}
            containerHeight={containerSize.h}
            fitMode={props.fitMode}
            baseScale={baseScale}
            selectionMode={props.selectionMode}
            onToggleSelect={() => props.onToggleSelect(index)}
            elements={props.elements.filter((element) => element.pageId === page.id)}
            activeTool={props.activeTool}
            selectedIds={props.selectedIds}
            onSetSelectedIds={props.onSetSelectedIds}
            onAddElement={props.onAddElement}
            onAddElementKeepTool={props.onAddElementKeepTool}
            onAddTextAt={props.onAddTextAt}
            onBeginTextEdit={props.onBeginTextEdit}
            onFinishTextEdit={props.onFinishTextEdit}
            editingTextId={props.editingTextId}
            onUpdateElement={props.onUpdateElement}
            onUpdateElements={props.onUpdateElements}
            onDuplicateElements={props.onDuplicateElements}
            onReplaceElements={props.onReplaceElements}
            onSelectionRectChange={props.onSelectionRectChange}
            drawStroke={props.drawStroke}
            eraserSize={props.eraserSize}
            highlightSettings={props.highlightSettings}
            shapeDefaults={props.shapeDefaults}
          />
        ))}
      </div>
      <div className="pointer-events-none fixed bottom-5 right-5 z-30 flex items-center gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button type="button" aria-label="Zoom out" onClick={() => props.onZoomChange(Math.max(0.5, +(props.zoom - 0.1).toFixed(2)))} className="pointer-events-auto grid h-8 w-8 place-items-center rounded-xl text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">−</button>
        <button type="button" aria-label="Fit width" onClick={props.onFitWidth} className="pointer-events-auto min-w-14 rounded-xl px-2 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">{props.fitMode === "custom" ? `${Math.round(props.zoom * 100)}%` : "Fit"}</button>
        <button type="button" aria-label="Zoom in" onClick={() => props.onZoomChange(Math.min(3, +(props.zoom + 0.1).toFixed(2)))} className="pointer-events-auto grid h-8 w-8 place-items-center rounded-xl text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">+</button>
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
  baseScale: number;
  selectionMode: boolean;
  onToggleSelect: () => void;
  elements: AnyElement[];
  activeTool: Tool;
  selectedIds: Set<string>;
  onSetSelectedIds: (ids: Set<string>) => void;
  onAddElement: (el: AnyElement) => void;
  onAddElementKeepTool: (el: AnyElement) => void;
  onAddTextAt: (pageId: string, x: number, y: number) => void;
  onBeginTextEdit: (id: string) => void;
  onFinishTextEdit: (id: string, text: string, cancel?: boolean) => void;
  editingTextId: string | null;
  onUpdateElement: (id: string, patch: Partial<AnyElement>) => void;
  onUpdateElements: (ids: Set<string>, patchFn: (e: AnyElement) => Partial<AnyElement>) => void;
  onDuplicateElements: (ids: Set<string>) => void;
  onReplaceElements: (toRemove: string[], toAdd: AnyElement[]) => void;
  onSelectionRectChange: (rect: DOMRect | null) => void;
  onZoomChange: (zoom: number) => void;
  onFitWidth: () => void;
  drawStroke: DrawStroke;
  eraserSize: number;
  highlightSettings: HighlightSettings;
  shapeDefaults: ShapeDefaults;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (props.page.isBlank) {
      setDims({ w: 595, h: 842 });
      setRendered(true);
      return () => { cancelled = true; };
    }
    void (async () => {
      try {
        const page = await props.pdf.getPage(props.page.originalIndex + 1);
        const viewport = page.getViewport({ scale: 1, rotation: props.page.rotation });
        if (!cancelled) setDims({ w: viewport.width, h: viewport.height });
      } catch { /* render failure is handled by the page state */ }
    })();
    return () => { cancelled = true; };
  }, [props.pdf, props.page.originalIndex, props.page.rotation, props.page.isBlank]);

  const scale = useMemo(() => {
    if (!dims) return 1;
    if (props.fitMode === "custom") return props.baseScale;
    const pad = 16;
    if (props.fitMode === "width") return Math.max(320, props.containerWidth - pad) / dims.w;
    return Math.min(Math.max(320, props.containerWidth - pad) / dims.w, Math.max(320, props.containerHeight - pad) / dims.h);
  }, [dims, props.fitMode, props.baseScale, props.containerWidth, props.containerHeight]);

  const displayW = dims ? dims.w * scale : 600;
  const displayH = dims ? dims.h * scale : 800;

  useEffect(() => {
    if (!props.visible || !dims || props.page.isBlank) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await props.pdf.getPage(props.page.originalIndex + 1);
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        const viewport = page.getViewport({ scale: Math.max(scale, 1) * dpr, rotation: props.page.rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${Math.ceil(displayW)}px`;
        canvas.style.height = `${Math.ceil(displayH)}px`;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx || cancelled) return;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (!cancelled) setRendered(true);
      } catch { /* page errors remain isolated to this page */ }
    })();
    return () => { cancelled = true; };
  }, [props.visible, dims, scale, props.pdf, props.page.originalIndex, props.page.rotation, displayW, displayH]);

  const rotation = ((Math.round(props.page.rotation) % 360) + 360) % 360 as 0 | 90 | 180 | 270;
  const unrotatedPageWidth = rotation === 90 || rotation === 270 ? (dims?.h ?? 842) : (dims?.w ?? 595);
  const unrotatedPageHeight = rotation === 90 || rotation === 270 ? (dims?.w ?? 595) : (dims?.h ?? 842);

  return (
    <div
      id={`pdf-page-${props.index}`}
      data-page-index={props.index}
      className={cn(
        "group relative overflow-hidden bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.28)]",
        props.selectionMode && "cursor-pointer",
      )}
      style={{ width: displayW, height: displayH }}
      onClick={props.selectionMode ? props.onToggleSelect : undefined}
    >
      <canvas ref={canvasRef} className="block h-full w-full bg-white" />
      {!rendered && !props.page.isBlank && <div className="absolute inset-0 grid animate-pulse place-items-center bg-slate-50 text-xs text-slate-400 dark:bg-slate-900 dark:text-slate-500">Rendering…</div>}
      {dims && (
        <AnnotationLayer
          pageId={props.page.id}
          scale={scale}
          elements={props.elements}
          activeTool={props.activeTool}
          selectedIds={props.selectedIds}
          onSetSelectedIds={props.onSetSelectedIds}
          onAddElement={props.onAddElement}
          onAddElementKeepTool={props.onAddElementKeepTool}
          onAddTextAt={props.onAddTextAt}
          onBeginTextEdit={props.onBeginTextEdit}
          onFinishTextEdit={props.onFinishTextEdit}
          editingTextId={props.editingTextId}
          onUpdateElement={props.onUpdateElement}
          onUpdateElements={props.onUpdateElements}
          onDuplicateElements={props.onDuplicateElements}
          onReplaceElements={props.onReplaceElements}
          onSelectionRectChange={props.onSelectionRectChange}
          interactive={props.activeTool !== "hand"}
          drawStroke={props.drawStroke}
          eraserSize={props.eraserSize}
          highlightSettings={props.highlightSettings}
          shapeDefaults={props.shapeDefaults}
          pageRotation={rotation}
          unrotatedPageWidth={unrotatedPageWidth}
          unrotatedPageHeight={unrotatedPageHeight}
        />
      )}
    </div>
  );
}
