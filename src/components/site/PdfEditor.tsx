import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { publishResult } from "@/lib/result-store";
import { cn } from "@/lib/utils";
import {
  FONT_OPTIONS,
  makeId,
  deleteSavedSignature,
  getSavedSignatures,
  saveSignature,
  stampElements,
  type AnyElement,
  type ImageElement,
  type SavedSignature,
  type TextElement,
} from "@/lib/pdf-annotations";
import { pickFile } from "@/lib/file-picker";
import { loadGoogleFontData } from "@/lib/google-font-data";
import { EditorCanvas } from "./EditorCanvas";
import { EditorErrorBoundary } from "./EditorErrorBoundary";
import { SignatureModal } from "./SignatureModal";
import { Toolbar } from "./Toolbar";
import {
  clearEditorDraft,
  loadEditorDraft,
  makeEditorFileKey,
  useEditorDraftAutosave,
} from "./hooks/useEditorDraft";
import { useEditorHistory } from "./hooks/useEditorHistory";
import type {
  EditorApplyResult,
  EditorApplyState,
  EditorPage,
  Phase,
  ShapeDefaults,
  Tool,
} from "./editor-types";

export type {
  EditorApplyResult,
  EditorApplyState,
  EditorPage,
  Phase,
  ShapeDefaults,
  Tool,
} from "./editor-types";

type PdfPage = {
  getViewport: (options: {
    scale: number;
    rotation?: number;
  }) => {
    width: number;
    height: number;
  };

  render: (options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: {
      width: number;
      height: number;
    };
  }) => {
    promise: Promise<void>;
  };

  getTextContent?: () => Promise<{
    items: {
      str: string;
    }[];
  }>;
};

type PdfDoc = {
  numPages: number;
  getPage: (
    index: number,
  ) => Promise<PdfPage>;
};

type Props = {
  file: File;
  mode: string;
  actionLabel: string;
  busy?: boolean;
  selectionHint?: string;
  onReplace: () => void;
  onApply: (
    state: EditorApplyState,
  ) =>
    | Promise<EditorApplyResult>
    | EditorApplyResult;
};

type SearchResult = {
  pageIndex: number;
  snippet: string;
};

type SaveStatus =
  | "saved"
  | "unsaved"
  | "saving";

type SuccessState = {
  blob: Blob;
  filename: string;
  thumb: string | null;
  pages: number;
};

const NUDGE = 1;
const NUDGE_FAST = 10;

function initialPages(
  count: number,
): EditorPage[] {
  return Array.from(
    {
      length: count,
    },
    (_, index) => ({
      id: `p${index}`,
      originalIndex: index,
      rotation: 0,
      selected: false,
    }),
  );
}

export function PdfEditor(
  props: Props,
) {
  const fileKey = useMemo(
    () =>
      makeEditorFileKey(
        props.file,
      ),
    [props.file],
  );

  return (
    <EditorErrorBoundary
      fileKey={fileKey}
      onReplace={props.onReplace}
    >
      <PdfEditorInner
        {...props}
        fileKey={fileKey}
      />
    </EditorErrorBoundary>
  );
}

