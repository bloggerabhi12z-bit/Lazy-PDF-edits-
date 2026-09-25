import { pdfBottomY } from "@/lib/pdf-editor-coordinates";

/**
 * Annotation element model + pdf-lib "stamping" logic.
 *
 * Requires: npm install pdf-lib
 *
 * Export coordinates are stored in unrotated page space and share the same
 * coordinate helpers as the on-screen AnnotationLayer. Page /Rotate is left to
 * pdf-lib/pdf.js so both paths use the same page-space origin and dimensions.
 * - Freehand pen strokes can be moved but not resized or rotated.
 * - Image "crop" is not implemented — replace / rotate / opacity are.
 * - Typed signatures use a standard italic serif font (no real handwriting
 *   font embedded).
 * - Rotation handle is enabled for text, images, and vector shapes that are
 *   exported with the same center-based rotation semantics as the editor.
 * - Sticky notes print their note text as a small visible label next to the
 *   pin on export (flat PDFs can't carry a hover-only popup), not a native
 *   hidden Acrobat comment popup.
 * - Form fields are real AcroForm fields (fillable in any PDF reader) via
 *   pdf-lib. "Required" is stored and shown in the editor, but the PDF
 *   standard's required-field enforcement isn't guaranteed across readers,
 *   so it's not claimed as enforced.
 * - Search is a simple text match + "jump to page" (no exact glyph
 *   highlight box).
 */

export type ElementType =
  | "text"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "triangle"
  | "star"
  | "rounded-rect"
  | "speech"
  | "draw"
  | "highlight"
  | "underline"
  | "strikeout"
  | "squiggly"
  | "whiteout"
  | "image"
  | "sticky"
  | "field-text"
  | "field-checkbox"
  | "field-radio"
  | "field-dropdown";

export type BaseElement = {
  id: string;
  pageId: string;
  type: ElementType;
  /** top-left x, in PDF points, unrotated page space */
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  /** degrees, rendered clockwise around the element center. */
  rotation: number;
  locked?: boolean;
};

export type TextElement = BaseElement & {
  type: "text";
  text: string;
  font: string;
  /** Optional embedded WOFF/WOFF2/TTF data URL for custom-font PDF export. */
  fontData?: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  align: "left" | "center" | "right";
  letterSpacing: number;
  lineSpacing: number;
};

export type ShapeElement = BaseElement & {
  type: "rect" | "ellipse" | "line" | "arrow" | "triangle" | "star" | "rounded-rect" | "speech";
  stroke: string;
  strokeWidth: number;
  fill: string | null;
  dash?: "solid" | "dashed" | "dotted";
  flipDiag?: boolean;
};

export type DrawElement = BaseElement & {
  type: "draw";
  points: { x: number; y: number }[];
  stroke: string;
  strokeWidth: number;
};

export type HighlightElement = BaseElement & {
  type: "highlight" | "underline" | "strikeout" | "squiggly";
  color: string;
};

export type WhiteoutElement = BaseElement & {
  type: "whiteout";
  color: string;
};

export type ImageElement = BaseElement & {
  type: "image";
  src: string; // data URL
};

export type StickyElement = BaseElement & {
  type: "sticky";
  color: string;
  note: string;
};

export type FieldTextElement = BaseElement & {
  type: "field-text";
  name: string;
  value: string;
  placeholder: string;
  required: boolean;
};

export type FieldCheckboxElement = BaseElement & {
  type: "field-checkbox";
  name: string;
  checked: boolean;
  required: boolean;
};

export type FieldRadioElement = BaseElement & {
  type: "field-radio";
  groupName: string;
  value: string;
  checked: boolean;
  required: boolean;
};

export type FieldDropdownElement = BaseElement & {
  type: "field-dropdown";
  name: string;
  options: string[];
  value: string;
  required: boolean;
};

export type AnyElement =
  | TextElement
  | ShapeElement
  | DrawElement
  | HighlightElement
  | WhiteoutElement
  | ImageElement
  | StickyElement
  | FieldTextElement
  | FieldCheckboxElement
  | FieldRadioElement
  | FieldDropdownElement;

export const FONT_OPTIONS = ["Helvetica", "TimesRoman", "Courier"] as const;

export const ROTATABLE_TYPES = new Set<ElementType>(["text", "rect", "ellipse", "line", "arrow", "triangle", "star", "rounded-rect", "speech", "image"]);

