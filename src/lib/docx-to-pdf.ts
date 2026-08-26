import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import JSZip from "jszip";

type FontFace = "regular" | "bold" | "italic" | "boldItalic";
type Alignment = "left" | "center" | "right" | "justify";

type RunStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;
  color: RGB;
  fontFamily?: string;
};

type TextRun = {
  text: string;
  style: RunStyle;
};

/**
 * Intermediate run produced while walking paragraph XML, before Word field
 * codes (PAGE, NUMPAGES, etc.) are resolved into real TextRuns. Kept
 * separate from TextRun so the field state machine can tell "visible text"
 * apart from "field instruction" and "cached field result" content.
 */
type RawPiece = {
  text: string;
  style: RunStyle;
  kind: "text" | "instrText" | "fldBegin" | "fldSeparate" | "fldEnd";
};

type ParagraphModel = {
  runs: TextRun[];
  alignment: Alignment;
  leftIndent: number;
  rightIndent: number;
  firstLineIndent: number;
  hangingIndent: number;
  beforeSpacing: number;
  afterSpacing: number;
  lineHeight: number;
  pageBreakBefore: boolean;
  keepWithNext: boolean;
  bullet?: string;
  number?: string;
  styleId?: string;
  headingLevel?: number;
  bottomBorder?: {
    width: number;
    color: RGB;
    space: number;
  };
  // Present only on header/footer paragraphs whose field codes (PAGE,
  // NUMPAGES) are resolved later, once the final page count is known.
  // `runs` is empty for these until resolveHeaderFooterParagraph() fills it in.
  rawRuns?: RawPiece[];
};

type TableCell = {
  paragraphs: ParagraphModel[];
  widthTwips?: number;
};

type TableRow = {
  cells: TableCell[];
  isHeader: boolean;
};

type TableModel = {
  rows: TableRow[];
  columnWidths: number[];
};

type Block =
  | { type: "paragraph"; value: ParagraphModel }
  | { type: "table"; value: TableModel };

type StyleDefaults = {
  paragraph?: Partial<ParagraphModel>;
  run?: Partial<RunStyle>;
  basedOn?: string;
};

type RenderContext = {
  page: PDFPage;
  cursorY: number;
  bottomLimit: number;
  addPage: () => void;
};

const TWIPS_PER_INCH = 1440;
const POINTS_PER_INCH = 72;
const EMU_PER_POINT = 12700;
const DEFAULT_PAGE_WIDTH_TWIPS = 12240; // US Letter 8.5"
const DEFAULT_PAGE_HEIGHT_TWIPS = 15840; // US Letter 11"
const DEFAULT_MARGIN_TWIPS = 1440;

/**
 * Standard PDF fonts (Helvetica, etc.) use WinAnsi encoding and throw for
 * characters outside that encoding. Word documents commonly contain smart
 * quotes, em dashes, bullet glyphs, middle dots, and other Unicode symbols.
 * Normalize those characters before they reach pdf-lib text measurement or
 * drawing so one unsupported character cannot abort the whole conversion.
 */
function toWinAnsiSafeText(value: string): string {
  const normalized = value
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u25CF\u25AA\u25A0\u00B7\u2219]/g, "\u2022")
    .replace(/[\u2192\u21D2]/g, "->")
    .replace(/[\u2190\u21D0]/g, "<-")
    .replace(/\u2713/g, "v")
    .replace(/\u2717/g, "x")
    .replace(/\u2122/g, "(TM)")
    .replace(/\u2117/g, "(P)")
    .replace(/\uFB00/g, "ff")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi")
    .replace(/\uFB04/g, "ffl")
    .replace(/[\u00BC]/g, "1/4")
    .replace(/[\u00BD]/g, "1/2")
    .replace(/[\u00BE]/g, "3/4")
    .replace(/[\u00B9\u00B2\u00B3]/g, (character) => (
      { "¹": "1", "²": "2", "³": "3" }[character] ?? character
    ))
    .replace(/[\u200B\u200C\uFEFF]/g, "")
    .replace(/\u200D/g, "")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");

  // Anything still outside the WinAnsi-safe Latin-1 range at this point
  // (e.g. Czech, Polish, Croatian, Romanian, Vietnamese, or Turkish letters
  // whose accented form isn't in Latin-1) gets a best-effort decompose and
  // strip-diacritics fallback so the base letter survives instead of
  // collapsing straight to "?". True non-Latin scripts (CJK, Cyrillic,
  // Greek, Arabic, etc.) still can't be represented by the standard
  // WinAnsi-encoded PDF fonts used here and fall through to "?".
  let result = "";
  for (const character of normalized) {
    const code = character.charCodeAt(0);
    const isTabNewlineOrFormFeed = character === "\t" || character === "\n" || character === "\f";
    if (isTabNewlineOrFormFeed) {
      result += character;
      continue;
    }
    if (code < 0x20) continue; // strip stray control characters
    if (code <= 0xff || character === "\u2022") {
      result += character;
      continue;
    }
    const decomposed = character.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    result += decomposed && decomposed.charCodeAt(0) <= 0xff ? decomposed : "?";
  }
  return result;
}

function localName(node: Element | null): string {
  return node?.localName ?? node?.nodeName.split(":").pop() ?? "";
}

function childElement(node: Element, name: string): Element | null {
  for (const child of Array.from(node.children)) {
    if (localName(child) === name) return child;
  }
  return null;
}

function childElements(node: Element, name: string): Element[] {
  return Array.from(node.children).filter((child) => localName(child) === name);
}

function descendantElements(node: Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", name));
}

function getAttr(node: Element | null, name: string): string | undefined {
  if (!node) return undefined;
  for (const attribute of Array.from(node.attributes)) {
    if (localName(attribute as unknown as Element) === name) return attribute.value;
  }
  return undefined;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function twipsToPoints(value: number): number {
  return (value / TWIPS_PER_INCH) * POINTS_PER_INCH;
}

function emuToPoints(value: number): number {
  return value / EMU_PER_POINT;
}

function parseXml(xml: string, label: string): Document {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = parsed.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`Invalid ${label} XML.`);
  }
  return parsed;
}

function parseBooleanProperty(node: Element | null): boolean | undefined {
  if (!node) return undefined;
  const val = getAttr(node, "val");
  if (val === undefined || val === "true" || val === "1" || val === "on") return true;
  return !(val === "false" || val === "0" || val === "off");
}

