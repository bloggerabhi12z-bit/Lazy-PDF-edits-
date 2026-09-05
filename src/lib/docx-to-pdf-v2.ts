import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import JSZip from "jszip";
import { renderWordToRealTextPdf } from "./docx-to-pdf";

// --- STRICT TYPES ---

type FontFace = "regular" | "bold" | "italic" | "boldItalic";
type Alignment = "left" | "center" | "right" | "justify";
type TabVal = "left" | "center" | "right" | "decimal" | "clear";

type RunStyle = {
  bold: boolean;
  italic: boolean;
  underline: "none" | "single" | "double" | "dotted" | "dashed";
  strike: boolean;
  vertAlign: "baseline" | "superscript" | "subscript";
  fontSize: number;
  fontFamily: string;
  color: RGB;
  highlight?: RGB;
  characterSpacing: number;
  caps: boolean;
  smallCaps: boolean;
};

type TextToken = { type: "text"; text: string; style: RunStyle };
type SpaceToken = { type: "space"; text: string; style: RunStyle };
type TabToken = { type: "tab"; style: RunStyle };
type FieldToken = { type: "field"; instr: string; cachedResult?: string; style: RunStyle };
type ImageToken = { type: "image"; mediaId: string; width: number; height: number; wrap: "inline" | "behind" | "front" | "square"; xOffset: number; yOffset: number };
type RunToken = TextToken | SpaceToken | TabToken | FieldToken | ImageToken;

type TabStop = { val: TabVal; pos: number };

type ParagraphModel = {
  type: "paragraph";
  tokens: RunToken[];
  alignment: Alignment;
  leftIndent: number;
  rightIndent: number;
  firstLineIndent: number;
  hangingIndent: number;
  beforeSpacing: number;
  afterSpacing: number;
  lineHeight: number;
  lineRule: "auto" | "exact" | "atLeast";
  pageBreakBefore: boolean;
  keepNext: boolean;
  keepLines: boolean;
  bulletText?: string;
  bulletStyle?: RunStyle;
  bulletLeftIndent?: number;
  bulletHangingIndent?: number;
  backgroundColor?: RGB;
  tabs: TabStop[];
};

type BorderStyle = { size: number; color: RGB; style: string };

type TableCell = {
  blocks: Block[];
  gridSpan: number;
  vMerge: "restart" | "continue" | null;
  width?: { val: number; type: "dxa" | "pct" | "auto" };
  backgroundColor?: RGB;
  margins: { top: number; bottom: number; left: number; right: number };
  borders: { top: BorderStyle; bottom: BorderStyle; left: BorderStyle; right: BorderStyle };
  vAlign: "top" | "center" | "bottom";
};

type TableRow = {
  cells: TableCell[];
  isHeader: boolean;
  exactHeight?: number;
  atLeastHeight?: number;
};

type TableModel = {
  type: "table";
  rows: TableRow[];
  columnWidths: number[];
  indent: number;
  alignment: Alignment;
};

type Block = ParagraphModel | TableModel;

type PageSection = {
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  margins: { top: number; bottom: number; left: number; right: number };
  headerDistance: number;
  footerDistance: number;
  titlePg: boolean;
  headerRelId?: string;
  footerRelId?: string;
  headerFirstRelId?: string;
  footerFirstRelId?: string;
  headerEvenRelId?: string;
  footerEvenRelId?: string;
  blocks: Block[];
};

type DocxDocument = {
  sections: PageSection[];
};

type LayoutCommand =
  | { type: "text"; text: string; x: number; y: number; font: PDFFont; size: number; color: RGB; charSpace: number; isField?: string }
  | { type: "image"; mediaId: string; x: number; y: number; w: number; h: number }
  | { type: "rect"; x: number; y: number; w: number; h: number; fillColor?: RGB; strokeColor?: RGB; lineWidth?: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; color: RGB; lineWidth: number; style: string };

type LayoutPage = {
  section: PageSection;
  commands: LayoutCommand[];
  isFirstInSection: boolean;
};

// --- CONSTANTS & CONVERSIONS ---

const TWIPS_PER_INCH = 1440;
const POINTS_PER_INCH = 72;
const EMU_PER_POINT = 12700;

function twipsToPts(twips: number): number { return (twips / TWIPS_PER_INCH) * POINTS_PER_INCH; }
function emuToPts(emus: number): number { return emus / EMU_PER_POINT; }

function parseHexColor(value: string | undefined, fallback?: RGB): RGB | undefined {
  if (!value || value === "auto" || value === "nil") return fallback;
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/i.test(hex)) return fallback;
  return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
}

function resolveRelativePath(basePath: string, targetPath: string): string {
  const decodedTarget = targetPath.split("/").map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  }).join("/");
  if (decodedTarget.startsWith("/")) return decodedTarget.substring(1);
  const baseParts = basePath.split("/").slice(0, -1);
  const targetParts = decodedTarget.split("/");
  for (const part of targetParts) {
    if (part === "..") baseParts.pop();
    else if (part !== ".") baseParts.push(part);
  }
  return baseParts.join("/");
}

// --- IMAGE HANDLING & CONVERSION ---

function sniffImageType(bytes: Uint8Array): { type: "png" | "jpeg" | "gif" | "bmp" | "webp" | "tiff" | "unsupported", mime?: string } {
  if (bytes.length < 4) return { type: "unsupported" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return { type: "png", mime: "image/png" };
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return { type: "jpeg", mime: "image/jpeg" };
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { type: "gif", mime: "image/gif" };
  if (bytes[0] === 0x42 && bytes[1] === 0x4D) return { type: "bmp", mime: "image/bmp" };
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return { type: "webp", mime: "image/webp" };
  if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4D && bytes[1] === 0x4D)) return { type: "tiff", mime: "image/tiff" };
  return { type: "unsupported" };
}

/** 
 * Uses HTML Canvas to convert unsupported web/legacy images (WebP, GIF, BMP, TIFF) 
 * into standard PNG bytes compatible with pdf-lib. 
 */
async function convertImageToPng(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const safeBuffer = new ArrayBuffer(bytes.byteLength);
new Uint8Array(safeBuffer).set(bytes);

const blob = new Blob([safeBuffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error("Canvas 2D context not available"));
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((outBlob) => {
        URL.revokeObjectURL(url);
        if (!outBlob) return reject(new Error("Canvas to Blob failed"));
        outBlob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for conversion"));
    };
    img.src = url;
  });
}

// --- XML PARSER HELPERS ---

