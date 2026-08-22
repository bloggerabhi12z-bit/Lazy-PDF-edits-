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
};

type TableCell = {
  paragraphs: ParagraphModel[];
  widthTwips?: number;
};

type TableRow = {
  cells: TableCell[];
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
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u25CF\u25AA\u25A0\u00B7]/g, "\u2022")
    .replace(/[\u00B9\u00B2\u00B3]/g, (character) => ({ "¹": "1", "²": "2", "³": "3" }[character] ?? character))
    .replace(/[\u200B]/g, "") // Remove zero-width spaces
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ") // Convert non-breaking & advanced Unicode spaces to standard space
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    // Expanded range to \xFF to include standard European accents (é, ñ, ç, etc.)
    .replace(/[^\x20-\xFF\u2022\t\n\f]/g, "?");
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

function parseRun(runNode: Element, inherited: RunStyle): TextRun[] {
  const runProperties = childElement(runNode, "rPr");
  const style = parseRunStyle(runProperties, inherited);
  const result: TextRun[] = [];

  for (const child of Array.from(runNode.children)) {
    switch (localName(child)) {
      case "t":
      case "instrText":
      case "delText": {
        result.push({ text: toWinAnsiSafeText(child.textContent ?? ""), style });
        break;
      }
      case "tab":
      case "ptab": 
        // Maintain exact tab characters so wrapParagraphLines can enforce a fixed column jump
        result.push({ text: "\t", style });
        break;
      case "br": {
        const type = getAttr(child, "type");
        result.push({ text: type === "page" ? "\f" : "\n", style });
        break;
      }
      case "noBreakHyphen":
        result.push({ text: "-", style });
        break;
      case "softHyphen":
        result.push({ text: "\u00AD", style });
        break;
      default:
        break;
    }
  }

  return result;
}

function collectRunsInOrder(node: Element, defaultRun: RunStyle): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of Array.from(node.children)) {
    const name = localName(child);

    if (name === "r") {
      runs.push(...parseRun(child, defaultRun));
    } else if (name === "hyperlink" || name === "ins" || name === "smartTag" || name === "sdt") {
      // These wrap runs without being runs themselves — recurse into
      // their children (sdt uses sdtContent as an extra nesting level).
      const container = name === "sdt" ? childElement(child, "sdtContent") ?? child : child;
      runs.push(...collectRunsInOrder(container, defaultRun));
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
  const runs: TextRun[] = collectRunsInOrder(paragraphNode, defaultRun);

  const paragraphBorders = childElement(pPr ?? document.createElement("span"), "pBdr");
  const bottomBorderNode = childElement(paragraphBorders ?? document.createElement("span"), "bottom");
  const bottomBorder = bottomBorderNode
    ? {
        width: Math.max(0.25, parseInteger(getAttr(bottomBorderNode, "sz"), 4) / 8),
        color: parseHexColor(getAttr(bottomBorderNode, "color"), rgb(0, 0, 0)),
        space: Math.max(0, parseInteger(getAttr(bottomBorderNode, "space"), 1)),
      }
    : undefined;

  const normalizedRuns = runs.length > 0 ? runs : [{ text: "", style: defaultRun }];

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
  };
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
    rows.push({ cells });
  }

  return { rows, columnWidths };
}

function parseBodyBlocks(
  documentXml: string,
  styles: Map<string, StyleDefaults>,
  numbering: Map<string, Map<number, { format: string; text: string; start: number }>>,
): { blocks: Block[]; section: PageSection } {
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
  return { blocks, section: parseSection(sectPr) };
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
  // We keep \t in the regex so tabs are preserved as chunks
  const pieces = run.text.split(/(\s+)/).filter((piece) => piece.length > 0);
  return pieces.map((text) => ({ text, style: { ...run.style } }));
}