let uidCounter = 0;
export function makeId(prefix: string) {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`;
}

/* -------------------------- Saved signatures (localStorage) -------------------------- */

export type SavedSignature = { id: string; src: string; createdAt: number };
const SIG_STORE_KEY = "lazypdf:saved-signatures";

export function getSavedSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(SIG_STORE_KEY);
    return raw ? (JSON.parse(raw) as SavedSignature[]) : [];
  } catch {
    return [];
  }
}

export function saveSignature(src: string): SavedSignature {
  const sig: SavedSignature = { id: makeId("savedsig"), src, createdAt: Date.now() };
  try {
    const all = [sig, ...getSavedSignatures()].slice(0, 12);
    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — signature still usable this session */
  }
  return sig;
}

export function deleteSavedSignature(id: string) {
  try {
    const all = getSavedSignatures().filter((s) => s.id !== id);
    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(all));
  } catch {
    /* noop */
  }
}

/* -------------------------- pdf-lib stamping -------------------------- */

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const value = Number.parseInt(full, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function pickStandardFont(fonts: Record<string, unknown>, family: string, bold: boolean, italic: boolean) {
  const normalized = family === "Times New Roman" ? "TimesRoman" : family === "Courier New" ? "Courier" : family;
  const key = normalized === "TimesRoman"
    ? bold && italic ? "TimesRomanBoldItalic" : bold ? "TimesRomanBold" : italic ? "TimesRomanItalic" : "TimesRoman"
    : normalized === "Courier"
      ? bold && italic ? "CourierBoldOblique" : bold ? "CourierBold" : italic ? "CourierOblique" : "Courier"
      : bold && italic ? "HelveticaBoldOblique" : bold ? "HelveticaBold" : italic ? "HelveticaOblique" : "Helvetica";
  return fonts[key];
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const encoded = dataUrl.includes(",") ? dataUrl.split(",", 2)[1] : dataUrl;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function rotatePoint(x: number, y: number, cx: number, cy: number, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { x: cx + (x - cx) * cos - (y - cy) * sin, y: cy + (x - cx) * sin + (y - cy) * cos };
}

function localPdfPoint(el: BaseElement, pageHeight: number, x: number, y: number) {
  return { x: el.x + x, y: pdfBottomY(el.y + y, 0, pageHeight) };
}

function elementPdfCenter(el: BaseElement, pageHeight: number) {
  return { x: el.x + el.width / 2, y: pageHeight - el.y - el.height / 2 };
}

function rotatedLocalPdfPoint(el: BaseElement, pageHeight: number, x: number, y: number) {
  const point = localPdfPoint(el, pageHeight, x, y);
  const center = elementPdfCenter(el, pageHeight);
  return rotatePoint(point.x, point.y, center.x, center.y, -el.rotation);
}

function dashPattern(kind: "solid" | "dashed" | "dotted" | undefined, strokeWidth: number) {
  if (!kind || kind === "solid") return null;
  return kind === "dotted" ? [Math.max(1.5, strokeWidth), Math.max(3, strokeWidth * 2.5)] : [Math.max(4, strokeWidth * 3.5), Math.max(4, strokeWidth * 2.5)];
}

function drawDashedSegment(page: any, start: { x: number; y: number }, end: { x: number; y: number }, options: { color: any; thickness: number; opacity?: number }, pattern: number[]) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0.001) return;
  const ux = dx / length, uy = dy / length;
  const cycle = pattern[0] + pattern[1];
  let cursor = 0;
  while (cursor < length) {
    const dashEnd = Math.min(length, cursor + pattern[0]);
    page.drawLine({
      start: { x: start.x + ux * cursor, y: start.y + uy * cursor },
      end: { x: start.x + ux * dashEnd, y: start.y + uy * dashEnd },
      ...options,
    });
    cursor += cycle;
  }
}

function drawLineWithDash(page: any, start: { x: number; y: number }, end: { x: number; y: number }, options: { color: any; thickness: number; opacity?: number }, dash: "solid" | "dashed" | "dotted" | undefined) {
  const pattern = dashPattern(dash, options.thickness);
  if (!pattern) {
    page.drawLine({ start, end, ...options });
    return;
  }
  drawDashedSegment(page, start, end, options, pattern);
}

function drawPolylineWithDash(page: any, points: { x: number; y: number }[], options: { color: any; thickness: number; opacity?: number }, dash: "solid" | "dashed" | "dotted" | undefined, closed = false) {
  if (points.length < 2) return;
  for (let i = 1; i < points.length; i += 1) drawLineWithDash(page, points[i - 1], points[i], options, dash);
  if (closed) drawLineWithDash(page, points[points.length - 1], points[0], options, dash);
}

function drawSvgPolygon(page: any, points: { x: number; y: number }[], options: { fill?: any; borderColor?: any; borderWidth?: number; opacity?: number; rotate?: any }) {
  if (points.length < 3) return;
  const path = `${points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")} Z`;
  page.drawSvgPath(path, options);
}

function shapePoints(el: ShapeElement, pageHeight: number) {
  const w = el.width, h = el.height;
  const lineEnd = el.flipDiag ? { x: w, y: h } : { x: w, y: 0 };
  const candidates: Record<string, { x: number; y: number }[]> = {
    rect: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    triangle: [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    star: Array.from({ length: 10 }, (_, index) => {
      const angle = index * Math.PI / 5 - Math.PI / 2;
      const radius = index % 2 === 0 ? Math.min(w, h) / 2 : Math.min(w, h) / 4.5;
      return { x: w / 2 + Math.cos(angle) * radius, y: h / 2 + Math.sin(angle) * radius };
    }),
    speech: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h * 0.72 }, { x: w * 0.3, y: h * 0.72 }, { x: w * 0.22, y: h }, { x: w * 0.22, y: h * 0.72 }, { x: 0, y: h * 0.72 }],
    line: [{ x: 0, y: h }, lineEnd],
    arrow: [{ x: 0, y: h }, lineEnd],
  };
  return candidates[el.type] ?? candidates.rect;
}