function localName(node: Element): string { return node.localName ?? node.nodeName.split(":").pop() ?? ""; }
function child(node: Element | null, name: string): Element | null {
  if (!node) return null;
  for (const c of Array.from(node.children)) if (localName(c) === name) return c;
  return null;
}
function children(node: Element | null, name: string): Element[] {
  if (!node) return [];
  return Array.from(node.children).filter((c) => localName(c) === name);
}
function attr(node: Element | null, name: string): string | undefined {
  if (!node) return undefined;
  for (const a of Array.from(node.attributes)) if (localName(a as unknown as Element) === name) return a.value;
  return undefined;
}
function parseBool(node: Element | null): boolean {
  if (!node) return false;
  const val = attr(node, "val");
  return val === undefined || val === "true" || val === "1" || val === "on";
}

function parseRels(xmlStr: string): Map<string, string> {
  const map = new Map<string, string>();
  const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
  for (const rel of children(doc.documentElement, "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

// --- DOCX PARSER ---

class DocxParser {
  private styles = new Map<string, Element>();
  private numbering = new Map<string, Element>();
  private listCounters = new Map<string, number[]>();

  constructor(stylesXml: Document | null, numXml: Document | null) {
    if (stylesXml) {
      for (const style of children(stylesXml.documentElement, "style")) {
        const id = attr(style, "styleId");
        if (id) this.styles.set(id, style);
      }
    }
    if (numXml) {
      const abstracts = new Map<string, Element>();
      for (const abs of children(numXml.documentElement, "abstractNum")) {
        const id = attr(abs, "abstractNumId");
        if (id) abstracts.set(id, abs);
      }
      for (const num of children(numXml.documentElement, "num")) {
        const numId = attr(num, "numId");
        const absId = attr(child(num, "abstractNumId"), "val");
        if (numId && absId && abstracts.has(absId)) {
          this.numbering.set(numId, abstracts.get(absId)!);
        }
      }
    }
  }

  private resolveStyle(styleId?: string): { pPr: Element | null; rPr: Element | null } {
    if (!styleId || !this.styles.has(styleId)) return { pPr: null, rPr: null };
    const styleNode = this.styles.get(styleId)!;
    const basedOn = attr(child(styleNode, "basedOn"), "val");
    const parent = this.resolveStyle(basedOn);
    return {
      pPr: child(styleNode, "pPr") || parent.pPr,
      rPr: child(styleNode, "rPr") || parent.rPr,
    };
  }

  private getRunStyle(rPr: Element | null, base: RunStyle): RunStyle {
    const s = { ...base };
    if (!rPr) return s;

    if (child(rPr, "b")) s.bold = parseBool(child(rPr, "b"));
    if (child(rPr, "i")) s.italic = parseBool(child(rPr, "i"));
    
    const u = child(rPr, "u");
    if (u) {
      const val = attr(u, "val");
      s.underline = val === "double" ? "double" : val === "dotted" ? "dotted" : val === "dashed" ? "dashed" : val !== "none" ? "single" : "none";
    }
    
    if (child(rPr, "strike")) s.strike = parseBool(child(rPr, "strike"));

    const vertAlign = attr(child(rPr, "vertAlign"), "val");
    if (vertAlign === "superscript" || vertAlign === "subscript") s.vertAlign = vertAlign;

    const sz = attr(child(rPr, "sz"), "val");
    if (sz) s.fontSize = parseInt(sz, 10) / 2;

    const color = attr(child(rPr, "color"), "val");
    if (color) s.color = parseHexColor(color, s.color)!;

    const highlight = attr(child(rPr, "highlight"), "val");
    if (highlight && highlight !== "none") {
      const hColorMap: Record<string, RGB> = { yellow: rgb(1,1,0), green: rgb(0,1,0), cyan: rgb(0,1,1), magenta: rgb(1,0,1), blue: rgb(0,0,1), red: rgb(1,0,0), darkBlue: rgb(0,0,0.5), darkCyan: rgb(0,0.5,0.5), darkGreen: rgb(0,0.5,0), darkMagenta: rgb(0.5,0,0.5), darkRed: rgb(0.5,0,0), darkYellow: rgb(0.5,0.5,0), darkGray: rgb(0.5,0.5,0.5), lightGray: rgb(0.75,0.75,0.75), black: rgb(0,0,0) };
      s.highlight = hColorMap[highlight] || rgb(1,1,0);
    }

    const spacing = attr(child(rPr, "spacing"), "val");
    if (spacing) s.characterSpacing = twipsToPts(parseInt(spacing, 10));

    const rFonts = child(rPr, "rFonts");
    const font = attr(rFonts, "ascii") || attr(rFonts, "hAnsi") || attr(rFonts, "cs") || attr(rFonts, "eastAsia");
    if (font) s.fontFamily = font;

    if (parseBool(child(rPr, "smallCaps"))) s.smallCaps = true;
    if (parseBool(child(rPr, "caps"))) s.caps = true;

    return s;
  }

  private parseListCounter(numId: string, ilvlStr: string, lvlNode: Element): string {
    const ilvl = parseInt(ilvlStr, 10);
    if (!this.listCounters.has(numId)) {
      this.listCounters.set(numId, [0,0,0,0,0,0,0,0,0]);
    }
    const counters = this.listCounters.get(numId)!;
    
    for (let i = ilvl + 1; i < 9; i++) counters[i] = 0;
    
    const startNode = child(lvlNode, "start");
    const start = startNode ? parseInt(attr(startNode, "val") || "1", 10) : 1;
    
    if (counters[ilvl] === 0) {
      counters[ilvl] = start;
    } else {
      counters[ilvl]++;
    }

    const lvlText = attr(child(lvlNode, "lvlText"), "val") || "";
    return lvlText.replace(/%(\d+)/g, (match, level) => {
       const lIdx = parseInt(level, 10) - 1;
       return String(counters[lIdx] || 1);
    });
  }

  public parseDocument(body: Element, rels: Map<string, string>, partPath: string): DocxDocument {
    const sections: PageSection[] = [];
    let currentBlocks: Block[] = [];

    const flushSection = (sectPr: Element | null) => {
      const pgSz = sectPr ? child(sectPr, "pgSz") : null;
      const pgMar = sectPr ? child(sectPr, "pgMar") : null;
      const orient = attr(pgSz, "orient") === "landscape" ? "landscape" : "portrait";
      const w = twipsToPts(parseInt(attr(pgSz, "w") || "12240", 10));
      const h = twipsToPts(parseInt(attr(pgSz, "h") || "15840", 10));

      const headerRefs = sectPr ? children(sectPr, "headerReference") : [];
      const footerRefs = sectPr ? children(sectPr, "footerReference") : [];

      sections.push({
        width: orient === "landscape" ? Math.max(w, h) : Math.min(w, h),
        height: orient === "landscape" ? Math.min(w, h) : Math.max(w, h),
        orientation: orient,
        margins: {
          top: twipsToPts(parseInt(attr(pgMar, "top") || "1440", 10)),
          bottom: twipsToPts(parseInt(attr(pgMar, "bottom") || "1440", 10)),
          left: twipsToPts(parseInt(attr(pgMar, "left") || "1440", 10)),
          right: twipsToPts(parseInt(attr(pgMar, "right") || "1440", 10)),
        },
        headerDistance: twipsToPts(parseInt(attr(pgMar, "header") || "720", 10)),
        footerDistance: twipsToPts(parseInt(attr(pgMar, "footer") || "720", 10)),
        titlePg: sectPr ? parseBool(child(sectPr, "titlePg")) : false,
        headerRelId: (headerRefs.find(r => attr(r, "type") === "default") || headerRefs[0])?.getAttribute("r:id") ?? undefined,
        footerRelId: (footerRefs.find(r => attr(r, "type") === "default") || footerRefs[0])?.getAttribute("r:id") ?? undefined,
        headerFirstRelId: headerRefs.find(r => attr(r, "type") === "first")?.getAttribute("r:id") ?? undefined,
        footerFirstRelId: footerRefs.find(r => attr(r, "type") === "first")?.getAttribute("r:id") ?? undefined,
        headerEvenRelId: headerRefs.find(r => attr(r, "type") === "even")?.getAttribute("r:id") ?? undefined,
        footerEvenRelId: footerRefs.find(r => attr(r, "type") === "even")?.getAttribute("r:id") ?? undefined,
        blocks: currentBlocks,
      });
      currentBlocks = [];
    };

    const nodes = Array.from(body.children);
    for (let i = 0; i < nodes.length; i++) {
      const childNode = nodes[i];
      const name = localName(childNode);
      if (name === "p") {
        const pPr = child(childNode, "pPr");
        const sectPr = child(pPr, "sectPr");
        
        currentBlocks.push(this.parseParagraph(childNode, rels, partPath));
        if (sectPr) flushSection(sectPr);
      } else if (name === "tbl") {
        currentBlocks.push(this.parseTable(childNode, rels, partPath));
      } else if (name === "sectPr") {
        flushSection(childNode);
      }
    }
    
    if (currentBlocks.length > 0 && sections.length === 0) {
        flushSection(child(body, "sectPr") || null);
        if (sections.length === 0) {
          flushSection(null);
        }
    } else if (currentBlocks.length > 0 && sections.length > 0) {
        sections[sections.length - 1].blocks.push(...currentBlocks);
    }

    return { sections };
  }

  public parseBlocks(node: Element, rels: Map<string, string>, partPath: string): Block[] {
    const blocks: Block[] = [];
    for (const childNode of Array.from(node.children)) {
      const name = localName(childNode);
      if (name === "p") blocks.push(this.parseParagraph(childNode, rels, partPath));
      if (name === "tbl") blocks.push(this.parseTable(childNode, rels, partPath));
    }
    return blocks;
  }

  private parseParagraph(node: Element, rels: Map<string, string>, partPath: string): ParagraphModel {
    const pPr = child(node, "pPr");
    const styleId = attr(child(pPr, "pStyle"), "val");
    const defaults = this.resolveStyle(styleId);

    const activePpr = pPr || defaults.pPr;
    const spacing = child(activePpr, "spacing");
    let ind = child(activePpr, "ind");
    const jc = attr(child(activePpr, "jc"), "val") || "left";

    const baseRunStyle: RunStyle = this.getRunStyle(defaults.rPr, {
      bold: false, italic: false, underline: "none", strike: false, vertAlign: "baseline",
      fontSize: 11, fontFamily: "Helvetica", color: rgb(0, 0, 0), characterSpacing: 0, caps: false, smallCaps: false
    });

    const tokens: RunToken[] = [];
    let inField = false;
    let instrBuffer = "";
    let cachedResult = "";

    const processRun = (rNode: Element) => {
      const rPr = child(rNode, "rPr");
      const style = this.getRunStyle(rPr, baseRunStyle);

      for (const tNode of Array.from(rNode.children)) {
        const tName = localName(tNode);
        if (tName === "fldChar") {
          const type = attr(tNode, "fldCharType");
          if (type === "begin") { inField = true; instrBuffer = ""; cachedResult = ""; }
          else if (type === "separate") { /* start capturing result */ }
          else if (type === "end") {
            inField = false;
            tokens.push({ type: "field", instr: instrBuffer.trim(), cachedResult, style });
          }
        } else if (tName === "instrText") {
          if (inField) instrBuffer += tNode.textContent || "";
        } else if (tName === "t") {
          let raw = tNode.textContent || "";
          if (style.caps || style.smallCaps) raw = raw.toUpperCase();

          if (inField) cachedResult += raw;
          else {
            const matches = raw.match(/([ \t]+)|([^ \t]+)/g) || [];
            for (const m of matches) {
              if (m.trim() === "") {
                for (const char of m) {
                  if (char === "\t") tokens.push({ type: "tab", style });
                  else tokens.push({ type: "space", text: " ", style });
                }
              } else {
                tokens.push({ type: "text", text: m, style });
              }
            }
          }
        } else if (tName === "tab") {
          tokens.push({ type: "tab", style });
        } else if (tName === "br") {
          tokens.push({ type: "text", text: attr(tNode, "type") === "page" ? "\f" : "\n", style });
        } else if (tName === "drawing" || tName === "pict") {
          let extent = child(child(child(tNode, "inline") || child(tNode, "anchor"), "extent"), "extent") || child(child(tNode, "inline") || child(tNode, "anchor"), "extent");
          let blip = child(child(child(child(tNode, "inline") || child(tNode, "anchor"), "graphic"), "graphicData"), "pic");
          if (!blip) return;

          const embedId = attr(child(child(blip, "blipFill"), "blip"), "embed") || attr(blip, "id");
          const anchor = child(tNode, "anchor");
          let wrap: ImageToken["wrap"] = "inline";
          let xOffset = 0, yOffset = 0;

          if (anchor) {
            wrap = child(anchor, "wrapNone") ? "front" : child(anchor, "wrapSquare") ? "square" : "front";
            if (attr(child(child(anchor, "positionH"), "posOffset"), "val")) xOffset = emuToPts(parseInt(child(child(anchor, "positionH"), "posOffset")!.textContent || "0"));
            if (attr(child(child(anchor, "positionV"), "posOffset"), "val")) yOffset = emuToPts(parseInt(child(child(anchor, "positionV"), "posOffset")!.textContent || "0"));
          }

          if (extent && embedId && rels.has(embedId)) {
            tokens.push({
              type: "image",
              mediaId: resolveRelativePath(partPath, rels.get(embedId)!),
              width: emuToPts(parseInt(attr(extent, "cx") || "0", 10)),
              height: emuToPts(parseInt(attr(extent, "cy") || "0", 10)),
              wrap, xOffset, yOffset
            });
          }
        }
      }
    };

    const collectRecursive = (node: Element) => {
      for (const c of Array.from(node.children)) {
        if (localName(c) === "r") processRun(c);
        else if (localName(c) === "hyperlink" || localName(c) === "smartTag" || localName(c) === "sdt") collectRecursive(localName(c) === "sdt" ? child(c, "sdtContent") || c : c);
        else if (localName(c) === "fldSimple") {
           tokens.push({ type: "field", instr: attr(c, "instr") || "", cachedResult: c.textContent || "", style: baseRunStyle });
        }
      }
    };
    collectRecursive(node);

    let bulletText, bulletStyle, bulletLeftIndent, bulletHangingIndent;
    const numPr = child(activePpr, "numPr");
    if (numPr) {
      const numId = attr(child(numPr, "numId"), "val");
      const ilvl = attr(child(numPr, "ilvl"), "val") || "0";
      if (numId && this.numbering.has(numId)) {
        const abs = this.numbering.get(numId)!;
        const lvl = children(abs, "lvl").find((l) => attr(l, "ilvl") === ilvl);
        if (lvl) {
          const pPrLvl = child(lvl, "pPr");
          const indLvl = child(pPrLvl, "ind");
          if (indLvl && !ind) ind = indLvl;

          const fmt = attr(child(lvl, "numFmt"), "val");
          bulletStyle = this.getRunStyle(child(lvl, "rPr"), baseRunStyle);
          
          if (ind) {
             bulletLeftIndent = twipsToPts(parseInt(attr(ind, "left") || "0", 10));
             bulletHangingIndent = twipsToPts(parseInt(attr(ind, "hanging") || "0", 10));
          }

          if (fmt === "bullet") {
            bulletText = attr(child(lvl, "lvlText"), "val") || "•";
          } else {
            bulletText = this.parseListCounter(numId, ilvl, lvl);
          }
        }
      }
    }

    const tabs: TabStop[] = children(child(activePpr, "tabs"), "tab").map(t => ({
      val: (attr(t, "val") as TabVal) || "left",
      pos: twipsToPts(parseInt(attr(t, "pos") || "0", 10))
    }));

    const shd = attr(child(activePpr, "shd"), "fill");
    const lineRule = attr(spacing, "lineRule") as ParagraphModel["lineRule"] || "auto";
    const line = parseInt(attr(spacing, "line") || "240", 10);
    const lh = lineRule === "auto" ? line / 240 : twipsToPts(line);

    return {
      type: "paragraph",
      tokens,
      alignment: (jc === "both" || jc === "distribute" ? "justify" : jc) as Alignment,
      leftIndent: twipsToPts(parseInt(attr(ind, "left") || "0", 10)),
      rightIndent: twipsToPts(parseInt(attr(ind, "right") || "0", 10)),
      firstLineIndent: twipsToPts(parseInt(attr(ind, "firstLine") || "0", 10)),
      hangingIndent: twipsToPts(parseInt(attr(ind, "hanging") || "0", 10)),
      beforeSpacing: twipsToPts(parseInt(attr(spacing, "before") || "0", 10)),
      afterSpacing: twipsToPts(parseInt(attr(spacing, "after") || "0", 10)),
      lineHeight: lh,
      lineRule,
      pageBreakBefore: parseBool(child(activePpr, "pageBreakBefore")),
      keepNext: parseBool(child(activePpr, "keepNext")),
      keepLines: parseBool(child(activePpr, "keepLines")),
      bulletText,
      bulletStyle,
      bulletLeftIndent,
      bulletHangingIndent,
      backgroundColor: parseHexColor(shd),
      tabs
    };
  }

  private parseTable(node: Element, rels: Map<string, string>, partPath: string): TableModel {
    const tblGrid = child(node, "tblGrid");
    const columnWidths = children(tblGrid, "gridCol").map((c) => twipsToPts(parseInt(attr(c, "w") || "0", 10)));

    const tblPr = child(node, "tblPr");
    const tblInd = twipsToPts(parseInt(attr(child(tblPr, "tblInd"), "w") || "0", 10));
    const tblJc = attr(child(tblPr, "jc"), "val") as Alignment || "left";

    const defaultBorders = child(tblPr, "tblBorders");

    const rows: TableRow[] = [];
    for (const tr of children(node, "tr")) {
      const trPr = child(tr, "trPr");
      const isHeader = parseBool(child(trPr, "tblHeader"));
      const trHeight = child(trPr, "trHeight");
      const exactHeight = trHeight && attr(trHeight, "hRule") === "exact" ? twipsToPts(parseInt(attr(trHeight, "val") || "0", 10)) : undefined;
      const atLeastHeight = trHeight && attr(trHeight, "hRule") === "atLeast" ? twipsToPts(parseInt(attr(trHeight, "val") || "0", 10)) : undefined;

      const cells: TableCell[] = [];
      const tcs = children(tr, "tc");
      
      if (tcs.length === 0) continue; 

      for (const tc of tcs) {
        const tcPr = child(tc, "tcPr");
        const tcW = child(tcPr, "tcW");
        let width: TableCell["width"];
        if (tcW) {
          const type = attr(tcW, "type") as "dxa" | "pct" | "auto" | undefined;
          const val = parseInt(attr(tcW, "w") || "0", 10);
          if (type && type !== "auto") width = { type, val };
        }

        const gridSpan = parseInt(attr(child(tcPr, "gridSpan"), "val") || "1", 10);
        const vMergeNode = child(tcPr, "vMerge");
        const vMerge = vMergeNode ? (attr(vMergeNode, "val") === "restart" ? "restart" : "continue") : null;
        
        const shd = attr(child(tcPr, "shd"), "fill");
        const tcMar = child(tcPr, "tcMar");
        const vAlign = attr(child(tcPr, "vAlign"), "val") as TableCell["vAlign"] || "top";

        const tcBorders = child(tcPr, "tcBorders");
        const parseBorder = (side: string): BorderStyle => {
           const b = child(tcBorders, side) || child(defaultBorders, side);
           if (!b || attr(b, "val") === "none" || attr(b, "val") === "nil") return { size: 0, color: rgb(0,0,0), style: "none" };
           return {
             size: Math.max(0.5, parseInt(attr(b, "sz") || "4", 10) / 8),
             color: parseHexColor(attr(b, "color"), rgb(0,0,0))!,
             style: attr(b, "val") || "single"
           };
        };

        cells.push({
          blocks: this.parseBlocks(tc, rels, partPath),
          width,
          gridSpan,
          vMerge,
          backgroundColor: parseHexColor(shd),
          margins: {
            top: twipsToPts(parseInt(attr(child(tcMar, "top"), "w") || "72", 10)),
            bottom: twipsToPts(parseInt(attr(child(tcMar, "bottom"), "w") || "72", 10)),
            left: twipsToPts(parseInt(attr(child(tcMar, "left"), "w") || "72", 10)),
            right: twipsToPts(parseInt(attr(child(tcMar, "right"), "w") || "72", 10)),
          },
          borders: { top: parseBorder("top"), bottom: parseBorder("bottom"), left: parseBorder("left"), right: parseBorder("right") },
          vAlign
        });
      }
      rows.push({ cells, isHeader, exactHeight, atLeastHeight });
    }

    return { type: "table", rows, columnWidths, indent: tblInd, alignment: tblJc };
  }
}

// --- LAYOUT ENGINE ---

class PdfLayoutEngine {
  public pages: LayoutPage[] = [];
  public currentCmds: LayoutCommand[] = [];
  public cursorY = 0;
  
  constructor(
    private fonts: Record<string, PDFFont>,
    private globalImageMap: Map<string, { type: "png"|"jpeg"|"unsupported", bytes: Uint8Array }>,
    private isHeaderFooter = false,
    private forcePageTopY?: number
  ) {}

  private resolveFont(style: RunStyle): PDFFont {
    const family = (style.fontFamily || "Helvetica").toLowerCase();
    let weightStyle = "";
    if (style.bold && style.italic) weightStyle = "-bolditalic";
    else if (style.bold) weightStyle = "-bold";
    else if (style.italic) weightStyle = "-italic";

    // 1. Try exact custom font mapping
    const exactMatch = this.fonts[`${family}${weightStyle}`];
    if (exactMatch) return exactMatch;

    // 2. Try regular family fallback
    const familyMatch = this.fonts[family];
    if (familyMatch) return familyMatch;

    // 3. Built-in StandardFonts mapping fallback
    if (family.includes("times") || family.includes("georgia") || family.includes("cambria")) {
      if (style.bold && style.italic) return this.fonts["TimesRomanBoldItalic"] || this.fonts["HelveticaBoldOblique"] || this.fonts["Helvetica"];
      if (style.bold) return this.fonts["TimesRomanBold"] || this.fonts["HelveticaBold"];
      if (style.italic) return this.fonts["TimesRomanOblique"] || this.fonts["HelveticaOblique"];
      return this.fonts["TimesRoman"] || this.fonts["Helvetica"];
    }
    if (family.includes("courier") || family.includes("mono") || family.includes("consolas")) {
      if (style.bold && style.italic) return this.fonts["CourierBoldItalic"] || this.fonts["HelveticaBoldOblique"];
      if (style.bold) return this.fonts["CourierBold"] || this.fonts["HelveticaBold"];
      if (style.italic) return this.fonts["CourierOblique"] || this.fonts["HelveticaOblique"];
      return this.fonts["Courier"] || this.fonts["Helvetica"];
    }

    // Ultimate fallback
    if (style.bold && style.italic) return this.fonts["HelveticaBoldOblique"];
    if (style.bold) return this.fonts["HelveticaBold"];
    if (style.italic) return this.fonts["HelveticaOblique"];
    return this.fonts["Helvetica"];
  }

  public layoutDocument(doc: DocxDocument) {
    for (let sIdx = 0; sIdx < doc.sections.length; sIdx++) {
      const section = doc.sections[sIdx];
      this.addPage(section, true);
      this.layoutBlocks(section.blocks, section.margins.left, section.width - section.margins.right, section, false);
    }
    this.flushPage();
  }

  public layoutHeadersFooters(doc: DocxDocument, headerBlocksMap: Map<string, Block[]>, footerBlocksMap: Map<string, Block[]>) {
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      const s = page.section;
      const isFirst = page.isFirstInSection && s.titlePg;
      
      const hId = (isFirst && s.headerFirstRelId) ? s.headerFirstRelId : s.headerRelId;
      if (hId && headerBlocksMap.has(hId)) {
        this.currentCmds = [];
        this.cursorY = s.headerDistance; 
        this.layoutBlocks(headerBlocksMap.get(hId)!, s.margins.left, s.width - s.margins.right, s, true, i+1, this.pages.length);
        page.commands.push(...this.currentCmds);
      }

      const fId = (isFirst && s.footerFirstRelId) ? s.footerFirstRelId : s.footerRelId;
      if (fId && footerBlocksMap.has(fId)) {
        this.currentCmds = [];
        const sandbox = new PdfLayoutEngine(this.fonts, this.globalImageMap, true, 0);
        sandbox.layoutBlocks(footerBlocksMap.get(fId)!, s.margins.left, s.width - s.margins.right, s, true, i+1, this.pages.length);
        const fHeight = Math.max(0, sandbox.cursorY);
        
        this.cursorY = s.height - s.footerDistance - fHeight;
        this.layoutBlocks(footerBlocksMap.get(fId)!, s.margins.left, s.width - s.margins.right, s, true, i+1, this.pages.length);
        page.commands.push(...this.currentCmds);
      }
    }
  }

  private addPage(section: PageSection, isFirstInSection = false) {
    if (this.isHeaderFooter) return; 
    this.flushPage();
    this.pages.push({ section, commands: [], isFirstInSection });
    this.cursorY = this.forcePageTopY ?? section.margins.top;
  }

  private flushPage() {
    if (this.currentCmds.length > 0 && this.pages.length > 0) {
      this.pages[this.pages.length - 1].commands.push(...this.currentCmds);
    }
    this.currentCmds = [];
  }

  public layoutBlocks(blocks: Block[], startX: number, endX: number, section: PageSection, isHF: boolean, pageNum = 1, totalPages = 1) {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      
      if (b.type === "paragraph" && b.keepNext && i < blocks.length - 1 && !isHF) {
         let groupH = 0;
         let checkIdx = i;
         while (checkIdx < blocks.length && blocks[checkIdx].type === "paragraph") {
            const sandbox = new PdfLayoutEngine(this.fonts, this.globalImageMap, true, 0);
            sandbox.layoutParagraph(blocks[checkIdx] as ParagraphModel, startX, endX, section, true, pageNum, totalPages);
            groupH += Math.max(0, sandbox.cursorY);
            if (!(blocks[checkIdx] as ParagraphModel).keepNext) break;
            checkIdx++;
         }
         if (this.cursorY + groupH > section.height - section.margins.bottom) this.addPage(section);
      }

      if (b.type === "paragraph") this.layoutParagraph(b, startX, endX, section, isHF, pageNum, totalPages);
      if (b.type === "table") this.layoutTable(b, startX, endX, section, isHF, pageNum, totalPages);
    }
  }

  private getNextTab(currentX: number, startX: number, tabs: TabStop[]): { x: number, val: TabVal } {
    const relX = currentX - startX;
    for (const t of tabs) {
      if (t.pos > relX + 1) return { x: startX + t.pos, val: t.val };
    }
    const defaultTab = 36;
    const next = Math.ceil((relX + 1) / defaultTab) * defaultTab;
    return { x: startX + next, val: "left" };
  }

  private layoutParagraph(p: ParagraphModel, startX: number, endX: number, section: PageSection, isHF: boolean, pageNum: number, totalPages: number) {
    if (p.pageBreakBefore && !isHF) this.addPage(section);
    this.cursorY += p.beforeSpacing;

    let lineX = startX + p.leftIndent + p.firstLineIndent - p.hangingIndent;
    let availWidth = endX - lineX;

    if (p.bulletText) {
      const font = this.resolveFont(p.bulletStyle!);
      const bX = startX + (p.bulletLeftIndent ?? p.leftIndent) - (p.bulletHangingIndent ?? p.hangingIndent);
      this.currentCmds.push({
        type: "text", text: p.bulletText, x: bX, y: this.cursorY + (p.bulletStyle!.fontSize * 0.8), font, size: p.bulletStyle!.fontSize, color: p.bulletStyle!.color, charSpace: p.bulletStyle!.characterSpacing
      });
    }

    type LineData = { tokens: RunToken[]; width: number; height: number; isLast: boolean };
    const lines: LineData[] = [];
    let currentLine: RunToken[] = [];
    let currentLineWidth = 0;
    
    let maxFontSize = 11;

    const pushLine = (isLast = false) => {
       if (currentLine.length === 0 && !isLast && lines.length === 0) return;
       const lh = p.lineRule === "auto" ? maxFontSize * p.lineHeight : p.lineHeight;
       lines.push({ tokens: currentLine, width: currentLineWidth, height: lh, isLast });
       currentLine = [];
       currentLineWidth = 0;
       maxFontSize = 11;
       lineX = startX + p.leftIndent; 
       availWidth = endX - lineX;
    };

    for (const tok of p.tokens) {
      if (tok.type === "text" || tok.type === "space") {
        if (tok.type === "text" && tok.text === "\f") { pushLine(true); if (!isHF) this.addPage(section); continue; }
        if (tok.type === "text" && tok.text === "\n") { pushLine(true); continue; }

        const font = this.resolveFont(tok.style);
        const scale = (tok.style.vertAlign !== "baseline") ? 0.6 : 1;
        const actualSize = tok.style.fontSize * scale;
        maxFontSize = Math.max(maxFontSize, actualSize);
        
        const w = font.widthOfTextAtSize(tok.text, actualSize) + (tok.text.length * tok.style.characterSpacing);

        if (currentLineWidth + w > availWidth && currentLineWidth > 0 && tok.type !== "space") {
          pushLine();
        }
        currentLine.push(tok);
        currentLineWidth += w;
        
      } else if (tok.type === "tab") {
        const nextTab = this.getNextTab(lineX + currentLineWidth, startX, p.tabs);
        const w = nextTab.x - (lineX + currentLineWidth);
        currentLine.push(tok);
        currentLineWidth += w;
      } else if (tok.type === "field") {
        let txt = tok.cachedResult || "";
        if (tok.instr.includes("PAGE")) txt = String(pageNum);
        if (tok.instr.includes("NUMPAGES")) txt = String(totalPages);
        
        const font = this.resolveFont(tok.style);
        const w = font.widthOfTextAtSize(txt, tok.style.fontSize) + (txt.length * tok.style.characterSpacing);
        if (currentLineWidth + w > availWidth && currentLineWidth > 0) pushLine();
        currentLine.push({ type: "field", instr: tok.instr, cachedResult: txt, style: tok.style });
        currentLineWidth += w;
        maxFontSize = Math.max(maxFontSize, tok.style.fontSize);
      } else if (tok.type === "image") {
        if (tok.wrap !== "inline") {
           this.currentCmds.push({ type: "image", mediaId: tok.mediaId, x: startX + tok.xOffset, y: this.cursorY + tok.yOffset, w: tok.width, h: tok.height });
        } else {
           if (currentLineWidth + tok.width > availWidth && currentLineWidth > 0) pushLine();
           currentLine.push(tok);
           currentLineWidth += tok.width;
           maxFontSize = Math.max(maxFontSize, tok.height); 
        }
      }
    }
    pushLine(true);

    for (const line of lines) {
      if (this.cursorY + line.height > section.height - section.margins.bottom && !isHF) {
        this.addPage(section);
        this.cursorY += p.beforeSpacing;
      }

      let cx = startX + p.leftIndent + (lines.indexOf(line) === 0 ? p.firstLineIndent - p.hangingIndent : 0);
      
      let spaceAdjustment = 0;
      if (p.alignment === "center") cx += (availWidth - line.width) / 2;
      else if (p.alignment === "right") cx += availWidth - line.width;
      else if (p.alignment === "justify" && !line.isLast) {
         const spaces = line.tokens.filter(t => t.type === "space").length;
         if (spaces > 0) spaceAdjustment = (availWidth - line.width) / spaces;
      }

      if (p.backgroundColor) {
         this.currentCmds.push({ type: "rect", x: startX + p.leftIndent, y: this.cursorY, w: endX - startX - p.leftIndent - p.rightIndent, h: line.height, fillColor: p.backgroundColor });
      }

      for (const tok of line.tokens) {
        if (tok.type === "space") {
          const font = this.resolveFont(tok.style);
          cx += font.widthOfTextAtSize(" ", tok.style.fontSize) + tok.style.characterSpacing + spaceAdjustment;
        } else if (tok.type === "tab") {
          const nextTab = this.getNextTab(cx, startX, p.tabs);
          cx = nextTab.x;
        } else if (tok.type === "text" || tok.type === "field") {
          const text = tok.type === "field" ? tok.cachedResult! : tok.text;
          const font = this.resolveFont(tok.style);
          const scale = (tok.style.vertAlign !== "baseline") ? 0.6 : 1;
          const actualSize = tok.style.fontSize * scale;
          const w = font.widthOfTextAtSize(text, actualSize) + (text.length * tok.style.characterSpacing);
          
          let yOffset = 0;
          if (tok.style.vertAlign === "superscript") yOffset = -(tok.style.fontSize * 0.4);
          if (tok.style.vertAlign === "subscript") yOffset = tok.style.fontSize * 0.2;

          if (tok.style.highlight) {
             this.currentCmds.push({ type: "rect", x: cx, y: this.cursorY, w, h: line.height, fillColor: tok.style.highlight });
          }

          this.currentCmds.push({
            type: "text", text: text, x: cx, y: this.cursorY + (tok.style.fontSize * 0.8) + yOffset, font, size: actualSize, color: tok.style.color, charSpace: tok.style.characterSpacing, isField: tok.type === "field" ? tok.instr : undefined
          });

          if (tok.style.underline !== "none") {
            const ut = tok.style.underline === "double" ? 1.5 : 0.5;
            const uy = this.cursorY + (tok.style.fontSize * 0.8) + yOffset + 2;
            this.currentCmds.push({ type: "line", x1: cx, y1: uy, x2: cx + w, y2: uy, color: tok.style.color, lineWidth: ut, style: tok.style.underline });
            if (tok.style.underline === "double") {
              this.currentCmds.push({ type: "line", x1: cx, y1: uy + 2, x2: cx + w, y2: uy + 2, color: tok.style.color, lineWidth: ut, style: "single" });
            }
          }
          if (tok.style.strike) {
             const sy = this.cursorY + (tok.style.fontSize * 0.8) + yOffset - (actualSize * 0.3);
             this.currentCmds.push({ type: "line", x1: cx, y1: sy, x2: cx + w, y2: sy, color: tok.style.color, lineWidth: 0.5, style: "single" });
          }
          cx += w;
        } else if (tok.type === "image") {
           this.currentCmds.push({ type: "image", mediaId: tok.mediaId, x: cx, y: this.cursorY + line.height - tok.height, w: tok.width, h: tok.height });
           cx += tok.width;
        }
      }
      this.cursorY += line.height;
    }
    
    if (lines.length === 0) {
      this.cursorY += (p.lineRule === "auto" ? 11 * p.lineHeight : p.lineHeight);
    }
    
    this.cursorY += p.afterSpacing;
  }

  private layoutTable(t: TableModel, startX: number, endX: number, section: PageSection, isHF: boolean, pageNum: number, totalPages: number) {
    const tableX = startX + t.indent;
    let tableWidth = t.columnWidths.reduce((a, b) => a + b, 0);
    const availX = endX - startX;
    if (tableWidth === 0 || tableWidth > availX) tableWidth = availX;

    let tableOffsetX = tableX;
    if (t.alignment === "center") tableOffsetX += (availX - tableWidth) / 2;
    if (t.alignment === "right") tableOffsetX += availX - tableWidth;

    const measureCell = (cell: TableCell, cellW: number): number => {
      const sandbox = new PdfLayoutEngine(this.fonts, this.globalImageMap, true, 0);
      sandbox.layoutBlocks(cell.blocks, 0, cellW - cell.margins.left - cell.margins.right, section, true, pageNum, totalPages);
      return sandbox.cursorY;
    };

    const headerRows = t.rows.filter(r => r.isHeader);
    const grid: { cell: TableCell, w: number, startY: number, h: number }[][] = [];
    for (let r = 0; r < t.rows.length; r++) grid[r] = [];

    const drawRow = (rowIdx: number, isRepeat = false) => {
      const row = t.rows[rowIdx];
      let maxH = row.exactHeight || row.atLeastHeight || 14;
      let currentGridCol = 0;
      
      const cellWidths: number[] = [];
      const cellHeights: number[] = [];

      for (const cell of row.cells) {
        while (grid[rowIdx][currentGridCol]) currentGridCol++; 
        
        let cellW = 0;
        if (cell.width?.type === "dxa") cellW = twipsToPts(cell.width.val);
        else if (cell.width?.type === "pct") cellW = (cell.width.val / 5000) * availX;
        else {
          for (let i = 0; i < cell.gridSpan; i++) {
            cellW += t.columnWidths[currentGridCol + i] || (tableWidth / row.cells.length);
          }
        }

        const h = measureCell(cell, cellW) + cell.margins.top + cell.margins.bottom;
        
        for (let i = 0; i < cell.gridSpan; i++) {
           grid[rowIdx][currentGridCol + i] = { cell, w: cellW, startY: 0, h };
           if (cell.vMerge === "restart") {
              let nr = rowIdx + 1;
              while (nr < t.rows.length) {
                 const nextRow = t.rows[nr];
                 let nxCol = 0;
                 let foundCont = false;
                 for (const nxCell of nextRow.cells) {
                    while (grid[nr][nxCol]) nxCol++;
                    if (nxCol === currentGridCol + i && nxCell.vMerge === "continue") {
                       grid[nr][nxCol] = { cell: nxCell, w: cellW, startY: 0, h: 0 }; 
                       foundCont = true;
                    }
                    nxCol += nxCell.gridSpan;
                 }
                 if (!foundCont) break;
                 nr++;
              }
           }
        }

        cellWidths.push(cellW);
        if (cell.vMerge !== "continue") {
           cellHeights.push(h);
           maxH = Math.max(maxH, h);
        } else {
           cellHeights.push(0);
        }
        currentGridCol += cell.gridSpan;
      }

      if (this.cursorY + maxH > section.height - section.margins.bottom && !isHF) {
        this.addPage(section);
        if (!isRepeat && headerRows.length > 0 && !row.isHeader) {
          headerRows.forEach((hr, i) => drawRow(i, true));
        }
      }

      const rowTopY = this.cursorY;
      let currentX = tableOffsetX;
      currentGridCol = 0;

      for (let i = 0; i < row.cells.length; i++) {
        const cell = row.cells[i];
        while (grid[rowIdx][currentGridCol] && grid[rowIdx][currentGridCol].cell !== cell) {
            currentGridCol++;
        }
        const cellInfo = grid[rowIdx][currentGridCol];
        const cellW = cellInfo.w;
        cellInfo.startY = rowTopY;

        let totalCellH = maxH;
        if (cell.vMerge === "restart") {
           let nr = rowIdx + 1;
           while (nr < t.rows.length && grid[nr][currentGridCol]?.cell.vMerge === "continue") {
              nr++;
           }
        }

        if (cell.vMerge !== "continue") {
           if (cell.backgroundColor) {
             this.currentCmds.push({ type: "rect", x: currentX, y: rowTopY, w: cellW, h: totalCellH, fillColor: cell.backgroundColor });
           }

           const cellEngine = new PdfLayoutEngine(this.fonts, this.globalImageMap, true, rowTopY + cell.margins.top);
           
           if (cell.vAlign === "center" || cell.vAlign === "bottom") {
              const contentH = cellInfo.h - cell.margins.top - cell.margins.bottom;
              const space = totalCellH - cell.margins.top - cell.margins.bottom - contentH;
              if (space > 0) cellEngine.cursorY += cell.vAlign === "center" ? space / 2 : space;
           }

           cellEngine.layoutBlocks(cell.blocks, currentX + cell.margins.left, currentX + cellW - cell.margins.right, section, true, pageNum, totalPages);
           this.currentCmds.push(...cellEngine.currentCmds);
        }

        const drawB = (b: BorderStyle, x1: number, y1: number, x2: number, y2: number) => {
          if (b.size > 0 && b.style !== "none") this.currentCmds.push({ type: "line", x1, y1, x2, y2, color: b.color, lineWidth: b.size, style: b.style });
        };
        
        if (cell.vMerge !== "continue") drawB(cell.borders.top, currentX, rowTopY, currentX + cellW, rowTopY);
        if (cell.vMerge !== "restart") drawB(cell.borders.bottom, currentX, rowTopY + totalCellH, currentX + cellW, rowTopY + totalCellH);
        drawB(cell.borders.left, currentX, rowTopY, currentX, rowTopY + totalCellH);
        drawB(cell.borders.right, currentX + cellW, rowTopY, currentX + cellW, rowTopY + totalCellH);

        currentX += cellW;
        currentGridCol += cell.gridSpan;
      }
      this.cursorY += maxH;
    };

    for (let i = 0; i < t.rows.length; i++) drawRow(i);
  }
}

// --- MAIN RENDER EXPORT ---

export async function renderWordToPdfV2(file: File): Promise<Blob> {
  try {
   return await renderWordToRealTextPdf(file);
  } catch (error) {
   console.warn("The DOCX XML renderer rejected the document; falling back to the legacy visual snapshot path.", error);

   if (typeof document === "undefined") {
     throw new Error("Word-to-PDF rendering requires a browser document.");
   }

   const { renderAsync } = await import("docx-preview");

   const iframe = document.createElement("iframe");
   iframe.style.position = "fixed";
   iframe.style.left = "-99999px";
   iframe.style.top = "0";
   iframe.style.width = "794px";
   iframe.style.height = "1200px";
   iframe.style.border = "none";
   iframe.style.visibility = "hidden";
   document.body.appendChild(iframe);

   try {
     const frameDoc = iframe.contentDocument;
     if (!frameDoc) throw new Error("Could not prepare an isolated render surface for this document.");

     frameDoc.open();
     frameDoc.write(`<!doctype html><html><head><meta charset="utf-8"><style>
       html, body {
         margin: 0;
         background: #ffffff;
         color: #000000;
         font-family: Arial, sans-serif;
       }
       body {
         width: 794px;
         min-height: 1200px;
         padding: 0;
       }
       * { box-sizing: border-box; }
     </style></head><body></body></html>`);
     frameDoc.close();

     const surface = frameDoc.body;
     await renderAsync(file, surface, surface, {
       inWrapper: true,
       hideWrapperOnPrint: false,
       ignoreWidth: false,
       ignoreHeight: false,
       ignoreFonts: false,
       breakPages: true,
       ignoreLastRenderedPageBreak: true,
       experimental: true,
       className: "docx-render",
       trimXmlDeclaration: true,
       renderHeaders: true,
       renderFooters: true,
       renderFootnotes: true,
       renderEndnotes: true,
       renderAltChunks: true,
       useBase64URL: true,
     });

     const html2canvasModule = await import("html2canvas");
     const html2canvas = (html2canvasModule as any).default ?? html2canvasModule;
     const rendered = await html2canvas(surface, {
       scale: 2,
       backgroundColor: "#ffffff",
       useCORS: true,
       width: surface.scrollWidth || 794,
       height: surface.scrollHeight || 1000,
     });

     const pdf = await PDFDocument.create();
     const pageWidthPt = 595.28;
     const pageHeightPt = 841.89;
     const sliceHeightPx = Math.floor(pageHeightPt * (rendered.width / pageWidthPt));

     let y = 0;
     while (y < rendered.height) {
       const h = Math.min(sliceHeightPx, rendered.height - y);
       const slice = document.createElement("canvas");
       slice.width = rendered.width;
       slice.height = h;
       const ctx = slice.getContext("2d");
       if (!ctx) throw new Error("Canvas rendering is not available in this browser.");

       ctx.fillStyle = "#ffffff";
       ctx.fillRect(0, 0, slice.width, slice.height);
       ctx.drawImage(rendered, 0, y, rendered.width, h, 0, 0, rendered.width, h);

       const blob = await new Promise<Blob>((resolve, reject) => {
         slice.toBlob((result) => {
           if (!result) return reject(new Error("Could not capture the document preview."));
           resolve(result);
         }, "image/png");
       });

       const image = await pdf.embedPng(new Uint8Array(await blob.arrayBuffer()));
       const page = pdf.addPage([pageWidthPt, pageHeightPt]);
       const drawHeight = (h / rendered.width) * pageWidthPt;
       page.drawImage(image, { x: 0, y: pageHeightPt - drawHeight, width: pageWidthPt, height: drawHeight });
       y += h;
     }

     if (pdf.getPageCount() === 0) {
       const page = pdf.addPage([pageWidthPt, pageHeightPt]);
       page.drawRectangle({ x: 0, y: 0, width: pageWidthPt, height: pageHeightPt, color: rgb(1, 1, 1) });
     }

     const pdfBytes = await pdf.save({ useObjectStreams: true });
     const buffer = new ArrayBuffer(pdfBytes.byteLength);
     new Uint8Array(buffer).set(pdfBytes);
     return new Blob([buffer], { type: "application/pdf" });
   } finally {
     iframe.remove();
   }
  }
}