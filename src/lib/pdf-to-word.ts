import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle as DocxBorderStyle, ShadingType } from "docx";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

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

async function loadPdfDoc(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

async function extractPageText(page: Awaited<ReturnType<Awaited<typeof loadPdfDoc>["getPage"]>>): Promise<PdfPageInfo> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  
  const items: PdfTextItem[] = content.items
    .filter((item): item is Extract<typeof item, { str?: string }> => "str" in item && item.str?.trim())
    .map((item) => ({
      str: item.str || "",
      transform: item.transform || [0, 0, 0, 0, 0, 0],
      width: item.width || 0,
      height: item.height || 0,
    }));

  return {
    pageNumber: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    items,
  };
}

function detectFontSize(transform: number[]): number {
  const scaleY = Math.abs(transform[3] || 1);
  return Math.max(8, Math.min(Math.round(scaleY), 72));
}

function isBold(fontName?: string): boolean {
  if (!fontName) return false;
  return fontName.toLowerCase().includes("bold");
}

function isItalic(fontName?: string): boolean {
  if (!fontName) return false;
  const fn = fontName.toLowerCase();
  return fn.includes("italic") || fn.includes("oblique");
}

function groupItemsIntoLines(items: PdfTextItem[], pageHeight: number): PdfTextItem[][] {
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

function groupLinesIntoParagraphs(lines: PdfTextItem[][], pageHeight: number): { lines: PdfTextItem[]; y: number; indent: number }[] {
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
        const minX = Math.min(...currentPara.map(item => item.transform[4]));
        paragraphs.push({ lines: currentPara, y: avgY, indent: Math.max(0, minX - 50) });
      }
      currentPara = [];
    }
    
    currentPara.push(...line);
    lastY = y;
  }
  
  if (currentPara.length > 0) {
    const avgY = currentPara.reduce((sum, item) => sum + item.transform[5], 0) / currentPara.length;
    const minX = Math.min(...currentPara.map(item => item.transform[4]));
    paragraphs.push({ lines: currentPara, y: avgY, indent: Math.max(0, minX - 50) });
  }
  
  return paragraphs;
}

function detectTableColumns(items: PdfTextItem[], pageWidth: number): number[] {
  const xPositions = new Set<number>();
  
  for (const item of items) {
    const x = Math.round(item.transform[4] / 20) * 20;
    xPositions.add(x);
  }
  
  const sorted = Array.from(xPositions).sort((a, b) => a - b);
  const columns: number[] = [];
  let lastX = -100;
  
  for (const x of sorted) {
    if (x - lastX > 40) {
      columns.push(x);
      lastX = x;
    }
  }
  
  return columns.length >= 2 ? columns : [];
}

function isTableLike(items: PdfTextItem[], pageWidth: number): boolean {
  if (items.length < 6) return false;
  
  const columns = detectTableColumns(items, pageWidth);
  if (columns.length < 2) return false;
  
  const uniqueY = new Set(items.map(i => Math.round(i.transform[5] / 8) * 8));
  return uniqueY.size >= 3 && columns.length >= 2;
}

function extractTableFromItems(items: PdfTextItem[], pageWidth: number): { rows: string[][]; x: number } | null {
  if (!isTableLike(items, pageWidth)) return null;
  
  const columns = detectTableColumns(items, pageWidth);
  if (columns.length < 2) return null;
  
  const itemsByY = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const yKey = Math.round(item.transform[5] / 5) * 5;
    if (!itemsByY.has(yKey)) itemsByY.set(yKey, []);
    itemsByY.get(yKey)!.push(item);
  }
  
  const sortedY = Array.from(itemsByY.keys()).sort((a, b) => b - a);
  const rows: string[][] = [];
  
  for (const y of sortedY) {
    const rowItems = itemsByY.get(y)!;
    const cells: string[] = [];
    
    for (let i = 0; i < columns.length; i++) {
      const colX = columns[i];
      const colItems = rowItems.filter(item => {
        const itemX = item.transform[4];
        return Math.abs(itemX - colX) < 35;
      });
      cells.push(colItems.map(i => i.str).join(" ").trim());
    }
    
    if (cells.some(c => c)) {
      rows.push(cells);
    }
  }
  
  if (rows.length < 2) return null;
  
  return { rows, x: columns[0] };
}

function createParagraphFromItems(items: PdfTextItem[], indent: number): Paragraph {
  if (items.length === 0) {
    return new Paragraph({ children: [] });
  }
  
  const runs: TextRun[] = [];
  let lastX = -1;
  
  for (const item of items) {
    const x = item.transform[4];
    const fontSize = detectFontSize(item.transform);
    
    if (lastX > 0 && x - lastX > 20) {
      runs.push(new TextRun({ text: " ", size: fontSize * 2 }));
    }
    
    runs.push(new TextRun({
      text: item.str,
      size: fontSize * 2,
      font: "Calibri",
    }));
    
    lastX = x + item.width;
  }
  
  return new Paragraph({
    children: runs,
    indent: {
      left: Math.round(indent * 20),
    },
    spacing: {
      line: 276,
      after: 200,
    },
  });
}

function createTable(rows: string[][]): Table {
  const docxRows = rows.map(row => {
    const cells = row.map(cellText => {
      return new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: cellText || " ",
                size: 22,
                font: "Calibri",
              }),
            ],
          }),
        ],
        shading: {
          fill: "FFFFFF",
        },
      });
    });
    
    return new TableRow({
      children: cells,
    });
  });
  
  return new Table({
    rows: docxRows,
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
  });
}

export async function convertPdfToWord(file: File): Promise<Blob> {
  const pdfDoc = await loadPdfDoc(file);
  const sections: Parameters<typeof Document>[0]["sections"] = [];
  
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const pageInfo = await extractPageText(page);
    
    const children: (Paragraph | Table)[] = [];
    
    if (pageInfo.items.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "[No text content on this page]", size: 20 })],
        })
      );
    } else {
      const tableResult = extractTableFromItems(pageInfo.items, pageInfo.width);
      
      if (tableResult && tableResult.rows.length >= 2) {
        children.push(createTable(tableResult.rows));
        
        const tableYValues = new Set<number>();
        for (const row of tableResult.rows) {
          for (const cell of row) {
            const matchedItem = pageInfo.items.find(i => i.str.includes(cell.substring(0, 10)));
            if (matchedItem) tableYValues.add(Math.round(matchedItem.transform[5] / 5) * 5);
          }
        }
        
        const nonTableItems = pageInfo.items.filter(item => {
          const yKey = Math.round(item.transform[5] / 5) * 5;
          return !tableYValues.has(yKey);
        });
        
        const lines = groupItemsIntoLines(nonTableItems, pageInfo.height);
        const paragraphs = groupLinesIntoParagraphs(lines, pageInfo.height);
        
        for (const para of paragraphs) {
          children.push(createParagraphFromItems(para.lines, para.indent));
        }
      } else {
        const lines = groupItemsIntoLines(pageInfo.items, pageInfo.height);
        const paragraphs = groupLinesIntoParagraphs(lines, pageInfo.height);
        
        for (const para of paragraphs) {
          children.push(createParagraphFromItems(para.lines, para.indent));
        }
      }
    }
    
    if (children.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "", size: 22 })],
        })
      );
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
      children: [
        new Paragraph({
          children: [new TextRun({ text: "No content found in PDF", size: 24 })],
        }),
      ],
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
      .map(item => "str" in item ? item.str : "")
      .filter(Boolean)
      .join(" ");
    pages.push(text);
  }
  
  return pages;
}