export async function stampElements(
  srcBlob: Blob,
  pages: { id: string }[],
  elements: AnyElement[],
): Promise<Blob> {
  if (elements.length === 0) return srcBlob;

  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");
  const fontkitModule = await import("@pdf-lib/fontkit");
  const fontkit = fontkitModule.default;
  const bytes = await srcBlob.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  doc.registerFontkit(fontkit);

  const fonts: Record<string, any> = {
    Helvetica: await doc.embedFont(StandardFonts.Helvetica),
    HelveticaBold: await doc.embedFont(StandardFonts.HelveticaBold),
    HelveticaOblique: await doc.embedFont(StandardFonts.HelveticaOblique),
    HelveticaBoldOblique: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    TimesRoman: await doc.embedFont(StandardFonts.TimesRoman),
    TimesRomanBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    TimesRomanItalic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    TimesRomanBoldItalic: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    Courier: await doc.embedFont(StandardFonts.Courier),
    CourierBold: await doc.embedFont(StandardFonts.CourierBold),
    CourierOblique: await doc.embedFont(StandardFonts.CourierOblique),
    CourierBoldOblique: await doc.embedFont(StandardFonts.CourierBoldOblique),
  };

  const customFontCache = new Map<string, any>();
  async function resolveTextFont(element: TextElement) {
    if (!element.fontData) return pickStandardFont(fonts, element.font, element.bold, element.italic) as any;
    if (customFontCache.has(element.fontData)) return customFontCache.get(element.fontData);
    const embedded = await doc.embedFont(decodeDataUrl(element.fontData), { subset: true });
    customFontCache.set(element.fontData, embedded);
    return embedded;
  }

  const imageCache = new Map<string, any>();
  async function embedImage(src: string) {
    if (imageCache.has(src)) return imageCache.get(src);
    const image = src.startsWith("data:image/png") ? await doc.embedPng(src) : await doc.embedJpg(src);
    imageCache.set(src, image);
    return image;
  }

  const byPage = new Map<string, AnyElement[]>();
  for (const element of elements) byPage.set(element.pageId, [...(byPage.get(element.pageId) ?? []), element]);

  let form: ReturnType<(typeof doc)["getForm"]> | null = null;
  const getFormLazy = () => (form ??= doc.getForm());
  let fieldCounter = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const pageElements = byPage.get(pages[pageIndex].id);
    if (!pageElements?.length) continue;
    const page = doc.getPage(pageIndex) as any;
    const pageHeight = page.getHeight();

    for (const element of pageElements) {
      const pdfY = pageHeight - element.y - element.height;
      const opacity = Math.max(0, Math.min(1, element.opacity));
      const rotate = ROTATABLE_TYPES.has(element.type) && element.rotation ? degrees(element.rotation) : undefined;

      if (element.type === "whiteout") {
        const [r, g, b] = hexToRgb01(element.color || "#ffffff");
        page.drawRectangle({ x: element.x, y: pdfY, width: element.width, height: element.height, color: rgb(r, g, b), opacity });
      } else if (element.type === "highlight") {
        const [r, g, b] = hexToRgb01(element.color);
        page.drawRectangle({ x: element.x, y: pdfY, width: element.width, height: element.height, color: rgb(r, g, b), opacity });
      } else if (element.type === "underline" || element.type === "strikeout") {
        const [r, g, b] = hexToRgb01(element.color);
        const lineY = element.type === "underline" ? pdfY + 1 : pdfY + element.height / 2;
        drawLineWithDash(page, { x: element.x, y: lineY }, { x: element.x + element.width, y: lineY }, { color: rgb(r, g, b), thickness: Math.max(1, element.height * 0.08), opacity }, "solid");
      } else if (element.type === "squiggly") {
        const [r, g, b] = hexToRgb01(element.color);
        const points = Array.from({ length: Math.max(2, Math.ceil(element.width / 6) + 1) }, (_, index) => ({ x: element.x + Math.min(element.width, index * 6), y: pdfY + 1 + (index % 2 ? -2.5 : 0) }));
        drawPolylineWithDash(page, points, { color: rgb(r, g, b), thickness: 1.4, opacity }, "solid");
      } else if (["rect", "ellipse", "line", "arrow", "triangle", "star", "rounded-rect", "speech"].includes(element.type)) {
        const shape = element as ShapeElement;
        const [sr, sg, sb] = hexToRgb01(shape.stroke);
        const stroke = rgb(sr, sg, sb);
        const fill = shape.fill ? rgb(...hexToRgb01(shape.fill)) : undefined;
        const dash = shape.dash;

        if (shape.type === "ellipse") {
          const center = elementPdfCenter(shape, pageHeight);
          page.drawEllipse({ x: center.x, y: center.y, xScale: shape.width / 2, yScale: shape.height / 2, color: fill, opacity, borderColor: dash && dash !== "solid" ? undefined : stroke, borderWidth: shape.strokeWidth, borderOpacity: opacity, rotate });
          if (dash && dash !== "solid") {
            const points = Array.from({ length: 48 }, (_, index) => {
              const a = index / 48 * Math.PI * 2;
              const point = rotatePoint(center.x + Math.cos(a) * shape.width / 2, center.y + Math.sin(a) * shape.height / 2, center.x, center.y, -shape.rotation);
              return point;
            });
            drawPolylineWithDash(page, points, { color: stroke, thickness: shape.strokeWidth, opacity }, dash, true);
          }
          continue;
        }

        if (shape.type === "line" || shape.type === "arrow") {
          const raw = shapePoints(shape, pageHeight);
          const start = rotatedLocalPdfPoint(shape, pageHeight, raw[0].x, raw[0].y);
          const end = rotatedLocalPdfPoint(shape, pageHeight, raw[1].x, raw[1].y);
          drawLineWithDash(page, start, end, { color: stroke, thickness: shape.strokeWidth, opacity }, dash);
          if (shape.type === "arrow") {
            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            const size = Math.max(8, shape.strokeWidth * 4);
            const left = { x: end.x - Math.cos(angle - Math.PI / 6) * size, y: end.y - Math.sin(angle - Math.PI / 6) * size };
            const right = { x: end.x - Math.cos(angle + Math.PI / 6) * size, y: end.y - Math.sin(angle + Math.PI / 6) * size };
            drawLineWithDash(page, end, left, { color: stroke, thickness: shape.strokeWidth, opacity }, "solid");
            drawLineWithDash(page, end, right, { color: stroke, thickness: shape.strokeWidth, opacity }, "solid");
          }
          continue;
        }

        const local = shape.type === "rounded-rect"
          ? [{ x: Math.min(18, shape.width / 3), y: 0 }, { x: shape.width - Math.min(18, shape.width / 3), y: 0 }, { x: shape.width, y: Math.min(18, shape.height / 3) }, { x: shape.width, y: shape.height - Math.min(18, shape.height / 3) }, { x: shape.width - Math.min(18, shape.width / 3), y: shape.height }, { x: Math.min(18, shape.width / 3), y: shape.height }, { x: 0, y: shape.height - Math.min(18, shape.height / 3) }, { x: 0, y: Math.min(18, shape.height / 3) }]
          : shapePoints(shape, pageHeight);
        const points = local.map((point) => rotatedLocalPdfPoint(shape, pageHeight, point.x, point.y));
        drawSvgPolygon(page, points, { fill, borderColor: dash && dash !== "solid" ? undefined : stroke, borderWidth: shape.strokeWidth, opacity });
        if (dash && dash !== "solid") drawPolylineWithDash(page, points, { color: stroke, thickness: shape.strokeWidth, opacity }, dash, true);
      } else if (element.type === "draw") {
        const draw = element as DrawElement;
        const points = draw.points.map((point) => rotatedLocalPdfPoint(draw, pageHeight, point.x, point.y));
        const [sr, sg, sb] = hexToRgb01(draw.stroke);
        drawPolylineWithDash(page, points, { color: rgb(sr, sg, sb), thickness: draw.strokeWidth, opacity }, "solid");
      } else if (element.type === "text") {
        const text = element as TextElement;
        const font = await resolveTextFont(text);
        const [cr, cg, cb] = hexToRgb01(text.color);
        const lines = text.text.split("\n");
        const lineHeight = text.fontSize * text.lineSpacing;
        lines.forEach((line, lineIndex) => {
          const width = font.widthOfTextAtSize(line, text.fontSize) + line.length * text.letterSpacing;
          const dx = text.align === "center" ? (element.width - width) / 2 : text.align === "right" ? element.width - width : 0;
          const base = localPdfPoint(text, pageHeight, Math.max(0, dx), element.height - (lineIndex + 1) * lineHeight + (lineHeight - text.fontSize) / 2);
          page.drawText(line, { x: base.x, y: base.y, size: text.fontSize, font, color: rgb(cr, cg, cb), opacity, characterSpacing: text.letterSpacing, rotate });
          if (text.underline) {
            const y = rotatedLocalPdfPoint(text, pageHeight, Math.max(0, dx), element.height - (lineIndex + 1) * lineHeight).y;
            const start = rotatedLocalPdfPoint(text, pageHeight, Math.max(0, dx), element.height - (lineIndex + 1) * lineHeight);
            const end = rotatedLocalPdfPoint(text, pageHeight, Math.max(0, dx) + width, element.height - (lineIndex + 1) * lineHeight);
            drawLineWithDash(page, start, end, { color: rgb(cr, cg, cb), thickness: Math.max(1, text.fontSize * 0.06), opacity }, "solid");
            void y;
          }
        });
      } else if (element.type === "image") {
        const image = element as ImageElement;
        const embedded = await embedImage(image.src);
        const position = localPdfPoint(image, pageHeight, 0, 0);
        page.drawImage(embedded, { x: position.x, y: position.y, width: image.width, height: image.height, opacity, rotate });
      } else if (element.type === "sticky") {
        const sticky = element as StickyElement;
        const [r, g, b] = hexToRgb01(sticky.color);
        page.drawRectangle({ x: sticky.x, y: pdfY, width: sticky.width, height: sticky.height, color: rgb(r, g, b), opacity: 0.9, borderColor: rgb(0.6, 0.5, 0), borderWidth: 0.75 });
        if (sticky.note) page.drawText(sticky.note.slice(0, 500), { x: sticky.x + 3, y: pdfY + sticky.height - 12, size: 8, font: fonts.Helvetica, color: rgb(0.2, 0.17, 0) });
      } else if (element.type === "field-text") {
        const field = element as FieldTextElement;
        const widget = getFormLazy().createTextField(`${field.name || "text"}_${fieldCounter++}`);
        widget.setText(field.value || "");
        try { if (field.required && (widget as any).enableRequired) (widget as any).enableRequired(); } catch { /* optional capability */ }
        widget.addToPage(page, { x: field.x, y: pdfY, width: field.width, height: field.height, borderWidth: 1 });
      } else if (element.type === "field-checkbox") {
        const field = element as FieldCheckboxElement;
        const widget = getFormLazy().createCheckBox(`${field.name || "checkbox"}_${fieldCounter++}`);
        widget.addToPage(page, { x: field.x, y: pdfY, width: field.width, height: field.height });
        if (field.checked) widget.check();
      } else if (element.type === "field-radio") {
        const field = element as FieldRadioElement;
        let group;
        try { group = getFormLazy().getRadioGroup(field.groupName || "radio-group"); } catch { group = getFormLazy().createRadioGroup(field.groupName || "radio-group"); }
        const value = field.value || `option_${fieldCounter++}`;
        group.addOptionToPage(value, page, { x: field.x, y: pdfY, width: field.width, height: field.height });
        if (field.checked) group.select(value);
      } else if (element.type === "field-dropdown") {
        const field = element as FieldDropdownElement;
        const widget = getFormLazy().createDropdown(`${field.name || "dropdown"}_${fieldCounter++}`);
        widget.addOptions(field.options.length ? field.options : ["Option 1"]);
        if (field.value) widget.select(field.value);
        widget.addToPage(page, { x: field.x, y: pdfY, width: field.width, height: field.height });
      }
    }
  }

  const outBytes = await doc.save();
  return new Blob([outBytes.buffer as ArrayBuffer], { type: "application/pdf" });
}
