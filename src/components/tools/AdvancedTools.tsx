import { useEffect, useMemo, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import mammoth from "mammoth/mammoth.browser";
import PptxGenJS from "pptxgenjs";
import { Document, ImageRun, Packer, Paragraph } from "docx";
import { createWorker } from "tesseract.js";
import { DropZone } from "@/components/site/DropZone";
import { PdfEditor, type EditorApplyState } from "@/components/site/PdfEditor";
import { ToolProgressBar } from "@/components/site/ToolProgressBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadBlob, formatBytes } from "@/lib/download";
import { canvasToBlob, extractPdfText, loadPdf, renderPdfPageToCanvas } from "@/lib/pdf-render";
import { createTextPdf, stripHtml } from "@/lib/text-pdf";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Single-PDF picker used across the "advanced" tools. Mirrors MergeTool's card:
 * a live canvas-rendered thumbnail of page 1 plus a page count badge, instead
 * of a generic file icon, so every tool in this file gets the same visual
 * quality without touching each tool individually.
 */
function SinglePdfPicker({
  file,
  onFile,
  hint,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
  hint?: string;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>();
  const [pageCount, setPageCount] = useState<number | undefined>();

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;

    if (!file) {
      setThumbnailUrl(undefined);
      setPageCount(undefined);
      return;
    }

    (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await PDFDocument.load(bytes, { updateMetadata: false }).catch(() => null);
        if (!cancelled && doc) setPageCount(doc.getPageCount());

        const pdf = await loadPdf(file).catch(() => null);
        if (!pdf || cancelled) return;
        const canvas = await renderPdfPageToCanvas(pdf, 1, 0.4);
        const blob = await canvasToBlob(canvas, "image/jpeg", 0.7);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      } catch {
        // Password-protected or malformed files simply fall back to the icon.
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  if (!file) {
    return (
      <DropZone
        onFiles={(files) => onFile(files[0] ?? null)}
        accept={{ "application/pdf": [".pdf"] }}
        multiple={false}
        hint={hint ?? "Drop one PDF."}
      />
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-white shadow-sm">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="PDF preview" className="h-full w-full object-contain" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-signal-soft text-signal">
              <FileText className="h-6 w-6" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{file.name}</div>
          <div className="text-sm text-muted-foreground">
            {formatBytes(file.size)}
            {pageCount ? ` · ${pageCount} ${pageCount === 1 ? "page" : "pages"}` : ""}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onFile(null)} aria-label="Remove file">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fileText(file: File) {
  return file.text();
}

function xmlText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeSpreadsheetXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

async function readWorkbookSections(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  if (!workbookXml) throw new Error("This workbook does not contain readable worksheets.");
  const sheetNames = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((match) => xmlText(match[1]));
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("text");
  const sharedStrings = sharedXml ? [...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1])) : [];
  const worksheetPaths = Object.keys(zip.files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return Promise.all(worksheetPaths.map(async (path, index) => {
    const xml = await zip.file(path)!.async("text");
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
      const cells = [...rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((cellMatch) => {
        const raw = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? cellMatch[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
        return /t="s"/.test(cellMatch[1]) ? sharedStrings[Number(raw)] ?? "" : xmlText(raw);
      });
      return cells.join(",");
    });
    return { heading: sheetNames[index] ?? `Sheet ${index + 1}`, body: rows.join("\n") };
  }));
}

/* -------------------------- Excel → PDF table rendering -------------------------- */

function colLetterToIndex(letter: string) {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readWorkbookGrid(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  if (!workbookXml) throw new Error("This workbook does not contain readable worksheets.");
  const sheetNames = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => xmlText(m[1]));
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("text");
  const sharedStrings = sharedXml
    ? [...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]))
    : [];
  const worksheetPaths = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return Promise.all(
    worksheetPaths.map(async (path, index) => {
      const xml = await zip.file(path)!.async("text");
      const rowMatches = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
      const rows: string[][] = rowMatches.map((rowMatch) => {
        const cellMatches = [...rowMatch[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];
        const rowCells: string[] = [];
        cellMatches.forEach((m) => {
          const attrs = m[1];
          const inner = m[2] ?? "";
          const colMatch = /r="([A-Z]+)\d*"/.exec(attrs);
          const colIdx = colMatch ? colLetterToIndex(colMatch[1]) : rowCells.length;
          const t = /t="([a-z]+)"/.exec(attrs)?.[1];
          const raw =
            inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
          const value = t === "s" ? sharedStrings[Number(raw)] ?? "" : xmlText(raw);
          while (rowCells.length < colIdx) rowCells.push("");
          rowCells[colIdx] = value;
        });
        return rowCells;
      });
      const colCount = Math.max(1, ...rows.map((r) => r.length));
      const padded = rows.map((r) => {
        const copy = [...r];
        while (copy.length < colCount) copy.push("");
        return copy;
      });
      return { heading: sheetNames[index] ?? `Sheet ${index + 1}`, rows: padded };
    }),
  );
}

function truncateToWidth(
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Built-in PDF fonts use WinAnsi and throw for characters outside that
 * encoding. Preserve a readable approximation so one cell cannot abort the
 * entire workbook conversion.
 */
function toPdfSafeText(value: string) {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00B9\u00B2\u00B3]/g, (character) => ({ "¹": "1", "²": "2", "³": "3" })[character]!)
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/[^\x20-\x7E\n\r\t]/g, "?");
}

async function renderSpreadsheetPdf(sheets: Array<{ heading: string; rows: string[][] }>) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 841.89; // A4 landscape
  const pageHeight = 595.28;
  const margin = 36;
  const fontSize = 8;
  const rowHeight = 18;
  const headerColor = rgb(0.09, 0.32, 0.26);
  const headerTextColor = rgb(1, 1, 1);
  const borderColor = rgb(0.85, 0.85, 0.85);
  const textColor = rgb(0.1, 0.1, 0.1);
  const zebraColor = rgb(0.96, 0.97, 0.96);
  const MAX_COLS = 12;

  for (const sheet of sheets) {
    if (!sheet.rows.length) continue;
    const colCount = Math.min(sheet.rows[0].length || 1, MAX_COLS);
    const usableWidth = pageWidth - margin * 2;
    const colWidth = usableWidth / colCount;

    let page = doc.addPage([pageWidth, pageHeight]);
    let cursorY = pageHeight - margin;

    page.drawText(toPdfSafeText(sheet.heading), { x: margin, y: cursorY, size: 14, font: boldFont, color: rgb(0.05, 0.05, 0.05) });
    cursorY -= 26;

    function drawRow(cells: string[], isHeader: boolean, zebra: boolean) {
      if (isHeader) {
        page.drawRectangle({ x: margin, y: cursorY - rowHeight, width: usableWidth, height: rowHeight, color: headerColor });
      } else if (zebra) {
        page.drawRectangle({ x: margin, y: cursorY - rowHeight, width: usableWidth, height: rowHeight, color: zebraColor });
      }
      for (let ci = 0; ci < colCount; ci++) {
        page.drawRectangle({
          x: margin + ci * colWidth,
          y: cursorY - rowHeight,
          width: colWidth,
          height: rowHeight,
          borderColor,
          borderWidth: 0.5,
        });
      }
      cells.slice(0, colCount).forEach((cell, ci) => {
        const usedFont = isHeader ? boldFont : font;
        const safeCell = toPdfSafeText(cell ?? "").replace(/[\r\n]+/g, " ");
        page.drawText(truncateToWidth(safeCell, colWidth - 8, usedFont, fontSize), {
          x: margin + ci * colWidth + 4,
          y: cursorY - rowHeight + 5,
          size: fontSize,
          font: usedFont,
          color: isHeader ? headerTextColor : textColor,
        });
      });
      cursorY -= rowHeight;
    }

    drawRow(sheet.rows[0], true, false);
    for (let ri = 1; ri < sheet.rows.length; ri++) {
      if (cursorY - rowHeight < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        cursorY = pageHeight - margin;
        drawRow(sheet.rows[0], true, false);
      }
      drawRow(sheet.rows[ri], false, ri % 2 === 0);
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

/* -------------------------- HTML → PDF visual renderer -------------------------- */
/**
 * Renders arbitrary HTML into a real, paginated, visually-styled PDF using
 * html2canvas (renders the DOM as-is: bold, headings, colors, tables,
 * images) + pdf-lib (slices the tall render into A4 pages and embeds each
 * slice as a PNG). Requires: npm install html2canvas
 *
 * This replaces the old approach of stripping HTML to plain text — layout,
 * formatting, and images are now preserved because the actual rendered DOM
 * is captured rather than discarded.
 */
async function renderHtmlToPdfBlob(html: string) {
  const html2canvasModule = await import("html2canvas");
  const html2canvas = html2canvasModule.default;

  const pageWidthPt = 595.28; // A4
  const pageHeightPt = 841.89;
  const cssWidthPx = 794; // A4 width at 96dpi

  // html2canvas can't parse modern CSS color functions like oklch()/
  // color-mix(), which this site's Tailwind theme uses globally. Overriding
  // individual CSS properties on an element appended to document.body isn't
  // reliable — there are too many color-bearing properties (background-image
  // gradients, outline-color, etc.) to cover one by one. Instead, render
  // inside a same-origin iframe with its own blank document, so nothing from
  // the host page's stylesheet — oklch or otherwise — is inherited at all.
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-99999px";
  iframe.style.top = "0";
  iframe.style.width = `${cssWidthPx}px`;
  iframe.style.height = "50px";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  try {
    const frameDoc = iframe.contentDocument;
    if (!frameDoc) throw new Error("Could not prepare an isolated render surface for this document.");

    frameDoc.open();
    frameDoc.write(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    width: ${cssWidthPx}px;
    padding: 40px;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 14px;
    line-height: 1.6;
    color: #111827;
  }
  h1, h2, h3, h4, h5, h6 { color: #0f172a; }
  a { color: #1d4ed8; }
  table { border-collapse: collapse; }
  table, th, td { border: 1px solid #d1d5db; }
  img { max-width: 100%; }
</style></head><body>${html}</body></html>`);
    frameDoc.close();

    // Let layout settle before measuring/rendering.
    await new Promise((resolve) => setTimeout(resolve, 30));

    const images = Array.from(frameDoc.images);
    await Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
      ),
    );

    const targetBody = frameDoc.body;
    iframe.style.height = `${Math.max(50, targetBody.scrollHeight)}px`;

    const rendered = await html2canvas(targetBody, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: cssWidthPx,
    });
    const doc = await PDFDocument.create();
    const sliceHeightPx = Math.floor(pageHeightPt * (rendered.width / pageWidthPt));

    let y = 0;
    while (y < rendered.height) {
      const h = Math.min(sliceHeightPx, rendered.height - y);
      const slice = document.createElement("canvas");
      slice.width = rendered.width;
      slice.height = h;
      const ctx = slice.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(rendered, 0, y, rendered.width, h, 0, 0, rendered.width, h);

      const blob = await canvasToBlob(slice, "image/png");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const image = await doc.embedPng(bytes);
      const page = doc.addPage([pageWidthPt, pageHeightPt]);
      const drawHeight = (h / rendered.width) * pageWidthPt;
      page.drawImage(image, { x: 0, y: pageHeightPt - drawHeight, width: pageWidthPt, height: drawHeight });
      y += h;
    }

    if (doc.getPageCount() === 0) doc.addPage([pageWidthPt, pageHeightPt]);
    const outBytes = await doc.save();
    return new Blob([outBytes.buffer as ArrayBuffer], { type: "application/pdf" });
  } finally {
    document.body.removeChild(iframe);
  }
}


async function createWorkbook(rows: Array<{ page: number; text: string }>) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="PDF Text" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  const allRows = [{ page: "Page", text: "Text" }, ...rows.map((row) => ({ page: String(row.page), text: row.text }))];
  const sheetRows = allRows.map((row, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${escapeSpreadsheetXml(row.page)}</t></is></c><c r="B${index + 1}" t="inlineStr"><is><t>${escapeSpreadsheetXml(row.text)}</t></is></c></row>`).join("");
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function renderPdfToImageZip(
  file: File,
  type: "jpg" | "png",
  password?: string,
  onProgress?: (current: number, total: number) => void,
) {
  const pdf = await loadPdf(file, password);
  const zip = new JSZip();
  const mime = type === "jpg" ? "image/jpeg" : "image/png";
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const canvas = await renderPdfPageToCanvas(pdf, pageNumber, 2);
    const blob = await canvasToBlob(canvas, mime, type === "jpg" ? 0.92 : undefined);
    zip.file(`page-${String(pageNumber).padStart(3, "0")}.${type}`, blob);
    onProgress?.(pageNumber, pdf.numPages);
  }
  return zip.generateAsync({ type: "blob" });
}

export function PdfToImagesTool({ type }: { type: "jpg" | "png" }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  async function run() {
    if (!file) return;
    setBusy(true);
    setProgress({ current: 0, total: 1 });
    try {
      const zip = await renderPdfToImageZip(file, type, password, (current, total) =>
        setProgress({ current, total }),
      );
      downloadBlob(zip, `lazy-pdf-${type}-pages.zip`, "application/zip");
      toast.success(`${type.toUpperCase()} pages ready.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Conversion failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint={`Drop a PDF to render every page as ${type.toUpperCase()}.`}
      />
      {file && (
        <Input
          type="password"
          placeholder="Password if needed"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      )}
      {progress && (
        <ToolProgressBar current={progress.current} total={progress.total} label="Rendering pages" />
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Convert to {type.toUpperCase()}
        </Button>
      </div>
    </div>
  );
}

export function ExtractTextTool() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const pages = await extractPdfText(file);
      const output = pages.map((page, index) => `Page ${index + 1}\n${page}`).join("\n\n");
      setText(output);
      downloadBlob(
        new Blob([output], { type: "text/plain" }),
        "lazy-pdf-extracted-text.txt",
        "text/plain",
      );
      toast.success("Text extracted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not extract text.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker file={file} onFile={setFile} />
      {text && <Textarea value={text} readOnly className="min-h-56" />}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Extract text
        </Button>
      </div>
    </div>
  );
}

export function ExtractImagesTool() {
  return <PdfToImagesTool type="png" />;
}

export function ScanToPdfTool() {
  return (
    <ImagesToPdfCaptureTool
      accept={{ "image/*": [".jpg", ".jpeg", ".png", ".webp"] }}
      hint="Upload scans or camera photos. On mobile, choose your camera."
      filename="lazy-pdf-scan.pdf"
    />
  );
}

function ImagesToPdfCaptureTool({
  accept,
  hint,
  filename,
}: {
  accept: Record<string, string[]>;
  hint: string;
  filename: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!files.length) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.create();
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const isPng = file.type.includes("png") || file.name.toLowerCase().endsWith(".png");
        const image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = doc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      downloadBlob(await doc.save(), filename);
      toast.success("PDF ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build PDF.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <DropZone
        onFiles={(newFiles) => setFiles((current) => [...current, ...newFiles])}
        accept={accept}
        hint={hint}
      />
      {files.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {files.length} image{files.length > 1 ? "s" : ""} selected
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!files.length || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create PDF
        </Button>
      </div>
    </div>
  );
}

export function CropPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [margin, setMargin] = useState(24);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      doc.getPages().forEach((page) => {
        const { width, height } = page.getSize();
        const m = Math.max(0, Math.min(margin, width / 3, height / 3));
        page.setCropBox(m, m, width - m * 2, height - m * 2);
      });
      downloadBlob(await doc.save(), `lazy-pdf-cropped-${file.name}`);
      toast.success("PDF cropped.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Crop failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint="Drop a PDF and trim the same margin from every page."
      />
      {file && (
        <div>
          <Label htmlFor="crop-margin">Margin to remove (points)</Label>
          <Input
            id="crop-margin"
            type="number"
            min={0}
            value={margin}
            onChange={(event) => setMargin(Number(event.target.value))}
            className="mt-1"
          />
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Crop PDF
        </Button>
      </div>
    </div>
  );
}

export function EditPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("Approved");
  const [x, setX] = useState(72);
  const [y, setY] = useState(72);
  const [busy, setBusy] = useState(false);
  async function apply(state: EditorApplyState) {
    if (!file) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const page = doc.getPages()[state.pages[0]?.originalIndex ?? 0];
      page?.drawText(text, { x, y, size: 18, font, color: rgb(0.1, 0.32, 0.45) });
      const bytes = await doc.save();
      toast.success("PDF edited.");
      return { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), filename: `lazy-pdf-edited-${file.name}` };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Edit failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {!file ? <DropZone onFiles={(files) => setFile(files[0] ?? null)} accept={{ "application/pdf": [".pdf"] }} multiple={false} hint="Drop a PDF to open the full editor workspace." /> : <>
        <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-3">
          <div className="sm:col-span-3"><Label htmlFor="edit-text">Text to add</Label><Input id="edit-text" value={text} onChange={(event) => setText(event.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="edit-x">Horizontal position</Label><Input id="edit-x" type="number" value={x} onChange={(event) => setX(Number(event.target.value))} className="mt-1" /></div>
          <div><Label htmlFor="edit-y">Vertical position</Label><Input id="edit-y" type="number" value={y} onChange={(event) => setY(Number(event.target.value))} className="mt-1" /></div>
        </div>
        <PdfEditor file={file} mode="select" actionLabel="Save changes" busy={busy} selectionHint="Use the workspace to review pages, zoom, rotate, duplicate, or select pages before saving." onReplace={() => setFile(null)} onApply={apply} />
      </>}
    </div>
  );
}

/**
 * True redaction: the old version only painted a black rectangle on top of
 * the page while the original text stayed selectable and copyable
 * underneath — not real redaction. This version rasterizes the chosen page
 * (renders it to an image via pdf.js, draws the black box on that image,
 * then replaces the page with the flattened image) so the covered text is
 * actually gone from the output file, not just visually hidden. Other pages
 * are left as normal vector/text pages and are untouched.
 */
export function RedactPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [x, setX] = useState(72);
  const [y, setY] = useState(650);
  const [width, setWidth] = useState(220);
  const [height, setHeight] = useState(36);
  const [busy, setBusy] = useState(false);

  async function choose(next: File | null) {
    setFile(next);
    setPageCount(null);
    if (!next) return;
    try {
      const doc = await PDFDocument.load(new Uint8Array(await next.arrayBuffer()));
      setPageCount(doc.getPageCount());
      setPageNumber(1);
    } catch {
      /* SinglePdfPicker's own preview will surface load errors */
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sourceDoc = await PDFDocument.load(bytes);
      const total = sourceDoc.getPageCount();
      const targetIndex = Math.min(Math.max(pageNumber - 1, 0), total - 1);

      const pdfJsDoc = await loadPdf(file);
      const outDoc = await PDFDocument.create();

      for (let i = 0; i < total; i += 1) {
        if (i === targetIndex) {
          const { width: pw, height: ph } = sourceDoc.getPage(i).getSize();
          const canvas = await renderPdfPageToCanvas(pdfJsDoc, i + 1, 2);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas is not available in this browser.");
          const scaleX = canvas.width / pw;
          const scaleY = canvas.height / ph;
          const boxX = Math.max(0, Math.min(x, pw)) * scaleX;
          const boxYFromTop = (ph - Math.min(y + height, ph)) * scaleY;
          const boxW = Math.max(0, Math.min(width, pw - x)) * scaleX;
          const boxH = Math.max(0, Math.min(height, ph - Math.max(y, 0))) * scaleY;
          ctx.fillStyle = "#000000";
          ctx.fillRect(boxX, boxYFromTop, boxW, boxH);

          const blob = await canvasToBlob(canvas, "image/png");
          const imageBytes = new Uint8Array(await blob.arrayBuffer());
          const image = await outDoc.embedPng(imageBytes);
          const page = outDoc.addPage([pw, ph]);
          page.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
        } else {
          const [copied] = await outDoc.copyPages(sourceDoc, [i]);
          outDoc.addPage(copied);
        }
      }

      const outBytes = await outDoc.save();
      downloadBlob(new Blob([outBytes.buffer as ArrayBuffer], { type: "application/pdf" }), `lazy-pdf-redacted-${file.name}`, "application/pdf");
      toast.success(`Page ${pageNumber} redacted — text underneath the box is permanently removed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Redaction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={choose}
        hint="Drop a PDF and place a black redaction box on any page."
      />
      {file && (
        <>
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            The redacted page is flattened to an image, so the text underneath the box is permanently removed —
            not just covered. Other pages in the file are left as normal, selectable text.
          </div>
          <div className="grid gap-4 sm:grid-cols-5">
            <div>
              <Label>Page</Label>
              <Input
                type="number"
                min={1}
                max={pageCount ?? 1}
                value={pageNumber}
                onChange={(event) => setPageNumber(Number(event.target.value))}
                className="mt-1"
              />
              {pageCount && <div className="mt-1 text-xs text-muted-foreground">of {pageCount}</div>}
            </div>
            {[
              ["X", x, setX],
              ["Y", y, setY],
              ["Width", width, setWidth],
              ["Height", height, setHeight],
            ].map(([label, value, setter]) => (
              <div key={String(label)}>
                <Label>{String(label)}</Label>
                <Input
                  type="number"
                  value={Number(value)}
                  onChange={(event) => (setter as (n: number) => void)(Number(event.target.value))}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
        </>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Redact
        </Button>
      </div>
    </div>
  );
}

/**
 * Renamed from "Remove watermark" to be honest about what this does: it
 * paints an opaque box over a region you choose on every page. It does not
 * detect or erase an actual watermark object/text — no client-side library
 * here can reliably do that for arbitrary PDFs. The old version hardcoded a
 * centered box, which only worked if the watermark happened to sit there;
 * this version lets you position and size the covered region yourself.
 */
export function RemoveWatermarkTool() {
  const [file, setFile] = useState<File | null>(null);
  const [xPct, setXPct] = useState(15);
  const [yPct, setYPct] = useState(40);
  const [wPct, setWPct] = useState(70);
  const [hPct, setHPct] = useState(20);
  const [color, setColor] = useState("#ffffff");
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
      doc.getPages().forEach((page) => {
        const { width, height } = page.getSize();
        page.drawRectangle({
          x: (width * xPct) / 100,
          y: (height * yPct) / 100,
          width: (width * wPct) / 100,
          height: (height * hPct) / 100,
          color: rgb(r, g, b),
          opacity: 1,
        });
      });
      downloadBlob(await doc.save(), `lazy-pdf-watermark-covered-${file.name}`);
      toast.success("Watermark area covered on every page.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cover the watermark area.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint="Drop a PDF, then position a solid box over the watermark on every page."
      />
      {file && (
        <>
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            This paints a solid box over the region you choose — it doesn't detect or erase the watermark
            object itself. Position it over where the watermark actually sits on your pages.
          </div>
          <div className="grid gap-4 sm:grid-cols-5">
            {[
              ["X %", xPct, setXPct],
              ["Y %", yPct, setYPct],
              ["Width %", wPct, setWPct],
              ["Height %", hPct, setHPct],
            ].map(([label, value, setter]) => (
              <div key={String(label)}>
                <Label>{String(label)}</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={Number(value)}
                  onChange={(event) => (setter as (n: number) => void)(Number(event.target.value))}
                  className="mt-1"
                />
              </div>
            ))}
            <div>
              <Label>Cover color</Label>
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-border"
              />
            </div>
          </div>
        </>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cover watermark area
        </Button>
      </div>
    </div>
  );
}

export function ProtectPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file || !password) return;
    setBusy(true);
    try {
      const { PDFDocument: EncryptedPDFDocument } =
        await import("pdf-lib-plus-encrypt/dist/pdf-lib-plus-encrypt.esm.js");
      const doc = await EncryptedPDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      await doc.encrypt({
        userPassword: password,
        ownerPassword: password,
        permissions: { printing: "highResolution", copying: false, modifying: false },
      });
      downloadBlob(await doc.save(), `lazy-pdf-protected-${file.name}`);
      toast.success("PDF protected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Protect failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker file={file} onFile={setFile} hint="Drop a PDF and set an open password." />
      {file && (
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || !password || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Protect PDF
        </Button>
      </div>
    </div>
  );
}

export function UnlockPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const pdf = await loadPdf(file, password);
      const doc = await PDFDocument.create();
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const canvas = await renderPdfPageToCanvas(pdf, pageNumber, 2);
        const png = new Uint8Array(await (await canvasToBlob(canvas, "image/png")).arrayBuffer());
        const image = await doc.embedPng(png);
        const page = doc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      downloadBlob(await doc.save(), `lazy-pdf-unlocked-${file.name}`);
      toast.success("Unlocked copy ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unlock failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint="Drop a PDF and enter its known password if prompted."
      />
      {file && (
        <Input
          type="password"
          placeholder="Known password if required"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Unlock PDF
        </Button>
      </div>
    </div>
  );
}

export function SignPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [signature, setSignature] = useState("Signature");
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const font = await doc.embedFont(StandardFonts.TimesRomanItalic);
      const page = doc.getPages()[0];
      page?.drawText(signature, { x: 72, y: 96, size: 28, font, color: rgb(0.05, 0.11, 0.18) });
      downloadBlob(await doc.save(), `lazy-pdf-signed-${file.name}`);
      toast.success("Signature added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint="Drop a PDF and type a signature for the first page."
      />
      {file && <Input value={signature} onChange={(event) => setSignature(event.target.value)} />}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || !signature || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign PDF
        </Button>
      </div>
    </div>
  );
}

export function FillFormsTool() {
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [json, setJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  async function choose(next: File | null) {
    setFile(next);
    setFields([]);
    if (!next) return;
    try {
      const doc = await PDFDocument.load(new Uint8Array(await next.arrayBuffer()));
      setFields(
        doc
          .getForm()
          .getFields()
          .map((field) => field.getName()),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read form fields.");
    }
  }
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const values = JSON.parse(json) as Record<string, string | boolean>;
      const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const form = doc.getForm();
      Object.entries(values).forEach(([name, value]) => {
        const field = form.getField(name) as unknown as {
          setText?: (v: string) => void;
          check?: () => void;
          uncheck?: () => void;
          select?: (v: string) => void;
        };
        if (typeof value === "boolean" && field.check && field.uncheck) {
          if (value) field.check();
          else field.uncheck();
        } else if (field.setText) field.setText(String(value));
        else if (field.select) field.select(String(value));
      });
      downloadBlob(await doc.save(), `lazy-pdf-filled-${file.name}`);
      toast.success("Form filled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Fill failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker file={file} onFile={choose} hint="Drop a PDF form." />
      {file && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Fields: {fields.length ? fields.join(", ") : "No interactive fields found"}
          </div>
          <Label htmlFor="form-json">Values as JSON</Label>
          <Textarea
            id="form-json"
            value={json}
            onChange={(event) => setJson(event.target.value)}
            className="min-h-36 font-mono"
          />
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Fill form
        </Button>
      </div>
    </div>
  );
}

export function ComparePdfsTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    if (files.length < 2) return;
    setBusy(true);
    try {
      const [a, b] = await Promise.all([extractPdfText(files[0]), extractPdfText(files[1])]);
      const left = a
        .join("\n")
        .split(/\n|\.\s+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const right = b
        .join("\n")
        .split(/\n|\.\s+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const missing = left.filter((line) => !right.includes(line)).slice(0, 200);
      const added = right.filter((line) => !left.includes(line)).slice(0, 200);
      const output = `Only in ${files[0].name}\n${missing.join("\n")}\n\nOnly in ${files[1].name}\n${added.join("\n")}`;
      setReport(output);
      downloadBlob(
        new Blob([output], { type: "text/plain" }),
        "lazy-pdf-compare-report.txt",
        "text/plain",
      );
      toast.success("Comparison ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Compare failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <DropZone
        onFiles={(next) => setFiles(next.slice(0, 2))}
        accept={{ "application/pdf": [".pdf"] }}
        multiple
        hint="Drop two PDFs to compare text."
      />
      {files.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {files.map((file) => file.name).join(" + ")}
        </div>
      )}
      {report && <Textarea value={report} readOnly className="min-h-56" />}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={files.length < 2 || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Compare PDFs
        </Button>
      </div>
    </div>
  );
}

export function OcrPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const pdf = await loadPdf(file);
      setProgress({ current: 0, total: pdf.numPages });
      const worker = await createWorker("eng");
      const out: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const canvas = await renderPdfPageToCanvas(pdf, pageNumber, 1.5);
        const result = await worker.recognize(canvas);
        out.push(`Page ${pageNumber}\n${result.data.text}`);
        setProgress({ current: pageNumber, total: pdf.numPages });
      }
      await worker.terminate();
      const text = out.join("\n\n");
      downloadBlob(new Blob([text], { type: "text/plain" }), "lazy-pdf-ocr.txt", "text/plain");
      toast.success("OCR text ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OCR failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint="Drop a scanned PDF to OCR in your browser."
      />
      {progress && (
        <ToolProgressBar current={progress.current} total={progress.total} label="Reading text from pages" />
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Run OCR
        </Button>
      </div>
    </div>
  );
}

export function WordToPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      const pdfBlob = await renderHtmlToPdfBlob(result.value);
      downloadBlob(pdfBlob, `lazy-pdf-${file.name.replace(/\.docx?$/i, "")}.pdf`, "application/pdf");
      toast.success("Word converted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Word conversion failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <FileToPdf
      accept={{
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      }}
      file={file}
      setFile={setFile}
      busy={busy}
      run={run}
      label="Convert Word to PDF"
    />
  );
}

export function ExcelToPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const sheets = await readWorkbookGrid(file);
      const pdfBlob = await renderSpreadsheetPdf(sheets);
      downloadBlob(pdfBlob, `lazy-pdf-${file.name.replace(/\.xlsx?$/i, "")}.pdf`, "application/pdf");
      toast.success("Excel converted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Excel conversion failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <FileToPdf
      accept={{
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
        "application/vnd.ms-excel": [".xls"],
      }}
      file={file}
      setFile={setFile}
      busy={busy}
      run={run}
      label="Convert Excel to PDF"
    />
  );
}

export function PowerPointToPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const slideNames = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const sections = await Promise.all(
        slideNames.map(async (name, index) => ({
          heading: `Slide ${index + 1}`,
          body: xmlText(await zip.file(name)!.async("text")),
        })),
      );
      downloadBlob(
        await createTextPdf(file.name, sections),
        `lazy-pdf-${file.name.replace(/\.pptx?$/i, "")}.pdf`,
      );
      toast.success("PowerPoint converted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PowerPoint conversion failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
        This extracts each slide's text only — layout, images, and slide design aren't preserved yet.
        Full visual slide rendering isn't implemented in this tool.
      </div>
      <FileToPdf
        accept={{
          "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
        }}
        file={file}
        setFile={setFile}
        busy={busy}
        run={run}
        label="Convert PowerPoint to PDF"
      />
    </div>
  );
}

export function HtmlToPdfTool() {
  const [html, setHtml] = useState("<h1>Document</h1><p>Paste HTML here.</p>");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const pdfBlob = await renderHtmlToPdfBlob(html);
      downloadBlob(pdfBlob, "lazy-pdf-html.pdf", "application/pdf");
      toast.success("HTML converted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "HTML conversion failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <Textarea
        value={html}
        onChange={(event) => setHtml(event.target.value)}
        className="min-h-64 font-mono"
      />
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Convert HTML
        </Button>
      </div>
    </div>
  );
}

export function EpubToPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const names = Object.keys(zip.files)
        .filter((name) => /\.(xhtml|html)$/i.test(name))
        .sort();
      if (!names.length) throw new Error("No readable chapters were found in this EPUB.");
      const chapters = await Promise.all(names.map((name) => zip.file(name)!.async("text")));
      const combinedHtml = chapters
        .map((chapterHtml, index) => `<section style="page-break-before:${index === 0 ? "avoid" : "always"};">${chapterHtml}</section>`)
        .join("\n");
      const pdfBlob = await renderHtmlToPdfBlob(combinedHtml);
      downloadBlob(pdfBlob, `lazy-pdf-${file.name.replace(/\.epub$/i, "")}.pdf`, "application/pdf");
      toast.success("EPUB converted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "EPUB conversion failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <FileToPdf
      accept={{ "application/epub+zip": [".epub"] }}
      file={file}
      setFile={setFile}
      busy={busy}
      run={run}
      label="Convert EPUB to PDF"
    />
  );
}

function FileToPdf({
  accept,
  file,
  setFile,
  busy,
  run,
  label,
}: {
  accept: Record<string, string[]>;
  file: File | null;
  setFile: (file: File | null) => void;
  busy: boolean;
  run: () => void;
  label: string;
}) {
  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone
          onFiles={(files) => setFile(files[0] ?? null)}
          accept={accept}
          multiple={false}
          hint="Drop a file to convert."
        />
      ) : (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-6">
          <div>
            <div className="font-medium">{file.name}</div>
            <div className="text-sm text-muted-foreground">{formatBytes(file.size)}</div>
          </div>
          <Button variant="ghost" onClick={() => setFile(null)}>
            Change
          </Button>
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {label}
        </Button>
      </div>
    </div>
  );
}

export function PdfToWordTool() {
  return <PdfTextExportTool type="word" />;
}

export function PdfToExcelTool() {
  return <PdfTextExportTool type="excel" />;
}

function PdfTextExportTool({ type }: { type: "word" | "excel" }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Array<{ page: number; text: string }>>([]);
  const [previewImages, setPreviewImages] = useState<Array<{ page: number; url: string }>>([]);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    setPreview([]);
    setPreviewImages([]);
    if (!file) {
      setPreviewBusy(false);
      return;
    }

    setPreviewBusy(true);
    if (type === "word") {
      (async () => {
        try {
          const pdf = await loadPdf(file);
          const previewCount = Math.min(pdf.numPages, 8);
          for (let pageNumber = 1; pageNumber <= previewCount; pageNumber += 1) {
            const canvas = await renderPdfPageToCanvas(pdf, pageNumber, 1.2);
            const blob = await canvasToBlob(canvas, "image/jpeg", 0.88);
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            if (!cancelled) setPreviewImages((current) => [...current, { page: pageNumber, url }]);
          }
        } catch {
          if (!cancelled) toast.error("Could not render this PDF preview.");
        } finally {
          if (!cancelled) setPreviewBusy(false);
        }
      })();
    } else {
      extractPdfText(file)
        .then((pages) => {
          if (!cancelled) setPreview(pages.map((text, index) => ({ page: index + 1, text })));
        })
        .catch(() => {
          if (!cancelled) toast.error("Could not read text from this PDF.");
        })
        .finally(() => {
          if (!cancelled) setPreviewBusy(false);
        });
    }

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [file, type]);

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      if (type === "word") {
        const pdf = await loadPdf(file);
        const sections = [];
        const renderScale = 1.5;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const canvas = await renderPdfPageToCanvas(pdf, pageNumber, renderScale);
          const image = await canvasToBlob(canvas, "image/png");
          const pageWidthPoints = canvas.width / renderScale;
          const pageHeightPoints = canvas.height / renderScale;
          const imageWidth = Math.round((pageWidthPoints / 72) * 96);
          const imageHeight = Math.round((pageHeightPoints / 72) * 96);
          sections.push({
            properties: {
              page: {
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                size: { width: Math.round(pageWidthPoints * 20), height: Math.round(pageHeightPoints * 20) },
              },
            },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0, line: 240 },
                children: [
                  new ImageRun({
                    type: "png",
                    data: new Uint8Array(await image.arrayBuffer()),
                    transformation: { width: imageWidth, height: imageHeight },
                  }),
                ],
              }),
            ],
          });
        }
        const doc = new Document({
          sections,
        });
        downloadBlob(
          await Packer.toBlob(doc),
          "lazy-pdf-pdf-text.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
      } else {
        const pages = await extractPdfText(file);
        const rows = pages.flatMap((page, index) =>
          page
            .split(/\s{2,}|(?<=[.!?])\s+/)
            .filter(Boolean)
            .map((line) => ({ page: index + 1, text: line })),
        );
        const workbook = await createWorkbook(rows);
        downloadBlob(
          workbook,
          "lazy-pdf-pdf-text.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      }
      toast.success("Export ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint={`Drop a PDF to export text to ${type === "word" ? "Word" : "Excel"}.`}
      />
      {file && type === "word" && (previewBusy || previewImages.length > 0) && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-live="polite">
          <div className="border-b border-border px-5 py-4 sm:px-6">
            <h2 className="font-display text-2xl">Document preview</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This preview keeps the original page layout, spacing, and alignment.
            </p>
          </div>
          <div className="max-h-[42rem] space-y-5 overflow-auto bg-secondary/35 p-4 sm:p-6">
            {previewBusy && <div className="rounded-xl bg-white p-5 text-sm text-slate-500">Rendering document pages...</div>}
            {!previewBusy && previewImages.map((page) => (
              <article key={page.page} className="flex flex-col items-center gap-2">
                <div className="w-full max-w-3xl rounded-sm bg-white p-1 shadow-lg">
                  <img src={page.url} alt={`Page ${page.page}`} className="block h-auto w-full" />
                </div>
                <span className="text-xs font-medium text-muted-foreground">Page {page.page}</span>
              </article>
            ))}
            {!previewBusy && previewImages.length === 8 && (
              <div className="text-center text-xs text-muted-foreground">Preview shows the first 8 pages.</div>
            )}
          </div>
        </section>
      )}
      {file && type === "excel" && (previewBusy || preview.length > 0) && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-live="polite">
          <div className="border-b border-border px-5 py-4 sm:px-6">
            <h2 className="font-display text-2xl">Text preview</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Review the extracted text before exporting it to Excel.
            </p>
          </div>
          <div className="max-h-[28rem] space-y-5 overflow-auto bg-secondary/35 p-4 sm:p-6">
            {previewBusy && <div className="rounded-xl bg-white p-5 text-sm text-slate-500">Reading PDF text...</div>}
            {!previewBusy && preview.map((page) => (
              <article key={page.page} className="rounded-xl bg-white p-5 text-slate-900 shadow-sm">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Page {page.page}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-7">{page.text || "No text found on this page."}</p>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="flex w-full justify-stretch sm:justify-end">
        <Button variant="action" size="xl" className="w-full sm:w-auto" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Export to{" "}
          {type === "word" ? "Word" : "Excel"}
        </Button>
      </div>
    </div>
  );
}

export function PdfToPowerPointTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const pdf = await loadPdf(file);
      setProgress({ current: 0, total: pdf.numPages });
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const canvas = await renderPdfPageToCanvas(pdf, pageNumber, 1.5);
        const data = await blobToDataUrl(await canvasToBlob(canvas, "image/png"));
        const slide = pptx.addSlide();
        slide.addImage({ data, x: 0, y: 0, w: 13.333, h: 7.5 });
        setProgress({ current: pageNumber, total: pdf.numPages });
      }
      const blob = (await pptx.write({ outputType: "blob" })) as Blob;
      downloadBlob(
        blob,
        "lazy-pdf-pdf-slides.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      toast.success("PowerPoint ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PowerPoint export failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint="Drop a PDF to turn each page into a slide."
      />
      {progress && (
        <ToolProgressBar current={progress.current} total={progress.total} label="Building slides" />
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Export PowerPoint
        </Button>
      </div>
    </div>
  );
}

export function PdfToHtmlTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const pages = await extractPdfText(file);
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${file.name}</title></head><body>${pages.map((page, index) => `<section><h1>Page ${index + 1}</h1><p>${page.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</p></section>`).join("\n")}</body></html>`;
      downloadBlob(new Blob([html], { type: "text/html" }), "lazy-pdf-pdf.html", "text/html");
      toast.success("HTML ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "HTML export failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint="Drop a PDF to export a text-based HTML file."
      />
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Export HTML
        </Button>
      </div>
    </div>
  );
}

export function PdfToEpubTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const pages = await extractPdfText(file);
      const zip = new JSZip();
      zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
      zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      );
      const manifest = pages
        .map(
          (_, index) =>
            `<item id="p${index + 1}" href="page${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
        )
        .join("");
      const spine = pages.map((_, index) => `<itemref idref="p${index + 1}"/>`).join("");
      zip.file(
        "OEBPS/content.opf",
        `<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">lazy-pdf</dc:identifier><dc:title>${file.name}</dc:title><dc:language>en</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
      );
      pages.forEach((page, index) =>
        zip.file(
          `OEBPS/page${index + 1}.xhtml`,
          `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${index + 1}</title></head><body><h1>Page ${index + 1}</h1><p>${page}</p></body></html>`,
        ),
      );
      downloadBlob(
        await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" }),
        "lazy-pdf-pdf.epub",
        "application/epub+zip",
      );
      toast.success("EPUB ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "EPUB export failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SinglePdfPicker
        file={file}
        onFile={setFile}
        hint="Drop a PDF to export a text-based EPUB."
      />
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Export EPUB
        </Button>
      </div>
    </div>
  );
}

export function ConversionStatus() {
  const readyCount = useMemo(() => 40, []);
  return <span>{readyCount}</span>;
}
