import type { CSSProperties, MutableRefObject } from "react";
import type { AnyElement } from "@/lib/pdf-annotations";

export type EditorPage = {
  id: string;
  originalIndex: number;
  rotation: number;
  selected: boolean;
  isBlank?: boolean;
};

export type EditorApplyState = { pages: EditorPage[]; selectedIds: Set<string> };
export type EditorApplyResult = { blob: Blob; filename: string } | void | undefined;

export type Phase = "reading" | "rendering" | "ready" | "error";

export type Tool =
  | "select" | "hand" | "text" | "draw" | "eraser"
  | "shape-rect" | "shape-ellipse" | "shape-line" | "shape-arrow"
  | "shape-triangle" | "shape-star" | "shape-rounded-rect" | "shape-speech"
  | "highlight" | "underline" | "strikeout" | "squiggly"
  | "image" | "signature" | "whiteout" | "sticky"
  | "field-text" | "field-checkbox" | "field-radio" | "field-dropdown";

export type PdfPage = {
  getViewport: (options: { scale: number; rotation?: number }) => { width: number; height: number };
  render: (options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
  getTextContent?: () => Promise<{ items: { str: string }[] }>;
};

export type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };

export type DrawStroke = { color: string; width: number };
export type HighlightSettings = { color: string; opacity: number };
export type ShapeDefaults = {
  stroke: string;
  strokeWidth: number;
  fill: string | null;
  dash: "solid" | "dashed" | "dotted";
};

export type PanState = {
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
  el: HTMLElement;
};

export type ElementPatch = Partial<AnyElement>;
export type ElementUpdate = (id: string, patch: ElementPatch) => void;
export type ElementBulkUpdate = (ids: Set<string>, patchFn: (element: AnyElement) => ElementPatch) => void;

export type ContextualToolbarAnchor = {
  left: number;
  top: number;
  width: number;
  height: number;
} | null;

export type EditorCanvasProps = {
  pdf: PdfDoc | null;
  pages: EditorPage[];
  zoom: number;
  fitMode: "width" | "page" | "custom";
  current: number;
  onCurrentChange: (index: number) => void;
  elements: AnyElement[];
  activeTool: Tool;
  selectedIds: Set<string>;
  onSetSelectedIds: (ids: Set<string>) => void;
  onAddElement: (element: AnyElement) => void;
  onAddElementKeepTool: (element: AnyElement) => void;
  onAddTextAt: (pageId: string, x: number, y: number) => void;
  onBeginTextEdit: (id: string) => void;
  onFinishTextEdit: (id: string, text: string, cancel?: boolean) => void;
  editingTextId: string | null;
  onUpdateElement: ElementUpdate;
  onUpdateElements: ElementBulkUpdate;
  onDuplicateElements: (ids: Set<string>) => void;
  onReplaceElements: (toRemove: string[], toAdd: AnyElement[]) => void;
  panStateRef: MutableRefObject<PanState | null>;
  drawStroke: DrawStroke;
  eraserSize: number;
  highlightSettings: HighlightSettings;
  shapeDefaults: ShapeDefaults;
  onSelectionRectChange?: (rect: ContextualToolbarAnchor) => void;
};

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const RESIZE_HANDLE_STYLE: Record<ResizeHandle, CSSProperties> = {
  nw: { left: -6, top: -6, cursor: "nwse-resize" },
  n: { left: "50%", top: -6, transform: "translateX(-50%)", cursor: "ns-resize" },
  ne: { right: -6, top: -6, cursor: "nesw-resize" },
  e: { right: -6, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
  se: { right: -6, bottom: -6, cursor: "nwse-resize" },
  s: { left: "50%", bottom: -6, transform: "translateX(-50%)", cursor: "ns-resize" },
  sw: { left: -6, bottom: -6, cursor: "nesw-resize" },
  w: { left: -6, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
};
