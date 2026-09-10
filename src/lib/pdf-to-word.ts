import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ImageRun } from "docx";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

interface ExtractedImage {
  bytes: Uint8Array;
  x: number;
  yFromTop: number;
  width: number;
  height: number;
}

const PLACEHOLDER_PATTERNS = [
  /^click or tap here to enter text\.?$/i,
  /^choose an item\.?$/i,
  /^choose a date\.?$/i,
  /^choose a .*\.?$/i,
  /^enter text here\.?$/i,
];

function isPlaceholder(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

function cleanCellText(text: string): string {
  return isPlaceholder(text) ? "" : text;
}

async function loadPdfDoc(file: File): Promise<PDFDocumentProxy> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

async function extractPageText(page: PDFPageProxy): Promise<PdfPageInfo> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const items: PdfTextItem[] = content.items
    .filter((item) => {
      const value = item as unknown as { str?: unknown };
      return typeof value.str === "string" && value.str.trim().length > 0;
    })
    .map((item) => {
      const value = item as unknown as {
        str?: unknown;
        transform?: unknown;
        width?: unknown;
        height?: unknown;
      };

      return {
        str: typeof value.str === "string" ? value.str : "",
        transform: Array.isArray(value.transform) ? value.transform as number[] : [0, 0, 0, 0, 0, 0],
        width: typeof value.width === "number" ? value.width : 0,
        height: typeof value.height === "number" ? value.height : 0,
      };
    });

  return {
    pageNumber: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    items,
  };
}

/* -------------------------- Image extraction -------------------------- */

function multiplyMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

async function extractPageImages(
  page: PDFPageProxy,
  pageHeight: number,
): Promise<ExtractedImage[]> {
  const pdfjs = await import("pdfjs-dist");
  const opList = await page.getOperatorList();
  const OPS = pdfjs.OPS;

  const results: ExtractedImage[] = [];
  let matrix: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === OPS.save) {
      stack.push([...matrix]);
    } else if (fn === OPS.restore) {
      matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.transform) {
      matrix = multiplyMatrix(matrix, args as number[]);
    } else if (
      fn === OPS.paintImageXObject ||
      fn === (OPS as unknown as { paintJpegXObject?: number }).paintJpegXObject
    ) {
      const name = args[0] as string;
      try {
        // eslint-disable-next-line no-await-in-loop
        const imgData: any = await new Promise((resolve) => {
          page.objs.get(name, (obj: any) => resolve(obj));
        });
        if (!imgData || !imgData.width || !imgData.height) continue;

        const canvas = document.createElement("canvas");
        canvas.width = imgData.width;
        canvas.height = imgData.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        if (imgData.bitmap) {
          ctx.drawImage(imgData.bitmap, 0, 0);
        } else if (imgData.data) {
          const channels = imgData.data.length / (imgData.width * imgData.height);
          let rgba: Uint8ClampedArray;
          if (channels === 4) {
            rgba = new Uint8ClampedArray(imgData.data);
          } else if (channels === 3) {
            rgba = new Uint8ClampedArray(imgData.width * imgData.height * 4);
            for (let p = 0, q = 0; p < imgData.data.length; p += 3, q += 4) {
              rgba[q] = imgData.data[p];
              rgba[q + 1] = imgData.data[p + 1];
              rgba[q + 2] = imgData.data[p + 2];
              rgba[q + 3] = 255;
            }
          } else {
            continue;
          }
          const imageData = ctx.createImageData(imgData.width, imgData.height);
          imageData.data.set(rgba);
          ctx.putImageData(imageData, 0, 0);
        } else {
          continue;
        }

        const [a, b, c, d, e, f] = matrix;
        const widthPt = Math.hypot(a, b);
        const heightPt = Math.hypot(c, d);
        if (widthPt < 4 || heightPt < 4) continue; // skip tiny decorative artifacts

        const yFromTop = pageHeight - (f + heightPt);

        const dataUrl = canvas.toDataURL("image/png");
        const base64 = dataUrl.split(",")[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let k = 0; k < binary.length; k++) bytes[k] = binary.charCodeAt(k);

        results.push({ bytes, x: e, yFromTop, width: widthPt, height: heightPt });
      } catch {
        // Skip images that fail to decode rather than aborting the whole page
      }
    }
  }

  return results;
}

/* -------------------------- Text layout -------------------------- */

function detectFontSize(transform: number[]): number {
  const scaleY = Math.abs(transform[3] || 1);
  return Math.max(8, Math.min(Math.round(scaleY), 72));
}

function groupItemsIntoLines(items: PdfTextItem[]): PdfTextItem[][] {
  if (items.length === 0) return [];

  const lines: PdfTextItem[][] = [];
  let currentLine: PdfTextItem[] = [];
  let lastY = -1;
  const yThreshold = 4;

  for (const item of items) {
    const y = item.transform[5];

    if (lastY > 0 && Math.abs(y - lastY) > yThreshold) {
      if (currentLine.length > 0) {
        currentLine.sort((a, b) => a.transform[4] - b.transform[4]);
        lines.push(currentLine);
      }
      currentLine = [];
    }

    currentLine.push(item);
    lastY = y;
  }

  if (currentLine.length > 0) {
    currentLine.sort((a, b) => a.transform[4] - b.transform[4]);
    lines.push(currentLine);
  }

  return lines;
}