function wrapParagraphLines(
  paragraph: ParagraphModel,
  contentWidth: number,
  fonts: Record<FontFace, PDFFont>,
): Array<{ runs: TextRun[]; width: number; isFirstLine: boolean; pageBreakBefore?: boolean }> {
  const pieces: TextRun[] = [];
  for (const run of paragraph.runs) {
    const chunks = splitRunOnWhitespace(run);
    for (const chunk of chunks) {
      if (chunk.text.includes("\n") || chunk.text.includes("\f")) {
        const parts = chunk.text.split(/([\n\f])/);
        for (const part of parts) {
          if (part) pieces.push({ text: part, style: { ...chunk.style } });
        }
      } else {
        pieces.push(chunk);
      }
    }
  }

  const lines: Array<{ runs: TextRun[]; width: number; isFirstLine: boolean; pageBreakBefore?: boolean }> = [];
  let current: TextRun[] = [];
  let width = 0;
  let lineIndex = 0;
  let pendingPageBreak = false;
  const bulletPrefix = paragraph.bullet ?? paragraph.number;
  const prefix = bulletPrefix ? `${toWinAnsiSafeText(bulletPrefix)} ` : "";

  if (prefix) {
    current.push({
      text: prefix,
      style: { ...pieces[0]?.style ?? paragraph.runs[0].style, bold: false },
    });
    width = resolvePdfFont(current[0].style, fonts).widthOfTextAtSize(
      prefix,
      current[0].style.fontSize,
    );
  }

  const flush = (force = false) => {
    if (current.length === 0 && !force) return;
    if (current.length === 0) {
      current.push({ text: "", style: { ...paragraph.runs[0].style } });
    }
    lines.push({
      runs: current,
      width,
      isFirstLine: lineIndex === 0,
      pageBreakBefore: pendingPageBreak,
    });
    pendingPageBreak = false;
    current = [];
    width = 0;
    lineIndex += 1;
  };

  for (const piece of pieces) {
    if (piece.text === "\n") {
      flush(true);
      continue;
    }

    if (piece.text === "\f") {
      flush(true);
      pendingPageBreak = true;
      continue;
    }

    const safePieceText = toWinAnsiSafeText(piece.text);
    if (!safePieceText) continue;

    const safePiece = { text: safePieceText, style: piece.style };
    const font = resolvePdfFont(safePiece.style, fonts);
    let textWidth = 0;

    if (safePieceText.includes("\t")) {
      const parts = safePieceText.split("\t");
      for (let index = 0; index < parts.length; index += 1) {
        if (index > 0) {
          const tabStop = 40;
          const remainder = (width + textWidth) % tabStop;
          textWidth += remainder === 0 ? tabStop : tabStop - remainder;
        }
        if (parts[index]) {
          textWidth += font.widthOfTextAtSize(parts[index], safePiece.style.fontSize);
        }
      }
    } else {
      textWidth = font.widthOfTextAtSize(safePiece.text, safePiece.style.fontSize);
    }

    const available = Math.max(
      20,
      contentWidth -
        (lineIndex === 0
          ? Math.max(0, paragraph.firstLineIndent - paragraph.hangingIndent)
          : 0),
    );

    if (piece.text.trim() && width > 0 && width + textWidth > available) {
      flush();
    }

    // A single unbreakable token must never overflow the content area.
    if (piece.text.trim() && width === 0 && textWidth > available && !safePieceText.includes("\t")) {
      let token = "";
      for (const character of safePieceText) {
        const candidate = token + character;
        if (font.widthOfTextAtSize(candidate, safePiece.style.fontSize) > available && token) {
          current.push({ text: token, style: { ...safePiece.style } });
          width = font.widthOfTextAtSize(token, safePiece.style.fontSize);
          flush();
          token = character;
        } else {
          token = candidate;
        }
      }
      if (token) {
        current.push({ text: token, style: { ...safePiece.style } });
        width = font.widthOfTextAtSize(token, safePiece.style.fontSize);
      }
      continue;
    }

    current.push(safePiece);
    width += textWidth;
  }

  if (current.length > 0 || lines.length === 0) flush(true);
  return lines;
}

