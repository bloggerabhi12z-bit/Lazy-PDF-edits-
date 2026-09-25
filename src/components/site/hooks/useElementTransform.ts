import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type {
  AnyElement,
  TextElement,
} from "@/lib/pdf-annotations";
import {
  elementScreenRect,
  rotateVector,
} from "@/lib/pdf-editor-coordinates";
type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

const MIN_ELEMENT_SIZE = 16;

export type TransformInteraction =
  | {
      kind: "move";
      ids: string[];
      offsets: Record<
        string,
        {
          x: number;
          y: number;
        }
      >;
      point: {
        x: number;
        y: number;
      };
    }
  | {
      kind: "resize";
      id: string;
      handle: ResizeHandle;
      start: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      startRotation: number;
      startFontSize?: number;
      startClient: {
        x: number;
        y: number;
      };
      latestClient: {
        x: number;
        y: number;
      };
    }
  | {
      kind: "rotate";
      id: string;
      center: {
        x: number;
        y: number;
      };
      startAngle: number;
      startRotation: number;
      latest: {
        x: number;
        y: number;
        shift: boolean;
      };
    }
  | null;

type TransformAction =
  | {
      type: "beginMove";
      ids: string[];
      offsets: Record<
        string,
        {
          x: number;
          y: number;
        }
      >;
      point: {
        x: number;
        y: number;
      };
    }
  | {
      type: "beginResize";
      id: string;
      handle: ResizeHandle;
      start: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      startRotation: number;
      startFontSize?: number;
      startClient: {
        x: number;
        y: number;
      };
    }
  | {
      type: "beginRotate";
      id: string;
      center: {
        x: number;
        y: number;
      };
      startAngle: number;
      startRotation: number;
      latest: {
        x: number;
        y: number;
        shift: boolean;
      };
    }
  | {
      type: "movePointer";
      point: {
        x: number;
        y: number;
      };
    }
  | {
      type: "resizePointer";
      client: {
        x: number;
        y: number;
      };
    }
  | {
      type: "rotatePointer";
      latest: {
        x: number;
        y: number;
        shift: boolean;
      };
    }
  | {
      type: "end";
    };

export function transformReducer(
  state: TransformInteraction,
  action: TransformAction,
): TransformInteraction {
  switch (action.type) {
    case "beginMove":
      return {
        kind: "move",
        ids: action.ids,
        offsets: action.offsets,
        point: action.point,
      };

    case "beginResize":
      return {
        kind: "resize",
        id: action.id,
        handle: action.handle,
        start: action.start,
        startRotation:
          action.startRotation,
        startFontSize:
          action.startFontSize,
        startClient:
          action.startClient,
        latestClient:
          action.startClient,
      };

    case "beginRotate":
      return {
        kind: "rotate",
        id: action.id,
        center: action.center,
        startAngle:
          action.startAngle,
        startRotation:
          action.startRotation,
        latest: action.latest,
      };

    case "movePointer":
      return state?.kind === "move"
        ? {
            ...state,
            point: action.point,
          }
        : state;

    case "resizePointer":
      return state?.kind === "resize"
        ? {
            ...state,
            latestClient:
              action.client,
          }
        : state;

    case "rotatePointer":
      return state?.kind === "rotate"
        ? {
            ...state,
            latest: action.latest,
          }
        : state;

    case "end":
      return null;
  }
}

function applyResizeHandle(
  handle: ResizeHandle,
  start: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  localDx: number,
  localDy: number,
) {
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (handle.includes("w")) {
    width =
      start.width - localDx;
    x =
      start.x + localDx;
  }

  if (handle.includes("e")) {
    width =
      start.width + localDx;
  }

  if (handle.includes("n")) {
    height =
      start.height - localDy;
    y =
      start.y + localDy;
  }

  if (handle.includes("s")) {
    height =
      start.height + localDy;
  }

  if (width < MIN_ELEMENT_SIZE) {
    if (handle.includes("w")) {
      x -=
        MIN_ELEMENT_SIZE -
        width;
    }

    width =
      MIN_ELEMENT_SIZE;
  }

  if (height < MIN_ELEMENT_SIZE) {
    if (handle.includes("n")) {
      y -=
        MIN_ELEMENT_SIZE -
        height;
    }

    height =
      MIN_ELEMENT_SIZE;
  }

  return {
    x,
    y,
    width,
    height,
  };
}

type Options = {
  pageRotation:
    | 0
    | 90
    | 180
    | 270;

  pageWidth: number;
  pageHeight: number;
  scale: number;

  getLayerRect: () =>
    | DOMRect
    | null;

  toPagePoint: (
    clientX: number,
    clientY: number,
  ) =>
    | {
        x: number;
        y: number;
      }
    | null;

  onCommitElements: (
    ids: Set<string>,
    patchFn: (
      element: AnyElement,
    ) => Partial<AnyElement>,
  ) => void;
};