function groupLinesIntoParagraphs(lines: PdfTextItem[][]): { lines: PdfTextItem[]; y: number; indent: number }[] {
  if (lines.length === 0) return [];

  const paragraphs: { lines: PdfTextItem[]; y: number; indent: number }[] = [];
  let currentPara: PdfTextItem[] = [];
  let lastY = -1;
  const paraThreshold = 12;

  for (const line of lines) {
    if (line.length === 0) continue;
    const y = line[0].transform[5];

    if (lastY > 0 && lastY - y > paraThreshold) {
      if (currentPara.length > 0) {
        const avgY = currentPara.reduce((sum, item) => sum + item.transform[5], 0) / currentPara.length;
        const minX = Math.min(...currentPara.map((item) => item.transform[4]));
        paragraphs.push({ lines: currentPara, y: avgY, indent: Math.max(0, minX - 50) });
      }
      currentPara = [];
    }

    currentPara.push(...line);
    lastY = y;
  }

  if (currentPara.length > 0) {
    const avgY = currentPara.reduce((sum, item) => sum + item.transform[5], 0) / currentPara.length;
    const minX = Math.min(...currentPara.map((item) => item.transform[4]));
    paragraphs.push({ lines: currentPara, y: avgY, indent: Math.max(0, minX - 50) });
  }

  return paragraphs;
}

/* -------------------------- Table detection (fixed) -------------------------- */

/**
 * Detects real column boundaries using the GAP BETWEEN items (prev item's
 * end vs next item's start), not raw word x-positions. A candidate boundary
 * must also recur across a meaningful fraction of rows at roughly the same
 * x — a one-off wide gap between two words in a single cell (e.g. "Sati
 * Bajar   Area") won't repeat row after row, but a genuine column edge will.
 * This fixes cells being split mid-value (e.g. "Harsh Yashwant" | "Devang").
 */
function detectTableColumns(rowMap: Map<number, PdfTextItem[]>): number[] {
  const GAP_THRESHOLD = 25; // pt; gap larger than this is a candidate column break
  const candidateStarts: number[] = [];

  for (const rowItems of rowMap.values()) {
    const sorted = [...rowItems].sort((a, b) => a.transform[4] - b.transform[4]);
    if (sorted.length === 0) continue;
    candidateStarts.push(sorted[0].transform[4]);
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].transform[4] + sorted[i - 1].width;
      const gap = sorted[i].transform[4] - prevEnd;
      if (gap > GAP_THRESHOLD) candidateStarts.push(sorted[i].transform[4]);
    }
  }

  const freq = new Map<number, number>();
  for (const x of candidateStarts) {
    const bucket = Math.round(x / 12) * 12;
    freq.set(bucket, (freq.get(bucket) || 0) + 1);
  }

  const totalRows = Math.max(1, rowMap.size);
  const minFreq = Math.max(2, Math.floor(totalRows * 0.35));

  const columns = Array.from(freq.entries())
    .filter(([, count]) => count >= minFreq)
    .map(([x]) => x)
    .sort((a, b) => a - b);

  const merged: number[] = [];
  for (const x of columns) {
    if (merged.length === 0 || x - merged[merged.length - 1] > 30) merged.push(x);
  }

  return merged;
}

function isTableLike(rowMap: Map<number, PdfTextItem[]>, columns: number[]): boolean {
  return rowMap.size >= 3 && columns.length >= 2;
}

function extractTableFromItems(items: PdfTextItem[]): { rows: string[][]; yKeys: Set<number> } | null {
  const rowMap = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const yKey = Math.round(item.transform[5] / 5) * 5;
    if (!rowMap.has(yKey)) rowMap.set(yKey, []);
    rowMap.get(yKey)!.push(item);
  }

  const columns = detectTableColumns(rowMap);
  if (!isTableLike(rowMap, columns)) return null;

  const sortedY = Array.from(rowMap.keys()).sort((a, b) => b - a);
  const rows: string[][] = [];
  const yKeys = new Set<number>();

  for (const y of sortedY) {
    const rowItems = [...rowMap.get(y)!].sort((a, b) => a.transform[4] - b.transform[4]);
    const cells: string[] = new Array(columns.length).fill("");

    for (const item of rowItems) {
      let colIdx = 0;
      for (let i = columns.length - 1; i >= 0; i--) {
        if (item.transform[4] >= columns[i] - 15) {
          colIdx = i;
          break;
        }
      }
      cells[colIdx] = cells[colIdx] ? `${cells[colIdx]} ${item.str}` : item.str;
    }

    const cleaned = cells.map((c) => cleanCellText(c.trim()));
    if (cleaned.some((c) => c)) {
      rows.push(cleaned);
      yKeys.add(y);
    }
  }

  if (rows.length < 2) return null;
  return { rows, yKeys };
}

