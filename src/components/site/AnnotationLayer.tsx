import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  makeId,
  ROTATABLE_TYPES,
  type AnyElement,
  type DrawElement,
  type FieldCheckboxElement,
  type FieldDropdownElement,
  type FieldRadioElement,
  type FieldTextElement,
  type HighlightElement,
  type ImageElement,
  type ShapeElement,
  type StickyElement,
  type TextElement,
} from "@/lib/pdf-annotations";
import {
  elementScreenRect,
  rotatePointToScreen,
  screenPointToPdf,
} from "@/lib/pdf-editor-coordinates";
import { useElementTransform } from "./hooks/useElementTransform";
import type { Tool } from "./editor-types";

type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

const RESIZE_HANDLES: ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

const RESIZE_HANDLE_STYLE: Record<
  ResizeHandle,
  CSSProperties
> = {
  nw: {
    left: -6,
    top: -6,
    cursor: "nwse-resize",
  },
  n: {
    left: "50%",
    top: -6,
    transform: "translateX(-50%)",
    cursor: "ns-resize",
  },
  ne: {
    right: -6,
    top: -6,
    cursor: "nesw-resize",
  },
  e: {
    right: -6,
    top: "50%",
    transform: "translateY(-50%)",
    cursor: "ew-resize",
  },
  se: {
    right: -6,
    bottom: -6,
    cursor: "nwse-resize",
  },
  s: {
    left: "50%",
    bottom: -6,
    transform: "translateX(-50%)",
    cursor: "ns-resize",
  },
  sw: {
    left: -6,
    bottom: -6,
    cursor: "nesw-resize",
  },
  w: {
    left: -6,
    top: "50%",
    transform: "translateY(-50%)",
    cursor: "ew-resize",
  },
};

type DragSession = {
  ids: string[];
  offsets: Record<
    string,
    {
      centerX: number;
      centerY: number;
      pdfWidth: number;
      pdfHeight: number;
    }
  >;
  ghosts: HTMLElement[];
  originals: HTMLElement[];
};

function elementNodeSelector(id: string) {
  const escape =
    typeof CSS !== "undefined" &&
    typeof CSS.escape === "function"
      ? CSS.escape
      : (value: string) =>
          value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

  return `[data-element-id="${escape(id)}"]`;
}