function PdfEditorInner({
  file,
  actionLabel,
  busy = false,
  onReplace,
  onApply,
  fileKey,
}: Props & {
  fileKey: string;
}) {
  const [
    pdf,
    setPdf,
  ] =
    useState<PdfDoc | null>(
      null,
    );

  const history =
    useEditorHistory({
      pages: [],
      elements: [],
    });

  const {
    reset: resetHistory,
    commit: commitHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = history;

  const pages =
    history.pages;

  const elements =
    history.elements;

  const [
    selectedIds,
    setSelectedIds,
  ] = useState<Set<string>>(
    new Set(),
  );

  const [
    editingTextId,
    setEditingTextId,
  ] = useState<
    string | null
  >(null);

  const editingOriginalTextRef =
    useRef<
      Record<string, string>
    >({});

  const [
    activeTool,
    setActiveTool,
  ] = useState<Tool>(
    "select",
  );

  const [
    activeShape,
    setActiveShape,
  ] = useState<Tool>(
    "shape-rect",
  );

  const [
    phase,
    setPhase,
  ] = useState<Phase>(
    "reading",
  );

  const [
    errorMsg,
    setErrorMsg,
  ] = useState<string | null>(
    null,
  );

  const [
    current,
    setCurrent,
  ] = useState(0);

  /*
   * Initial editor preview:
   * 60% instead of the previous 100% / width-fit mode.
   */
  const [
    zoom,
    setZoom,
  ] = useState(0.6);

  const [
    fitMode,
    setFitMode,
  ] = useState<
    "width" | "page" | "custom"
  >("custom");

  const [
    thumbs,
    setThumbs,
  ] = useState<
    Record<number, string>
  >({});

  const [
    showPagePanel,
    setShowPagePanel,
  ] = useState(false);

  const [
    showSearch,
    setShowSearch,
  ] = useState(false);

  const [
    searchQuery,
    setSearchQuery,
  ] = useState("");

  const [
    searchResults,
    setSearchResults,
  ] = useState<
    SearchResult[]
  >([]);

  const [
    searchActiveIdx,
    setSearchActiveIdx,
  ] = useState(0);

  const [
    searching,
    setSearching,
  ] = useState(false);

  const [
    signatureOpen,
    setSignatureOpen,
  ] = useState(false);

  const [
    savedSignatures,
    setSavedSignatures,
  ] = useState<
    SavedSignature[]
  >([]);

  const [
    processing,
    setProcessing,
  ] = useState(false);

  const [
    saveStatus,
    setSaveStatus,
  ] = useState<SaveStatus>(
    "saved",
  );

  const [
    success,
    setSuccess,
  ] =
    useState<SuccessState | null>(
      null,
    );

  const [
    selectionRect,
    setSelectionRect,
  ] = useState<
    DOMRect | null
  >(null);

  const [
    imagePickerState,
    setImagePickerState,
  ] = useState<
    "idle" | "loading" | "error"
  >("idle");

  const [
    imagePickerError,
    setImagePickerError,
  ] =
    useState<string | null>(
      null,
    );

  const clipboardRef =
    useRef<
      AnyElement[] | null
    >(null);

  const textCacheRef =
    useRef<
      Record<number, string>
    >({});

  const panStateRef =
    useRef<{
      startX: number;
      startY: number;
      scrollLeft: number;
      scrollTop: number;
      el: HTMLElement;
    } | null>(null);

  const [
    drawStroke,
    setDrawStroke,
  ] = useState({
    color: "#DC2626",
    width: 2,
  });

  const [
    eraserSize,
    setEraserSize,
  ] = useState(15);

  const [
    highlightSettings,
    setHighlightSettings,
  ] = useState({
    color: "#FDE047",
    opacity: 0.35,
  });

  const [
    shapeDefaults,
    setShapeDefaults,
  ] =
    useState<ShapeDefaults>(
      {
        stroke: "#DC2626",
        strokeWidth: 2,
        fill: null,
        dash: "solid",
      },
    );

  const selectedElements =
    useMemo(
      () =>
        elements.filter(
          (element) =>
            selectedIds.has(
              element.id,
            ),
        ),
      [
        elements,
        selectedIds,
      ],
    );

  const singleSelected =
    selectedElements.length ===
    1
      ? selectedElements[0]
      : null;

  const annotateDisabled =
    !pages[current];

  const commit =
    useCallback(
      (
        nextPages: EditorPage[] =
          pages,
        nextElements: AnyElement[] =
          elements,
      ) => {
        commitHistory({
          pages: nextPages,
          elements:
            nextElements,
        });

        setSaveStatus(
          "unsaved",
        );
      },
      [
        commitHistory,
        elements,
        pages,
      ],
    );

  const updateElements =
    useCallback(
      (
        ids: Set<string>,
        patchFn: (
          element: AnyElement,
        ) => Partial<AnyElement>,
      ) => {
        const next =
          elements.map(
            (element) =>
              ids.has(
                element.id,
              )
                ? ({
                    ...element,
                    ...patchFn(
                      element,
                    ),
                  } as AnyElement)
                : element,
          );

        commit(
          pages,
          next,
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const updateElement =
    useCallback(
      (
        id: string,
        patch: Partial<AnyElement>,
      ) =>
        updateElements(
          new Set([id]),
          () => patch,
        ),
      [updateElements],
    );

  const deleteElements =
    useCallback(
      (ids: Set<string>) => {
        commit(
          pages,
          elements.filter(
            (element) =>
              !ids.has(
                element.id,
              ),
          ),
        );

        setSelectedIds(
          new Set(),
        );

        setEditingTextId(
          (id) =>
            id &&
            ids.has(id)
              ? null
              : id,
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const duplicateElements =
    useCallback(
      (ids: Set<string>) => {
        const clones =
          elements
            .filter(
              (element) =>
                ids.has(
                  element.id,
                ),
            )
            .map(
              (element) =>
                ({
                  ...element,
                  id: makeId(
                    "dup",
                  ),
                  x:
                    element.x +
                    14,
                  y:
                    element.y +
                    14,
                } as AnyElement),
            );

        if (
          !clones.length
        ) {
          return;
        }

        commit(
          pages,
          [
            ...elements,
            ...clones,
          ],
        );

        setSelectedIds(
          new Set(
            clones.map(
              (clone) =>
                clone.id,
            ),
          ),
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const replaceElements =
    useCallback(
      (
        toRemove: string[],
        toAdd: AnyElement[],
      ) => {
        commit(
          pages,
          [
            ...elements.filter(
              (element) =>
                !toRemove.includes(
                  element.id,
                ),
            ),
            ...toAdd,
          ],
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const addElementKeepTool =
    useCallback(
      (element: AnyElement) => {
        commit(
          pages,
          [
            ...elements,
            element,
          ],
        );

        setSelectedIds(
          new Set([
            element.id,
          ]),
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const addElement =
    useCallback(
      (element: AnyElement) => {
        addElementKeepTool(
          element,
        );

        setActiveTool(
          "select",
        );
      },
      [addElementKeepTool],
    );

  const addTextAt =
    useCallback(
      (
        pageId: string,
        x: number,
        y: number,
        width = 200,
        height = 32,
      ) => {
        const id =
          makeId("txt");

        const element: TextElement =
          {
            id,
            pageId,
            type: "text",
            x,
            y,
            width,
            height,
            opacity: 1,
            rotation: 0,
            text: "",
            font: "Helvetica",
            fontSize: 14,
            bold: false,
            italic: false,
            underline:
              false,
            color: "#111827",
            align: "left",
            letterSpacing: 0,
            lineSpacing: 1.25,
          };

        commit(
          pages,
          [
            ...elements,
            element,
          ],
        );

        editingOriginalTextRef.current[
          id
        ] = "";

        setSelectedIds(
          new Set([id]),
        );

        setEditingTextId(
          id,
        );

        setActiveTool(
          "select",
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const beginTextEdit =
    useCallback(
      (id: string) => {
        const element =
          elements.find(
            (candidate) =>
              candidate.id ===
              id,
          );

        if (
          element?.type ===
          "text"
        ) {
          editingOriginalTextRef.current[
            id
          ] =
            element.text;
        }

        setSelectedIds(
          new Set([id]),
        );

        setEditingTextId(
          id,
        );
      },
      [elements],
    );

  const finishTextEdit =
    useCallback(
      (
        id: string,
        value: string,
        cancel = false,
      ) => {
        const text =
          value.replace(
            /\u00a0/g,
            " ",
          );

        const original =
          editingOriginalTextRef
            .current[id] ??
          "";

        setEditingTextId(
          (currentId) =>
            currentId === id
              ? null
              : currentId,
        );

        delete editingOriginalTextRef
          .current[id];

        if (
          cancel ||
          !text.trim()
        ) {
          if (
            !original.trim()
          ) {
            commit(
              pages,
              elements.filter(
                (element) =>
                  element.id !==
                  id,
              ),
            );

            setSelectedIds(
              new Set(),
            );
          }

          return;
        }

        commit(
          pages,
          elements.map(
            (element) =>
              element.id ===
                id &&
              element.type ===
                "text"
                ? {
                    ...element,
                    text,
                  }
                : element,
          ),
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const copyElements =
    useCallback(
      (ids: Set<string>) => {
        clipboardRef.current =
          elements.filter(
            (element) =>
              ids.has(
                element.id,
              ),
          );
      },
      [elements],
    );

  const pasteElements =
    useCallback(
      (pageId: string) => {
        const clip =
          clipboardRef.current;

        if (
          !clip?.length
        ) {
          return;
        }

        const clones =
          clip.map(
            (element) =>
              ({
                ...element,
                id: makeId(
                  "paste",
                ),
                pageId,
                x:
                  element.x +
                  20,
                y:
                  element.y +
                  20,
              } as AnyElement),
          );

        commit(
          pages,
          [
            ...elements,
            ...clones,
          ],
        );

        setSelectedIds(
          new Set(
            clones.map(
              (clone) =>
                clone.id,
            ),
          ),
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const reorderZ =
    useCallback(
      (
        ids: Set<string>,
        dir:
          | "forward"
          | "backward"
          | "front"
          | "back",
      ) => {
        const next =
          [...elements];

        const indices =
          next
            .map(
              (
                element,
                index,
              ) =>
                ids.has(
                  element.id,
                )
                  ? index
                  : -1,
            )
            .filter(
              (index) =>
                index >= 0,
            );

        if (
          !indices.length
        ) {
          return;
        }

        if (
          dir === "front"
        ) {
          const items =
            indices.map(
              (index) =>
                next[index],
            );

          commit(
            pages,
            [
              ...next.filter(
                (_, index) =>
                  !indices.includes(
                    index,
                  ),
              ),
              ...items,
            ],
          );

          return;
        }

        if (
          dir === "back"
        ) {
          const items =
            indices.map(
              (index) =>
                next[index],
            );

          commit(
            pages,
            [
              ...items,
              ...next.filter(
                (_, index) =>
                  !indices.includes(
                    index,
                  ),
              ),
            ],
          );

          return;
        }

        const step =
          dir ===
          "forward"
            ? 1
            : -1;

        const order =
          dir ===
          "forward"
            ? [...indices].reverse()
            : indices;

        for (
          const index of order
        ) {
          const target =
            index + step;

          if (
            target < 0 ||
            target >=
              next.length ||
            ids.has(
              next[target]
                .id,
            )
          ) {
            continue;
          }

          [
            next[index],
            next[target],
          ] = [
            next[target],
            next[index],
          ];
        }

        commit(
          pages,
          next,
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const alignElements =
    useCallback(
      (
        ids: Set<string>,
        mode:
          | "left"
          | "center"
          | "right"
          | "top"
          | "middle"
          | "bottom",
      ) => {
        const selected =
          elements.filter(
            (element) =>
              ids.has(
                element.id,
              ),
          );

        if (
          selected.length <
          2
        ) {
          return;
        }

        const left =
          Math.min(
            ...selected.map(
              (element) =>
                element.x,
            ),
          );

        const right =
          Math.max(
            ...selected.map(
              (element) =>
                element.x +
                element.width,
            ),
          );

        const top =
          Math.min(
            ...selected.map(
              (element) =>
                element.y,
            ),
          );

        const bottom =
          Math.max(
            ...selected.map(
              (element) =>
                element.y +
                element.height,
            ),
          );

        const centerX =
          (left + right) /
          2;

        const centerY =
          (top + bottom) /
          2;

        commit(
          pages,
          elements.map(
            (element) => {
              if (
                !ids.has(
                  element.id,
                )
              ) {
                return element;
              }

              const x =
                mode ===
                "left"
                  ? left
                  : mode ===
                      "center"
                    ? centerX -
                      element.width /
                        2
                    : mode ===
                        "right"
                      ? right -
                        element.width
                      : element.x;

              const y =
                mode ===
                "top"
                  ? top
                  : mode ===
                      "middle"
                    ? centerY -
                      element.height /
                        2
                    : mode ===
                        "bottom"
                      ? bottom -
                        element.height
                      : element.y;

              return {
                ...element,
                x,
                y,
              } as AnyElement;
            },
          ),
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const distributeElements =
    useCallback(
      (
        ids: Set<string>,
        axis:
          | "horizontal"
          | "vertical",
      ) => {
        const selected =
          [
            ...elements.filter(
              (element) =>
                ids.has(
                  element.id,
                ),
            ),
          ].sort(
            (a, b) =>
              axis ===
              "horizontal"
                ? a.x - b.x
                : a.y - b.y,
          );

        if (
          selected.length <
          3
        ) {
          return;
        }

        const first =
          selected[0];

        const last =
          selected[
            selected.length -
              1
          ];

        const totalSpan =
          axis ===
          "horizontal"
            ? last.x +
              last.width -
              first.x
            : last.y +
              last.height -
              first.y;

        const totalSize =
          selected.reduce(
            (
              sum,
              element,
            ) =>
              sum +
              (axis ===
              "horizontal"
                ? element.width
                : element.height),
            0,
          );

        const gap =
          (totalSpan -
            totalSize) /
          (selected.length -
            1);

        let cursor =
          axis ===
          "horizontal"
            ? first.x
            : first.y;

        const positions =
          new Map<
            string,
            number
          >();

        for (
          const element of selected
        ) {
          positions.set(
            element.id,
            cursor,
          );

          cursor +=
            (axis ===
            "horizontal"
              ? element.width
              : element.height) +
            gap;
        }

        commit(
          pages,
          elements.map(
            (element) => {
              const position =
                positions.get(
                  element.id,
                );

              if (
                position ==
                null
              ) {
                return element;
              }

              return axis ===
                "horizontal"
                ? ({
                    ...element,
                    x: position,
                  } as AnyElement)
                : ({
                    ...element,
                    y: position,
                  } as AnyElement);
            },
          ),
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const selectAllPages =
    useCallback(
      () =>
        commit(
          pages.map(
            (page) => ({
              ...page,
              selected:
                true,
            }),
          ),
          elements,
        ),
      [
        commit,
        elements,
        pages,
      ],
    );

  const handlePageClick =
    useCallback(
      (index: number) => {
        setCurrent(index);

        document
          .getElementById(
            `pdf-page-${index}`,
          )
          ?.scrollIntoView({
            behavior:
              "smooth",
            block:
              "center",
          });
      },
      [],
    );

  const rotatePage =
    useCallback(
      (
        index: number,
        delta: number,
      ) =>
        commit(
          pages.map(
            (
              page,
              pageIndex,
            ) =>
              pageIndex ===
              index
                ? {
                    ...page,
                    rotation:
                      (page.rotation +
                        delta +
                        360) %
                      360,
                  }
                : page,
          ),
          elements,
        ),
      [
        commit,
        elements,
        pages,
      ],
    );

  const deletePage =
    useCallback(
      (index: number) => {
        if (
          pages.length <=
          1
        ) {
          toast.error(
            "PDF must have at least one page.",
          );

          return;
        }

        const deletedPageId =
          pages[index]?.id;

        commit(
          pages.filter(
            (
              _,
              pageIndex,
            ) =>
              pageIndex !==
              index,
          ),
          deletedPageId
            ? elements.filter(
                (element) =>
                  element.pageId !==
                  deletedPageId,
              )
            : elements,
        );

        setCurrent(
          (value) =>
            Math.min(
              value,
              pages.length -
                2,
            ),
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const duplicatePage =
    useCallback(
      (index: number) => {
        const source =
          pages[index];

        if (!source) {
          return;
        }

        const copy = {
          ...source,
          id: `${source.id}-dup-${Date.now()}`,
          selected:
            false,
        };

        commit(
          [
            ...pages.slice(
              0,
              index + 1,
            ),
            copy,
            ...pages.slice(
              index + 1,
            ),
          ],
          [
            ...elements,
            ...elements
              .filter(
                (element) =>
                  element.pageId ===
                  source.id,
              )
              .map(
                (element) =>
                  ({
                    ...element,
                    id: makeId(
                      "page-copy",
                    ),
                    pageId:
                      copy.id,
                  } as AnyElement),
              ),
          ],
        );

        setCurrent(
          index + 1,
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const insertBlankPage =
    useCallback(
      (after: number) => {
        const blank: EditorPage =
          {
            id: `blank-${Date.now()}`,
            originalIndex:
              -1,
            isBlank: true,
            rotation: 0,
            selected:
              false,
          };

        commit(
          [
            ...pages.slice(
              0,
              after + 1,
            ),
            blank,
            ...pages.slice(
              after + 1,
            ),
          ],
          elements,
        );

        setCurrent(
          after + 1,
        );
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  const movePage =
    useCallback(
      (
        from: number,
        to: number,
      ) => {
        if (
          from === to ||
          from < 0 ||
          to < 0 ||
          from >=
            pages.length ||
          to >= pages.length
        ) {
          return;
        }

        const next =
          [...pages];

        const [
          moved,
        ] = next.splice(
          from,
          1,
        );

        next.splice(
          to,
          0,
          moved,
        );

        commit(
          next,
          elements,
        );

        setCurrent(to);
      },
      [
        commit,
        elements,
        pages,
      ],
    );

  useEffect(() => {
    setSavedSignatures(
      getSavedSignatures(),
    );
  }, [signatureOpen]);

  useEffect(() => {
    function onBeforeUnload(
      event: BeforeUnloadEvent,
    ) {
      if (
        saveStatus !==
        "unsaved"
      ) {
        return;
      }

      event.preventDefault();
      event.returnValue =
        "";
    }

    window.addEventListener(
      "beforeunload",
      onBeforeUnload,
    );

    return () =>
      window.removeEventListener(
        "beforeunload",
        onBeforeUnload,
      );
  }, [saveStatus]);

  useEffect(() => {
    let cancelled = false;

    setPhase("reading");
    setErrorMsg(null);
    setPdf(null);
    setSelectedIds(
      new Set(),
    );
    setThumbs({});
    setCurrent(0);
    setSuccess(null);

    textCacheRef.current =
      {};

    resetHistory({
      pages: [],
      elements: [],
    });

    void (async () => {
      try {
        const {
          loadPdf,
        } = await import(
          "@/lib/pdf-render"
        );

        const doc =
          (await loadPdf(
            file,
          )) as unknown as PdfDoc;

        if (
          cancelled
        ) {
          return;
        }

        const draft =
          loadEditorDraft(
            fileKey,
          );

        const canRestore =
          !!draft &&
          draft.pages
            .length > 0 &&
          draft.pages.every(
            (page) =>
              page.isBlank ||
              (page.originalIndex >=
                0 &&
                page.originalIndex <
                  doc.numPages),
          );

        const restoredPages =
          canRestore &&
          draft
            ? draft.pages
            : initialPages(
                doc.numPages,
              );

        const allowedPageIds =
          new Set(
            restoredPages.map(
              (page) =>
                page.id,
            ),
          );

        const restoredElements =
          canRestore &&
          draft
            ? draft.elements.filter(
                (element) =>
                  allowedPageIds.has(
                    element.pageId,
                  ),
              )
            : [];

        setPdf(doc);

        resetHistory({
          pages:
            restoredPages,
          elements:
            restoredElements,
        });

        setSaveStatus(
          canRestore
            ? "unsaved"
            : "saved",
        );

        if (
          canRestore
        ) {
          toast.success(
            "Restored your local draft.",
          );
        }

        setPhase(
          "rendering",
        );
      } catch (error) {
        if (
          cancelled
        ) {
          return;
        }

        const message =
          error instanceof
          Error
            ? error.message
            : "Could not read PDF.";

        setErrorMsg(
          /password/i.test(
            message,
          )
            ? "This PDF is password-protected."
            : /invalid|corrupt/i.test(
                  message,
                )
              ? "This file appears corrupt."
              : message,
        );

        setPhase(
          "error",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    file,
    fileKey,
    resetHistory,
  ]);

  useEffect(() => {
    if (!pdf) {
      return;
    }

    let cancelled = false;

    void (async () => {
      for (
        let index = 0;
        index <
        pdf.numPages;
        index += 1
      ) {
        if (
          cancelled
        ) {
          return;
        }

        if (
          thumbs[index]
        ) {
          continue;
        }

        try {
          const page =
            await pdf.getPage(
              index + 1,
            );

          const viewport =
            page.getViewport({
              scale: 0.3,
            });

          const canvas =
            document.createElement(
              "canvas",
            );

          canvas.width =
            Math.ceil(
              viewport.width,
            );

          canvas.height =
            Math.ceil(
              viewport.height,
            );

          const context =
            canvas.getContext(
              "2d",
            );

          if (!context) {
            continue;
          }

          await page
            .render({
              canvas,
              canvasContext:
                context,
              viewport,
            })
            .promise;

          if (
            !cancelled
          ) {
            setThumbs(
              (
                currentThumbs,
              ) => ({
                ...currentThumbs,
                [index]:
                  canvas.toDataURL(
                    "image/jpeg",
                    0.75,
                  ),
              }),
            );
          }
        } catch {
          /* one thumbnail failure must not stop the editor */
        }
      }

      if (
        !cancelled
      ) {
        setPhase(
          "ready",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdf, thumbs]);

  useEditorDraftAutosave(
    fileKey,
    pages,
    elements,
    phase === "ready" &&
      !processing &&
      !success,
  );

  useEffect(() => {
    function onKey(
      event: KeyboardEvent,
    ) {
      const target =
        event.target as HTMLElement | null;

      if (
        target?.tagName ===
          "INPUT" ||
        target?.tagName ===
          "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      const modifier =
        event.metaKey ||
        event.ctrlKey;

      if (
        modifier &&
        event.key.toLowerCase() ===
          "z" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        undo();
        return;
      }

      if (
        (modifier &&
          event.key.toLowerCase() ===
            "y") ||
        (modifier &&
          event.shiftKey &&
          event.key.toLowerCase() ===
            "z")
      ) {
        event.preventDefault();
        redo();
        return;
      }

      if (
        modifier &&
        event.key.toLowerCase() ===
          "d" &&
        selectedIds.size
      ) {
        event.preventDefault();
        duplicateElements(
          selectedIds,
        );
        return;
      }

      if (
        modifier &&
        event.key.toLowerCase() ===
          "c" &&
        selectedIds.size
      ) {
        event.preventDefault();
        copyElements(
          selectedIds,
        );
        return;
      }

      if (
        modifier &&
        event.key.toLowerCase() ===
          "x" &&
        selectedIds.size
      ) {
        event.preventDefault();
        copyElements(
          selectedIds,
        );
        deleteElements(
          selectedIds,
        );
        return;
      }

      if (
        modifier &&
        event.key.toLowerCase() ===
          "v"
      ) {
        const pageId =
          pages[current]?.id;

        if (
          pageId &&
          clipboardRef.current?.length
        ) {
          event.preventDefault();
          pasteElements(
            pageId,
          );
        }

        return;
      }

      if (
        modifier &&
        event.key.toLowerCase() ===
          "a"
      ) {
        event.preventDefault();

        if (
          activeTool ===
            "select" &&
          elements.length
        ) {
          const pageId =
            pages[current]?.id;

          if (
            pageId
          ) {
            setSelectedIds(
              new Set(
                elements
                  .filter(
                    (element) =>
                      element.pageId ===
                      pageId,
                  )
                  .map(
                    (element) =>
                      element.id,
                  ),
              ),
            );
          }
        } else {
          selectAllPages();
        }

        return;
      }

      if (
        modifier &&
        event.key.toLowerCase() ===
          "f"
      ) {
        event.preventDefault();
        setShowSearch(
          true,
        );
        return;
      }

      if (
        (event.key ===
          "Delete" ||
          event.key ===
            "Backspace") &&
        selectedIds.size
      ) {
        event.preventDefault();

        deleteElements(
          selectedIds,
        );

        return;
      }

      if (
        event.key ===
        "Escape"
      ) {
        if (
          editingTextId
        ) {
          finishTextEdit(
            editingTextId,
            editingOriginalTextRef
              .current[
              editingTextId
            ] ?? "",
            true,
          );

          return;
        }

        setSelectedIds(
          new Set(),
        );

        setActiveTool(
          "select",
        );

        setShowSearch(
          false,
        );

        return;
      }

      if (
        [
          "ArrowDown",
          "ArrowRight",
          "ArrowUp",
          "ArrowLeft",
        ].includes(
          event.key,
        ) &&
        selectedIds.size
      ) {
        event.preventDefault();

        const amount =
          event.shiftKey
            ? NUDGE_FAST
            : NUDGE;

        const dx =
          event.key ===
          "ArrowRight"
            ? amount
            : event.key ===
                "ArrowLeft"
              ? -amount
              : 0;

        const dy =
          event.key ===
          "ArrowDown"
            ? amount
            : event.key ===
                "ArrowUp"
              ? -amount
              : 0;

        updateElements(
          selectedIds,
          (element) => ({
            x:
              element.x +
              dx,
            y:
              element.y +
              dy,
          }),
        );

        return;
      }

      if (
        !modifier &&
        !editingTextId
      ) {
        if (
          event.key.toLowerCase() ===
          "v"
        ) {
          event.preventDefault();
          setActiveTool(
            "select",
          );
        } else if (
          event.key.toLowerCase() ===
          "h"
        ) {
          event.preventDefault();
          setActiveTool(
            "hand",
          );
        } else if (
          event.key.toLowerCase() ===
          "t"
        ) {
          event.preventDefault();
          setActiveTool(
            "text",
          );
        }
      }
    }

    window.addEventListener(
      "keydown",
      onKey,
    );

    return () =>
      window.removeEventListener(
        "keydown",
        onKey,
      );
  }, [
    activeTool,
    copyElements,
    deleteElements,
    duplicateElements,
    elements,
    editingTextId,
    finishTextEdit,
    pages,
    pasteElements,
    redo,
    selectAllPages,
    selectedIds,
    undo,
    updateElements,
  ]);

  const runSearch =
    useCallback(
      async (
        query: string,
      ) => {
        setSearchQuery(
          query,
        );

        setSearchActiveIdx(
          0,
        );

        if (
          !pdf ||
          !query.trim()
        ) {
          setSearchResults(
            [],
          );
          return;
        }

        setSearching(
          true,
        );

        try {
          const results: SearchResult[] =
            [];

          for (
            let index = 0;
            index <
            pages.length;
            index += 1
          ) {
            const originalIndex =
              pages[index]
                .originalIndex;

            if (
              originalIndex <
              0
            ) {
              continue;
            }

            let text =
              textCacheRef
                .current[
                originalIndex
              ];

            if (
              text == null
            ) {
              try {
                const page =
                  await pdf.getPage(
                    originalIndex +
                      1,
                  );

                const content =
                  await page.getTextContent?.();

                text = content
                  ? content.items
                      .map(
                        (item) =>
                          item.str,
                      )
                      .join(" ")
                  : "";
              } catch {
                text = "";
              }

              textCacheRef.current[
                originalIndex
              ] = text;
            }

            const matchIndex =
              text
                .toLowerCase()
                .indexOf(
                  query.toLowerCase(),
                );

            if (
              matchIndex >=
              0
            ) {
              const start =
                Math.max(
                  0,
                  matchIndex -
                    30,
                );

              results.push({
                pageIndex:
                  index,
                snippet: `${
                  start
                    ? "…"
                    : ""
                }${text.slice(
                  start,
                  matchIndex +
                    query.length +
                    30,
                )}…`,
              });
            }
          }

          setSearchResults(
            results,
          );
        } finally {
          setSearching(
            false,
          );
        }
      },
      [pages, pdf],
    );

  const jumpToSearchResult =
    useCallback(
      (index: number) => {
        if (
          !searchResults.length
        ) {
          return;
        }

        const resultIndex =
          ((index %
            searchResults.length) +
            searchResults.length) %
          searchResults.length;

        setSearchActiveIdx(
          resultIndex,
        );

        handlePageClick(
          searchResults[
            resultIndex
          ].pageIndex,
        );
      },
      [
        handlePageClick,
        searchResults,
      ],
    );

  const readImageFile =
    useCallback(
      (
        inputFile: File,
      ): Promise<{
        src: string;
        width: number;
        height: number;
      }> =>
        new Promise(
          (
            resolve,
            reject,
          ) => {
            const reader =
              new FileReader();

            reader.onerror =
              () =>
                reject(
                  new Error(
                    "Could not read that image file.",
                  ),
                );

            reader.onload = () => {
              const src =
                String(
                  reader.result,
                );

              const image =
                new Image();

              image.onerror =
                () =>
                  reject(
                    new Error(
                      "Could not decode that image.",
                    ),
                  );

              image.onload =
                () => {
                  const mime =
                    inputFile.type.toLowerCase();

                  if (
                    mime ===
                      "image/png" ||
                    mime ===
                      "image/jpeg"
                  ) {
                    resolve({
                      src,
                      width:
                        image.width,
                      height:
                        image.height,
                    });

                    return;
                  }

                  const canvas =
                    document.createElement(
                      "canvas",
                    );

                  canvas.width =
                    image.width;

                  canvas.height =
                    image.height;

                  const context =
                    canvas.getContext(
                      "2d",
                    );

                  if (!context) {
                    reject(
                      new Error(
                        "Could not decode that image.",
                      ),
                    );

                    return;
                  }

                  context.drawImage(
                    image,
                    0,
                    0,
                  );

                  resolve({
                    src:
                      canvas.toDataURL(
                        "image/png",
                      ),
                    width:
                      image.width,
                    height:
                      image.height,
                  });
                };

              image.src = src;
            };

            reader.readAsDataURL(
              inputFile,
            );
          },
        ),
      [],
    );

  const chooseImage =
    useCallback(
      async (
        replaceId?: string,
      ) => {
        if (
          !pages[current]
        ) {
          return;
        }

        setImagePickerState(
          "loading",
        );

        setImagePickerError(
          null,
        );

        try {
          const picked =
            await pickFile({
              accept:
                "image/png,image/jpeg,image/webp,image/svg+xml",
              multiple:
                false,
            });

          const selectedFile = Array.isArray(
            picked,
          )
            ? picked[0]
            : picked;

          if (!selectedFile) {
            setImagePickerState(
              "idle",
            );

            setActiveTool(
              "select",
            );

            return;
          }

          const image =
            await readImageFile(
              selectedFile,
            );

          if (replaceId) {
            const currentElement =
              elements.find(
                (element) =>
                  element.id ===
                  replaceId,
              );

            if (
              !currentElement ||
              currentElement.type !==
                "image"
            ) {
              throw new Error(
                "The selected image no longer exists.",
              );
            }

            const scale =
              Math.min(
                1,
                Math.min(
                  currentElement.width /
                    Math.max(
                      1,
                      image.width,
                    ),
                  currentElement.height /
                    Math.max(
                      1,
                      image.height,
                    ),
                ),
              );

            updateElement(
              replaceId,
              {
                src:
                  image.src,
                width:
                  Math.max(
                    16,
                    image.width *
                      scale,
                  ),
                height:
                  Math.max(
                    16,
                    image.height *
                      scale,
                  ),
              },
            );
          } else {
            const scale =
              Math.min(
                1,
                220 /
                  Math.max(
                    1,
                    image.width,
                  ),
              );

            addElement({
              id: makeId(
                "img",
              ),
              pageId:
                pages[current].id,
              type: "image",
              x: 60,
              y: 60,
              width:
                image.width *
                scale,
              height:
                image.height *
                scale,
              opacity: 1,
              rotation: 0,
              src: image.src,
            } as ImageElement);
          }

          setImagePickerState(
            "idle",
          );
        } catch (error) {
          const message =
            error instanceof
            Error
              ? error.message
              : "Could not add the image.";

          setImagePickerError(
            message,
          );

          setImagePickerState(
            "error",
          );

          setActiveTool(
            "select",
          );

          toast.error(
            message,
          );

          window.setTimeout(
            () => {
              setImagePickerState(
                "idle",
              );

              setImagePickerError(
                null,
              );
            },
            3500,
          );
        }
      },
      [
        addElement,
        current,
        elements,
        pages,
        readImageFile,
        updateElement,
      ],
    );

  const openNewImage =
    useCallback(
      () => {
        setActiveTool(
          "image",
        );

        void chooseImage();
      },
      [chooseImage],
    );

  const openReplacementImage =
    useCallback(
      () => {
        const id =
          selectedElements.length ===
            1 &&
          selectedElements[0]
            .type === "image"
            ? selectedElements[0]
                .id
            : undefined;

        if (id) {
          void chooseImage(
            id,
          );
        }
      },
      [
        chooseImage,
        selectedElements,
      ],
    );

  const handleSignatureInsert =
    useCallback(
      (
        src: string,
        save: boolean,
      ) => {
        if (save) {
          const saved =
            saveSignature(
              src,
            );

          setSavedSignatures(
            (
              currentSignatures,
            ) =>
              [
                saved,
                ...currentSignatures,
              ].slice(0, 12),
          );
        }

        const pageId =
          pages[current]?.id;

        if (!pageId) {
          return;
        }

        addElement({
          id: makeId(
            "sig",
          ),
          pageId,
          type: "image",
          x: 80,
          y: 80,
          width: 180,
          height: 70,
          opacity: 1,
          rotation: 0,
          src,
        } as ImageElement);

        setSignatureOpen(
          false,
        );
      },
      [
        addElement,
        current,
        pages,
      ],
    );

  const handleLoadCustomFont =
    useCallback(
      async (
        id: string,
        family: string,
      ) => {
        if (
          FONT_OPTIONS.includes(
            family as typeof FONT_OPTIONS[number],
          )
        ) {
          updateElement(
            id,
            {
              font: family,
              fontData:
                undefined,
            },
          );

          return;
        }

        try {
          const fontData =
            await loadGoogleFontData(
              family,
            );

          const fontFace =
            new FontFace(
              family,
              `url(${fontData})`,
            );

          await fontFace.load();

          document.fonts.add(
            fontFace,
          );

          updateElement(
            id,
            {
              font: family,
              fontData,
            },
          );
        } catch (error) {
          toast.error(
            error instanceof
            Error
              ? error.message
              : `Could not embed ${family}.`,
          );
        }
      },
      [updateElement],
    );

  const apply =
    useCallback(
      async () => {
        if (
          processing ||
          busy
        ) {
          return;
        }

        setProcessing(
          true,
        );

        setSaveStatus(
          "saving",
        );

        try {
          const result =
            await onApply({
              pages,
              selectedIds:
                new Set(
                  pages
                    .filter(
                      (page) =>
                        page.selected,
                    )
                    .map(
                      (page) =>
                        page.id,
                    ),
                ),
            });

          if (
            !result ||
            !("blob" in result)
          ) {
            setSaveStatus(
              "unsaved",
            );

            return;
          }

          let finalBlob =
            result.blob;

          try {
            finalBlob =
              await stampElements(
                result.blob,
                pages,
                elements,
              );
          } catch (error) {
            console.error(
              "Stamp failed",
              error,
            );

            toast.error(
              "Saved, but some annotations could not be embedded.",
            );
          }

          let thumbUrl:
            | string
            | null = null;

          let pageCount =
            pages.length;

          try {
            const {
              loadPdf,
              renderPdfPageToCanvas,
              canvasToBlob,
            } = await import(
              "@/lib/pdf-render"
            );

            const doc =
              await loadPdf(
                new File(
                  [
                    finalBlob,
                  ],
                  result.filename,
                  {
                    type: "application/pdf",
                  },
                ),
              );

            pageCount =
              doc.numPages;

            const canvas =
              await renderPdfPageToCanvas(
                doc,
                1,
                1.2,
              );

            const blob =
              await canvasToBlob(
                canvas,
                "image/png",
              );

            thumbUrl =
              URL.createObjectURL(
                blob,
              );
          } catch {
            /* preview is optional */
          }

          setSuccess({
            blob:
              finalBlob,
            filename:
              result.filename,
            thumb:
              thumbUrl,
            pages:
              pageCount,
          });

          setSaveStatus(
            "saved",
          );

          clearEditorDraft(
            fileKey,
          );

          const url =
            URL.createObjectURL(
              finalBlob,
            );

          publishResult({
            name:
              result.filename,
            mime:
              "application/pdf",
            size:
              finalBlob.size,
            url,
            createdAt:
              Date.now(),
          });
        } catch (error) {
          setSaveStatus(
            "unsaved",
          );

          console.error(
            "Save failed",
            error,
          );

          toast.error(
            "Something went wrong while saving. Your edits are still here — try again.",
          );
        } finally {
          setProcessing(
            false,
          );
        }
      },
      [
        busy,
        elements,
        fileKey,
        onApply,
        pages,
        processing,
      ],
    );

  const saveAsDownload =
    useCallback(
      () => {
        if (!success) {
          return;
        }

        const anchor =
          document.createElement(
            "a",
          );

        anchor.href =
          URL.createObjectURL(
            success.blob,
          );

        anchor.download =
          success.filename;

        anchor.click();

        window.setTimeout(
          () =>
            URL.revokeObjectURL(
              anchor.href,
            ),
          1000,
        );
      },
      [success],
    );

  if (
    phase === "error"
  ) {
    return (
      <div className="fixed inset-0 z-[9999] grid place-items-center bg-slate-100 p-5 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40">
            <Lock className="h-6 w-6" />
          </div>

          <h3 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">
            Couldn’t open this PDF
          </h3>

          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {errorMsg}
          </p>

          <Button
            variant="outline"
            onClick={
              onReplace
            }
            className="mt-5 rounded-xl"
          >
            Choose another
            file
          </Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <SuccessScreen
        result={success}
        onDownload={
          saveAsDownload
        }
        onEditAgain={() =>
          setSuccess(null)
        }
        onNewFile={
          onReplace
        }
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-slate-50 font-sans dark:bg-slate-950">
      <Toolbar
        fileName={
          file.name
        }
        pageCount={
          pages.length
        }
        saveStatus={
          saveStatus
        }
        actionLabel={
          actionLabel
        }
        busy={busy}
        processing={
          processing
        }
        canUndo={
          canUndo
        }
        canRedo={
          canRedo
        }
        onUndo={
          undo
        }
        onRedo={
          redo
        }
        onApply={
          apply
        }
        onReplace={
          onReplace
        }
        activeTool={
          activeTool
        }
        activeShape={
          activeShape
        }
        annotateDisabled={
          annotateDisabled
        }
        editingTextId={
          editingTextId
        }
        selectedIds={
          selectedIds
        }
        selectedElements={
          selectedElements
        }
        current={
          current
        }
        pages={pages}
        showSearch={
          showSearch
        }
        searchQuery={
          searchQuery
        }
        searchResults={
          searchResults
        }
        searchActiveIdx={
          searchActiveIdx
        }
        searching={
          searching
        }
        onSearchToggle={() =>
          setShowSearch(
            (value) =>
              !value,
          )
        }
        onSearch={
          runSearch
        }
        onSearchJump={
          jumpToSearchResult
        }
        onSearchClose={() => {
          setShowSearch(
            false,
          );
          setSearchQuery(
            "",
          );
          setSearchResults(
            [],
          );
        }}
        onSetActiveTool={(
          tool,
        ) => {
          setActiveTool(
            tool,
          );

          if (
            tool !==
            "select"
          ) {
            setSelectedIds(
              new Set(),
            );
          }
        }}
        onSetActiveShape={
          setActiveShape
        }
        onOpenImage={
          openNewImage
        }
        onOpenSignature={() => {
          setActiveTool(
            "signature",
          );

          setSignatureOpen(
            true,
          );
        }}
        onDelete={() =>
          deleteElements(
            selectedIds,
          )
        }
        onDuplicate={() =>
          duplicateElements(
            selectedIds,
          )
        }
        onUpdateElement={
          updateElement
        }
        onUpdateElements={
          updateElements
        }
        onAlign={(mode) =>
          alignElements(
            selectedIds,
            mode,
          )
        }
        onDistribute={(axis) =>
          distributeElements(
            selectedIds,
            axis,
          )
        }
        onReorder={(dir) =>
          reorderZ(
            selectedIds,
            dir,
          )
        }
        onOpenImageForSelected={
          openReplacementImage
        }
        onLoadCustomFont={
          handleLoadCustomFont
        }
        selectionRect={
          selectionRect
        }
        drawStroke={
          drawStroke
        }
        setDrawStroke={
          setDrawStroke
        }
        eraserSize={
          eraserSize
        }
        setEraserSize={
          setEraserSize
        }
        highlightSettings={
          highlightSettings
        }
        setHighlightSettings={
          setHighlightSettings
        }
        shapeDefaults={
          shapeDefaults
        }
        setShapeDefaults={
          setShapeDefaults
        }
        thumbs={thumbs}
        showPagePanel={
          showPagePanel
        }
        onTogglePagePanel={() =>
          setShowPagePanel(
            (value) =>
              !value,
          )
        }
        onPageClick={
          handlePageClick
        }
        onRotatePage={
          rotatePage
        }
        onDeletePage={
          deletePage
        }
        onDuplicatePage={
          duplicatePage
        }
        onInsertBlankPage={
          insertBlankPage
        }
        onMovePage={
          movePage
        }
      />

      <main className="min-h-0 flex-1">
        {phase ===
          "reading" ||
        phase ===
          "rendering" ? (
          <div className="grid h-full place-items-center text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Preparing document…
            </div>
          </div>
        ) : (
          <EditorCanvas
            pdf={pdf}
            pages={pages}
            zoom={zoom}
            fitMode={
              fitMode
            }
            current={
              current
            }
            onCurrentChange={
              setCurrent
            }
            phase={phase}
            onToggleSelect={(
              index,
            ) =>
              commit(
                pages.map(
                  (
                    page,
                    pageIndex,
                  ) =>
                    pageIndex ===
                    index
                      ? {
                          ...page,
                          selected:
                            !page.selected,
                        }
                      : page,
                ),
                elements,
              )
            }
            selectionMode={
              false
            }
            elements={
              elements
            }
            activeTool={
              activeTool
            }
            selectedIds={
              selectedIds
            }
            onSetSelectedIds={
              setSelectedIds
            }
            onAddElement={
              addElement
            }
            onAddElementKeepTool={
              addElementKeepTool
            }
            onAddTextAt={
              addTextAt
            }
            onBeginTextEdit={
              beginTextEdit
            }
            onFinishTextEdit={
              finishTextEdit
            }
            editingTextId={
              editingTextId
            }
            onUpdateElement={
              updateElement
            }
            onUpdateElements={
              updateElements
            }
            onDuplicateElements={
              duplicateElements
            }
            onReplaceElements={
              replaceElements
            }
            onSelectionRectChange={
              setSelectionRect
            }
            onZoomChange={(
              nextZoom,
            ) => {
              setZoom(
                nextZoom,
              );
              setFitMode(
                "custom",
              );
            }}
            onFitWidth={() => {
              setZoom(1);
              setFitMode(
                "width",
              );
            }}
            panStateRef={
              panStateRef
            }
            drawStroke={
              drawStroke
            }
            eraserSize={
              eraserSize
            }
            highlightSettings={
              highlightSettings
            }
            shapeDefaults={
              shapeDefaults
            }
          />
        )}
      </main>

      {imagePickerState ===
        "loading" && (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading image…
        </div>
      )}

      {imagePickerState ===
        "error" &&
        imagePickerError && (
          <div className="fixed bottom-5 right-5 z-[90] rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 shadow-xl dark:border-red-900 dark:bg-slate-900">
            {
              imagePickerError
            }
          </div>
        )}

      {signatureOpen && (
        <SignatureModal
          savedSignatures={
            savedSignatures
          }
          onInsert={
            handleSignatureInsert
          }
          onCancel={() =>
            setSignatureOpen(
              false,
            )
          }
          onDeleteSaved={(
            id,
          ) => {
            deleteSavedSignature(
              id,
            );

            setSavedSignatures(
              getSavedSignatures(),
            );
          }}
        />
      )}
    </div>
  );
}

function SuccessScreen({
  result,
  onDownload,
  onEditAgain,
  onNewFile,
}: {
  result: SuccessState;
  onDownload: () => void;
  onEditAgain: () => void;
  onNewFile: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center overflow-y-auto bg-slate-100 p-6 dark:bg-slate-950">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-5 border-b border-slate-100 px-7 py-8 text-center dark:border-slate-800">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
            <span className="text-2xl">
              ✓
            </span>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              PDF saved
            </h2>

            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {
                result.filename
              }
            </p>
          </div>
        </div>

        <div className="grid gap-6 p-7 sm:grid-cols-[180px_1fr]">
          <div className="aspect-[3/4] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
            {result.thumb && (
              <img
                src={
                  result.thumb
                }
                alt="Saved PDF preview"
                className="h-full w-full object-contain"
              />
            )}
          </div>

          <div className="flex flex-col justify-center">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {
                result.pages
              }{" "}
              {
                result.pages ===
                1
                  ? "page"
                  : "pages"
              }
            </div>

            <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
              Your edited document is ready.
            </h3>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={
                  onDownload
                }
                className="inline-flex h-10 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
              >
                Download PDF
              </button>

              <button
                type="button"
                onClick={
                  onEditAgain
                }
                className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Keep editing
              </button>

              <button
                type="button"
                onClick={
                  onNewFile
                }
                className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                New PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}