function parseHexColor(value: string | undefined, fallback: RGB = rgb(0, 0, 0)): RGB {
  if (!value || value === "auto") return fallback;
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallback;
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function parseUnderline(runProperties: Element | null): boolean {
  return Boolean(parseBooleanProperty(childElement(runProperties ?? document.createElement("span"), "u")));
}

function getFontFace(style: RunStyle): FontFace {
  if (style.bold && style.italic) return "boldItalic";
  if (style.bold) return "bold";
  if (style.italic) return "italic";
  return "regular";
}

function resolvePdfFont(style: RunStyle, fonts: Record<FontFace, PDFFont>): PDFFont {
  return fonts[getFontFace(style)];
}

function parseRunStyle(runProperties: Element | null, inherited: RunStyle): RunStyle {
  const result: RunStyle = { ...inherited };
  const bold = parseBooleanProperty(childElement(runProperties ?? document.createElement("span"), "b"));
  const italic = parseBooleanProperty(childElement(runProperties ?? document.createElement("span"), "i"));
  const underline = parseBooleanProperty(childElement(runProperties ?? document.createElement("span"), "u"));
  if (bold !== undefined) result.bold = bold;
  if (italic !== undefined) result.italic = italic;
  if (underline !== undefined) result.underline = underline;

  const colorNode = childElement(runProperties ?? document.createElement("span"), "color");
  const color = getAttr(colorNode, "val");
  if (color) result.color = parseHexColor(color, result.color);

  const sizeNode = childElement(runProperties ?? document.createElement("span"), "sz");
  const sizeHalfPoints = getAttr(sizeNode, "val");
  if (sizeHalfPoints) {
    const parsed = Number.parseFloat(sizeHalfPoints);
    if (Number.isFinite(parsed) && parsed > 0) result.fontSize = parsed / 2;
  }

  const fontsNode = childElement(runProperties ?? document.createElement("span"), "rFonts");
  const fontFamily = getAttr(fontsNode, "ascii") ?? getAttr(fontsNode, "hAnsi") ?? getAttr(fontsNode, "cs");
  if (fontFamily) result.fontFamily = fontFamily;

  return result;
}

function parseStyleSheet(stylesXml: string): Map<string, StyleDefaults> {
  const document = parseXml(stylesXml, "Word styles");
  const styles = new Map<string, StyleDefaults>();
  const root = document.documentElement;

  for (const styleNode of childElements(root, "style")) {
    const styleId = getAttr(styleNode, "styleId");
    if (!styleId) continue;

    const paragraphProperties = childElement(styleNode, "pPr");
    const runProperties = childElement(styleNode, "rPr");
    const paragraph: Partial<ParagraphModel> = {};
    const run: Partial<RunStyle> = {};

    const alignment = getAttr(childElement(paragraphProperties ?? document.createElement("span"), "jc"), "val");
    if (alignment === "left" || alignment === "center" || alignment === "right" || alignment === "both") {
      paragraph.alignment = alignment === "both" ? "justify" : alignment;
    }

    const spacing = childElement(paragraphProperties ?? document.createElement("span"), "spacing");
    if (spacing) {
      paragraph.beforeSpacing = twipsToPoints(parseInteger(getAttr(spacing, "before"), 0));
      paragraph.afterSpacing = twipsToPoints(parseInteger(getAttr(spacing, "after"), 0));
    }

    const indent = childElement(paragraphProperties ?? document.createElement("span"), "ind");
    if (indent) {
      paragraph.leftIndent = twipsToPoints(parseInteger(getAttr(indent, "left"), 0));
      paragraph.rightIndent = twipsToPoints(parseInteger(getAttr(indent, "right"), 0));
      paragraph.firstLineIndent = twipsToPoints(parseInteger(getAttr(indent, "firstLine"), 0));
      paragraph.hangingIndent = twipsToPoints(parseInteger(getAttr(indent, "hanging"), 0));
    }

    const bold = parseBooleanProperty(childElement(runProperties ?? document.createElement("span"), "b"));
    const italic = parseBooleanProperty(childElement(runProperties ?? document.createElement("span"), "i"));
    const underline = parseBooleanProperty(childElement(runProperties ?? document.createElement("span"), "u"));
    if (bold !== undefined) run.bold = bold;
    if (italic !== undefined) run.italic = italic;
    if (underline !== undefined) run.underline = underline;

    const color = getAttr(childElement(runProperties ?? document.createElement("span"), "color"), "val");
    if (color) run.color = parseHexColor(color);

    const sizeHalfPoints = getAttr(childElement(runProperties ?? document.createElement("span"), "sz"), "val");
    if (sizeHalfPoints) {
      const parsed = Number.parseFloat(sizeHalfPoints);
      if (Number.isFinite(parsed) && parsed > 0) run.fontSize = parsed / 2;
    }

    const rFonts = childElement(runProperties ?? document.createElement("span"), "rFonts");
    const fontFamily = getAttr(rFonts, "ascii") ?? getAttr(rFonts, "hAnsi");
    if (fontFamily) run.fontFamily = fontFamily;

    const basedOn = getAttr(childElement(styleNode, "basedOn"), "val");
    styles.set(styleId, { paragraph, run, basedOn });
  }

  return styles;
}

function mergedStyleDefaults(styleId: string | undefined, styles: Map<string, StyleDefaults>): StyleDefaults {
  if (!styleId) return {};

  const chain: StyleDefaults[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = styleId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const style = styles.get(currentId);
    if (!style) break;

    chain.unshift(style);
    currentId = style.basedOn;
  }

  const merged: StyleDefaults = {};
  for (const style of chain) {
    merged.paragraph = { ...(merged.paragraph ?? {}), ...(style.paragraph ?? {}) };
    merged.run = { ...(merged.run ?? {}), ...(style.run ?? {}) };
  }

  return merged;
}

function headingLevelFromStyle(styleId: string | undefined): number | undefined {
  if (!styleId) return undefined;
  const match = /^Heading([1-9])$/i.exec(styleId);
  return match ? Number(match[1]) : undefined;
}

function parseNumbering(numberingXml: string): Map<string, Map<number, { format: string; text: string; start: number }>> {
  const document = parseXml(numberingXml, "Word numbering");
  const abstract = new Map<string, Map<number, { format: string; text: string; start: number }>>();

  for (const abstractNode of childElements(document.documentElement, "abstractNum")) {
    const abstractId = getAttr(abstractNode, "abstractNumId");
    if (!abstractId) continue;
    const levels = new Map<number, { format: string; text: string; start: number }>();

    for (const lvlNode of childElements(abstractNode, "lvl")) {
      const ilvl = parseInteger(getAttr(lvlNode, "ilvl"), 0);
      const startNode = childElement(lvlNode, "start");
      const numFmtNode = childElement(lvlNode, "numFmt");
      const lvlTextNode = childElement(lvlNode, "lvlText");
      levels.set(ilvl, {
        format: getAttr(numFmtNode, "val") ?? "bullet",
        text: toWinAnsiSafeText(getAttr(lvlTextNode, "val") ?? "•"),
        start: parseInteger(getAttr(startNode, "val"), 1),
      });
    }
    abstract.set(abstractId, levels);
  }

  const nums = new Map<string, string>();
  for (const numNode of childElements(document.documentElement, "num")) {
    const numId = getAttr(numNode, "numId");
    const abstractRef = childElement(numNode, "abstractNumId");
    if (numId && abstractRef) nums.set(numId, getAttr(abstractRef, "val") ?? "");
  }

  const result = new Map<string, Map<number, { format: string; text: string; start: number }>>();
  for (const [numId, abstractId] of nums) {
    const levels = abstract.get(abstractId);
    if (levels) result.set(numId, levels);
  }
  return result;
}

function formatNumbering(value: number, format: string): string {
  switch (format) {
    case "upperRoman":
      return toRoman(value);
    case "lowerRoman":
      return toRoman(value).toLowerCase();
    case "upperLetter":
      return toLetters(value);
    case "lowerLetter":
      return toLetters(value).toLowerCase();
    default:
      return String(value);
  }
}

function toRoman(value: number): string {
  const pairs: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let remaining = Math.max(1, value);
  let result = "";
  for (const [unit, symbol] of pairs) {
    while (remaining >= unit) {
      result += symbol;
      remaining -= unit;
    }
  }
  return result;
}

function toLetters(value: number): string {
  let n = Math.max(1, value);
  let result = "";
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function parseRun(runNode: Element, inherited: RunStyle): RawPiece[] {
  const runProperties = childElement(runNode, "rPr");
  const style = parseRunStyle(runProperties, inherited);
  const result: RawPiece[] = [];

  for (const child of Array.from(runNode.children)) {
    switch (localName(child)) {
      case "t":
      case "delText": {
        result.push({ text: toWinAnsiSafeText(child.textContent ?? ""), style, kind: "text" });
        break;
      }
      case "instrText": {
        // Field instruction code (e.g. " PAGE ", " HYPERLINK \"...\" ").
        // Never visible text on its own — resolveFields() interprets it.
        result.push({ text: toWinAnsiSafeText(child.textContent ?? ""), style, kind: "instrText" });
        break;
      }
      case "fldChar": {
        const fldCharType = getAttr(child, "fldCharType");
        if (fldCharType === "begin") result.push({ text: "", style, kind: "fldBegin" });
        else if (fldCharType === "separate") result.push({ text: "", style, kind: "fldSeparate" });
        else if (fldCharType === "end") result.push({ text: "", style, kind: "fldEnd" });
        break;
      }
      case "tab":
      case "ptab":
        // Maintain exact tab characters so wrapParagraphLines can enforce a fixed column jump
        result.push({ text: "\t", style, kind: "text" });
        break;
      case "br": {
        const type = getAttr(child, "type");
        result.push({ text: type === "page" ? "\f" : "\n", style, kind: "text" });
        break;
      }
      case "noBreakHyphen":
        result.push({ text: "-", style, kind: "text" });
        break;
      case "softHyphen":
        result.push({ text: "\u00AD", style, kind: "text" });
        break;
      default:
        break;
    }
  }

  return result;
}

/**
 * Collapses a flat run sequence into final visible TextRuns, resolving Word
 * field codes instead of letting raw instruction text (" PAGE ", " HYPERLINK
 * ... ") leak into the document as literal characters.
 *
 * Handles both field forms:
 *  - complex fields: fldChar(begin) ... instrText ... fldChar(separate) ... cached result runs ... fldChar(end)
 *  - simple fields: <w:fldSimple w:instr="..."> cached result runs </w:fldSimple>, expanded by
 *    collectRunsInOrder into the same begin/instrText/separate/result/end shape.
 *
 * When `liveContext` is supplied (used for header/footer rendering, once the
 * final page count is known), PAGE and NUMPAGES fields are replaced with the
 * real page number / total page count instead of Word's cached result text.
 * Without it (ordinary body content), other field types fall back to
 * rendering their cached result — accurate for static fields and, per the
 * "never render field-code XML as raw text" requirement, at least never
 * shows the instruction code itself.
 */
function resolveFields(raw: RawPiece[], liveContext?: { page: number; totalPages: number }): TextRun[] {
  const output: TextRun[] = [];
  let state: "none" | "instr" | "result" = "none";
  let instrBuffer = "";
  let skipResult = false;

  for (const piece of raw) {
    switch (piece.kind) {
      case "fldBegin":
        state = "instr";
        instrBuffer = "";
        skipResult = false;
        break;
      case "fldSeparate": {
        const instr = instrBuffer.trim();
        if (liveContext && /^PAGE\b/i.test(instr)) {
          output.push({ text: String(liveContext.page), style: piece.style });
          skipResult = true;
        } else if (liveContext && /^NUMPAGES\b/i.test(instr)) {
          output.push({ text: String(liveContext.totalPages), style: piece.style });
          skipResult = true;
        } else {
          skipResult = false;
        }
        state = "result";
        break;
      }
      case "fldEnd":
        state = "none";
        skipResult = false;
        break;
      case "instrText":
        if (state === "instr") instrBuffer += piece.text;
        else output.push({ text: piece.text, style: piece.style });
        break;
      case "text":
        if (state === "result" && skipResult) break;
        output.push({ text: piece.text, style: piece.style });
        break;
      default:
        break;
    }
  }

  return output;
}

function collectRunsInOrder(node: Element, defaultRun: RunStyle): RawPiece[] {
  const runs: RawPiece[] = [];
  for (const child of Array.from(node.children)) {
    const name = localName(child);

    if (name === "r") {
      runs.push(...parseRun(child, defaultRun));
    } else if (name === "hyperlink" || name === "ins" || name === "smartTag" || name === "sdt") {
      // These wrap runs without being runs themselves — recurse into
      // their children (sdt uses sdtContent as an extra nesting level).
      const container = name === "sdt" ? childElement(child, "sdtContent") ?? child : child;
      runs.push(...collectRunsInOrder(container, defaultRun));
    } else if (name === "fldSimple") {
      // Self-contained field: <w:fldSimple w:instr="PAGE"><w:r>1</w:r></w:fldSimple>.
      // Expand into the same begin/instrText/separate/result/end shape that
      // complex fields use so resolveFields() can handle both uniformly.
      const instr = getAttr(child, "instr") ?? "";
      runs.push({ text: "", style: defaultRun, kind: "fldBegin" });
      runs.push({ text: instr, style: defaultRun, kind: "instrText" });
      runs.push({ text: "", style: defaultRun, kind: "fldSeparate" });
      runs.push(...collectRunsInOrder(child, defaultRun));
      runs.push({ text: "", style: defaultRun, kind: "fldEnd" });
    }
    // "del" (deleted/tracked-change text) is intentionally skipped
  }
  return runs;
}

function parseParagraph(
  paragraphNode: Element,
  styles: Map<string, StyleDefaults>,
  numbering: Map<string, Map<number, { format: string; text: string; start: number }>>,
  numberingCounters: Map<string, number>,
  deferFieldResolution = false,
): ParagraphModel {
  const pPr = childElement(paragraphNode, "pPr");
  const styleId = getAttr(childElement(pPr ?? document.createElement("span"), "pStyle"), "val");
  const styleDefaults = mergedStyleDefaults(styleId, styles);
  const defaultRun: RunStyle = {
    bold: Boolean(styleDefaults.run?.bold),
    italic: Boolean(styleDefaults.run?.italic),
    underline: Boolean(styleDefaults.run?.underline),
    fontSize: styleDefaults.run?.fontSize ?? 11,
    color: styleDefaults.run?.color ?? rgb(0, 0, 0),
    fontFamily: styleDefaults.run?.fontFamily,
  };

  const alignmentValue =
    getAttr(childElement(pPr ?? document.createElement("span"), "jc"), "val") ??
    styleDefaults.paragraph?.alignment ??
    "left";
  const alignment: Alignment = alignmentValue === "both" ? "justify" : alignmentValue === "center" || alignmentValue === "right" ? alignmentValue : "left";

  const spacing = childElement(pPr ?? document.createElement("span"), "spacing");
  const indent = childElement(pPr ?? document.createElement("span"), "ind");
  const beforeSpacing = spacing ? twipsToPoints(parseInteger(getAttr(spacing, "before"), 0)) : styleDefaults.paragraph?.beforeSpacing ?? 0;
  const afterSpacing = spacing ? twipsToPoints(parseInteger(getAttr(spacing, "after"), 0)) : styleDefaults.paragraph?.afterSpacing ?? 0;
  const leftIndent = indent ? twipsToPoints(parseInteger(getAttr(indent, "left"), 0)) : styleDefaults.paragraph?.leftIndent ?? 0;
  const rightIndent = indent ? twipsToPoints(parseInteger(getAttr(indent, "right"), 0)) : styleDefaults.paragraph?.rightIndent ?? 0;
  const firstLineIndent = indent ? twipsToPoints(parseInteger(getAttr(indent, "firstLine"), 0)) : styleDefaults.paragraph?.firstLineIndent ?? 0;
  const hangingIndent = indent ? twipsToPoints(parseInteger(getAttr(indent, "hanging"), 0)) : styleDefaults.paragraph?.hangingIndent ?? 0;

  const lineRaw = getAttr(spacing, "line");
  const baseSize = defaultRun.fontSize;
  const lineHeight = lineRaw ? Math.max(baseSize * 1.05, (parseInteger(lineRaw, 240) / 240) * baseSize) : baseSize * 1.2;

  const pageBreakBefore = Boolean(parseBooleanProperty(childElement(pPr ?? document.createElement("span"), "pageBreakBefore")));
  const keepWithNext = Boolean(parseBooleanProperty(childElement(pPr ?? document.createElement("span"), "keepNext")));
  const headingLevel = headingLevelFromStyle(styleId);

  let bullet: string | undefined;
  let number: string | undefined;
  const numPr = childElement(pPr ?? document.createElement("span"), "numPr");
  if (numPr) {
    const numId = getAttr(childElement(numPr, "numId"), "val");
    const ilvl = parseInteger(getAttr(childElement(numPr, "ilvl"), "val"), 0);
    if (numId) {
      const level = numbering.get(numId)?.get(ilvl);
      if (level) {
        if (level.format === "bullet" || level.text.includes("•") || level.text.includes("·")) {
          bullet = level.text.replace(/%\d+/g, "•");
        } else {
          const counterKey = `${numId}:${ilvl}`;
          const current = numberingCounters.get(counterKey) ?? level.start - 1;
          const next = current + 1;
          numberingCounters.set(counterKey, next);
          number = level.text.replace(/%\d+/, formatNumbering(next, level.format));
        }
      }
    }
  }

  // Uses recursive runner to fetch deeply nested text
  const rawPieces = collectRunsInOrder(paragraphNode, defaultRun);
  const runs: TextRun[] = deferFieldResolution ? [] : resolveFields(rawPieces);

  const paragraphBorders = childElement(pPr ?? document.createElement("span"), "pBdr");
  const bottomBorderNode = childElement(paragraphBorders ?? document.createElement("span"), "bottom");
  const bottomBorder = bottomBorderNode
    ? {
        width: Math.max(0.25, parseInteger(getAttr(bottomBorderNode, "sz"), 4) / 8),
        color: parseHexColor(getAttr(bottomBorderNode, "color"), rgb(0, 0, 0)),
        space: Math.max(0, parseInteger(getAttr(bottomBorderNode, "space"), 1)),
      }
    : undefined;

  const normalizedRuns = deferFieldResolution
    ? runs
    : runs.length > 0
      ? runs
      : [{ text: "", style: defaultRun }];

  if (headingLevel) {
    const headingSizes: Record<number, number> = { 1: 18, 2: 16, 3: 14, 4: 13, 5: 12, 6: 11 };
    const headingSize = headingSizes[headingLevel] ?? baseSize;
    for (const run of normalizedRuns) {
      run.style.fontSize = Math.max(run.style.fontSize, headingSize);
      run.style.bold = true;
    }
  }

  return {
    runs: normalizedRuns,
    alignment,
    leftIndent,
    rightIndent,
    firstLineIndent,
    hangingIndent,
    beforeSpacing,
    afterSpacing,
    lineHeight,
    pageBreakBefore,
    keepWithNext,
    bullet,
    number,
    styleId,
    headingLevel,
    bottomBorder,
    rawRuns: deferFieldResolution ? rawPieces : undefined,
  };
}

/**
 * Resolves the field codes in a header/footer paragraph now that the real
 * page number and total page count are known, producing a paragraph ready
 * to wrap and draw. Also applies the same heading-size bump parseParagraph
 * would have applied (headers/footers rarely use heading styles, but stay
 * consistent if they do).
 */
function resolveHeaderFooterParagraph(
  paragraph: ParagraphModel,
  page: number,
  totalPages: number,
): ParagraphModel {
  const resolved = resolveFields(paragraph.rawRuns ?? [], { page, totalPages });
  const runs = resolved.length > 0 ? resolved : [{ text: "", style: defaultBodyRunStyle() }];
  return { ...paragraph, runs, rawRuns: undefined };
}

function defaultBodyRunStyle(): RunStyle {
  return { bold: false, italic: false, underline: false, fontSize: 10, color: rgb(0, 0, 0) };
}

function parseTable(
  tableNode: Element,
  styles: Map<string, StyleDefaults>,
  numbering: Map<string, Map<number, { format: string; text: string; start: number }>>,
  numberingCounters: Map<string, number>,
): TableModel {
  const grid = childElement(tableNode, "tblGrid");
  const columnWidths = grid
    ? childElements(grid, "gridCol").map((col) => parseInteger(getAttr(col, "w"), 0))
    : [];

  const rows: TableRow[] = [];
  for (const rowNode of childElements(tableNode, "tr")) {
    const cells: TableCell[] = [];
    for (const cellNode of childElements(rowNode, "tc")) {
      const cellProperties = childElement(cellNode, "tcPr");
      const widthNode = childElement(cellProperties ?? document.createElement("span"), "tcW");
      const cellWidthTwips = parseInteger(getAttr(widthNode, "w"), 0);
      const paragraphs = childElements(cellNode, "p").map((paragraph) =>
        parseParagraph(paragraph, styles, numbering, numberingCounters),
      );
      cells.push({ paragraphs, widthTwips: cellWidthTwips > 0 ? cellWidthTwips : undefined });
    }
    const rowProperties = childElement(rowNode, "trPr");
    const isHeader = Boolean(parseBooleanProperty(childElement(rowProperties ?? document.createElement("span"), "tblHeader")));
    rows.push({ cells, isHeader });
  }

  return { rows, columnWidths };
}

type SectionReferences = {
  headerRelId?: string;
  footerRelId?: string;
};

function parseBodyBlocks(
  documentXml: string,
  styles: Map<string, StyleDefaults>,
  numbering: Map<string, Map<number, { format: string; text: string; start: number }>>,
): { blocks: Block[]; section: PageSection; references: SectionReferences } {
  const document = parseXml(documentXml, "Word document");
  const body = childElement(document.documentElement, "body");
  if (!body) throw new Error("The Word document does not contain a readable document body.");

  const counters = new Map<string, number>();
  const blocks: Block[] = [];

  for (const child of Array.from(body.children)) {
    const name = localName(child);
    if (name === "p") {
      const parsed = parseParagraph(child, styles, numbering, counters);
      blocks.push({ type: "paragraph", value: parsed });
    } else if (name === "tbl") {
      blocks.push({ type: "table", value: parseTable(child, styles, numbering, counters) });
    }
  }

  const sectPr = childElement(body, "sectPr");
  return { blocks, section: parseSection(sectPr), references: parseSectionReferences(sectPr) };
}

/**
 * Finds the default header/footer reference for the section. Word can
 * define separate "first page" and "even page" headers/footers via the
 * `w:type` attribute, but the overwhelmingly common case is a single
 * "default" header/footer applied to every page — that's what's supported
 * here. Falls back to whichever reference is present if "default" is absent.
 */
function parseSectionReferences(sectPr: Element | null): SectionReferences {
  if (!sectPr) return {};

  const headerRefs = childElements(sectPr, "headerReference");
  const footerRefs = childElements(sectPr, "footerReference");

  const pickReference = (refs: Element[]): string | undefined => {
    const defaultRef = refs.find((ref) => (getAttr(ref, "type") ?? "default") === "default");
    return getAttr(defaultRef ?? refs[0], "id");
  };

  return {
    headerRelId: pickReference(headerRefs),
    footerRelId: pickReference(footerRefs),
  };
}

/** Parses word/_rels/document.xml.rels into a map of r:id -> target path (relative to word/). */
function parseRelationships(relsXml: string | undefined): Map<string, string> {
  const relationships = new Map<string, string>();
  if (!relsXml) return relationships;

  const document = parseXml(relsXml, "Word relationships");
  for (const relNode of Array.from(document.documentElement.children)) {
    const id = getAttr(relNode, "Id");
    const target = getAttr(relNode, "Target");
    if (id && target) relationships.set(id, target.replace(/^\//, ""));
  }
  return relationships;
}

/** Parses a word/header*.xml or word/footer*.xml part into paragraphs, deferring field-code resolution. */
function parseHeaderFooterXml(
  xml: string,
  styles: Map<string, StyleDefaults>,
  numbering: Map<string, Map<number, { format: string; text: string; start: number }>>,
): ParagraphModel[] {
  const document = parseXml(xml, "Word header/footer");
  const counters = new Map<string, number>();
  return childElements(document.documentElement, "p").map((paragraphNode) =>
    parseParagraph(paragraphNode, styles, numbering, counters, true),
  );
}

type PageSection = {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  headerDistance: number;
  footerDistance: number;
};

function parseSection(sectPr: Element | null): PageSection {
  const pageSize = childElement(sectPr ?? document.createElement("span"), "pgSz");
  const pageMargin = childElement(sectPr ?? document.createElement("span"), "pgMar");
  const widthTwips = parseInteger(getAttr(pageSize, "w"), DEFAULT_PAGE_WIDTH_TWIPS);
  const heightTwips = parseInteger(getAttr(pageSize, "h"), DEFAULT_PAGE_HEIGHT_TWIPS);
  const orientation = getAttr(pageSize, "orient");

  const width = twipsToPoints(orientation === "landscape" ? heightTwips : widthTwips);
  const height = twipsToPoints(orientation === "landscape" ? widthTwips : heightTwips);

  return {
    width,
    height,
    marginLeft: twipsToPoints(parseInteger(getAttr(pageMargin, "left"), DEFAULT_MARGIN_TWIPS)),
    marginRight: twipsToPoints(parseInteger(getAttr(pageMargin, "right"), DEFAULT_MARGIN_TWIPS)),
    marginTop: twipsToPoints(parseInteger(getAttr(pageMargin, "top"), DEFAULT_MARGIN_TWIPS)),
    marginBottom: twipsToPoints(parseInteger(getAttr(pageMargin, "bottom"), DEFAULT_MARGIN_TWIPS)),
    headerDistance: twipsToPoints(parseInteger(getAttr(pageMargin, "header"), 720)),
    footerDistance: twipsToPoints(parseInteger(getAttr(pageMargin, "footer"), 720)),
  };
}


function splitRunOnWhitespace(run: TextRun): TextRun[] {
  const matches = run.text.match(/\f|\n|\t|[^\s]+|[ ]+/g) ?? [];
  return matches
    .filter((text) => text.length > 0)
    .map((text) => ({ text, style: { ...run.style } }));
}

type WrappedLine = {
  runs: TextRun[];
  width: number;
  isFirstLine: boolean;
  pageBreakBefore?: boolean;
};

function getParagraphLineHeight(paragraph: ParagraphModel): number {
  const headingScale = paragraph.headingLevel
    ? Math.max(1, 1.12 - (paragraph.headingLevel - 1) * 0.03)
    : 1;
  return Math.max(1, paragraph.lineHeight * headingScale);
}

function getLineAvailableWidth(
  paragraph: ParagraphModel,
  contentWidth: number,
  lineIndex: number,
): number {
  const firstLineOffset = lineIndex === 0
    ? paragraph.firstLineIndent - paragraph.hangingIndent
    : paragraph.hangingIndent > 0
      ? -paragraph.hangingIndent
      : 0;

  return Math.max(
    20,
    contentWidth - paragraph.leftIndent - paragraph.rightIndent - firstLineOffset,
  );
}

function measureTextWithTabs(
  text: string,
  style: RunStyle,
  currentWidth: number,
  fonts: Record<FontFace, PDFFont>,
): number {
  const font = resolvePdfFont(style, fonts);
  const parts = text.split("\t");
  let width = 0;

  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) {
      const tabStop = 36;
      const absolutePosition = currentWidth + width;
      const remainder = absolutePosition % tabStop;
      width += remainder === 0 ? tabStop : tabStop - remainder;
    }

    const part = parts[index];
    if (part) {
      width += font.widthOfTextAtSize(part, style.fontSize);
    }
  }

  return width;
}

function breakLongToken(
  text: string,
  style: RunStyle,
  availableWidth: number,
  fonts: Record<FontFace, PDFFont>,
): TextRun[] {
  const safeText = toWinAnsiSafeText(text);
  const font = resolvePdfFont(style, fonts);
  const result: TextRun[] = [];
  let current = "";

  for (const character of safeText) {
    const candidate = current + character;

    if (
      current &&
      font.widthOfTextAtSize(candidate, style.fontSize) > availableWidth
    ) {
      result.push({ text: current, style: { ...style } });
      current = character;
    } else {
      current = candidate;
    }
  }

  if (current) {
    result.push({ text: current, style: { ...style } });
  }

  return result;
}

function wrapParagraphLines(
  paragraph: ParagraphModel,
  contentWidth: number,
  fonts: Record<FontFace, PDFFont>,
): WrappedLine[] {
  const pieces: TextRun[] = [];

  for (const run of paragraph.runs) {
    pieces.push(...splitRunOnWhitespace(run));
  }

  const lines: WrappedLine[] = [];
  let current: TextRun[] = [];
  let currentWidth = 0;
  let lineIndex = 0;
  let pendingPageBreak = false;

  const baseStyle =
    paragraph.runs[0]?.style ?? {
      bold: false,
      italic: false,
      underline: false,
      fontSize: 11,
      color: rgb(0, 0, 0),
    };

  const bulletPrefix = paragraph.bullet ?? paragraph.number;
  const prefix = bulletPrefix
    ? `${toWinAnsiSafeText(bulletPrefix)} `
    : "";

  const flush = (force = false) => {
    if (!force && current.length === 0) return;

    if (current.length === 0) {
      current = [{ text: "", style: { ...baseStyle } }];
    }

    lines.push({
      runs: current,
      width: currentWidth,
      isFirstLine: lineIndex === 0,
      pageBreakBefore: pendingPageBreak,
    });

    current = [];
    currentWidth = 0;
    lineIndex += 1;
    pendingPageBreak = false;
  };

  if (prefix) {
    const prefixStyle = { ...baseStyle, bold: false };
    current.push({ text: prefix, style: prefixStyle });
    currentWidth = measureTextWithTabs(prefix, prefixStyle, 0, fonts);
  }

  for (const piece of pieces) {
    if (piece.text === "\f") {
      flush(true);
      pendingPageBreak = true;
      continue;
    }

    if (piece.text === "\n") {
      flush(true);
      continue;
    }

    const safeText = toWinAnsiSafeText(piece.text);
    if (!safeText) continue;

    const safePiece: TextRun = {
      text: safeText,
      style: { ...piece.style },
    };

    const isWhitespace = /^\s+$/.test(safePiece.text);
    const availableWidth = getLineAvailableWidth(
      paragraph,
      contentWidth,
      lineIndex,
    );
    const pieceWidth = measureTextWithTabs(
      safePiece.text,
      safePiece.style,
      currentWidth,
      fonts,
    );

    if (
      !isWhitespace &&
      currentWidth > 0 &&
      currentWidth + pieceWidth > availableWidth
    ) {
      flush();
    }

    const availableAfterFlush = getLineAvailableWidth(
      paragraph,
      contentWidth,
      lineIndex,
    );

    if (
      !isWhitespace &&
      currentWidth === 0 &&
      pieceWidth > availableAfterFlush &&
      !safePiece.text.includes("\t")
    ) {
      const brokenRuns = breakLongToken(
        safePiece.text,
        safePiece.style,
        availableAfterFlush,
        fonts,
      );

      for (const brokenRun of brokenRuns) {
        const brokenWidth = resolvePdfFont(
          brokenRun.style,
          fonts,
        ).widthOfTextAtSize(
          brokenRun.text,
          brokenRun.style.fontSize,
        );

        if (
          currentWidth > 0 &&
          currentWidth + brokenWidth > availableAfterFlush
        ) {
          flush();
        }

        current.push(brokenRun);
        currentWidth += brokenWidth;

        if (
          currentWidth >= availableAfterFlush &&
          brokenRun.text !== brokenRuns[brokenRuns.length - 1].text
        ) {
          flush();
        }
      }

      continue;
    }

    if (isWhitespace && current.length === 0) {
      continue;
    }

    current.push(safePiece);
    currentWidth += measureTextWithTabs(
      safePiece.text,
      safePiece.style,
      currentWidth,
      fonts,
    );
  }

  if (current.length > 0 || lines.length === 0) {
    flush(true);
  }

  return lines;
}

function drawTextRunLine(
  page: PDFPage,
  line: WrappedLine,
  paragraph: ParagraphModel,
  x: number,
  y: number,
  contentWidth: number,
  fonts: Record<FontFace, PDFFont>,
  isLastLine: boolean,
): void {
  const indent = line.isFirstLine
    ? paragraph.firstLineIndent - paragraph.hangingIndent
    : paragraph.hangingIndent > 0
      ? -paragraph.hangingIndent
      : 0;

  let cursorX = x + paragraph.leftIndent + indent;
  const maxWidth = contentWidth - paragraph.leftIndent - paragraph.rightIndent;

  const shouldJustify =
    paragraph.alignment === "justify" &&
    !isLastLine &&
    line.runs.some((run) => /[ ]/.test(run.text));

  const totalSpaces = shouldJustify
    ? line.runs.reduce(
        (count, run) => count + (run.text.match(/ /g)?.length ?? 0),
        0,
      )
    : 0;

  const extraSpace =
    shouldJustify && totalSpaces > 0
      ? Math.max(0, maxWidth - line.width) / totalSpaces
      : 0;

  for (const run of line.runs) {
    const font = resolvePdfFont(run.style, fonts);
    const safeText = toWinAnsiSafeText(run.text);

    if (!safeText) continue;

    const segments = safeText.split(/(\t| +)/);

    for (const segment of segments) {
      if (!segment) continue;

      if (segment === "\t") {
        const tabStop = 36;
        const remainder = cursorX % tabStop;
        cursorX += remainder === 0 ? tabStop : tabStop - remainder;
        continue;
      }

      if (/^ +$/.test(segment)) {
        // Draw an actual space glyph so the PDF content stream contains
        // a real space character between words. The previous version
        // only advanced cursorX without drawing anything, so no space
        // ever existed in the text layer — copy/paste or extraction
        // merged adjacent words (e.g. "strategy,operations").
        page.drawText(segment, {
          x: cursorX,
          y,
          size: run.style.fontSize,
          font,
          color: run.style.color,
        });
        const spaceWidth = font.widthOfTextAtSize(
          " ",
          run.style.fontSize,
        );
        cursorX +=
          spaceWidth * segment.length +
          extraSpace * segment.length;
        continue;
      }

      const width = font.widthOfTextAtSize(
        segment,
        run.style.fontSize,
      );

      page.drawText(segment, {
        x: cursorX,
        y,
        size: run.style.fontSize,
        font,
        color: run.style.color,
      });

      if (run.style.underline) {
        page.drawLine({
          start: { x: cursorX, y: y - 1.5 },
          end: { x: cursorX + width, y: y - 1.5 },
          thickness: Math.max(0.4, run.style.fontSize / 18),
          color: run.style.color,
        });
      }

      cursorX += width;
    }
  }
}

function drawParagraph(
  ctx: RenderContext,
  paragraph: ParagraphModel,
  x: number,
  contentWidth: number,
  fonts: Record<FontFace, PDFFont>,
  lines: WrappedLine[],
): void {
  const lineHeight = getParagraphLineHeight(paragraph);

  if (paragraph.pageBreakBefore) {
    ctx.addPage();
  } else {
    ctx.cursorY -= paragraph.beforeSpacing;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.pageBreakBefore) {
      ctx.addPage();
    }

    if (ctx.cursorY - lineHeight < ctx.bottomLimit) {
      ctx.addPage();
    }

    drawTextRunLine(
      ctx.page,
      line,
      paragraph,
      x,
      ctx.cursorY,
      contentWidth,
      fonts,
      index === lines.length - 1,
    );

    ctx.cursorY -= lineHeight;
  }

  if (paragraph.bottomBorder) {
    const borderY = ctx.cursorY + Math.min(
      lineHeight * 0.25,
      Math.max(1, paragraph.bottomBorder.space),
    );

    if (borderY < ctx.bottomLimit) {
      ctx.addPage();
    }

    ctx.page.drawLine({
      start: {
        x: x + paragraph.leftIndent,
        y: borderY,
      },
      end: {
        x: x + contentWidth - paragraph.rightIndent,
        y: borderY,
      },
      thickness: paragraph.bottomBorder.width,
      color: paragraph.bottomBorder.color,
    });
  }

  ctx.cursorY -= paragraph.afterSpacing;
}

function measureTableCellHeight(
  cell: TableCell,
  cellWidth: number,
  fonts: Record<FontFace, PDFFont>,
): number {
  const horizontalPadding = 10;
  const availableWidth = Math.max(20, cellWidth - horizontalPadding);
  let height = 10;

  for (const paragraph of cell.paragraphs) {
    const lines = wrapParagraphLines(
      paragraph,
      Math.max(
        20,
        availableWidth - paragraph.leftIndent - paragraph.rightIndent,
      ),
      fonts,
    );

    height += paragraph.beforeSpacing;
    height += Math.max(1, lines.length) * getParagraphLineHeight(paragraph);
    height += paragraph.afterSpacing;
  }

  return Math.max(24, height + 10);
}

function drawTable(
  ctx: RenderContext,
  table: TableModel,
  x: number,
  contentWidth: number,
  fonts: Record<FontFace, PDFFont>,
): void {
  const columnCount = Math.max(
    table.columnWidths.length,
    ...table.rows.map((row) => row.cells.length),
    1,
  );

  const explicitWidths =
    table.columnWidths.length === columnCount
      ? table.columnWidths
      : [];

  const totalExplicitWidth = explicitWidths.reduce(
    (sum, value) => sum + Math.max(0, value),
    0,
  );

  const widths =
    explicitWidths.length === columnCount &&
    totalExplicitWidth > 0
      ? explicitWidths.map(
          (value) =>
            (Math.max(0, value) / totalExplicitWidth) *
            contentWidth,
        )
      : Array.from(
          { length: columnCount },
          () => contentWidth / columnCount,
        );

  const measureRowHeight = (row: TableRow): number =>
    Math.max(
      24,
      ...row.cells.map((cell, index) =>
        measureTableCellHeight(cell, widths[index] ?? widths[widths.length - 1], fonts),
      ),
    );

  const drawRow = (row: TableRow, rowHeight: number): void => {
    const rowTopY = ctx.cursorY;
    let cursorX = x;

    row.cells.forEach((cell, index) => {
      const cellWidth = widths[index] ?? widths[widths.length - 1];

      ctx.page.drawRectangle({
        x: cursorX,
        y: rowTopY - rowHeight,
        width: cellWidth,
        height: rowHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.75, 0.75, 0.75),
      });

      let cellY = rowTopY - 12;

      for (const paragraph of cell.paragraphs) {
        const availableWidth = Math.max(
          20,
          cellWidth -
            10 -
            paragraph.leftIndent -
            paragraph.rightIndent,
        );

        const paragraphLines = wrapParagraphLines(
          paragraph,
          availableWidth,
          fonts,
        );

        const lineHeight = getParagraphLineHeight(paragraph);

        cellY -= paragraph.beforeSpacing;

        for (let lineIndex = 0; lineIndex < paragraphLines.length; lineIndex += 1) {
          const line = paragraphLines[lineIndex];

          if (line.pageBreakBefore) {
            continue;
          }

          if (
            cellY - lineHeight <
            rowTopY - rowHeight + 5
          ) {
            break;
          }

          drawTextRunLine(
            ctx.page,
            line,
            paragraph,
            cursorX + 5,
            cellY,
            cellWidth - 10,
            fonts,
            lineIndex === paragraphLines.length - 1,
          );

          cellY -= lineHeight;
        }

        cellY -= paragraph.afterSpacing;
      }

      cursorX += cellWidth;
    });

    ctx.cursorY = rowTopY - rowHeight;
  };

  // Rows marked with w:tblHeader repeat at the top of every page the table
  // spans, matching Word's "repeat as header row" table option.
  const headerRows = table.rows.filter((row) => row.isHeader);
  const headerRowHeights = headerRows.map((row) => measureRowHeight(row));

  for (const row of table.rows) {
    const rowHeight = measureRowHeight(row);

    if (ctx.cursorY - rowHeight < ctx.bottomLimit) {
      ctx.addPage();
      if (!row.isHeader) {
        headerRows.forEach((headerRow, index) => drawRow(headerRow, headerRowHeights[index]));
      }
    }

    drawRow(row, rowHeight);
  }
}