function drawTextRunLine(
  page: PDFPage,
  line: { runs: TextRun[]; width: number; isFirstLine: boolean; pageBreakBefore?: boolean },
  paragraph: ParagraphModel,
  x: number,
  y: number,
  contentWidth: number,
  fonts: Record<FontFace, PDFFont>,
): void {
  if (line.pageBreakBefore) {
    // Pagination is handled by drawParagraph; this marker is intentionally
    // carried by the line model so an inline Word page break is exact.
  }

  const indent = line.isFirstLine
    ? paragraph.firstLineIndent - paragraph.hangingIndent
    : paragraph.hangingIndent > 0
      ? -paragraph.hangingIndent
      : 0;
  const startX = x + paragraph.leftIndent + indent;
  let cursorX = startX;

  const textRuns = line.runs;
  const isJustified = paragraph.alignment === "justify" && textRuns.some((run) => /\s/.test(run.text)) && !line.runs.some((run) => run.text.endsWith("\n"));
  const whitespaceCount = isJustified
    ? textRuns.reduce((count, run) => count + (run.text.match(/ /g) ?? []).length, 0)
    : 0;
  const extraSpace = isJustified && whitespaceCount > 0 ? Math.max(0, contentWidth - paragraph.leftIndent - paragraph.rightIndent - line.width) / whitespaceCount : 0;

  for (const run of textRuns) {
    const font = resolvePdfFont(run.style, fonts);
    const text = run.text.replace(/[\f\n]/g, " ");
    if (!text) continue;

    const pieces = isJustified ? text.split(/( +)/) : [text];
    for (const piece of pieces) {
      if (!piece) continue;
      const safePiece = toWinAnsiSafeText(piece);
      
      if (safePiece.includes("\t")) {
        const tabCount = (safePiece.match(/\t/g) || []).length;
        cursorX += tabCount * 40; // Hard tab advance
        const spacesOnly = safePiece.replace(/\t/g, "");
        if (spacesOnly.length > 0) {
          cursorX += font.widthOfTextAtSize(spacesOnly, run.style.fontSize);
        }
      } else {
        const width = font.widthOfTextAtSize(safePiece, run.style.fontSize);
        page.drawText(safePiece, {
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
      
      if (/^ +$/.test(piece)) cursorX += extraSpace;
    }
  }
}

function drawParagraph(
  ctx: RenderContext,
  paragraph: ParagraphModel,
  x: number,
  contentWidth: number,
  fonts: Record<FontFace, PDFFont>,
  lines: Array<{ runs: TextRun[]; width: number; isFirstLine: boolean; pageBreakBefore?: boolean }>,
): void {
  const headingScale = paragraph.headingLevel ? Math.max(1, 1.12 - (paragraph.headingLevel - 1) * 0.03) : 1;
  const effectiveLineHeight = paragraph.lineHeight * headingScale;

  if (paragraph.pageBreakBefore) {
    ctx.addPage();
  } else {
    ctx.cursorY -= paragraph.beforeSpacing;
  }

  for (const line of lines) {
    if (line.pageBreakBefore) {
      ctx.addPage();
    }
    if (ctx.cursorY - effectiveLineHeight < ctx.bottomLimit) {
      ctx.addPage();
    }
    drawTextRunLine(ctx.page, line, paragraph, x, ctx.cursorY, contentWidth, fonts);
    ctx.cursorY -= effectiveLineHeight;
  }

  if (paragraph.bottomBorder) {
    const borderY = ctx.cursorY + effectiveLineHeight * 0.35;
    if (borderY < ctx.bottomLimit) {
      ctx.addPage();
    }
    ctx.page.drawLine({
      start: { x: x + paragraph.leftIndent, y: borderY },
      end: { x: x + contentWidth - paragraph.rightIndent, y: borderY },
      thickness: paragraph.bottomBorder.width,
      color: paragraph.bottomBorder.color,
    });
  }

  ctx.cursorY -= paragraph.afterSpacing;
}

function drawTable(
  ctx: RenderContext,
  table: TableModel,
  x: number,
  contentWidth: number,
  fonts: Record<FontFace, PDFFont>,
): void {
  const columnCount = Math.max(table.columnWidths.length, ...table.rows.map((row) => row.cells.length), 1);
  const explicitWidths = table.columnWidths.length === columnCount ? table.columnWidths : [];
  const totalExplicit = explicitWidths.reduce((sum, value) => sum + value, 0);
  const widths = explicitWidths.length === columnCount && totalExplicit > 0
    ? explicitWidths.map((value) => (value / totalExplicit) * contentWidth)
    : Array.from({ length: columnCount }, () => contentWidth / columnCount);

  for (const row of table.rows) {
    const cellHeights: number[] = [];
    for (const cell of row.cells) {
      const cellWidth = widths[cellHeights.length] ?? widths[widths.length - 1];
      const availableWidth = Math.max(1, cellWidth - 10);
      let measuredHeight = 10;

      for (const paragraph of cell.paragraphs) {
        const lines = wrapParagraphLines(paragraph, availableWidth, fonts);
        const headingScale = paragraph.headingLevel
          ? Math.max(1, 1.12 - (paragraph.headingLevel - 1) * 0.03)
          : 1;
        const lineHeight = paragraph.lineHeight * headingScale;
        measuredHeight += paragraph.beforeSpacing + lines.length * lineHeight + paragraph.afterSpacing;
      }

      cellHeights.push(Math.max(24, measuredHeight + 10));
    }
    const rowHeight = Math.max(24, ...cellHeights);

    if (ctx.cursorY - rowHeight < ctx.bottomLimit) {
      ctx.addPage();
    }

    let cursorX = x;
    const rowStartY = ctx.cursorY;
    
    row.cells.forEach((cell, index) => {
      const cellWidth = widths[index] ?? widths[widths.length - 1];
      ctx.page.drawRectangle({
        x: cursorX,
        y: rowStartY - rowHeight,
        width: cellWidth,
        height: rowHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.75, 0.75, 0.75),
      });

      let cellY = rowStartY - 12;
      for (const paragraph of cell.paragraphs) {
        const availableWidth = Math.max(1, cellWidth - 10 - paragraph.leftIndent - paragraph.rightIndent);
        const paragraphLines = wrapParagraphLines(paragraph, availableWidth, fonts);
        
        const headingScale = paragraph.headingLevel ? Math.max(1, 1.12 - (paragraph.headingLevel - 1) * 0.03) : 1;
        const effectiveLineHeight = paragraph.lineHeight * headingScale;

        cellY -= paragraph.beforeSpacing;
        for (const line of paragraphLines) {
          if (cellY < rowStartY - rowHeight + 5) break; 
          drawTextRunLine(ctx.page, line, paragraph, cursorX + 5, cellY, cellWidth - 10, fonts);
          cellY -= effectiveLineHeight;
        }
        cellY -= paragraph.afterSpacing;
      }
      cursorX += cellWidth;
    });

    ctx.cursorY -= rowHeight;
  }
}

async function readDocxXml(file: File): Promise<{
  documentXml: string;
  stylesXml: string;
  numberingXml: string;
}> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const [documentXml, stylesXml, numberingXml] = await Promise.all([
    zip.file("word/document.xml")?.async("text"),
    zip.file("word/styles.xml")?.async("text"),
    zip.file("word/numbering.xml")?.async("text"),
  ]);

  if (!documentXml) throw new Error("The DOCX file does not contain word/document.xml.");
  return {
    documentXml,
    stylesXml: stylesXml ?? "<?xml version=\"1.0\"?><styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>;",
    numberingXml: numberingXml ?? "<?xml version=\"1.0\"?><numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>;",
  };
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
    const { documentXml, stylesXml, numberingXml } = await readDocxXml(file);

    const styles = parseStyleSheet(stylesXml);
  const numbering = parseNumbering(numberingXml);
  const { blocks, section } = parseBodyBlocks(documentXml, styles, numbering);

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
      const lines = wrapParagraphLines(
        paragraph,
        contentWidth - paragraph.leftIndent - paragraph.rightIndent,
        fonts,
      );

      if (paragraph.keepWithNext) {
        let requiredHeight = paragraph.beforeSpacing + lines.length * paragraph.lineHeight + paragraph.afterSpacing;
        let nextIndex = blockIndex + 1;

        while (nextIndex < blocks.length) {
          const nextBlock = blocks[nextIndex];
          if (nextBlock.type !== "paragraph" || !nextBlock.value.keepWithNext) {
            if (nextBlock.type === "paragraph") {
              const nextLines = wrapParagraphLines(
                nextBlock.value,
                contentWidth - nextBlock.value.leftIndent - nextBlock.value.rightIndent,
                fonts,
              );
              requiredHeight +=
                nextBlock.value.beforeSpacing +
                nextLines.length * nextBlock.value.lineHeight +
                nextBlock.value.afterSpacing;
            }
            break;
          }
          const nextLines = wrapParagraphLines(
            nextBlock.value,
            contentWidth - nextBlock.value.leftIndent - nextBlock.value.rightIndent,
            fonts,
          );
          requiredHeight +=
            nextBlock.value.beforeSpacing +
            nextLines.length * nextBlock.value.lineHeight +
            nextBlock.value.afterSpacing;
          nextIndex += 1;
        }

        if (ctx.cursorY - requiredHeight < ctx.bottomLimit) {
          ctx.addPage();
        }
      }

      drawParagraph(ctx, paragraph, section.marginLeft, contentWidth, fonts, lines);
    } else {
      drawTable(ctx, block.value, section.marginLeft, contentWidth, fonts);
    }
  }

    const bytes = await pdf.save({ useObjectStreams: true });
    return new Blob([bytes], { type: "application/pdf" });
  } catch (error) {
    if (error instanceof Error && error.message) {
      throw error;
    }
    throw new Error("The Word document could not be converted to PDF.");
  }
}