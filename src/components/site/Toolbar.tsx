import { useEffect, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold,
  Copy,
  Download,
  Eraser,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Layers,
  Loader2,
  MessageSquare,
  Minus,
  MoreHorizontal,
  MousePointer2,
  PenLine,
  PenTool,
  RotateCw,
  Search,
  Square,
  Star,
  Trash2,
  Triangle,
  Type,
  Underline,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FONT_OPTIONS,
  type AnyElement,
  type ImageElement,
  type ShapeElement,
  type TextElement,
} from "@/lib/pdf-annotations";
import type { EditorPage, Tool } from "./editor-types";

const GOOGLE_FONTS = [
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
  "DM Sans",
  "Space Grotesk",
  "IBM Plex Sans",
  "Roboto Mono",
  "Caveat",
  "Pacifico",
  "Dancing Script",
  "Great Vibes",
  "Shadows Into Light",
  "Indie Flower",
];

type ShapeDash = "solid" | "dashed" | "dotted";

type ShapeDefaults = {
  stroke: string;
  strokeWidth: number;
  fill: string | null;
  dash: ShapeDash;
};

type Props = {
  fileName: string;
  pageCount: number;
  saveStatus: "saved" | "unsaved" | "saving";
  actionLabel: string;
  busy: boolean;
  processing: boolean;

  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onApply: () => void;
  onReplace: () => void;

  activeTool: Tool;
  activeShape: Tool;
  annotateDisabled: boolean;
  editingTextId: string | null;

  selectedIds: Set<string>;
  selectedElements: AnyElement[];

  current: number;
  pages: EditorPage[];

  showSearch: boolean;
  searchQuery: string;
  searchResults: {
    pageIndex: number;
    snippet: string;
  }[];
  searchActiveIdx: number;
  searching: boolean;

  onSearchToggle: () => void;
  onSearch: (query: string) => void;
  onSearchJump: (index: number) => void;
  onSearchClose: () => void;

  onSetActiveTool: (tool: Tool) => void;
  onSetActiveShape: (tool: Tool) => void;

  onOpenImage: () => void;
  onOpenSignature: () => void;

  onDelete: () => void;
  onDuplicate: () => void;

  onUpdateElement: (
    id: string,
    patch: Partial<AnyElement>,
  ) => void;

  onUpdateElements: (
    ids: Set<string>,
    patchFn: (element: AnyElement) => Partial<AnyElement>,
  ) => void;

  onAlign: (
    mode:
      | "left"
      | "center"
      | "right"
      | "top"
      | "middle"
      | "bottom",
  ) => void;

  onDistribute: (
    axis: "horizontal" | "vertical",
  ) => void;

  onReorder: (
    dir:
      | "forward"
      | "backward"
      | "front"
      | "back",
  ) => void;

  onOpenImageForSelected: () => void;

  onLoadCustomFont: (
    id: string,
    family: string,
  ) => void;

  selectionRect: DOMRect | null;

  drawStroke: {
    color: string;
    width: number;
  };

  setDrawStroke: (value: {
    color: string;
    width: number;
  }) => void;

  eraserSize: number;
  setEraserSize: (value: number) => void;

  highlightSettings: {
    color: string;
    opacity: number;
  };

  setHighlightSettings: (value: {
    color: string;
    opacity: number;
  }) => void;

  shapeDefaults: ShapeDefaults;

  setShapeDefaults: (
    value: ShapeDefaults,
  ) => void;

  thumbs: Record<number, string>;

  showPagePanel: boolean;
  onTogglePagePanel: () => void;

  onPageClick: (index: number) => void;
  onRotatePage: (
    index: number,
    delta: number,
  ) => void;
  onDeletePage: (index: number) => void;
  onDuplicatePage: (index: number) => void;
  onInsertBlankPage: (
    index: number,
  ) => void;
  onMovePage: (
    from: number,
    to: number,
  ) => void;
};

function ToolButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5",
        "text-xs font-medium transition-all duration-150",
        "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
        "dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white",
        active &&
          "bg-red-50 text-[#DC2626] shadow-sm dark:bg-red-500/15 dark:text-red-300",
        disabled &&
          "pointer-events-none opacity-30",
      )}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>

      <span className="hidden lg:inline">
        {label}
      </span>
    </button>
  );
}

function Divider() {
  return (
    <div className="mx-1 h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-800" />
  );
}