async function readDocxXml(file: File): Promise<{
  documentXml: string;
  stylesXml: string;
  numberingXml: string;
  relationshipsXml?: string;
  zip: JSZip;
}> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const [documentXml, stylesXml, numberingXml, relationshipsXml] = await Promise.all([
    zip.file("word/document.xml")?.async("text"),
    zip.file("word/styles.xml")?.async("text"),
    zip.file("word/numbering.xml")?.async("text"),
    zip.file("word/_rels/document.xml.rels")?.async("text"),
  ]);

  if (!documentXml) throw new Error("The DOCX file does not contain word/document.xml.");
  return {
    documentXml,
    stylesXml: stylesXml ?? "<?xml version=\"1.0\"?><styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>;",
    numberingXml: numberingXml ?? "<?xml version=\"1.0\"?><numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>;",
    relationshipsXml,
    zip,
  };
}

/**
 * Draws a fixed block of paragraphs (a resolved header or footer) starting
 * at `topY` and flowing downward, without page-break/overflow handling —
 * headers and footers are short, fixed-area content that never spans pages.
 */
function drawHeaderFooterParagraphs(
  page: PDFPage,
  paragraphs: ParagraphModel[],
  x: number,
  contentWidth: number,
  fonts: Record<FontFace, PDFFont>,
  topY: number,
): void {
  let cursorY = topY;
  for (const paragraph of paragraphs) {
    const availableWidth = Math.max(20, contentWidth - paragraph.leftIndent - paragraph.rightIndent);
    const lines = wrapParagraphLines(paragraph, availableWidth, fonts);
    const lineHeight = getParagraphLineHeight(paragraph);

    cursorY -= paragraph.beforeSpacing;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      drawTextRunLine(page, lines[lineIndex], paragraph, x, cursorY, contentWidth, fonts, lineIndex === lines.length - 1);
      cursorY -= lineHeight;
    }
    cursorY -= paragraph.afterSpacing;
  }
}