function createDragGhost(
  node: HTMLElement,
) {
  const rect =
    node.getBoundingClientRect();

  const ghost =
    node.cloneNode(true) as HTMLElement;

  ghost.removeAttribute(
    "data-element-id",
  );

  ghost
    .querySelectorAll<HTMLElement>(
      '[role="button"]',
    )
    .forEach((handle) => {
      handle.remove();
    });

  ghost.style.position = "fixed";
  ghost.style.left = "0px";
  ghost.style.top = "0px";
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "2147483647";
  ghost.style.opacity = "0.92";
  ghost.style.transition = "none";
  ghost.style.willChange = "transform";
  ghost.style.transform =
    `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  ghost.style.cursor = "grabbing";

  document.body.appendChild(
    ghost,
  );

  node.style.visibility = "hidden";

  return ghost;
}

function findPageLayerAtPoint(
  clientX: number,
  clientY: number,
) {
  const layers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-annotation-layer='true']",
    ),
  );

  let nearest:
    | {
        element: HTMLElement;
        rect: DOMRect;
        pageId: string;
        scale: number;
        rotation: 0 | 90 | 180 | 270;
        pageWidth: number;
        pageHeight: number;
        distance: number;
      }
    | null = null;

  for (const layer of layers) {
    const rect = layer.getBoundingClientRect();

    const pageId = layer.dataset.pageId;
    const scale = Number(layer.dataset.scale);
    const pageWidth = Number(layer.dataset.pageWidth);
    const pageHeight = Number(layer.dataset.pageHeight);
    const rotationValue = Number(layer.dataset.rotation);

    const rotation = (
      rotationValue === 90 ||
      rotationValue === 180 ||
      rotationValue === 270
        ? rotationValue
        : 0
    ) as 0 | 90 | 180 | 270;

    if (
      !pageId ||
      !Number.isFinite(scale) ||
      !Number.isFinite(pageWidth) ||
      !Number.isFinite(pageHeight)
    ) {
      continue;
    }

    const inside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    const closestX = Math.max(
      rect.left,
      Math.min(clientX, rect.right),
    );

    const closestY = Math.max(
      rect.top,
      Math.min(clientY, rect.bottom),
    );

    const distance = inside
      ? 0
      : Math.hypot(
          clientX - closestX,
          clientY - closestY,
        );

    if (!nearest || distance < nearest.distance) {
      nearest = {
        element: layer,
        rect,
        pageId,
        scale,
        rotation,
        pageWidth,
        pageHeight,
        distance,
      };
    }
  }

  return nearest;
}

export function AnnotationLayer(
  props: {
    pageId: string;
    scale: number;
    elements: AnyElement[];
    activeTool: Tool;

    selectedIds: Set<string>;
    onSetSelectedIds: (
      ids: Set<string>,
    ) => void;

    onAddElement: (
      element: AnyElement,
    ) => void;

    onAddElementKeepTool: (
      element: AnyElement,
    ) => void;

    onAddTextAt: (
      pageId: string,
      x: number,
      y: number,
    ) => void;

    onBeginTextEdit: (
      id: string,
    ) => void;

    onFinishTextEdit: (
      id: string,
      text: string,
      cancel?: boolean,
    ) => void;

    editingTextId:
      | string
      | null;

    onUpdateElement: (
      id: string,
      patch: Partial<AnyElement>,
    ) => void;

    onUpdateElements: (
      ids: Set<string>,
      patchFn: (
        element: AnyElement,
      ) => Partial<AnyElement>,
    ) => void;

    onDuplicateElements: (
      ids: Set<string>,
    ) => void;

    onReplaceElements: (
      toRemove: string[],
      toAdd: AnyElement[],
    ) => void;

    onSelectionRectChange?: (
      rect: DOMRect | null,
    ) => void;

    interactive: boolean;

    drawStroke: {
      color: string;
      width: number;
    };

    eraserSize: number;

    highlightSettings: {
      color: string;
      opacity: number;
    };

    shapeDefaults: {
      stroke: string;
      strokeWidth: number;
      fill: string | null;
      dash:
        | "solid"
        | "dashed"
        | "dotted";
    };

    pageRotation:
      | 0
      | 90
      | 180
      | 270;

    unrotatedPageWidth: number;
    unrotatedPageHeight: number;
  },
) {
  const layerRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const {
    pageRotation,
    unrotatedPageWidth:
      pageW,
    unrotatedPageHeight:
      pageH,
  } = props;

  const elementsRef =
    useRef<AnyElement[]>(
      props.elements,
    );

  useEffect(() => {
    elementsRef.current =
      props.elements;
  }, [props.elements]);

  const [
    draft,
    setDraft,
  ] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const [
    drawPoints,
    setDrawPoints,
  ] = useState<
    {
      x: number;
      y: number;
    }[] | null
  >(null);

  const [
    marquee,
    setMarquee,
  ] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const [
    eraserPos,
    setEraserPos,
  ] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const creationDragRef =
    useRef<{
      startPt: {
        x: number;
        y: number;
      };
    } | null>(null);

  const creationRafRef =
    useRef<number | null>(
      null,
    );

  const latestCreationPointRef =
    useRef<{
      x: number;
      y: number;
    } | null>(null);

  const dragSessionRef =
    useRef<DragSession | null>(null);

  const dragRafRef =
    useRef<number | null>(null);

  const dragPointerRef =
    useRef<{
      clientX: number;
      clientY: number;
    } | null>(null);

  const {
    interaction,
    beginResize,
    beginRotate,
    preview,
  } =
    useElementTransform({
      scale: props.scale,
      pageRotation,
      pageWidth: pageW,
      pageHeight: pageH,
      getLayerRect: () =>
        layerRef.current?.getBoundingClientRect() ??
        null,
      toPagePoint: (
        clientX,
        clientY,
      ) =>
        toPdfPoint(
          clientX,
          clientY,
        ),
      onCommitElements:
        props.onUpdateElements,
    });

  function toPdfPoint(
    clientX: number,
    clientY: number,
  ) {
    const rect =
      layerRef.current?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    return screenPointToPdf(
      clientX,
      clientY,
      rect,
      props.scale,
      pageRotation,
      pageW,
      pageH,
    );
  }

  const rectToScreenStyle =
    useCallback(
      (
        x: number,
        y: number,
        width: number,
        height: number,
      ) =>
        elementScreenRect(
          x,
          y,
          width,
          height,
          pageRotation,
          pageW,
          pageH,
          props.scale,
        ),
      [
        props.scale,
        pageRotation,
        pageW,
        pageH,
      ],
    );

  /*
   * Keep the parent informed only when selection
   * changes, not on every animation frame.
   */
  useEffect(() => {
    if (
      props.selectedIds.size !==
      1
    ) {
      props.onSelectionRectChange?.(
        null,
      );
    }
  }, [
    props.selectedIds,
    props.onSelectionRectChange,
  ]);

  const nonCreationTools: Tool[] =
    [
      "select",
      "hand",
      "image",
      "signature",
      "eraser",
    ];

  const isCreationTool =
    props.interactive &&
    !nonCreationTools.includes(
      props.activeTool,
    );

  const isShapeTool =
    props.activeTool.startsWith(
      "shape-",
    );

  const isFieldTool =
    props.activeTool.startsWith(
      "field-",
    );

  const finishCrossPageDrag =
    useCallback(
      (
        cancelled: boolean,
        clientX?: number,
        clientY?: number,
      ) => {
        const session = dragSessionRef.current;
        dragSessionRef.current = null;

        if (dragRafRef.current !== null) {
          cancelAnimationFrame(dragRafRef.current);
          dragRafRef.current = null;
        }

        const pointer =
          clientX != null && clientY != null
            ? { clientX, clientY }
            : dragPointerRef.current;

        if (!cancelled && session && pointer) {
          const target = findPageLayerAtPoint(
            pointer.clientX,
            pointer.clientY,
          );

          if (target) {
            props.onUpdateElements(
              new Set(session.ids),
              (element) => {
                const offset = session.offsets[element.id];

                if (!offset) {
                  return {};
                }

                const centerX =
                  pointer.clientX - offset.centerX;
                const centerY =
                  pointer.clientY - offset.centerY;

                const point = screenPointToPdf(
                  centerX,
                  centerY,
                  target.rect,
                  target.scale,
                  target.rotation,
                  target.pageWidth,
                  target.pageHeight,
                );

                if (!point) {
                  return {};
                }

                return {
                  pageId: target.pageId,
                  x: point.x - offset.pdfWidth / 2,
                  y: point.y - offset.pdfHeight / 2,
                };
              },
            );
          }
        }

        for (const node of session?.originals ?? []) {
          node.style.visibility = "";
          node.style.willChange = "";
        }

        for (const ghost of session?.ghosts ?? []) {
          ghost.remove();
        }

        dragPointerRef.current = null;
        document.body.style.cursor = "";
      },
      [props.onUpdateElements],
    );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const session =
        dragSessionRef.current;

      if (!session) {
        return;
      }

      dragPointerRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };

      if (dragRafRef.current !== null) {
        return;
      }

      dragRafRef.current =
        requestAnimationFrame(() => {
          dragRafRef.current = null;

          const pointer =
            dragPointerRef.current;

          const currentSession =
            dragSessionRef.current;

          if (!pointer || !currentSession) {
            return;
          }

          for (
            let index = 0;
            index < currentSession.ghosts.length;
            index += 1
          ) {
            const ghost =
              currentSession.ghosts[index];

            const id =
              currentSession.ids[index];

            const offset =
              currentSession.offsets[id];

            if (!ghost || !offset) {
              continue;
            }

            ghost.style.transform =
              `translate3d(${
                pointer.clientX -
                offset.centerX
              }px, ${
                pointer.clientY -
                offset.centerY
              }px, 0)`;
          }
        });
    };

    const onPointerUp = (event: PointerEvent) =>
      finishCrossPageDrag(
        false,
        event.clientX,
        event.clientY,
      );

    const onPointerCancel = () =>
      finishCrossPageDrag(true);

    const onBlur = () =>
      finishCrossPageDrag(true);

    window.addEventListener(
      "pointermove",
      onPointerMove,
    );

    window.addEventListener(
      "pointerup",
      onPointerUp,
    );

    window.addEventListener(
      "pointercancel",
      onPointerCancel,
    );

    window.addEventListener(
      "blur",
      onBlur,
    );

    return () => {
      window.removeEventListener(
        "pointermove",
        onPointerMove,
      );

      window.removeEventListener(
        "pointerup",
        onPointerUp,
      );

      window.removeEventListener(
        "pointercancel",
        onPointerCancel,
      );

      window.removeEventListener(
        "blur",
        onBlur,
      );
    };
  }, [finishCrossPageDrag]);

  function startResize(
    event: ReactPointerEvent,
    element: AnyElement,
    handle: ResizeHandle,
  ) {
    if (
      !props.interactive ||
      props.activeTool !==
        "select"
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    beginResize(
      element,
      handle,
      {
        x: event.clientX,
        y: event.clientY,
      },
    );
  }

  function startRotate(
    event: ReactPointerEvent,
    element: AnyElement,
  ) {
    if (
      !props.interactive ||
      props.activeTool !==
        "select"
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    beginRotate(
      element,
      {
        x: event.clientX,
        y: event.clientY,
      },
    );
  }

  function startMove(
    event: ReactPointerEvent,
    element: AnyElement,
  ) {
    if (
      !props.interactive ||
      props.activeTool !== "select" ||
      props.editingTextId
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      (event.currentTarget as HTMLElement).setPointerCapture(
        event.pointerId,
      );
    } catch {
      // Pointer capture is best-effort.
    }

    let ids = props.selectedIds;

    if (
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey
    ) {
      const next = new Set(ids);

      if (next.has(element.id)) {
        next.delete(element.id);
      } else {
        next.add(element.id);
      }

      props.onSetSelectedIds(next);
      ids = next;
    } else if (!ids.has(element.id)) {
      ids = new Set([element.id]);
      props.onSetSelectedIds(ids);
    }

    if (!ids.has(element.id)) {
      return;
    }

    if (event.altKey) {
      props.onDuplicateElements(ids);
      return;
    }

    const dragIds = Array.from(ids).filter(
      (id) =>
        props.elements.some(
          (candidate) =>
            candidate.id === id &&
            candidate.pageId === props.pageId,
        ),
    );

    if (!dragIds.length) {
      return;
    }

    const originals: HTMLElement[] = [];
    const ghosts: HTMLElement[] = [];
    const offsets: DragSession["offsets"] = {};

    const created = dragIds
      .map((id) => {
        const node =
          layerRef.current?.querySelector<HTMLElement>(
            elementNodeSelector(id),
          ) ?? null;

        const item =
          props.elements.find(
            (candidate) =>
              candidate.id === id,
          );

        if (!node || !item) {
          return null;
        }

        const rect =
          node.getBoundingClientRect();

        const centerX =
          rect.left + rect.width / 2;

        const centerY =
          rect.top + rect.height / 2;

        const ghost =
          createDragGhost(node);

        offsets[id] = {
          centerX:
            event.clientX - centerX,
          centerY:
            event.clientY - centerY,
          pdfWidth: item.width,
          pdfHeight: item.height,
        };

        originals.push(node);
        ghosts.push(ghost);

        return id;
      })
      .filter(
        (id): id is string =>
          id !== null,
      );

    if (!created.length) {
      for (const node of originals) {
        node.style.visibility = "";
      }

      for (const ghost of ghosts) {
        ghost.remove();
      }

      return;
    }

    dragPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };

    dragSessionRef.current = {
      ids: created,
      offsets,
      ghosts,
      originals,
    };

    document.body.style.cursor =
      "grabbing";
  }

  const onLayerPointerDown =
    useCallback(
      (
        event: ReactPointerEvent,
      ) => {
        if (
          !props.interactive
        ) {
          return;
        }

        /*
         * ERASER
         */
        if (
          props.activeTool ===
          "eraser"
        ) {
          event.preventDefault();

          const point =
            toPdfPoint(
              event.clientX,
              event.clientY,
            );

          if (!point) {
            return;
          }

          setEraserPos(point);

          const currentDrawElements =
            props.elements.filter(
              (element) =>
                element.type ===
                "draw",
            ) as DrawElement[];

          const result =
            eraseFromDrawElements(
              point,
              props.eraserSize,
              currentDrawElements,
            );

          if (
            result.toRemove
              .length
          ) {
            props.onReplaceElements(
              result.toRemove,
              result.toAdd,
            );
          }

          const onMove = (
            moveEvent: PointerEvent,
          ) => {
            const nextPoint =
              toPdfPoint(
                moveEvent.clientX,
                moveEvent.clientY,
              );

            if (!nextPoint) {
              return;
            }

            setEraserPos(
              nextPoint,
            );

            const draws =
              elementsRef.current.filter(
                (candidate) =>
                  candidate.type ===
                  "draw",
              ) as DrawElement[];

            const next =
              eraseFromDrawElements(
                nextPoint,
                props.eraserSize,
                draws,
              );

            if (
              next.toRemove
                .length
            ) {
              props.onReplaceElements(
                next.toRemove,
                next.toAdd,
              );
            }
          };

          const onUp = () => {
            setEraserPos(null);

            window.removeEventListener(
              "pointermove",
              onMove,
            );

            window.removeEventListener(
              "pointerup",
              onUp,
            );

            window.removeEventListener(
              "pointercancel",
              onUp,
            );
          };

          window.addEventListener(
            "pointermove",
            onMove,
          );

          window.addEventListener(
            "pointerup",
            onUp,
          );

          window.addEventListener(
            "pointercancel",
            onUp,
          );

          return;
        }

        /*
         * SELECT / MARQUEE
         */
        if (
          !isCreationTool
        ) {
          if (
            event.target ===
            layerRef.current
          ) {
            if (
              event.shiftKey ||
              event.metaKey ||
              event.ctrlKey
            ) {
              return;
            }

            props.onSetSelectedIds(
              new Set(),
            );

            const start =
              toPdfPoint(
                event.clientX,
                event.clientY,
              );

            if (!start) {
              return;
            }

            setMarquee({
              x: start.x,
              y: start.y,
              w: 0,
              h: 0,
            });

            const move = (
              moveEvent: PointerEvent,
            ) => {
              const point =
                toPdfPoint(
                  moveEvent.clientX,
                  moveEvent.clientY,
                );

              if (!point) {
                return;
              }

              setMarquee({
                x: Math.min(
                  start.x,
                  point.x,
                ),
                y: Math.min(
                  start.y,
                  point.y,
                ),
                w: Math.abs(
                  point.x -
                    start.x,
                ),
                h: Math.abs(
                  point.y -
                    start.y,
                ),
              });
            };

            const up = (
              upEvent: PointerEvent,
            ) => {
              window.removeEventListener(
                "pointermove",
                move,
              );

              window.removeEventListener(
                "pointerup",
                up,
              );

              window.removeEventListener(
                "pointercancel",
                up,
              );

              const point =
                toPdfPoint(
                  upEvent.clientX,
                  upEvent.clientY,
                );

              if (!point) {
                setMarquee(null);
                return;
              }

              const selection =
                {
                  x1: Math.min(
                    start.x,
                    point.x,
                  ),
                  y1: Math.min(
                    start.y,
                    point.y,
                  ),
                  x2: Math.max(
                    start.x,
                    point.x,
                  ),
                  y2: Math.max(
                    start.y,
                    point.y,
                  ),
                };

              if (
                Math.abs(
                  selection.x2 -
                    selection.x1,
                ) >
                  3 ||
                Math.abs(
                  selection.y2 -
                    selection.y1,
                ) >
                  3
              ) {
                props.onSetSelectedIds(
                  new Set(
                    props.elements
                      .filter(
                        (
                          candidate,
                        ) => {
                          const bounds =
                            {
                              x1:
                                candidate.x,
                              y1:
                                candidate.y,
                              x2:
                                candidate.x +
                                candidate.width,
                              y2:
                                candidate.y +
                                candidate.height,
                            };

                          return (
                            selection.x1 <
                              bounds.x2 &&
                            selection.x2 >
                              bounds.x1 &&
                            selection.y1 <
                              bounds.y2 &&
                            selection.y2 >
                              bounds.y1
                          );
                        },
                      )
                      .map(
                        (
                          candidate,
                        ) =>
                          candidate.id,
                      ),
                  ),
                );
              }

              setMarquee(null);
            };

            window.addEventListener(
              "pointermove",
              move,
            );

            window.addEventListener(
              "pointerup",
              up,
            );

            window.addEventListener(
              "pointercancel",
              up,
            );
          }

          return;
        }

        const point =
          toPdfPoint(
            event.clientX,
            event.clientY,
          );

        if (!point) {
          return;
        }

        /*
         * TEXT
         */
        if (
          props.activeTool ===
          "text"
        ) {
          if (
            event.target ===
            layerRef.current
          ) {
            event.preventDefault();

            props.onAddTextAt(
              props.pageId,
              point.x,
              point.y,
            );
          }

          return;
        }

        /*
         * STICKY
         */
        if (
          props.activeTool ===
          "sticky"
        ) {
          props.onAddElement({
            id: makeId(
              "sticky",
            ),
            pageId:
              props.pageId,
            type: "sticky",
            x: point.x,
            y: point.y,
            width: 140,
            height: 100,
            opacity: 1,
            rotation: 0,
            color: "#FEF08A",
            note: "",
          } as StickyElement);

          return;
        }

        /*
         * FORM FIELDS
         */
        if (isFieldTool) {
          const base = {
            id: makeId(
              props.activeTool,
            ),
            pageId:
              props.pageId,
            opacity: 1,
            rotation: 0,
            x: point.x,
            y: point.y,
          } as const;

          let element:
            | AnyElement
            | null = null;

          if (
            props.activeTool ===
            "field-text"
          ) {
            element = {
              ...base,
              type: "field-text",
              width: 180,
              height: 26,
              name: "text_field",
              value: "",
              placeholder:
                "Enter text",
              required:
                false,
            } as FieldTextElement;
          } else if (
            props.activeTool ===
            "field-checkbox"
          ) {
            element = {
              ...base,
              type:
                "field-checkbox",
              width: 18,
              height: 18,
              name: "checkbox",
              checked: false,
              required:
                false,
            } as FieldCheckboxElement;
          } else if (
            props.activeTool ===
            "field-radio"
          ) {
            element = {
              ...base,
              type:
                "field-radio",
              width: 18,
              height: 18,
              groupName:
                "radio_group",
              value:
                "option_1",
              checked: false,
              required:
                false,
            } as FieldRadioElement;
          } else if (
            props.activeTool ===
            "field-dropdown"
          ) {
            element = {
              ...base,
              type:
                "field-dropdown",
              width: 160,
              height: 26,
              name: "dropdown",
              options: [
                "Option 1",
                "Option 2",
              ],
              value:
                "Option 1",
              required:
                false,
            } as FieldDropdownElement;
          }

          if (element) {
            props.onAddElement(
              element,
            );
          }

          return;
        }

        /*
         * DRAG CREATION
         */
        creationDragRef.current =
          {
            startPt: point,
          };

        latestCreationPointRef.current =
          point;

        if (
          props.activeTool ===
          "draw"
        ) {
          setDrawPoints([
            point,
          ]);
        } else {
          setDraft({
            x: point.x,
            y: point.y,
            w: 0,
            h: 0,
          });
        }

        const move = (
          moveEvent: PointerEvent,
        ) => {
          const nextPoint =
            toPdfPoint(
              moveEvent.clientX,
              moveEvent.clientY,
            );

          if (!nextPoint) {
            return;
          }

          latestCreationPointRef.current =
            nextPoint;

          if (
            creationRafRef.current !==
            null
          ) {
            return;
          }

          creationRafRef.current =
            requestAnimationFrame(
              () => {
                creationRafRef.current =
                  null;

                const currentPoint =
                  latestCreationPointRef
                    .current;

                const start =
                  creationDragRef
                    .current
                    ?.startPt;

                if (
                  !currentPoint ||
                  !start
                ) {
                  return;
                }

                if (
                  props.activeTool ===
                  "draw"
                ) {
                  setDrawPoints(
                    (
                      previous,
                    ) => {
                      if (
                        !previous
                          ?.length
                      ) {
                        return [
                          currentPoint,
                        ];
                      }

                      const last =
                        previous[
                          previous.length -
                            1
                        ];

                      if (
                        Math.hypot(
                          currentPoint.x -
                            last.x,
                          currentPoint.y -
                            last.y,
                        ) <
                        0.75
                      ) {
                        return previous;
                      }

                      return [
                        ...previous,
                        currentPoint,
                      ];
                    },
                  );

                  return;
                }

                setDraft({
                  x: Math.min(
                    start.x,
                    currentPoint.x,
                  ),
                  y: Math.min(
                    start.y,
                    currentPoint.y,
                  ),
                  w: Math.abs(
                    currentPoint.x -
                      start.x,
                  ),
                  h: Math.abs(
                    currentPoint.y -
                      start.y,
                  ),
                });
              },
            );
        };

        const up = (
          upEvent: PointerEvent,
        ) => {
          if (
            creationRafRef.current !==
            null
          ) {
            cancelAnimationFrame(
              creationRafRef.current,
            );

            creationRafRef.current =
              null;
          }

          window.removeEventListener(
            "pointermove",
            move,
          );

          window.removeEventListener(
            "pointerup",
            up,
          );

          window.removeEventListener(
            "pointercancel",
            up,
          );

          const nextPoint =
            toPdfPoint(
              upEvent.clientX,
              upEvent.clientY,
            );

          const start =
            creationDragRef.current
              ?.startPt;

          creationDragRef.current =
            null;

          latestCreationPointRef.current =
            null;

          if (
            !nextPoint ||
            !start
          ) {
            setDraft(null);
            setDrawPoints(null);
            return;
          }

          if (
            props.activeTool ===
            "draw"
          ) {
            setDrawPoints(
              (points) => {
                if (
                  !points ||
                  points.length <
                    2
                ) {
                  return null;
                }

                const xs =
                  points.map(
                    (point) =>
                      point.x,
                  );

                const ys =
                  points.map(
                    (point) =>
                      point.y,
                  );

                const minX =
                  Math.min(
                    ...xs,
                  );

                const minY =
                  Math.min(
                    ...ys,
                  );

                const maxX =
                  Math.max(
                    ...xs,
                  );

                const maxY =
                  Math.max(
                    ...ys,
                  );

                props.onAddElementKeepTool(
                  {
                    id: makeId(
                      "draw",
                    ),
                    pageId:
                      props.pageId,
                    type: "draw",
                    x: minX,
                    y: minY,
                    width:
                      Math.max(
                        1,
                        maxX -
                          minX,
                      ),
                    height:
                      Math.max(
                        1,
                        maxY -
                          minY,
                      ),
                    opacity: 1,
                    rotation: 0,
                    stroke:
                      props
                        .drawStroke
                        .color,
                    strokeWidth:
                      props
                        .drawStroke
                        .width,
                    points:
                      points.map(
                        (
                          point,
                        ) => ({
                          x:
                            point.x -
                            minX,
                          y:
                            point.y -
                            minY,
                        }),
                      ),
                  } as DrawElement,
                );

                return null;
              },
            );

            return;
          }

          const x =
            Math.min(
              start.x,
              nextPoint.x,
            );

          const y =
            Math.min(
              start.y,
              nextPoint.y,
            );

          const width =
            Math.max(
              8,
              Math.abs(
                nextPoint.x -
                  start.x,
              ),
            );

          const height =
            Math.max(
              8,
              Math.abs(
                nextPoint.y -
                  start.y,
              ),
            );

          setDraft(null);

          if (
            isShapeTool
          ) {
            const flipDiag =
              (start.x <
                nextPoint.x) !==
              (start.y <
                nextPoint.y);

            props.onAddElement({
              id: makeId(
                "shape",
              ),
              pageId:
                props.pageId,
              type: props.activeTool.replace(
                "shape-",
                "",
              ),
              x,
              y,
              width,
              height,
              opacity: 1,
              rotation: 0,
              stroke:
                props.shapeDefaults
                  .stroke,
              strokeWidth:
                props.shapeDefaults
                  .strokeWidth,
              fill:
                props.shapeDefaults
                  .fill,
              dash:
                props.shapeDefaults
                  .dash,
              flipDiag,
            } as unknown as ShapeElement);

            return;
          }

          if (
            [
              "highlight",
              "underline",
              "strikeout",
              "squiggly",
            ].includes(
              props.activeTool,
            )
          ) {
            props.onAddElement({
              id: makeId(
                "markup",
              ),
              pageId:
                props.pageId,
              type: props.activeTool,
              x,
              y,
              width,
              height,
              opacity:
                props.activeTool ===
                "highlight"
                  ? props
                      .highlightSettings
                      .opacity
                  : 1,
              rotation: 0,
              color:
                props.activeTool ===
                "highlight"
                  ? props
                      .highlightSettings
                      .color
                  : "#FDE047",
            } as HighlightElement);

            return;
          }

          if (
            props.activeTool ===
            "whiteout"
          ) {
            props.onAddElementKeepTool(
              {
                id: makeId(
                  "wo",
                ),
                pageId:
                  props.pageId,
                type: "whiteout",
                x,
                y,
                width,
                height,
                opacity: 1,
                rotation: 0,
                color:
                  "#ffffff",
              },
            );
          }
        };

        window.addEventListener(
          "pointermove",
          move,
        );

        window.addEventListener(
          "pointerup",
          up,
        );

        window.addEventListener(
          "pointercancel",
          up,
        );
      },
      [
        isCreationTool,
        isFieldTool,
        isShapeTool,
        props,
      ],
    );

  const isInteractiveDrawing =
    props.activeTool ===
      "draw" ||
    props.activeTool ===
      "eraser" ||
    isCreationTool;

  return (
    <div
      ref={layerRef}
      data-annotation-layer="true"
      data-page-id={props.pageId}
      data-scale={props.scale}
      data-rotation={pageRotation}
      data-page-width={pageW}
      data-page-height={pageH}
      className="absolute inset-0 select-none"
      style={{
        cursor:
          props.activeTool ===
          "eraser"
            ? "none"
            : isCreationTool
              ? "crosshair"
              : props.activeTool ===
                  "hand"
                ? "grab"
                : "default",

        pointerEvents:
          props.interactive
            ? "auto"
            : "none",

        touchAction:
          isInteractiveDrawing
            ? "none"
            : "manipulation",

        contain:
          "layout paint style",
      }}
      onPointerDown={
        onLayerPointerDown
      }
    >
      {props.elements.map(
        (rawElement) => {
          const previewPatch =
            preview.get(
              rawElement.id,
            );

          const element =
            previewPatch
              ? ({
                  ...rawElement,
                  ...previewPatch,
                } as AnyElement)
              : rawElement;

          if (
            element.pageId !==
            props.pageId
          ) {
            return null;
          }

          const selected =
            props.selectedIds.has(
              element.id,
            );

          const isOnlySelected =
            selected &&
            props.selectedIds
              .size === 1;

          const isEditingThis =
            props.editingTextId ===
            element.id;

          const canRotate =
            isOnlySelected &&
            props.activeTool ===
              "select" &&
            ROTATABLE_TYPES.has(
              element.type,
            );

          const canResize =
            isOnlySelected &&
            props.activeTool ===
              "select" &&
            element.type !==
              "draw" &&
            !element.type.startsWith(
              "field-",
            );

          const shape =
            element as ShapeElement & {
              flipDiag?: boolean;
              dash?:
                | "solid"
                | "dashed"
                | "dotted";
            };

          const screenRect =
            rectToScreenStyle(
              element.x,
              element.y,
              element.width,
              element.height,
            );

          const elementRotation =
            element.rotation ||
            0;

          const style: CSSProperties =
            {
              position:
                "absolute",
              left:
                screenRect.left,
              top:
                screenRect.top,
              width:
                screenRect.width,
              height:
                screenRect.height,
              opacity:
                element.opacity,
              transform:
                elementRotation
                  ? `rotate(${elementRotation}deg)`
                  : undefined,
              transformOrigin:
                "center center",
              willChange:
                interaction &&
                "id" in
                  interaction &&
                interaction.id ===
                  element.id
                  ? "transform,width,height"
                  : undefined,
            };

          const strokeStyle =
            shape.dash ===
            "dashed"
              ? "dashed"
              : shape.dash ===
                  "dotted"
                ? "dotted"
                : "solid";

          let body:
            |  ReactNode
            | null = null;

          if (
            element.type ===
            "text"
          ) {
            const text =
              element as TextElement;

            const fontFamily =
              text.font ===
              "TimesRoman"
                ? "Times New Roman, serif"
                : text.font ===
                    "Courier"
                  ? "monospace"
                  : `"${text.font}", Helvetica, Arial, sans-serif`;

            const textStyle: CSSProperties =
              {
                width: "100%",
                height: "100%",
                boxSizing:
                  "border-box",
                display: "block",
                margin: 0,
                border: "none",
                fontFamily,
                fontSize:
                  text.fontSize *
                  props.scale,
                fontWeight:
                  text.bold
                    ? 700
                    : 400,
                fontStyle:
                  text.italic
                    ? "italic"
                    : "normal",
                textDecoration:
                  text.underline
                    ? "underline"
                    : "none",
                color:
                  text.color,
                textAlign:
                  text.align,
                whiteSpace:
                  "pre-wrap",
                outline:
                  "none",
                lineHeight:
                  text.lineSpacing,
                letterSpacing: `${text.letterSpacing * props.scale}px`,
                padding: `${2 * props.scale}px ${3 * props.scale}px`,
                background:
                  "transparent",
                resize: "none",
                overflow:
                  "hidden",
                userSelect:
                  isEditingThis
                    ? "text"
                    : "none",
              };

            body =
              isEditingThis ? (
                <TextEditBox
                  initialText={
                    text.text
                  }
                  style={
                    textStyle
                  }
                  onCommit={(
                    value,
                  ) =>
                    props.onFinishTextEdit(
                      element.id,
                      value,
                    )
                  }
                  onCancel={() =>
                    props.onFinishTextEdit(
                      element.id,
                      text.text,
                      true,
                    )
                  }
                />
              ) : (
                <div
                  data-el-content
                  onDoubleClick={(
                    event,
                  ) => {
                    event.stopPropagation();

                    props.onBeginTextEdit(
                      element.id,
                    );
                  }}
                  style={{
                    ...textStyle,
                    cursor:
                      props.activeTool ===
                      "select"
                        ? "move"
                        : "text",
                  }}
                >
                  {text.text || (
                    <span
                      style={{
                        opacity:
                          0.4,
                      }}
                    >
                      Text
                    </span>
                  )}
                </div>
              );
          } else if (
            element.type ===
            "rect"
          ) {
            body = (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  boxSizing:
                    "border-box",
                  border: `${shape.strokeWidth * props.scale}px ${strokeStyle} ${shape.stroke}`,
                  background:
                    shape.fill ??
                    "transparent",
                }}
              />
            );
          } else if (
            element.type ===
            "rounded-rect"
          ) {
            body = (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  boxSizing:
                    "border-box",
                  borderRadius:
                    12 *
                    props.scale,
                  border: `${shape.strokeWidth * props.scale}px ${strokeStyle} ${shape.stroke}`,
                  background:
                    shape.fill ??
                    "transparent",
                }}
              />
            );
          } else if (
            element.type ===
            "ellipse"
          ) {
            body = (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  boxSizing:
                    "border-box",
                  borderRadius:
                    "50%",
                  border: `${shape.strokeWidth * props.scale}px ${strokeStyle} ${shape.stroke}`,
                  background:
                    shape.fill ??
                    "transparent",
                }}
              />
            );
          } else if (
            element.type ===
            "line"
          ) {
            const width =
              screenRect.width;

            const height =
              screenRect.height;

            body = (
              <svg
                width="100%"
                height="100%"
                style={{
                  overflow:
                    "visible",
                  pointerEvents:
                    "none",
                }}
              >
                <line
                  x1="0"
                  y1={
                    shape.flipDiag
                      ? height
                      : 0
                  }
                  x2={width}
                  y2={
                    shape.flipDiag
                      ? 0
                      : height
                  }
                  stroke={
                    shape.stroke
                  }
                  strokeWidth={
                    shape.strokeWidth *
                    props.scale
                  }
                  strokeDasharray={
                    shape.dash ===
                    "dashed"
                      ? "8 6"
                      : shape.dash ===
                          "dotted"
                        ? "2 4"
                        : "none"
                  }
                  strokeLinecap="round"
                />
              </svg>
            );
          } else if (
            element.type ===
            "arrow"
          ) {
            const width =
              screenRect.width;

            const height =
              screenRect.height;

            const arrowWidth =
              Math.max(
                10,
                Math.min(
                  width *
                    0.25,
                  height *
                    0.8,
                ),
              );

            const arrowHeight =
              arrowWidth *
              0.65;

            body = (
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${width} ${height}`}
                style={{
                  overflow:
                    "visible",
                  pointerEvents:
                    "none",
                }}
              >
                <line
                  x1="0"
                  y1={
                    height / 2
                  }
                  x2={
                    width -
                    arrowWidth *
                      0.8
                  }
                  y2={
                    height / 2
                  }
                  stroke={
                    shape.stroke
                  }
                  strokeWidth={
                    shape.strokeWidth *
                    props.scale
                  }
                  strokeDasharray={
                    shape.dash ===
                    "dashed"
                      ? "8 6"
                      : shape.dash ===
                          "dotted"
                        ? "2 4"
                        : "none"
                  }
                  strokeLinecap="round"
                />

                <polygon
                  points={`${width - arrowWidth},${
                    height / 2 -
                    arrowHeight /
                      2
                  } ${width},${
                    height / 2
                  } ${
                    width -
                    arrowWidth
                  },${
                    height / 2 +
                    arrowHeight /
                      2
                  }`}
                  fill={
                    shape.stroke
                  }
                />
              </svg>
            );
          } else if (
            element.type ===
            "triangle"
          ) {
            const width =
              screenRect.width;

            const height =
              screenRect.height;

            body = (
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${width} ${height}`}
                style={{
                  overflow:
                    "visible",
                  pointerEvents:
                    "none",
                }}
              >
                <polygon
                  points={`${width / 2},0 ${width},${height} 0,${height}`}
                  fill={
                    shape.fill ??
                    "none"
                  }
                  stroke={
                    shape.stroke
                  }
                  strokeWidth={
                    shape.strokeWidth *
                    props.scale
                  }
                  strokeDasharray={
                    shape.dash ===
                    "dashed"
                      ? "8 6"
                      : shape.dash ===
                          "dotted"
                        ? "2 4"
                        : "none"
                  }
                  strokeLinejoin="round"
                />
              </svg>
            );
          } else if (
            element.type ===
            "star"
          ) {
            const width =
              screenRect.width;

            const height =
              screenRect.height;

            const cx =
              width / 2;

            const cy =
              height / 2;

            const outerR =
              Math.min(
                cx,
                cy,
              ) *
              0.98;

            const innerR =
              outerR * 0.42;

            body = (
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${width} ${height}`}
                style={{
                  overflow:
                    "visible",
                  pointerEvents:
                    "none",
                }}
              >
                <polygon
                  points={starSvgPoints(
                    cx,
                    cy,
                    outerR,
                    innerR,
                  )}
                  fill={
                    shape.fill ??
                    "none"
                  }
                  stroke={
                    shape.stroke
                  }
                  strokeWidth={
                    shape.strokeWidth *
                    props.scale
                  }
                  strokeDasharray={
                    shape.dash ===
                    "dashed"
                      ? "8 6"
                      : shape.dash ===
                          "dotted"
                        ? "2 4"
                        : "none"
                  }
                  strokeLinejoin="round"
                />
              </svg>
            );
          } else if (
            element.type ===
            "speech"
          ) {
            const width =
              screenRect.width;

            const height =
              screenRect.height;

            const radius =
              Math.min(
                10,
                width *
                  0.05,
                height *
                  0.08,
              );

            const tailHeight =
              height * 0.22;

            const bubbleHeight =
              height -
              tailHeight;

            body = (
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${width} ${height}`}
                style={{
                  overflow:
                    "visible",
                  pointerEvents:
                    "none",
                }}
              >
                <path
                  d={`M ${radius},0
                    L ${
                      width -
                      radius
                    },0
                    Q ${width},0 ${width},${radius}
                    L ${width},${
                      bubbleHeight -
                      radius
                    }
                    Q ${width},${bubbleHeight} ${
                      width -
                      radius
                    },${bubbleHeight}
                    L ${
                      width *
                      0.38
                    },${bubbleHeight}
                    L ${
                      width *
                      0.22
                    },${height}
                    L ${
                      width *
                      0.3
                    },${bubbleHeight}
                    L ${radius},${bubbleHeight}
                    Q 0,${bubbleHeight} 0,${
                      bubbleHeight -
                      radius
                    }
                    L 0,${radius}
                    Q 0,0 ${radius},0 Z`}
                  fill={
                    shape.fill ??
                    "white"
                  }
                  stroke={
                    shape.stroke
                  }
                  strokeWidth={
                    shape.strokeWidth *
                    props.scale
                  }
                  strokeDasharray={
                    shape.dash ===
                    "dashed"
                      ? "8 6"
                      : shape.dash ===
                          "dotted"
                        ? "2 4"
                        : "none"
                  }
                  strokeLinejoin="round"
                />
              </svg>
            );
          } else if (
            element.type ===
            "draw"
          ) {
            const draw =
              element as DrawElement;

            const points =
              draw.points
                .map(
                  (point) =>
                    `${point.x * props.scale},${
                      point.y *
                      props.scale
                    }`,
                )
                .join(" ");

            body = (
              <svg
                className="absolute inset-0 h-full w-full"
                style={{
                  overflow:
                    "visible",
                  pointerEvents:
                    "none",
                }}
              >
                <polyline
                  points={
                    points
                  }
                  fill="none"
                  stroke={
                    draw.stroke
                  }
                  strokeWidth={
                    draw.strokeWidth *
                    props.scale
                  }
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            );
          } else if (
            element.type ===
            "highlight"
          ) {
            const highlight =
              element as HighlightElement;

            body = (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background:
                    highlight.color,
                }}
              />
            );
          } else if (
            element.type ===
            "underline"
          ) {
            const thickness =
              Math.max(
                1,
                2 *
                  props.scale,
              );

            body = (
              <div
                style={{
                  width: "100%",
                  height:
                    thickness,
                  marginTop:
                    element.height *
                      props.scale -
                    thickness,
                  background:
                    (
                      element as HighlightElement
                    ).color,
                }}
              />
            );
          } else if (
            element.type ===
            "strikeout"
          ) {
            body = (
              <div
                style={{
                  width: "100%",
                  height:
                    Math.max(
                      1,
                      2 *
                        props.scale,
                    ),
                  marginTop:
                    (element.height *
                      props.scale) /
                    2,
                  background:
                    (
                      element as HighlightElement
                    ).color,
                }}
              />
            );
          } else if (
            element.type ===
            "squiggly"
          ) {
            const width =
              screenRect.width;

            const height =
              screenRect.height;

            body = (
              <svg
                width="100%"
                height="100%"
                style={{
                  overflow:
                    "visible",
                  pointerEvents:
                    "none",
                }}
              >
                <polyline
                  points={Array.from(
                    {
                      length: 10,
                    },
                    (
                      _,
                      index,
                    ) =>
                      `${
                        index *
                        (width /
                          9)
                      },${
                        height -
                        (index %
                          2 ===
                        0
                          ? 0
                          : 4 *
                            props.scale)
                      }`,
                  ).join(" ")}
                  fill="none"
                  stroke={
                    (
                      element as HighlightElement
                    ).color
                  }
                  strokeWidth={
                    1.6 *
                    props.scale
                  }
                />
              </svg>
            );
          } else if (
            element.type ===
            "whiteout"
          ) {
            body = (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background:
                    (
                      element as {
                        color: string;
                      }
                    ).color ||
                    "#ffffff",
                }}
              />
            );
          } else if (
            element.type ===
            "image"
          ) {
            const image =
              element as ImageElement;

            body = (
              <img
                src={
                  image.src
                }
                alt=""
                draggable={
                  false
                }
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit:
                    "fill",
                  pointerEvents:
                    "none",
                  display:
                    "block",
                }}
              />
            );
          } else if (
            element.type ===
            "sticky"
          ) {
            const sticky =
              element as StickyElement;

            body = (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background:
                    sticky.color,
                  border:
                    "1px solid rgba(0,0,0,0.15)",
                  borderRadius: 4,
                  boxShadow:
                    "0 2px 6px rgba(0,0,0,0.15)",
                  padding:
                    4 *
                    props.scale,
                  overflow:
                    "hidden",
                }}
              >
                <textarea
                  value={
                    sticky.note
                  }
                  onChange={(
                    changeEvent,
                  ) =>
                    props.onUpdateElement(
                      element.id,
                      {
                        note:
                          changeEvent
                            .target
                            .value,
                      },
                    )
                  }
                  onPointerDown={(
                    pointerEvent,
                  ) =>
                    pointerEvent.stopPropagation()
                  }
                  placeholder="Note…"
                  style={{
                    width: "100%",
                    height: "100%",
                    background:
                      "transparent",
                    border: "none",
                    outline:
                      "none",
                    resize: "none",
                    fontSize:
                      11 *
                      Math.max(
                        1,
                        props.scale,
                      ),
                    color:
                      "#3F3300",
                  }}
                />
              </div>
            );
          } else if (
            element.type ===
            "field-text"
          ) {
            const field =
              element as FieldTextElement;

            body = (
              <input
                value={
                  field.value
                }
                placeholder={
                  field.placeholder
                }
                onChange={(
                  changeEvent,
                ) =>
                  props.onUpdateElement(
                    element.id,
                    {
                      value:
                        changeEvent
                          .target
                          .value,
                    },
                  )
                }
                onPointerDown={(
                  pointerEvent,
                ) =>
                  pointerEvent.stopPropagation()
                }
                style={{
                  width: "100%",
                  height: "100%",
                  boxSizing:
                    "border-box",
                  border: `${1.5 * props.scale}px solid #DC2626`,
                  borderRadius: 4,
                  background:
                    "rgba(220,38,38,0.05)",
                  fontSize:
                    12 *
                    Math.max(
                      1,
                      props.scale,
                    ),
                  padding: `0 ${
                    6 *
                    props.scale
                  }px`,
                  outline:
                    "none",
                }}
              />
            );
          } else if (
            element.type ===
            "field-checkbox"
          ) {
            const field =
              element as FieldCheckboxElement;

            body = (
              <div
                onPointerDown={(
                  pointerEvent,
                ) => {
                  pointerEvent.stopPropagation();

                  props.onUpdateElement(
                    element.id,
                    {
                      checked:
                        !field.checked,
                    },
                  );
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  boxSizing:
                    "border-box",
                  border: `${1.5 * props.scale}px solid #DC2626`,
                  borderRadius: 3,
                  background:
                    field.checked
                      ? "#DC2626"
                      : "rgba(220,38,38,0.05)",
                  display: "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  cursor:
                    "pointer",
                }}
              >
                {field.checked && (
                  <Check
                    style={{
                      width:
                        "80%",
                      height:
                        "80%",
                    }}
                    className="text-white"
                  />
                )}
              </div>
            );
          } else if (
            element.type ===
            "field-radio"
          ) {
            const field =
              element as FieldRadioElement;

            body = (
              <div
                onPointerDown={(
                  pointerEvent,
                ) => {
                  pointerEvent.stopPropagation();

                  props.onUpdateElement(
                    element.id,
                    {
                      checked:
                        !field.checked,
                    },
                  );
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius:
                    "50%",
                  border: `${1.5 * props.scale}px solid #DC2626`,
                  background:
                    "rgba(220,38,38,0.05)",
                  display: "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  cursor:
                    "pointer",
                }}
              >
                {field.checked && (
                  <div
                    style={{
                      width:
                        "55%",
                      height:
                        "55%",
                      borderRadius:
                        "50%",
                      background:
                        "#DC2626",
                    }}
                  />
                )}
              </div>
            );
          } else if (
            element.type ===
            "field-dropdown"
          ) {
            const field =
              element as FieldDropdownElement;

            body = (
              <select
                value={
                  field.value
                }
                onChange={(
                  changeEvent,
                ) =>
                  props.onUpdateElement(
                    element.id,
                    {
                      value:
                        changeEvent
                          .target
                          .value,
                    },
                  )
                }
                onPointerDown={(
                  pointerEvent,
                ) =>
                  pointerEvent.stopPropagation()
                }
                style={{
                  width: "100%",
                  height: "100%",
                  boxSizing:
                    "border-box",
                  border: `${1.5 * props.scale}px solid #DC2626`,
                  borderRadius: 4,
                  background:
                    "rgba(220,38,38,0.05)",
                  fontSize:
                    12 *
                    Math.max(
                      1,
                      props.scale,
                    ),
                }}
              >
                {field.options.map(
                  (option) => (
                    <option
                      key={
                        option
                      }
                      value={
                        option
                      }
                    >
                      {option}
                    </option>
                  ),
                )}
              </select>
            );
          }

          return (
            <div
              key={
                element.id
              }
              data-element-id={
                element.id
              }
              style={
                style
              }
              onPointerDown={
                props.activeTool ===
                "select"
                  ? (
                      event,
                    ) =>
                      startMove(
                        event,
                        rawElement,
                      )
                  : element.type ===
                        "text" &&
                      props.activeTool ===
                        "text"
                    ? (
                        event,
                      ) => {
                        event.stopPropagation();

                        props.onBeginTextEdit(
                          element.id,
                        );
                      }
                    : undefined
              }
              className={cn(
                selected &&
                  props.activeTool ===
                    "select" &&
                  !isEditingThis &&
                  "outline outline-2 outline-[#DC2626] outline-offset-1",

                isEditingThis &&
                  "outline outline-2 outline-[#DC2626] outline-offset-1 ring-2 ring-[#DC2626]/20",

                dragSessionRef.current?.ids.includes(
                  element.id,
                ) &&
                  "transition-none",
              )}
            >
              {body}

              {canResize &&
                (isOnlySelected ||
                  isEditingThis) &&
                RESIZE_HANDLES.map(
                  (
                    handle,
                  ) => (
                    <div
                      key={
                        handle
                      }
                      role="button"
                      aria-label={`Resize ${handle}`}
                      onPointerDown={(
                        event,
                      ) =>
                        startResize(
                          event,
                          element,
                          handle,
                        )
                      }
                      style={{
                        position:
                          "absolute",
                        ...RESIZE_HANDLE_STYLE[
                          handle
                        ],
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background:
                          "#ffffff",
                        border:
                          "2px solid #DC2626",
                        boxShadow:
                          "0 1px 4px rgba(15,23,42,0.3)",
                        zIndex: 20,
                        touchAction:
                          "none",
                        willChange:
                          "transform",
                      }}
                    />
                  ),
                )}

              {canRotate && (
                <div
                  role="button"
                  aria-label="Rotate"
                  onPointerDown={(
                    event,
                  ) =>
                    startRotate(
                      event,
                      element,
                    )
                  }
                  style={{
                    position:
                      "absolute",
                    left: "50%",
                    top: -22,
                    width: 10,
                    height: 10,
                    marginLeft: -5,
                    borderRadius:
                      "50%",
                    background:
                      "#DC2626",
                    cursor:
                      "grab",
                    touchAction:
                      "none",
                    zIndex: 21,
                  }}
                />
              )}
            </div>
          );
        },
      )}

      {draft &&
        (() => {
          const screen =
            rectToScreenStyle(
              draft.x,
              draft.y,
              draft.w,
              draft.h,
            );

          return (
            <div
              style={{
                position:
                  "absolute",
                left:
                  screen.left,
                top:
                  screen.top,
                width:
                  screen.width,
                height:
                  screen.height,
                border:
                  "1.5px dashed #DC2626",
                background:
                  props.activeTool ===
                  "highlight"
                    ? "rgba(253,224,71,0.35)"
                    : "rgba(220,38,38,0.06)",
                pointerEvents:
                  "none",
              }}
            />
          );
        })()}

      {drawPoints &&
        drawPoints.length >
          1 && (
          <svg
            className="absolute inset-0 h-full w-full"
            style={{
              pointerEvents:
                "none",
              overflow:
                "visible",
            }}
          >
            <polyline
              points={drawPoints
                .map(
                  (point) => {
                    const screen =
                      rotatePointToScreen(
                        point.x,
                        point.y,
                        pageRotation,
                        pageW,
                        pageH,
                      );

                    return `${screen.x * props.scale},${
                      screen.y *
                      props.scale
                    }`;
                  },
                )
                .join(" ")}
              fill="none"
              stroke={
                props.drawStroke
                  .color
              }
              strokeWidth={
                props.drawStroke
                  .width *
                props.scale
              }
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

      {marquee &&
        (() => {
          const screen =
            rectToScreenStyle(
              marquee.x,
              marquee.y,
              marquee.w,
              marquee.h,
            );

          return (
            <div
              style={{
                position:
                  "absolute",
                left:
                  screen.left,
                top:
                  screen.top,
                width:
                  screen.width,
                height:
                  screen.height,
                border:
                  "1px dashed #DC2626",
                background:
                  "rgba(220,38,38,0.08)",
                pointerEvents:
                  "none",
              }}
            />
          );
        })()}

      {eraserPos &&
        (() => {
          const size =
            props.eraserSize;

          const screen =
            rectToScreenStyle(
              eraserPos.x -
                size,
              eraserPos.y -
                size,
              size * 2,
              size * 2,
            );

          return (
            <div
              style={{
                position:
                  "absolute",
                left:
                  screen.left,
                top:
                  screen.top,
                width:
                  screen.width,
                height:
                  screen.height,
                borderRadius:
                  "50%",
                border:
                  "2px solid #DC2626",
                background:
                  "rgba(220,38,38,0.08)",
                pointerEvents:
                  "none",
              }}
            />
          );
        })()}
    </div>
  );
}