export function useElementTransform(
  options: Options,
) {
  const [
    interaction,
    dispatch,
  ] = useReducer(
    transformReducer,
    null,
  );

  const callbacksRef =
    useRef(options);

  callbacksRef.current =
    options;

  const interactionRef =
    useRef<TransformInteraction>(
      null,
    );

  interactionRef.current =
    interaction;

  const rafRef =
    useRef<number | null>(
      null,
    );

  const pendingPointerRef =
    useRef<{
      x: number;
      y: number;
      shift: boolean;
    } | null>(null);

  const beginMoveWithOffsets =
    useCallback(
      (
        ids: string[],
        offsets: Record<
          string,
          {
            x: number;
            y: number;
          }
        >,
        point: {
          x: number;
          y: number;
        },
      ) => {
        dispatch({
          type: "beginMove",
          ids,
          offsets,
          point,
        });
      },
      [],
    );

  const beginResize =
    useCallback(
      (
        element: AnyElement,
        handle: ResizeHandle,
        client: {
          x: number;
          y: number;
        },
      ) => {
        dispatch({
          type: "beginResize",
          id: element.id,
          handle,
          start: {
            x: element.x,
            y: element.y,
            width:
              element.width,
            height:
              element.height,
          },
          startRotation:
            element.rotation ||
            0,
          startFontSize:
            element.type === "text"
              ? (
                  element as TextElement
                ).fontSize
              : undefined,
          startClient:
            client,
        });
      },
      [],
    );

  const beginRotate =
    useCallback(
      (
        element: AnyElement,
        client: {
          x: number;
          y: number;
        },
      ) => {
        const active =
          callbacksRef.current;

        const layerRect =
          active.getLayerRect();

        if (!layerRect) {
          return;
        }

        const screenRect =
          elementScreenRect(
            element.x,
            element.y,
            element.width,
            element.height,
            active.pageRotation,
            active.pageWidth,
            active.pageHeight,
            active.scale,
          );

        const center = {
          x:
            layerRect.left +
            screenRect.left +
            screenRect.width /
              2,
          y:
            layerRect.top +
            screenRect.top +
            screenRect.height /
              2,
        };

        dispatch({
          type: "beginRotate",
          id: element.id,
          center,
          startAngle:
            Math.atan2(
              client.y -
                center.y,
              client.x -
                center.x,
            ),
          startRotation:
            element.rotation ||
            0,
          latest: {
            x: client.x,
            y: client.y,
            shift: false,
          },
        });
      },
      [],
    );

  useEffect(() => {
    function scheduleFrame() {
      if (
        rafRef.current !==
        null
      ) {
        return;
      }

      rafRef.current =
        requestAnimationFrame(
          () => {
            rafRef.current =
              null;

            const current =
              interactionRef.current;

            const pointer =
              pendingPointerRef.current;

            if (
              !current ||
              !pointer
            ) {
              return;
            }

            if (
              current.kind ===
              "move"
            ) {
              const active =
                callbacksRef.current;

              const point =
                active.toPagePoint(
                  pointer.x,
                  pointer.y,
                );

              if (point) {
                dispatch({
                  type: "movePointer",
                  point,
                });
              }

              return;
            }

            if (
              current.kind ===
              "resize"
            ) {
              dispatch({
                type: "resizePointer",
                client: {
                  x: pointer.x,
                  y: pointer.y,
                },
              });

              return;
            }

            dispatch({
              type: "rotatePointer",
              latest: {
                x: pointer.x,
                y: pointer.y,
                shift: pointer.shift,
              },
            });
          },
        );
    }

    function onPointerMove(
      event: PointerEvent,
    ) {
      if (
        !interactionRef.current
      ) {
        return;
      }

      pendingPointerRef.current =
        {
          x: event.clientX,
          y: event.clientY,
          shift: event.shiftKey,
        };

      scheduleFrame();
    }

    function finish(
      event: PointerEvent,
    ) {
      const current =
        interactionRef.current;

      if (!current) {
        return;
      }

      if (
        rafRef.current !==
        null
      ) {
        cancelAnimationFrame(
          rafRef.current,
        );
        rafRef.current =
          null;
      }

      const active =
        callbacksRef.current;

      if (
        current.kind ===
        "move"
      ) {
        const point =
          active.toPagePoint(
            event.clientX,
            event.clientY,
          );

        if (point) {
          active.onCommitElements(
            new Set(
              current.ids,
            ),
            (element) => {
              const offset =
                current.offsets[
                  element.id
                ];

              if (!offset) {
                return {};
              }

              return {
                x:
                  point.x -
                  offset.x,
                y:
                  point.y -
                  offset.y,
              };
            },
          );
        }
      } else if (
        current.kind ===
        "resize"
      ) {
        const finalState = {
          ...current,
          latestClient: {
            x: event.clientX,
            y: event.clientY,
          },
        };

        const patch =
          resizePatch(
            finalState,
            active.scale,
            active.pageRotation,
          );

        active.onCommitElements(
          new Set([
            current.id,
          ]),
          () => patch,
        );
      } else {
        const finalState = {
          ...current,
          latest: {
            x: event.clientX,
            y: event.clientY,
            shift: event.shiftKey,
          },
        };

        active.onCommitElements(
          new Set([
            current.id,
          ]),
          () => ({
            rotation:
              rotationValue(
                finalState,
              ),
          }),
        );
      }

      pendingPointerRef.current =
        null;

      interactionRef.current =
        null;

      dispatch({
        type: "end",
      });
    }

    function cancel() {
      if (
        rafRef.current !==
        null
      ) {
        cancelAnimationFrame(
          rafRef.current,
        );

        rafRef.current =
          null;
      }

      pendingPointerRef.current =
        null;

      interactionRef.current =
        null;

      dispatch({
        type: "end",
      });
    }

    window.addEventListener(
      "pointermove",
      onPointerMove,
    );

    window.addEventListener(
      "pointerup",
      finish,
    );

    window.addEventListener(
      "pointercancel",
      cancel,
    );

    window.addEventListener(
      "blur",
      cancel,
    );

    document.addEventListener(
      "visibilitychange",
      cancel,
    );

    return () => {
      window.removeEventListener(
        "pointermove",
        onPointerMove,
      );

      window.removeEventListener(
        "pointerup",
        finish,
      );

      window.removeEventListener(
        "pointercancel",
        cancel,
      );

      window.removeEventListener(
        "blur",
        cancel,
      );

      document.removeEventListener(
        "visibilitychange",
        cancel,
      );

      if (
        rafRef.current !==
        null
      ) {
        cancelAnimationFrame(
          rafRef.current,
        );
      }
    };
  }, []);

  const preview =
    useMemo(() => {
      if (!interaction) {
        return new Map<
          string,
          Partial<AnyElement>
        >();
      }

      if (
        interaction.kind ===
        "move"
      ) {
        return new Map(
          interaction.ids.map(
            (id) => {
              const offset =
                interaction
                  .offsets[id];

              return [
                id,
                offset
                  ? {
                      x:
                        interaction
                          .point.x -
                        offset.x,
                      y:
                        interaction
                          .point.y -
                        offset.y,
                    }
                  : {},
              ];
            },
          ),
        );
      }

      if (
        interaction.kind ===
        "resize"
      ) {
        return new Map([
          [
            interaction.id,
            resizePatch(
              interaction,
              callbacksRef
                .current.scale,
              callbacksRef
                .current
                .pageRotation,
            ),
          ],
        ]);
      }

      return new Map([
        [
          interaction.id,
          {
            rotation:
              rotationValue(
                interaction,
              ),
          },
        ],
      ]);
    }, [interaction]);

  return {
    interaction,
    beginMoveWithOffsets,
    beginResize,
    beginRotate,
    preview,
  };
}