/** Total rendered height of a resolved header/footer paragraph block, used to top-anchor footers above the bottom margin. */
function measureHeaderFooterHeight(paragraphs: ParagraphModel[], contentWidth: number, fonts: Record<FontFace, PDFFont>): number {
  let height = 0;
  for (const paragraph of paragraphs) {
    const availableWidth = Math.max(20, contentWidth - paragraph.leftIndent - paragraph.rightIndent);
    const lines = wrapParagraphLines(paragraph, availableWidth, fonts);
    height += paragraph.beforeSpacing + lines.length * getParagraphLineHeight(paragraph) + paragraph.afterSpacing;
  }
  return height;
}

export async function renderWordToRealTextPdf(file: File): Promise<Blob> {
  if (!(file instanceof File)) {
    throw new Error("Please select a valid Word document.");
  }
  if (file.size === 0) {
    throw new Error("The Word document is empty.");
  }
  if (!/\.docx$/i.test(file.name)) {
    throw new Error("Please select a .docx Word document.");
  }

  try {
    const { documentXml, stylesXml, numberingXml, relationshipsXml, zip } = await readDocxXml(file);

    const styles = parseStyleSheet(stylesXml);
  const numbering = parseNumbering(numberingXml);
  const { blocks, section, references } = parseBodyBlocks(documentXml, styles, numbering);

  const relationships = parseRelationships(relationshipsXml);
  const headerTarget = references.headerRelId ? relationships.get(references.headerRelId) : undefined;
  const footerTarget = references.footerRelId ? relationships.get(references.footerRelId) : undefined;

  const [headerXml, footerXml] = await Promise.all([
    headerTarget ? zip.file(`word/${headerTarget}`)?.async("text") : Promise.resolve(undefined),
    footerTarget ? zip.file(`word/${footerTarget}`)?.async("text") : Promise.resolve(undefined),
  ]);

  const headerParagraphs = headerXml ? parseHeaderFooterXml(headerXml, styles, numbering) : [];
  const footerParagraphs = footerXml ? parseHeaderFooterXml(footerXml, styles, numbering) : [];

  const pdf = await PDFDocument.create();
  const fonts: Record<FontFace, PDFFont> = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const ctx: RenderContext = {
    page: pdf.addPage([section.width, section.height]),
    cursorY: section.height - section.marginTop,
    bottomLimit: section.marginBottom,
    addPage() {
      this.page = pdf.addPage([section.width, section.height]);
      this.cursorY = section.height - section.marginTop;
    }
  };

  const contentWidth = section.width - section.marginLeft - section.marginRight;

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];

    if (block.type === "paragraph") {
      const paragraph = block.value;
      const availableWidth = Math.max(
        20,
        contentWidth - paragraph.leftIndent - paragraph.rightIndent,
      );

      const lines = wrapParagraphLines(
        paragraph,
        availableWidth,
        fonts,
      );

      if (paragraph.keepWithNext) {
        let requiredHeight =
          paragraph.beforeSpacing +
          lines.length * getParagraphLineHeight(paragraph) +
          paragraph.afterSpacing;

        let nextIndex = blockIndex + 1;

        while (nextIndex < blocks.length) {
          const nextBlock = blocks[nextIndex];

          if (nextBlock.type !== "paragraph") {
            break;
          }

          const nextParagraph = nextBlock.value;
          const nextLines = wrapParagraphLines(
            nextParagraph,
            Math.max(
              20,
              contentWidth -
                nextParagraph.leftIndent -
                nextParagraph.rightIndent,
            ),
            fonts,
          );

          requiredHeight +=
            nextParagraph.beforeSpacing +
            nextLines.length *
              getParagraphLineHeight(nextParagraph) +
            nextParagraph.afterSpacing;

          if (!nextParagraph.keepWithNext) {
            break;
          }

          nextIndex += 1;
        }

        if (
          ctx.cursorY - requiredHeight <
          ctx.bottomLimit
        ) {
          ctx.addPage();
        }
      }

      drawParagraph(
        ctx,
        paragraph,
        section.marginLeft,
        contentWidth,
        fonts,
        lines,
      );
    } else {
      drawTable(
        ctx,
        block.value,
        section.marginLeft,
        contentWidth,
        fonts,
      );
    }
  }

  if (headerParagraphs.length > 0 || footerParagraphs.length > 0) {
    const pages = pdf.getPages();
    const totalPages = pages.length;

    pages.forEach((page, pageIndex) => {
      const pageNumber = pageIndex + 1;

      if (headerParagraphs.length > 0) {
        const resolvedHeader = headerParagraphs.map((paragraph) =>
          resolveHeaderFooterParagraph(paragraph, pageNumber, totalPages),
        );
        drawHeaderFooterParagraphs(
          page,
          resolvedHeader,
          section.marginLeft,
          contentWidth,
          fonts,
          section.height - section.headerDistance,
        );
      }

      if (footerParagraphs.length > 0) {
        const resolvedFooter = footerParagraphs.map((paragraph) =>
          resolveHeaderFooterParagraph(paragraph, pageNumber, totalPages),
        );
        const footerHeight = measureHeaderFooterHeight(resolvedFooter, contentWidth, fonts);
        drawHeaderFooterParagraphs(
          page,
          resolvedFooter,
          section.marginLeft,
          contentWidth,
          fonts,
          section.footerDistance + footerHeight,
        );
      }
    });
  }

    const bytes = await pdf.save({ useObjectStreams: true });

const pdfBuffer = new ArrayBuffer(bytes.byteLength);
new Uint8Array(pdfBuffer).set(bytes);

return new Blob([pdfBuffer], {
  type: "application/pdf",
});
  } catch (error) {
    if (error instanceof Error && error.message) {
      throw error;
    }
    throw new Error("The Word document could not be converted to PDF.");
  }
}