function SmallButton({
  icon,
  title,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
        "text-slate-500 transition-colors",
        "hover:bg-slate-100 hover:text-slate-900",
        "dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white",
        active &&
          "bg-red-50 text-[#DC2626] dark:bg-red-500/15 dark:text-red-300",
        disabled &&
          "pointer-events-none opacity-30",
      )}
    >
      {icon}
    </button>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  width = "w-16",
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  width?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex h-8 shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-900">
      <span className="text-[10px] font-semibold text-slate-400">
        {label}
      </span>

      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        onChange={(event) =>
          onChange(
            Number(event.target.value),
          )
        }
        className={cn(
          width,
          "bg-transparent text-xs font-medium text-slate-700 outline-none",
          "dark:text-slate-200",
        )}
      />
    </label>
  );
}

function ColorButton({
  value,
  title,
  disabled = false,
  onChange,
}: {
  value: string;
  title: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label
      title={title}
      className={cn(
        "relative grid h-8 w-8 shrink-0 cursor-pointer place-items-center",
        "overflow-hidden rounded-xl border border-slate-200 bg-white",
        "dark:border-slate-700 dark:bg-slate-900",
        disabled &&
          "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className="h-4 w-4 rounded-full border border-black/10"
        style={{ backgroundColor: value }}
      />

      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

export function Toolbar(props: Props) {
  const [moreOpen, setMoreOpen] =
    useState(false);

  const [shapeOpen, setShapeOpen] =
    useState(false);

  useEffect(() => {
    if (!moreOpen && !shapeOpen) {
      return;
    }

    const onPointerDown = (
      event: PointerEvent,
    ) => {
      const target =
        event.target as HTMLElement | null;

      if (
        target?.closest(
          "[data-toolbar-popover]",
        )
      ) {
        return;
      }

      setMoreOpen(false);
      setShapeOpen(false);
    };

    document.addEventListener(
      "pointerdown",
      onPointerDown,
    );

    return () =>
      document.removeEventListener(
        "pointerdown",
        onPointerDown,
      );
  }, [moreOpen, shapeOpen]);

  const shapeTools: {
    tool: Tool;
    label: string;
    icon: ReactNode;
  }[] = [
    {
      tool: "shape-rect",
      label: "Rectangle",
      icon: <Square />,
    },
    {
      tool: "shape-ellipse",
      label: "Ellipse",
      icon: (
        <span className="text-lg leading-none">
          ○
        </span>
      ),
    },
    {
      tool: "shape-line",
      label: "Line",
      icon: <Minus />,
    },
    {
      tool: "shape-arrow",
      label: "Arrow",
      icon: <ArrowRight />,
    },
    {
      tool: "shape-triangle",
      label: "Triangle",
      icon: <Triangle />,
    },
    {
      tool: "shape-star",
      label: "Star",
      icon: <Star />,
    },
    {
      tool: "shape-rounded-rect",
      label: "Rounded",
      icon: (
        <span className="text-base leading-none">
          ▢
        </span>
      ),
    },
    {
      tool: "shape-speech",
      label: "Bubble",
      icon: <MessageSquare />,
    },
  ];

  const single =
    props.selectedElements.length === 1
      ? props.selectedElements[0]
      : null;

  const selectedText =
    single?.type === "text"
      ? (single as TextElement)
      : null;

  const selectedShape =
    single &&
    [
      "rect",
      "ellipse",
      "line",
      "arrow",
      "triangle",
      "star",
      "rounded-rect",
      "speech",
    ].includes(single.type)
      ? (single as ShapeElement)
      : null;

  const selectedImage =
    single?.type === "image"
      ? (single as ImageElement)
      : null;

  const multi =
    props.selectedElements.length > 1;

  const toolIsActive = (
    tool: Tool,
  ) =>
    props.activeTool === tool;

  const hasSelection =
    props.selectedElements.length >
    0;

  return (
    <div className="relative z-50 shrink-0 bg-white dark:bg-slate-950">
      {/* ======================================================
          HEADER
      ====================================================== */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 px-3 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/95">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={props.onReplace}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            title="Back"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />

          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-600 text-[9px] font-black text-white">
            PDF
          </div>

          <div className="min-w-0">
            <div className="max-w-[280px] truncate text-sm font-semibold text-slate-900 dark:text-white">
              {props.fileName}
            </div>

            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
              <span>
                {props.pageCount}{" "}
                {props.pageCount === 1
                  ? "page"
                  : "pages"}
              </span>

              <span>·</span>

              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    props.saveStatus ===
                      "saved" &&
                      "bg-emerald-500",
                    props.saveStatus ===
                      "unsaved" &&
                      "bg-amber-500",
                    props.saveStatus ===
                      "saving" &&
                      "animate-pulse bg-slate-400",
                  )}
                />

                {props.saveStatus ===
                "saving"
                  ? "Saving…"
                  : props.saveStatus ===
                      "saved"
                    ? "Saved"
                    : "Unsaved changes"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ToolButton
            icon={<Undo2 />}
            label="Undo"
            disabled={!props.canUndo}
            onClick={props.onUndo}
          />

          <ToolButton
            icon={<Redo2 />}
            label="Redo"
            disabled={!props.canRedo}
            onClick={props.onRedo}
          />

          <ToolButton
            icon={<Search />}
            label="Search"
            active={props.showSearch}
            onClick={props.onSearchToggle}
          />

          <Divider />

          <button
            type="button"
            onClick={props.onApply}
            disabled={
              props.processing ||
              props.busy
            }
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-3.5 text-xs font-semibold text-white shadow-[0_8px_24px_-12px_rgba(220,38,38,0.95)] transition-colors hover:bg-red-700 disabled:pointer-events-none disabled:opacity-60"
          >
            {props.processing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}

            <span className="hidden sm:inline">
              {props.processing
                ? "Saving…"
                : props.actionLabel ||
                  "Save changes"}
            </span>
          </button>
        </div>
      </header>

      {/* ======================================================
          SEARCH
      ====================================================== */}
      {props.showSearch && (
        <div className="border-b border-slate-200/80 bg-white px-3 py-2 dark:border-slate-800/80 dark:bg-slate-950">
          <div className="mx-auto flex max-w-[1100px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />

            <input
              autoFocus
              value={props.searchQuery}
              onChange={(event) =>
                props.onSearch(
                  event.target.value,
                )
              }
              placeholder="Search in document…"
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
            />

            {props.searching && (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            )}

            {!props.searching &&
              props.searchQuery && (
                <span className="shrink-0 text-xs text-slate-400">
                  {props.searchResults
                    .length
                    ? `${
                        props.searchActiveIdx +
                        1
                      } / ${
                        props.searchResults
                          .length
                      }`
                    : "No results"}
                </span>
              )}

            <SmallButton
              icon={<ArrowUp />}
              title="Previous result"
              disabled={
                !props.searchResults
                  .length
              }
              onClick={() =>
                props.onSearchJump(
                  props.searchActiveIdx -
                    1,
                )
              }
            />

            <SmallButton
              icon={<ArrowDown />}
              title="Next result"
              disabled={
                !props.searchResults
                  .length
              }
              onClick={() =>
                props.onSearchJump(
                  props.searchActiveIdx +
                    1,
                )
              }
            />

            <SmallButton
              icon={<X />}
              title="Close search"
              onClick={
                props.onSearchClose
              }
            />
          </div>
        </div>
      )}

      {/* ======================================================
          MAIN TOOLBAR
      ====================================================== */}
      <nav className="relative z-40 border-b border-slate-200/80 bg-white/95 px-3 py-1.5 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/95">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          <ToolButton
            icon={<MousePointer2 />}
            label="Select"
            active={toolIsActive(
              "select",
            )}
            onClick={() =>
              props.onSetActiveTool(
                "select",
              )
            }
          />

          <ToolButton
            icon={<Hand />}
            label="Hand"
            active={toolIsActive(
              "hand",
            )}
            onClick={() =>
              props.onSetActiveTool(
                "hand",
              )
            }
          />

          <Divider />

          <ToolButton
            icon={<Type />}
            label="Text"
            active={
              toolIsActive("text") ||
              !!props.editingTextId
            }
            disabled={
              props.annotateDisabled
            }
            onClick={() =>
              props.onSetActiveTool(
                "text",
              )
            }
          />

          <ToolButton
            icon={<ImageIcon />}
            label="Image"
            active={toolIsActive(
              "image",
            )}
            disabled={
              props.annotateDisabled
            }
            onClick={
              props.onOpenImage
            }
          />

          <ToolButton
            icon={<PenLine />}
            label="Draw"
            active={toolIsActive(
              "draw",
            )}
            disabled={
              props.annotateDisabled
            }
            onClick={() =>
              props.onSetActiveTool(
                "draw",
              )
            }
          />

          <ToolButton
            icon={<Highlighter />}
            label="Highlight"
            active={toolIsActive(
              "highlight",
            )}
            disabled={
              props.annotateDisabled
            }
            onClick={() =>
              props.onSetActiveTool(
                "highlight",
              )
            }
          />

          {/* SHAPES */}
          <div
            className="relative shrink-0"
            data-toolbar-popover
          >
            <ToolButton
              icon={<Square />}
              label="Shapes"
              active={
                shapeOpen ||
                props.activeTool.startsWith(
                  "shape-",
                )
              }
              disabled={
                props.annotateDisabled
              }
              onClick={() => {
                setShapeOpen(
                  (open) =>
                    !open,
                );
                setMoreOpen(false);
              }}
            />

            {shapeOpen && (
              <div className="absolute left-0 top-11 z-[100] grid w-60 grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
                {shapeTools.map(
                  (shape) => (
                    <button
                      key={
                        shape.tool
                      }
                      type="button"
                      onClick={() => {
                        props.onSetActiveShape(
                          shape.tool,
                        );
                        props.onSetActiveTool(
                          shape.tool,
                        );
                        setShapeOpen(
                          false,
                        );
                      }}
                      className="flex h-9 items-center gap-2 rounded-xl px-3 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    >
                      <span className="grid h-4 w-4 place-items-center [&>svg]:h-4 [&>svg]:w-4">
                        {
                          shape.icon
                        }
                      </span>

                      {
                        shape.label
                      }
                    </button>
                  ),
                )}
              </div>
            )}
          </div>

          <ToolButton
            icon={<Eraser />}
            label="Eraser"
            active={toolIsActive(
              "eraser",
            )}
            disabled={
              props.annotateDisabled
            }
            onClick={() =>
              props.onSetActiveTool(
                "eraser",
              )
            }
          />

          <ToolButton
            icon={<PenTool />}
            label="Signature"
            active={toolIsActive(
              "signature",
            )}
            disabled={
              props.annotateDisabled
            }
            onClick={
              props.onOpenSignature
            }
          />

          {/* MORE */}
          <div
            className="relative shrink-0"
            data-toolbar-popover
          >
            <ToolButton
              icon={<MoreHorizontal />}
              label="More"
              active={moreOpen}
              disabled={
                props.annotateDisabled
              }
              onClick={() => {
                setMoreOpen(
                  (open) =>
                    !open,
                );
                setShapeOpen(false);
              }}
            />

            {moreOpen && (
              <div className="absolute left-0 top-11 z-[100] w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
                {[
                  [
                    "whiteout",
                    "Whiteout",
                  ],
                  [
                    "sticky",
                    "Sticky note",
                  ],
                  [
                    "field-text",
                    "Text field",
                  ],
                  [
                    "field-checkbox",
                    "Checkbox",
                  ],
                  [
                    "field-radio",
                    "Radio button",
                  ],
                  [
                    "field-dropdown",
                    "Dropdown",
                  ],
                ].map(
                  ([tool, label]) => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => {
                        props.onSetActiveTool(
                          tool as Tool,
                        );
                        setMoreOpen(
                          false,
                        );
                      }}
                      className="flex w-full items-center rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>

          <Divider />

          <ToolButton
            icon={<Layers />}
            label="Pages"
            active={
              props.showPagePanel
            }
            onClick={
              props.onTogglePagePanel
            }
          />

          <div className="ml-auto hidden shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-slate-800 dark:bg-slate-900 md:flex">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Page
            </span>

            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {props.current + 1}/
              {props.pages.length}
            </span>
          </div>
        </div>
      </nav>

      {/* ======================================================
          CONTEXTUAL TOOL SETTINGS
          Always INSIDE normal layout.
      ====================================================== */}
      {(props.activeTool ===
        "draw" ||
        props.activeTool ===
          "eraser" ||
        props.activeTool ===
          "highlight" ||
        props.activeTool.startsWith(
          "shape-",
        )) && (
        <div className="relative z-30 shrink-0 border-b border-slate-200/80 bg-slate-50/95 px-3 py-1.5 dark:border-slate-800/80 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-[1200px] min-h-10 flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            {/* DRAW */}
            {props.activeTool ===
              "draw" && (
              <>
                <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Brush
                </span>

                {[1, 2, 4, 8, 12, 20].map(
                  (width) => (
                    <button
                      key={width}
                      type="button"
                      title={`${width}px`}
                      onClick={() =>
                        props.setDrawStroke(
                          {
                            ...props.drawStroke,
                            width,
                          },
                        )
                      }
                      className={cn(
                        "grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800",
                        props.drawStroke
                          .width ===
                          width &&
                          "bg-red-50 text-[#DC2626] shadow-sm dark:bg-red-500/15 dark:text-red-300",
                      )}
                    >
                      <span
                        className="rounded-full bg-current"
                        style={{
                          width: Math.min(
                            18,
                            width,
                          ),
                          height: Math.min(
                            18,
                            width,
                          ),
                        }}
                      />
                    </button>
                  ),
                )}

                <Divider />

                <ColorButton
                  value={
                    props.drawStroke
                      .color
                  }
                  title="Brush color"
                  onChange={(color) =>
                    props.setDrawStroke(
                      {
                        ...props.drawStroke,
                        color,
                      },
                    )
                  }
                />
              </>
            )}

            {/* ERASER */}
            {props.activeTool ===
              "eraser" && (
              <>
                <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Eraser
                </span>

                {[5, 10, 15, 20, 30, 40, 60].map(
                  (size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() =>
                        props.setEraserSize(
                          size,
                        )
                      }
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-800",
                        props.eraserSize ===
                          size &&
                          "bg-red-50 text-[#DC2626] shadow-sm dark:bg-red-500/15 dark:text-red-300",
                      )}
                    >
                      {size}px
                    </button>
                  ),
                )}
              </>
            )}

            {/* HIGHLIGHT */}
            {props.activeTool ===
              "highlight" && (
              <>
                <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Highlight
                </span>

                <ColorButton
                  value={
                    props
                      .highlightSettings
                      .color
                  }
                  title="Highlight color"
                  onChange={(color) =>
                    props.setHighlightSettings(
                      {
                        ...props.highlightSettings,
                        color,
                      },
                    )
                  }
                />

                <select
                  value={
                    props
                      .highlightSettings
                      .opacity
                  }
                  onChange={(event) =>
                    props.setHighlightSettings(
                      {
                        ...props.highlightSettings,
                        opacity:
                          Number(
                            event
                              .target
                              .value,
                          ),
                      },
                    )
                  }
                  className="h-8 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value={0.2}>
                    20%
                  </option>
                  <option value={0.35}>
                    35%
                  </option>
                  <option value={0.5}>
                    50%
                  </option>
                  <option value={0.65}>
                    65%
                  </option>
                </select>
              </>
            )}

            {/* SHAPE TOOL */}
            {props.activeTool.startsWith(
              "shape-",
            ) && (
              <>
                <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Shape
                </span>

                <ColorButton
                  value={
                    props.shapeDefaults
                      .stroke
                  }
                  title="Stroke color"
                  onChange={(stroke) =>
                    props.setShapeDefaults(
                      {
                        ...props.shapeDefaults,
                        stroke,
                      },
                    )
                  }
                />

                <NumberField
                  label="W"
                  value={
                    props
                      .shapeDefaults
                      .strokeWidth
                  }
                  min={1}
                  max={40}
                  width="w-12"
                  onChange={(
                    strokeWidth,
                  ) =>
                    props.setShapeDefaults(
                      {
                        ...props.shapeDefaults,
                        strokeWidth:
                          Math.max(
                            1,
                            Math.min(
                              40,
                              strokeWidth ||
                                1,
                            ),
                          ),
                      },
                    )
                  }
                />

                <select
                  value={
                    props.shapeDefaults
                      .dash
                  }
                  onChange={(event) =>
                    props.setShapeDefaults(
                      {
                        ...props.shapeDefaults,
                        dash:
                          event.target
                            .value as ShapeDash,
                      },
                    )
                  }
                  className="h-8 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="solid">
                    Solid
                  </option>
                  <option value="dashed">
                    Dashed
                  </option>
                  <option value="dotted">
                    Dotted
                  </option>
                </select>

                <button
                  type="button"
                  onClick={() =>
                    props.setShapeDefaults(
                      {
                        ...props.shapeDefaults,
                        fill:
                          props
                            .shapeDefaults
                            .fill ===
                          null
                            ? "#ffffff"
                            : null,
                      },
                    )
                  }
                  className={cn(
                    "rounded-xl px-3 py-1.5 text-[10px] font-medium transition-colors",
                    props.shapeDefaults
                      .fill === null
                      ? "hover:bg-slate-100 dark:hover:bg-slate-800"
                      : "bg-red-50 text-[#DC2626] dark:bg-red-500/15 dark:text-red-300",
                  )}
                >
                  {props.shapeDefaults
                    .fill === null
                    ? "No fill"
                    : "Fill"}
                </button>

                <ColorButton
                  value={
                    props.shapeDefaults
                      .fill ??
                    "#ffffff"
                  }
                  title="Fill color"
                  disabled={
                    props.shapeDefaults
                      .fill ===
                    null
                  }
                  onChange={(fill) =>
                    props.setShapeDefaults(
                      {
                        ...props.shapeDefaults,
                        fill,
                      },
                    )
                  }
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* ======================================================
          SELECTED ELEMENT PROPERTIES
          THIS IS THE IMPORTANT PART:
          normal document flow, never fixed over PDF.
      ====================================================== */}
      {hasSelection && (
        <div className="relative z-30 shrink-0 border-b border-slate-200/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/95">
          <div
            className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-1.5 overflow-x-auto"
            onPointerDown={(event) =>
              event.stopPropagation()
            }
          >
            {multi && (
              <>
                <span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {
                    props.selectedElements
                      .length
                  }{" "}
                  selected
                </span>

                <Divider />

                <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                  <SmallButton
                    icon={
                      <AlignLeft />
                    }
                    title="Align left"
                    onClick={() =>
                      props.onAlign(
                        "left",
                      )
                    }
                  />

                  <SmallButton
                    icon={
                      <AlignCenter />
                    }
                    title="Align center"
                    onClick={() =>
                      props.onAlign(
                        "center",
                      )
                    }
                  />

                  <SmallButton
                    icon={
                      <AlignRight />
                    }
                    title="Align right"
                    onClick={() =>
                      props.onAlign(
                        "right",
                      )
                    }
                  />

                  <SmallButton
                    icon={
                      <AlignHorizontalDistributeCenter />
                    }
                    title="Distribute horizontally"
                    onClick={() =>
                      props.onDistribute(
                        "horizontal",
                      )
                    }
                  />
                </div>

                <Divider />

                <SmallButton
                  icon={<Copy />}
                  title="Duplicate"
                  onClick={
                    props.onDuplicate
                  }
                />

                <SmallButton
                  icon={<Trash2 />}
                  title="Delete"
                  onClick={
                    props.onDelete
                  }
                />
              </>
            )}

            {single && (
              <>
                <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                  <SmallButton
                    icon={<Copy />}
                    title="Duplicate"
                    onClick={
                      props.onDuplicate
                    }
                  />

                  <SmallButton
                    icon={<Trash2 />}
                    title="Delete"
                    onClick={
                      props.onDelete
                    }
                  />
                </div>

                <NumberField
                  label="W"
                  value={single.width}
                  min={16}
                  onChange={(width) =>
                    props.onUpdateElement(
                      single.id,
                      {
                        width: Math.max(
                          16,
                          width ||
                            16,
                        ),
                      },
                    )
                  }
                />

                <NumberField
                  label="H"
                  value={single.height}
                  min={16}
                  onChange={(height) =>
                    props.onUpdateElement(
                      single.id,
                      {
                        height:
                          Math.max(
                            16,
                            height ||
                              16,
                          ),
                      },
                    )
                  }
                />

                <NumberField
                  label="O"
                  value={
                    Math.round(
                      single.opacity *
                        100,
                    )
                  }
                  min={0}
                  max={100}
                  width="w-12"
                  onChange={(
                    opacity,
                  ) =>
                    props.onUpdateElement(
                      single.id,
                      {
                        opacity:
                          Math.max(
                            0,
                            Math.min(
                              1,
                              (opacity ||
                                0) / 100,
                            ),
                          ),
                      },
                    )
                  }
                />

                <SmallButton
                  icon={
                    <RotateCw />
                  }
                  title="Rotate 15°"
                  onClick={() =>
                    props.onUpdateElement(
                      single.id,
                      {
                        rotation:
                          (single.rotation +
                            15) %
                          360,
                      },
                    )
                  }
                />

                <Divider />

                {selectedText && (
                  <>
                    <select
                      value={
                        selectedText.font
                      }
                      onChange={(
                        event,
                      ) =>
                        props.onLoadCustomFont(
                          selectedText.id,
                          event.target
                            .value,
                        )
                      }
                      className="h-8 max-w-[180px] rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      style={{
                        fontFamily:
                          selectedText.font,
                      }}
                    >
                      {FONT_OPTIONS.map(
                        (font) => (
                          <option
                            key={font}
                            value={
                              font
                            }
                          >
                            {font}
                          </option>
                        ),
                      )}

                      <optgroup label="Google Fonts">
                        {GOOGLE_FONTS.map(
                          (font) => (
                            <option
                              key={
                                font
                              }
                              value={
                                font
                              }
                            >
                              {font}
                            </option>
                          ),
                        )}
                      </optgroup>
                    </select>

                    <NumberField
                      label="Px"
                      value={
                        selectedText.fontSize
                      }
                      min={6}
                      max={120}
                      width="w-12"
                      onChange={(
                        fontSize,
                      ) =>
                        props.onUpdateElement(
                          selectedText.id,
                          {
                            fontSize:
                              Math.max(
                                6,
                                Math.min(
                                  120,
                                  fontSize ||
                                    14,
                                ),
                              ),
                          },
                        )
                      }
                    />

                    <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                      <SmallButton
                        icon={
                          <Bold />
                        }
                        title="Bold"
                        active={
                          selectedText.bold
                        }
                        onClick={() =>
                          props.onUpdateElement(
                            selectedText.id,
                            {
                              bold:
                                !selectedText.bold,
                            },
                          )
                        }
                      />

                      <SmallButton
                        icon={
                          <Italic />
                        }
                        title="Italic"
                        active={
                          selectedText.italic
                        }
                        onClick={() =>
                          props.onUpdateElement(
                            selectedText.id,
                            {
                              italic:
                                !selectedText.italic,
                            },
                          )
                        }
                      />

                      <SmallButton
                        icon={
                          <Underline />
                        }
                        title="Underline"
                        active={
                          selectedText.underline
                        }
                        onClick={() =>
                          props.onUpdateElement(
                            selectedText.id,
                            {
                              underline:
                                !selectedText.underline,
                            },
                          )
                        }
                      />
                    </div>

                    <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                      <SmallButton
                        icon={
                          <AlignLeft />
                        }
                        title="Align left"
                        active={
                          selectedText.align ===
                          "left"
                        }
                        onClick={() =>
                          props.onUpdateElement(
                            selectedText.id,
                            {
                              align: "left",
                            },
                          )
                        }
                      />

                      <SmallButton
                        icon={
                          <AlignCenter />
                        }
                        title="Align center"
                        active={
                          selectedText.align ===
                          "center"
                        }
                        onClick={() =>
                          props.onUpdateElement(
                            selectedText.id,
                            {
                              align: "center",
                            },
                          )
                        }
                      />

                      <SmallButton
                        icon={
                          <AlignRight />
                        }
                        title="Align right"
                        active={
                          selectedText.align ===
                          "right"
                        }
                        onClick={() =>
                          props.onUpdateElement(
                            selectedText.id,
                            {
                              align: "right",
                            },
                          )
                        }
                      />
                    </div>

                    <ColorButton
                      value={
                        selectedText.color
                      }
                      title="Text color"
                      onChange={(color) =>
                        props.onUpdateElement(
                          selectedText.id,
                          {
                            color,
                          },
                        )
                      }
                    />
                  </>
                )}

                {selectedShape && (
                  <>
                    <ColorButton
                      value={
                        selectedShape.stroke
                      }
                      title="Stroke color"
                      onChange={(
                        stroke,
                      ) =>
                        props.onUpdateElement(
                          selectedShape.id,
                          {
                            stroke,
                          },
                        )
                      }
                    />

                    <NumberField
                      label="SW"
                      value={
                        selectedShape.strokeWidth
                      }
                      min={1}
                      max={40}
                      width="w-12"
                      onChange={(
                        strokeWidth,
                      ) =>
                        props.onUpdateElement(
                          selectedShape.id,
                          {
                            strokeWidth:
                              Math.max(
                                1,
                                Math.min(
                                  40,
                                  strokeWidth ||
                                    1,
                                ),
                              ),
                          },
                        )
                      }
                    />

                    {![
                      "line",
                      "arrow",
                    ].includes(
                      selectedShape.type,
                    ) && (
                      <ColorButton
                        value={
                          selectedShape.fill ??
                          "#ffffff"
                        }
                        title="Fill color"
                        onChange={(
                          fill,
                        ) =>
                          props.onUpdateElement(
                            selectedShape.id,
                            {
                              fill,
                            },
                          )
                        }
                      />
                    )}

                    <select
                      value={
                        selectedShape.dash ??
                        "solid"
                      }
                      onChange={(
                        event,
                      ) =>
                        props.onUpdateElement(
                          selectedShape.id,
                          {
                            dash:
                              event
                                .target
                                .value as ShapeDash,
                          },
                        )
                      }
                      className="h-8 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <option value="solid">
                        Solid
                      </option>
                      <option value="dashed">
                        Dashed
                      </option>
                      <option value="dotted">
                        Dotted
                      </option>
                    </select>
                  </>
                )}

                {selectedImage && (
                  <button
                    type="button"
                    onClick={
                      props
                        .onOpenImageForSelected
                    }
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    Replace image
                  </button>
                )}

                <div className="ml-auto flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                  <SmallButton
                    icon={
                      <ArrowUp />
                    }
                    title="Bring forward"
                    onClick={() =>
                      props.onReorder(
                        "forward",
                      )
                    }
                  />

                  <SmallButton
                    icon={
                      <ArrowDown />
                    }
                    title="Send backward"
                    onClick={() =>
                      props.onReorder(
                        "backward",
                      )
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ======================================================
          PAGE PANEL
      ====================================================== */}
      {props.showPagePanel && (
        <div className="absolute bottom-4 left-4 top-full z-[60] w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Pages
            </span>

            <span className="text-[10px] text-slate-400">
              {props.current +
                1}
              /
              {props.pages.length}
            </span>
          </div>

          <div className="max-h-[70vh] overflow-auto p-2">
            {props.pages.map(
              (page, index) => (
                <div
                  key={page.id}
                  className={cn(
                    "mb-2 rounded-xl border p-1.5",
                    props.current ===
                      index
                      ? "border-red-300 bg-red-50/60 dark:border-red-500/50 dark:bg-red-500/10"
                      : "border-slate-200 dark:border-slate-800",
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      props.onPageClick(
                        index,
                      )
                    }
                    className="block w-full rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
                  >
                    {props.thumbs[
                      index
                    ] ? (
                      <img
                        src={
                          props.thumbs[
                            index
                          ]
                        }
                        alt={`Page ${
                          index + 1
                        }`}
                        className="mx-auto max-h-36 w-full object-contain"
                      />
                    ) : (
                      <div className="grid aspect-[3/4] place-items-center text-[10px] text-slate-400">
                        Blank page
                      </div>
                    )}
                  </button>

                  <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-slate-400">
                    <span>
                      Page{" "}
                      {index +
                        1}
                    </span>

                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        title="Move up"
                        disabled={
                          index ===
                          0
                        }
                        onClick={() =>
                          props.onMovePage(
                            index,
                            index -
                              1,
                          )
                        }
                        className="rounded p-1 transition-colors hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>

                      <button
                        type="button"
                        title="Move down"
                        disabled={
                          index ===
                          props.pages
                            .length -
                            1
                        }
                        onClick={() =>
                          props.onMovePage(
                            index,
                            index +
                              1,
                          )
                        }
                        className="rounded p-1 transition-colors hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>

                      <button
                        type="button"
                        title="Rotate"
                        onClick={() =>
                          props.onRotatePage(
                            index,
                            90,
                          )
                        }
                        className="rounded p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <RotateCw className="h-3 w-3" />
                      </button>

                      <button
                        type="button"
                        title="Duplicate"
                        onClick={() =>
                          props.onDuplicatePage(
                            index,
                          )
                        }
                        className="rounded p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Copy className="h-3 w-3" />
                      </button>

                      <button
                        type="button"
                        title="Delete"
                        onClick={() =>
                          props.onDeletePage(
                            index,
                          )
                        }
                        className="rounded p-1 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ),
            )}

            <button
              type="button"
              onClick={() =>
                props.onInsertBlankPage(
                  props.current,
                )
              }
              className="w-full rounded-xl border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              + Blank page
            </button>
          </div>
        </div>
      )}
    </div>
  );
}