function resizePatch(
  interaction: Extract<
    TransformInteraction,
    {
      kind: "resize";
    }
  >,
  scale: number,
  pageRotation: number,
) {
  const dxScreen =
    (interaction.latestClient.x -
      interaction.startClient.x) /
    scale;

  const dyScreen =
    (interaction.latestClient.y -
      interaction.startClient.y) /
    scale;

  const { dx, dy } =
    rotateVector(
      dxScreen,
      dyScreen,
      -(
        pageRotation +
        interaction.startRotation
      ),
    );

  const box =
    applyResizeHandle(
      interaction.handle,
      interaction.start,
      dx,
      dy,
    );

  const patch: Partial<AnyElement> =
    {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };

  if (
    interaction.startFontSize &&
    interaction.handle.length ===
      2
  ) {
    const factor =
      Math.max(
        0.35,
        Math.min(
          4,
          Math.max(
            box.width /
              interaction.start
                .width,
            box.height /
              interaction.start
                .height,
          ),
        ),
      );

    (
      patch as Partial<TextElement>
    ).fontSize =
      Math.max(
        6,
        Math.min(
          96,
          +(
            interaction.startFontSize *
            factor
          ).toFixed(1),
        ),
      );
  }

  return patch;
}

function rotationValue(
  interaction: Extract<
    TransformInteraction,
    {
      kind: "rotate";
    }
  >,
) {
  const angle =
    Math.atan2(
      interaction.latest.y -
        interaction.center.y,
      interaction.latest.x -
        interaction.center.x,
    );

  let rotation = Math.round(
    interaction.startRotation +
      ((angle -
        interaction.startAngle) *
        180) /
        Math.PI,
  );

  if (
    interaction.latest.shift
  ) {
    rotation =
      Math.round(
        rotation / 15,
      ) * 15;
  }

  return (
    ((rotation % 360) +
      360) %
    360
  );
}