function TextEditBox({
  initialText,
  style,
  onCommit,
  onCancel,
}: {
  initialText: string;
  style: CSSProperties;
  onCommit: (
    text: string,
  ) => void;
  onCancel: () => void;
}) {
  const [
    value,
    setValue,
  ] = useState(
    initialText,
  );

  const ref =
    useRef<HTMLTextAreaElement | null>(
      null,
    );

  const settledRef =
    useRef(false);

  useEffect(() => {
    const node =
      ref.current;

    if (!node) {
      return;
    }

    node.focus({
      preventScroll:
        true,
    });

    const length =
      node.value.length;

    node.setSelectionRange(
      length,
      length,
    );
  }, []);

  const commitOnce =
    useCallback(() => {
      if (
        settledRef.current
      ) {
        return;
      }

      settledRef.current =
        true;

      onCommit(value);
    }, [
      onCommit,
      value,
    ]);

  const cancelOnce =
    useCallback(() => {
      if (
        settledRef.current
      ) {
        return;
      }

      settledRef.current =
        true;

      onCancel();
    }, [onCancel]);

  return (
    <textarea
      ref={ref}
      data-el-content
      value={value}
      onChange={(event) =>
        setValue(
          event.target.value,
        )
      }
      onPointerDown={(event) =>
        event.stopPropagation()
      }
      onClick={(event) =>
        event.stopPropagation()
      }
      onKeyDown={(event) => {
        event.stopPropagation();

        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();
          cancelOnce();
          return;
        }

        if (
          event.key ===
            "Enter" &&
          (event.metaKey ||
            event.ctrlKey)
        ) {
          event.preventDefault();
          commitOnce();
        }
      }}
      onBlur={commitOnce}
      spellCheck={false}
      style={{
        ...style,
        cursor:
          "text",
        userSelect:
          "text",
      }}
    />
  );
}