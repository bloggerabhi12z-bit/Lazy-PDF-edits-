import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  Image as ImageIcon,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SavedSignature } from "@/lib/pdf-annotations";

const SIGNATURE_FONTS = [
  "Dancing Script",
  "Pacifico",
  "Great Vibes",
  "Caveat",
  "Satisfy",
  "Allura",
];

type SignatureTab =
  | "draw"
  | "type"
  | "upload"
  | "saved";

type Props = {
  onInsert: (
    src: string,
    save: boolean,
  ) => void;

  onCancel: () => void;

  savedSignatures: SavedSignature[];

  onDeleteSaved: (
    id: string,
  ) => void;
};

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 420;

export function SignatureModal(
  props: Props,
) {
  const [
    tab,
    setTab,
  ] = useState<SignatureTab>(
    "draw",
  );

  const [
    typedName,
    setTypedName,
  ] = useState("");

  const [
    sigFont,
    setSigFont,
  ] = useState(
    "Dancing Script",
  );

  const [
    sigColor,
    setSigColor,
  ] = useState("#111827");

  const [
    sigSize,
    setSigSize,
  ] = useState(52);

  const [
    saveAfterInsert,
    setSaveAfterInsert,
  ] = useState(true);

  const [
    hasDrawing,
    setHasDrawing,
  ] = useState(false);

  const [
    uploadedSignature,
    setUploadedSignature,
  ] = useState<
    string | null
  >(null);

  const canvasRef =
    useRef<HTMLCanvasElement | null>(
      null,
    );

  const fileInputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const drawingRef =
    useRef(false);

  const lastPointRef =
    useRef<{
      x: number;
      y: number;
    } | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadFonts = async () => {
      try {
        if (
          document.fonts?.ready
        ) {
          await document.fonts.ready;
        }

        if (!mounted) {
          return;
        }

        for (
          const family of SIGNATURE_FONTS
        ) {
          const selector = `link[data-signature-font="${family}"]`;

          if (
            document.querySelector(
              selector,
            )
          ) {
            continue;
          }

          const link =
            document.createElement(
              "link",
            );

          link.rel =
            "stylesheet";

          link.dataset.signatureFont =
            family;

          link.href =
            `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
              family,
            ).replace(
              /%20/g,
              "+",
            )}:wght@400;700&display=swap`;

          document.head.appendChild(
            link,
          );
        }
      } catch {
        /*
         * Signature drawing remains available even if
         * Google Fonts cannot be loaded.
         */
      }
    };

    void loadFonts();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (
      tab !== "draw"
    ) {
      return;
    }

    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    /*
     * IMPORTANT:
     * Keep the canvas at a fixed, predictable internal
     * resolution. Do not derive the canvas dimensions from
     * canvas.clientWidth/clientHeight and do not resize the
     * canvas on every layout change.
     *
     * CSS handles visual scaling.
     */
    canvas.width =
      CANVAS_WIDTH;

    canvas.height =
      CANVAS_HEIGHT;

    const context =
      canvas.getContext(
        "2d",
      );

    if (!context) {
      return;
    }

    context.clearRect(
      0,
      0,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
    );

    context.lineCap =
      "round";

    context.lineJoin =
      "round";

    context.lineWidth = 5;

    context.strokeStyle =
      sigColor;

    context.fillStyle =
      sigColor;
  }, []);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    const context =
      canvas.getContext(
        "2d",
      );

    if (!context) {
      return;
    }

    context.strokeStyle =
      sigColor;

    context.fillStyle =
      sigColor;

    context.lineCap =
      "round";

    context.lineJoin =
      "round";
  }, [sigColor]);

  function getCanvasPoint(
    event:
      | ReactPointerEvent<HTMLCanvasElement>
      | PointerEvent,
  ) {
    const canvas =
      canvasRef.current;

    if (!canvas) {
      return null;
    }

    const rect =
      canvas.getBoundingClientRect();

    if (
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return null;
    }

    return {
      x:
        ((event.clientX -
          rect.left) /
          rect.width) *
        CANVAS_WIDTH,

      y:
        ((event.clientY -
          rect.top) /
          rect.height) *
        CANVAS_HEIGHT,
    };
  }

  function startDrawing(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    const point =
      getCanvasPoint(event);

    if (!point) {
      return;
    }

    drawingRef.current =
      true;

    lastPointRef.current =
      point;

    try {
      canvas.setPointerCapture(
        event.pointerId,
      );
    } catch {
      /*
       * Pointer capture can fail in some embedded
       * browser environments. Drawing still works.
       */
    }

    const context =
      canvas.getContext(
        "2d",
      );

    if (!context) {
      return;
    }

    context.strokeStyle =
      sigColor;

    context.fillStyle =
      sigColor;

    context.lineWidth = 5;

    context.lineCap =
      "round";

    context.lineJoin =
      "round";

    context.beginPath();

    context.arc(
      point.x,
      point.y,
      2.5,
      0,
      Math.PI * 2,
    );

    context.fill();

    setHasDrawing(
      true,
    );
  }

  function moveDrawing(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    if (
      !drawingRef.current
    ) {
      return;
    }

    event.preventDefault();

    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    const context =
      canvas.getContext(
        "2d",
      );

    if (!context) {
      return;
    }

    const last =
      lastPointRef.current;

    if (!last) {
      return;
    }

    const nativeEvent =
      event.nativeEvent;

    const events =
      typeof nativeEvent.getCoalescedEvents ===
      "function"
        ? nativeEvent.getCoalescedEvents()
        : [nativeEvent];

    context.strokeStyle =
      sigColor;

    context.lineWidth = 5;

    context.lineCap =
      "round";

    context.lineJoin =
      "round";

    context.beginPath();

    context.moveTo(
      last.x,
      last.y,
    );

    let current =
      last;

    for (
      const pointEvent of events
    ) {
      const point =
        getCanvasPoint(
          pointEvent,
        );

      if (!point) {
        continue;
      }

      current =
        point;

      context.lineTo(
        point.x,
        point.y,
      );
    }

    context.stroke();

    lastPointRef.current =
      current;

    setHasDrawing(
      true,
    );
  }

  function stopDrawing(
    event?: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    drawingRef.current =
      false;

    lastPointRef.current =
      null;

    const canvas =
      canvasRef.current;

    if (
      canvas &&
      event
    ) {
      try {
        canvas.releasePointerCapture(
          event.pointerId,
        );
      } catch {
        /*
         * Pointer capture may already have been released.
         */
      }
    }
  }

  function clearDrawing() {
    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    const context =
      canvas.getContext(
        "2d",
      );

    if (!context) {
      return;
    }

    context.clearRect(
      0,
      0,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
    );

    context.strokeStyle =
      sigColor;

    context.fillStyle =
      sigColor;

    context.lineWidth = 5;

    context.lineCap =
      "round";

    context.lineJoin =
      "round";

    drawingRef.current =
      false;

    lastPointRef.current =
      null;

    setHasDrawing(
      false,
    );
  }

  function handleUpload(
    file:
      | File
      | undefined,
  ) {
    if (!file) {
      return;
    }

    if (
      !file.type.startsWith(
        "image/",
      )
    ) {
      toast.error(
        "Please choose a signature image.",
      );

      return;
    }

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      toast.error(
        "Signature image must be smaller than 5 MB.",
      );

      return;
    }

    const reader =
      new FileReader();

    reader.onerror =
      () => {
        toast.error(
          "Could not read the signature image.",
        );
      };

    reader.onload =
      () => {
        setUploadedSignature(
          String(
            reader.result,
          ),
        );
      };

    reader.readAsDataURL(
      file,
    );
  }

  function trimCanvas(
    source: HTMLCanvasElement,
  ) {
    const context =
      source.getContext(
        "2d",
      );

    if (!context) {
      return source;
    }

    const image =
      context.getImageData(
        0,
        0,
        source.width,
        source.height,
      );

    const data =
      image.data;

    let minX =
      source.width;

    let minY =
      source.height;

    let maxX = -1;
    let maxY = -1;

    for (
      let y = 0;
      y <
      source.height;
      y += 1
    ) {
      for (
        let x = 0;
        x <
        source.width;
        x += 1
      ) {
        const alpha =
          data[
            (y *
              source.width +
              x) *
              4 +
              3
          ];

        if (
          alpha > 10
        ) {
          if (
            x < minX
          ) {
            minX = x;
          }

          if (
            y < minY
          ) {
            minY = y;
          }

          if (
            x > maxX
          ) {
            maxX = x;
          }

          if (
            y > maxY
          ) {
            maxY = y;
          }
        }
      }
    }

    if (
      maxX < minX ||
      maxY < minY
    ) {
      return source;
    }

    const padding =
      18;

    const x =
      Math.max(
        0,
        minX -
          padding,
      );

    const y =
      Math.max(
        0,
        minY -
          padding,
      );

    const right =
      Math.min(
        source.width,
        maxX +
          padding +
          1,
      );

    const bottom =
      Math.min(
        source.height,
        maxY +
          padding +
          1,
      );

    const target =
      document.createElement(
        "canvas",
      );

    target.width =
      Math.max(
        1,
        right - x,
      );

    target.height =
      Math.max(
        1,
        bottom - y,
      );

    const targetContext =
      target.getContext(
        "2d",
      );

    if (!targetContext) {
      return source;
    }

    targetContext.drawImage(
      source,
      x,
      y,
      target.width,
      target.height,
      0,
      0,
      target.width,
      target.height,
    );

    return target;
  }

  async function createTypedSignature() {
    const text =
      typedName.trim() ||
      "Signature";

    try {
      await document.fonts.ready;
    } catch {
      // System fallback font is sufficient.
    }

    const canvas =
      document.createElement(
        "canvas",
      );

    canvas.width =
      1000;

    canvas.height =
      300;

    const context =
      canvas.getContext(
        "2d",
      );

    if (!context) {
      return null;
    }

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    context.fillStyle =
      sigColor;

    context.textBaseline =
      "middle";

    context.font = `${sigSize * 2}px "${sigFont}", cursive`;

    const measured =
      context.measureText(
        text,
      );

    const width =
      measured.width;

    const x =
      Math.max(
        20,
        (canvas.width -
          width) /
          2,
      );

    context.fillText(
      text,
      x,
      canvas.height /
        2,
    );

    return trimCanvas(
      canvas,
    ).toDataURL(
      "image/png",
    );
  }

  async function handleInsert() {
    if (
      tab === "draw"
    ) {
      const canvas =
        canvasRef.current;

      if (
        !canvas ||
        !hasDrawing
      ) {
        toast.error(
          "Draw your signature first.",
        );

        return;
      }

      props.onInsert(
        trimCanvas(
          canvas,
        ).toDataURL(
          "image/png",
        ),
        saveAfterInsert,
      );

      return;
    }

    if (
      tab === "type"
    ) {
      const source =
        await createTypedSignature();

      if (!source) {
        toast.error(
          "Could not create the typed signature.",
        );

        return;
      }

      props.onInsert(
        source,
        saveAfterInsert,
      );

      return;
    }

    if (
      tab === "upload"
    ) {
      if (
        !uploadedSignature
      ) {
        toast.error(
          "Upload a signature image first.",
        );

        return;
      }

      props.onInsert(
        uploadedSignature,
        saveAfterInsert,
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          props.onCancel();
        }
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onPointerDown={(event) =>
          event.stopPropagation()
        }
      >
        {/* HEADER */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Add signature
            </h2>

            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Draw, type, upload, or use a saved signature.
            </p>
          </div>

          <button
            type="button"
            aria-label="Close signature dialog"
            onClick={
              props.onCancel
            }
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* TABS */}
        <div className="flex shrink-0 border-b border-slate-200 px-5 dark:border-slate-800">
          {(
            [
              [
                "draw",
                "Draw",
              ],
              [
                "type",
                "Type",
              ],
              [
                "upload",
                "Upload",
              ],
              [
                "saved",
                `Saved (${props.savedSignatures.length})`,
              ],
            ] as const
          ).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  setTab(value)
                }
                className={cn(
                  "flex-1 border-b-2 px-4 py-3 text-sm font-semibold transition-colors",
                  tab ===
                    value
                    ? "border-red-600 text-red-600"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                )}
              >
                {label}
              </button>
            ),
          )}
        </div>

        {/* BODY */}
        <div className="min-h-0 overflow-y-auto p-5">
          {tab ===
            "draw" && (
            <div>
              <div className="relative h-[210px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                <canvas
                  ref={
                    canvasRef
                  }
                  width={
                    CANVAS_WIDTH
                  }
                  height={
                    CANVAS_HEIGHT
                  }
                  className="absolute inset-0 block h-full w-full cursor-crosshair"
                  style={{
                    touchAction:
                      "none",
                    userSelect:
                      "none",
                  }}
                  onPointerDown={
                    startDrawing
                  }
                  onPointerMove={
                    moveDrawing
                  }
                  onPointerUp={
                    stopDrawing
                  }
                  onPointerCancel={() =>
                    stopDrawing()
                  }
                />

                {!hasDrawing && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-300">
                    Draw your signature here
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Ink color
                </span>

                <label className="relative grid h-9 w-9 cursor-pointer place-items-center overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                  <span
                    className="h-5 w-5 rounded-full border border-black/10"
                    style={{
                      backgroundColor:
                        sigColor,
                    }}
                  />

                  <input
                    type="color"
                    value={
                      sigColor
                    }
                    onChange={(
                      event,
                    ) =>
                      setSigColor(
                        event
                          .target
                          .value,
                      )
                    }
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>

                <button
                  type="button"
                  onClick={
                    clearDrawing
                  }
                  className="ml-auto rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {tab ===
            "type" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                <input
                  autoFocus
                  value={
                    typedName
                  }
                  onChange={(
                    event,
                  ) =>
                    setTypedName(
                      event
                        .target
                        .value,
                    )
                  }
                  placeholder="Type your name"
                  className="h-24 w-full rounded-xl border border-slate-200 bg-white px-4 text-center text-slate-900 outline-none focus:border-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  style={{
                    fontFamily: `"${sigFont}", cursive`,
                    fontSize:
                      Math.min(
                        48,
                        sigSize *
                          0.85,
                      ),
                    color:
                      sigColor,
                  }}
                />
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Style
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {SIGNATURE_FONTS.map(
                    (font) => (
                      <button
                        key={
                          font
                        }
                        type="button"
                        onClick={() =>
                          setSigFont(
                            font,
                          )
                        }
                        className={cn(
                          "min-h-16 rounded-xl border px-3 py-3 text-center transition-colors",
                          sigFont ===
                            font
                            ? "border-red-500 bg-red-50 dark:bg-red-500/10"
                            : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800",
                        )}
                        style={{
                          fontFamily: `"${font}", cursive`,
                          fontSize:
                            23,
                          color:
                            sigColor,
                        }}
                      >
                        {typedName ||
                          "Signature"}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Color
                </span>

                <label className="relative grid h-9 w-9 cursor-pointer place-items-center overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                  <span
                    className="h-5 w-5 rounded-full border border-black/10"
                    style={{
                      backgroundColor:
                        sigColor,
                    }}
                  />

                  <input
                    type="color"
                    value={
                      sigColor
                    }
                    onChange={(
                      event,
                    ) =>
                      setSigColor(
                        event
                          .target
                          .value,
                      )
                    }
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>

                <span className="ml-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Size
                </span>

                <input
                  type="range"
                  min={28}
                  max={80}
                  value={
                    sigSize
                  }
                  onChange={(
                    event,
                  ) =>
                    setSigSize(
                      Number(
                        event
                          .target
                          .value,
                      ),
                    )
                  }
                  className="flex-1 accent-red-600"
                />

                <span className="w-8 text-right text-xs text-slate-400">
                  {
                    sigSize
                  }
                </span>
              </div>
            </div>
          )}

          {tab ===
            "upload" && (
            <div>
              <input
                ref={
                  fileInputRef
                }
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(
                  event,
                ) => {
                  handleUpload(
                    event
                      .target
                      .files?.[0],
                  );

                  event.target.value =
                    "";
                }}
              />

              {!uploadedSignature ? (
                <button
                  type="button"
                  onClick={() =>
                    fileInputRef.current?.click()
                  }
                  className="flex min-h-[280px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 transition-colors hover:border-red-400 hover:bg-red-50/40 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-red-500"
                >
                  <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-sm dark:bg-slate-900">
                    <Upload className="h-6 w-6 text-red-600" />
                  </div>

                  <div className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Upload signature image
                  </div>

                  <div className="mt-1 text-xs text-slate-400">
                    PNG, JPG, WEBP or SVG · Maximum 5 MB
                  </div>
                </button>
              ) : (
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Preview
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        setUploadedSignature(
                          null,
                        )
                      }
                      className="text-xs font-semibold text-slate-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 flex min-h-[230px] items-center justify-center rounded-xl bg-slate-50 p-6 dark:bg-slate-800">
                    <img
                      src={
                        uploadedSignature
                      }
                      alt="Uploaded signature"
                      className="max-h-[190px] max-w-full object-contain"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      fileInputRef.current?.click()
                    }
                    className="mt-3 w-full rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    Choose another image
                  </button>
                </div>
              )}
            </div>
          )}

          {tab ===
            "saved" && (
            <div>
              {props.savedSignatures
                .length ===
              0 ? (
                <div className="grid min-h-[240px] place-items-center rounded-2xl border border-dashed border-slate-300 text-sm text-slate-400 dark:border-slate-700">
                  No saved signatures yet.
                </div>
              ) : (
                <div className="grid max-h-[420px] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
                  {props.savedSignatures.map(
                    (
                      signature,
                    ) => (
                      <div
                        key={
                          signature.id
                        }
                        className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700"
                      >
                        <div className="flex h-28 items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800">
                          <img
                            src={
                              signature.src
                            }
                            alt="Saved signature"
                            className="max-h-24 max-w-full object-contain"
                          />
                        </div>

                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              props.onInsert(
                                signature.src,
                                false,
                              )
                            }
                            className="flex-1 rounded-xl bg-red-600 py-2.5 text-xs font-semibold text-white hover:bg-red-700"
                          >
                            Insert
                          </button>

                          <button
                            type="button"
                            aria-label="Delete saved signature"
                            onClick={() =>
                              props.onDeleteSaved(
                                signature.id,
                              )
                            }
                            className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:hover:bg-red-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          )}

          {tab !==
            "saved" && (
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={
                  saveAfterInsert
                }
                onChange={(
                  event,
                ) =>
                  setSaveAfterInsert(
                    event
                      .target
                      .checked,
                  )
                }
                className="h-4 w-4 accent-red-600"
              />

              Save signature for later
            </label>
          )}
        </div>

        {/* FOOTER */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <Button
            type="button"
            variant="outline"
            onClick={
              props.onCancel
            }
            className="rounded-xl"
          >
            Cancel
          </Button>

          {tab !==
            "saved" && (
            <Button
              type="button"
              onClick={
                handleInsert
              }
              className="rounded-xl bg-red-600 px-5 font-semibold text-white hover:bg-red-700"
            >
              <Check className="mr-2 h-4 w-4" />
              Insert signature
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}