/* -------------------------- DOCX building -------------------------- */

function createParagraphFromItems(items: PdfTextItem[], indent: number): Paragraph {
  if (items.length === 0) return new Paragraph({ children: [] });

  const runs: TextRun[] = [];
  let lastX = -1;

  for (const item of items) {
    const x = item.transform[4];
    const fontSize = detectFontSize(item.transform);

    if (lastX > 0 && x - lastX > 20) {
      runs.push(new TextRun({ text: " ", size: fontSize * 2 }));
    }

    runs.push(new TextRun({ text: item.str, size: fontSize * 2, font: "Calibri" }));
    lastX = x + item.width;
  }

  return new Paragraph({
    children: runs,
    indent: { left: Math.round(indent * 20) },
    spacing: { line: 276, after: 200 },
  });
}

function createTable(rows: string[][]): Table {
  const docxRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cellText) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: cellText || " ", size: 22, font: "Calibri" })],
                }),
              ],
              shading: { fill: "FFFFFF" },
            }),
        ),
      }),
  );

  return new Table({ rows: docxRows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function createImageParagraph(img: ExtractedImage): Paragraph {
  // docx ImageRun needs a size in px; convert pt -> px at 96dpi (pdf pt is 1/72in)
  const pxWidth = Math.round(img.width * (96 / 72));
  const pxHeight = Math.round(img.height * (96 / 72));

  return new Paragraph({
    children: [
      new ImageRun({
        data: img.bytes,
        transformation: { width: Math.max(20, pxWidth), height: Math.max(20, pxHeight) },
        type: "png",
      }),
    ],
    spacing: { before: 120, after: 120 },
  });
}

export async function convertPdfToWord(file: File): Promise<Blob> {
  const pdfDoc = await loadPdfDoc(file);
  const sections: Array<{
    properties: {
      page: {
        margin: { top: number; right: number; bottom: number; left: number };
        size: { width: number; height: number };
      };
    };
    children: Array<Paragraph | Table>;
  }> = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const pageInfo = await extractPageText(page);
    const images = await extractPageImages(page, pageInfo.height);

    const children: (Paragraph | Table)[] = [];

    if (pageInfo.items.length === 0 && images.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "[No content on this page]", size: 20 })] }));
    } else {
      const tableResult = extractTableFromItems(pageInfo.items);

      let remainingImages = [...images];

      if (tableResult) {
        children.push(createTable(tableResult.rows));

        const nonTableItems = pageInfo.items.filter((item) => {
          const yKey = Math.round(item.transform[5] / 5) * 5;
          return !tableResult.yKeys.has(yKey);
        });

        // Roughly determine the y-range covered by the table so we can
        // place images that fall inside that vertical span right after it,
        // matching the original page's visual order.
        const tableYs = Array.from(tableResult.yKeys);
        const tableTop = Math.max(...tableYs);
        const tableBottom = Math.min(...tableYs);

        const imagesInTable = remainingImages.filter(
          (img) => pageInfo.height - img.yFromTop <= tableTop + 20 && pageInfo.height - img.yFromTop >= tableBottom - 40,
        );
        imagesInTable.forEach((img) => children.push(createImageParagraph(img)));
        remainingImages = remainingImages.filter((img) => !imagesInTable.includes(img));

        const lines = groupItemsIntoLines(nonTableItems);
        const paragraphs = groupLinesIntoParagraphs(lines);
        for (const para of paragraphs) {
          const text = para.lines.map((i) => i.str).join(" ").trim();
          if (isPlaceholder(text)) continue;
          children.push(createParagraphFromItems(para.lines, para.indent));
        }
      } else {
        const lines = groupItemsIntoLines(pageInfo.items);
        const paragraphs = groupLinesIntoParagraphs(lines);
        for (const para of paragraphs) {
          const text = para.lines.map((i) => i.str).join(" ").trim();
          if (isPlaceholder(text)) continue;
          children.push(createParagraphFromItems(para.lines, para.indent));
        }
      }

      // Any images not matched into the table's y-range (e.g. signature
      // sitting below the table) get appended in page order at the end.
      remainingImages
        .sort((a, b) => a.yFromTop - b.yFromTop)
        .forEach((img) => children.push(createImageParagraph(img)));
    }

    if (children.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "", size: 22 })] }));
    }

    sections.push({
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
          size: { width: Math.round(pageInfo.width * 20), height: Math.round(pageInfo.height * 20) },
        },
      },
      children,
    });
  }

  if (sections.length === 0) {
    sections.push({
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
          size: { width: 12240, height: 15840 },
        },
      },
      children: [new Paragraph({ children: [new TextRun({ text: "No content found in PDF", size: 24 })] })],
    });
  }

  const doc = new Document({ sections });
  return Packer.toBlob(doc);
}

export async function extractPdfText(file: File): Promise<string[]> {
  const pdfDoc = await loadPdfDoc(file);
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    pages.push(text);
  }

  return pages;
}