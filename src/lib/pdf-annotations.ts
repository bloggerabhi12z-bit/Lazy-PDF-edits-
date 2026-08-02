/**
 * Annotation element model + pdf-lib "stamping" logic.
 *
 * Requires: npm install pdf-lib
 *
 * Scope / known limitations (kept simple on purpose, documented honestly):
 * - Annotation tools only work on pages with rotation === 0. If a page has
 *   been rotated with the existing rotate tool, its annotate tools are
 *   disabled (tooltip explains why). Avoids fragile rotation math.
 * - Freehand pen strokes can be moved but not resized or rotated.
 * - Image "crop" is not implemented — replace / rotate / opacity are.
 * - Typed signatures use a standard italic serif font (no real handwriting
 *   font embedded).
 * - Rotation handle only applies to text / rect / image elements (the only
 *   types pdf-lib can rotate on export). Ellipse/line/draw/highlight-family/
 *   sticky/form-field elements don't get a rotate handle — rotating them
 *   in-browser without exporting that rotation would be a fake control.
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
  /** degrees, only honored on export for text/rect/image (see notes above) */
  rotation: number;
  locked?: boolean;
};

export type TextElement = BaseElement & {
  type: "text";
  text: string;
  font: "Helvetica" | "TimesRoman" | "Courier";
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
  type: "rect" | "ellipse" | "line";
  stroke: string;
  strokeWidth: number;
  fill: string | null;
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

export const ROTATABLE_TYPES = new Set<ElementType>(["text", "rect", "image"]);

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
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function pickStandardFont(fonts: Record<string, unknown>, family: string, bold: boolean, italic: boolean) {
  const key =
    family === "TimesRoman"
      ? bold && italic
        ? "TimesRomanBoldItalic"
        : bold
          ? "TimesRomanBold"
          : italic
            ? "TimesRomanItalic"
            : "TimesRoman"
      : family === "Courier"
        ? bold && italic
          ? "CourierBoldOblique"
          : bold
            ? "CourierBold"
            : italic
              ? "CourierOblique"
              : "Courier"
        : bold && italic
          ? "HelveticaBoldOblique"
          : bold
            ? "HelveticaBold"
            : italic
              ? "HelveticaOblique"
              : "Helvetica";
  return fonts[key];
}

/**
 * Stamps annotation elements onto an already-exported PDF blob (the result
 * of the existing onApply page-management logic), using pdf-lib. Page
 * order in `pages` must match page order in `srcBlob`.
 */
export async function stampElements(
  srcBlob: Blob,
  pages: { id: string }[],
  elements: AnyElement[],
): Promise<Blob> {
  if (elements.length === 0) return srcBlob;

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const bytes = await srcBlob.arrayBuffer();
  const doc = await PDFDocument.load(bytes);

  const fonts: Record<string, unknown> = {
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

  const imageCache = new Map<string, unknown>();
  async function embedImage(src: string) {
    if (imageCache.has(src)) return imageCache.get(src);
    const isPng = src.startsWith("data:image/png");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const img = isPng ? await (doc as any).embedPng(src) : await (doc as any).embedJpg(src);
    imageCache.set(src, img);
    return img;
  }

  const byPage = new Map<string, AnyElement[]>();
  for (const el of elements) {
    const arr = byPage.get(el.pageId) ?? [];
    arr.push(el);
    byPage.set(el.pageId, arr);
  }

  let form: ReturnType<(typeof doc)["getForm"]> | null = null;
  function getFormLazy() {
    if (!form) form = doc.getForm();
    return form;
  }
  let fieldCounter = 0;

  for (let i = 0; i < pages.length; i++) {
    const els = byPage.get(pages[i].id);
    if (!els || els.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = doc.getPage(i) as any;
    const pageHeight = page.getHeight();

    for (const el of els) {
      const pdfY = pageHeight - el.y - el.height; // flip y-down -> y-up
      const rotate = el.rotation && ROTATABLE_TYPES.has(el.type) ? { type: "degrees", angle: el.rotation } : undefined;

      if (el.type === "whiteout") {
        const [r, g, b] = hexToRgb01((el as WhiteoutElement).color || "#ffffff");
        page.drawRectangle({ x: el.x, y: pdfY, width: el.width, height: el.height, color: rgb(r, g, b), opacity: 1 });
      } else if (el.type === "highlight") {
        const [r, g, b] = hexToRgb01((el as HighlightElement).color);
        page.drawRectangle({ x: el.x, y: pdfY, width: el.width, height: el.height, color: rgb(r, g, b), opacity: el.opacity });
      } else if (el.type === "underline" || el.type === "strikeout") {
        const [r, g, b] = hexToRgb01((el as HighlightElement).color);
        const lineY = el.type === "underline" ? pdfY + 1 : pdfY + el.height / 2;
        page.drawLine({
          start: { x: el.x, y: lineY },
          end: { x: el.x + el.width, y: lineY },
          thickness: Math.max(1, el.height * 0.08),
          color: rgb(r, g, b),
          opacity: el.opacity,
        });
      } else if (el.type === "squiggly") {
        const [r, g, b] = hexToRgb01((el as HighlightElement).color);
        const amp = 2.5;
        const step = 6;
        let path = `M 0 0`;
        for (let x = step; x <= el.width; x += step) {
          const yOff = (x / step) % 2 === 0 ? 0 : -amp;
          path += ` L ${x} ${yOff}`;
        }
        page.drawSvgPath(path, {
          x: el.x,
          y: pdfY + 1,
          borderColor: rgb(r, g, b),
          borderWidth: 1.4,
          opacity: el.opacity,
        });
      } else if (el.type === "rect") {
        const s = el as ShapeElement;
        const [sr, sg, sb] = hexToRgb01(s.stroke);
        page.drawRectangle({
          x: el.x,
          y: pdfY,
          width: el.width,
          height: el.height,
          borderColor: rgb(sr, sg, sb),
          borderWidth: s.strokeWidth,
          color: s.fill ? rgb(...hexToRgb01(s.fill)) : undefined,
          opacity: el.opacity,
          borderOpacity: el.opacity,
          rotate,
        });
      } else if (el.type === "ellipse") {
        const s = el as ShapeElement;
        const [sr, sg, sb] = hexToRgb01(s.stroke);
        page.drawEllipse({
          x: el.x + el.width / 2,
          y: pdfY + el.height / 2,
          xScale: el.width / 2,
          yScale: el.height / 2,
          borderColor: rgb(sr, sg, sb),
          borderWidth: s.strokeWidth,
          color: s.fill ? rgb(...hexToRgb01(s.fill)) : undefined,
          opacity: el.opacity,
          borderOpacity: el.opacity,
        });
      } else if (el.type === "line") {
        const s = el as ShapeElement;
        const [sr, sg, sb] = hexToRgb01(s.stroke);
        page.drawLine({
          start: { x: el.x, y: pdfY + el.height },
          end: { x: el.x + el.width, y: pdfY },
          thickness: s.strokeWidth,
          color: rgb(sr, sg, sb),
          opacity: el.opacity,
        });
      } else if (el.type === "draw") {
        const d = el as DrawElement;
        if (d.points.length < 2) continue;
        const [sr, sg, sb] = hexToRgb01(d.stroke);
        const path = d.points.map((p, i2) => `${i2 === 0 ? "M" : "L"} ${p.x} ${el.height - p.y}`).join(" ");
        page.drawSvgPath(path, {
          x: el.x,
          y: pdfY,
          borderColor: rgb(sr, sg, sb),
          borderWidth: d.strokeWidth,
          opacity: el.opacity,
          scale: 1,
        });
      } else if (el.type === "text") {
        const t = el as TextElement;
        const font = pickStandardFont(fonts, t.font, t.bold, t.italic);
        const [cr, cg, cb] = hexToRgb01(t.color);
        const lines = t.text.split("\n");
        const lineHeight = t.fontSize * t.lineSpacing;
        lines.forEach((line, li) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const f = font as any;
          const w = f.widthOfTextAtSize(line, t.fontSize) + line.length * t.letterSpacing;
          let dx = 0;
          if (t.align === "center") dx = (el.width - w) / 2;
          else if (t.align === "right") dx = el.width - w;
          page.drawText(line, {
            x: el.x + Math.max(0, dx),
            y: pdfY + el.height - (li + 1) * lineHeight + (lineHeight - t.fontSize) / 2,
            size: t.fontSize,
            font: f,
            color: rgb(cr, cg, cb),
            opacity: el.opacity,
            characterSpacing: t.letterSpacing,
            rotate,
          });
          if (t.underline) {
            page.drawLine({
              start: { x: el.x + Math.max(0, dx), y: pdfY + el.height - (li + 1) * lineHeight },
              end: { x: el.x + Math.max(0, dx) + w, y: pdfY + el.height - (li + 1) * lineHeight },
              thickness: Math.max(1, t.fontSize * 0.06),
              color: rgb(cr, cg, cb),
              opacity: el.opacity,
            });
          }
        });
      } else if (el.type === "image") {
        const im = el as ImageElement;
        const embedded = await embedImage(im.src);
        page.drawImage(embedded, { x: el.x, y: pdfY, width: el.width, height: el.height, opacity: el.opacity, rotate });
      } else if (el.type === "sticky") {
        const s = el as StickyElement;
        const [r, g, b] = hexToRgb01(s.color);
        page.drawRectangle({ x: el.x, y: pdfY, width: el.width, height: el.height, color: rgb(r, g, b), opacity: 0.9, borderColor: rgb(0.6, 0.5, 0), borderWidth: 0.75 });
        if (s.note) {
          const f = fonts.Helvetica as any;
          const fontSize = 8;
          const words = s.note.split(/\s+/);
          const maxW = el.width - 6;
          let line = "";
          let cy = pdfY + el.height - 12;
          for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            if (f.widthOfTextAtSize(test, fontSize) > maxW && line) {
              page.drawText(line, { x: el.x + 3, y: cy, size: fontSize, font: f, color: rgb(0.2, 0.17, 0) });
              line = w;
              cy -= fontSize + 2;
              if (cy < pdfY + 2) break;
            } else {
              line = test;
            }
          }
          if (line && cy >= pdfY + 2) {
            page.drawText(line, { x: el.x + 3, y: cy, size: fontSize, font: f, color: rgb(0.2, 0.17, 0) });
          }
        }
      } else if (el.type === "field-text") {
        const f = el as FieldTextElement;
        const name = `${f.name || "text"}_${fieldCounter++}`;
        const field = getFormLazy().createTextField(name);
        field.setText(f.value || "");
        if (f.placeholder && !f.value) field.setText("");
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (f.required && (field as any).enableRequired) (field as any).enableRequired();
        } catch {
          /* required flag not supported in this pdf-lib version — non-fatal */
        }
        field.addToPage(page, { x: el.x, y: pdfY, width: el.width, height: el.height, borderWidth: 1 });
      } else if (el.type === "field-checkbox") {
        const f = el as FieldCheckboxElement;
        const name = `${f.name || "checkbox"}_${fieldCounter++}`;
        const field = getFormLazy().createCheckBox(name);
        field.addToPage(page, { x: el.x, y: pdfY, width: el.width, height: el.height });
        if (f.checked) field.check();
      } else if (el.type === "field-radio") {
        const f = el as FieldRadioElement;
        const groupName = f.groupName || "radio-group";
        let group;
        try {
          group = getFormLazy().getRadioGroup(groupName);
        } catch {
          group = getFormLazy().createRadioGroup(groupName);
        }
        group.addOptionToPage(f.value || `option_${fieldCounter++}`, page, { x: el.x, y: pdfY, width: el.width, height: el.height });
        if (f.checked) group.select(f.value);
      } else if (el.type === "field-dropdown") {
        const f = el as FieldDropdownElement;
        const name = `${f.name || "dropdown"}_${fieldCounter++}`;
        const field = getFormLazy().createDropdown(name);
        field.addOptions(f.options.length ? f.options : ["Option 1"]);
        if (f.value) field.select(f.value);
        field.addToPage(page, { x: el.x, y: pdfY, width: el.width, height: el.height });
      }
    }
  }

  const outBytes = await doc.save();
  return new Blob([outBytes.buffer as ArrayBuffer], { type: "application/pdf" });
}