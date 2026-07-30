import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function safeText(value: string) {
  // eslint-disable-next-line no-control-regex -- intentional: strip to WinAnsi-safe chars for pdf-lib's StandardFonts
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ");
}

function wrapText(text: string, maxChars = 92) {
  const words = safeText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function createTextPdf(
  title: string,
  sections: Array<{ heading: string; body: string }>,
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };
  const drawLine = (line: string, size = 10, isBold = false) => {
    if (y < margin) newPage();
    page.drawText(safeText(line), {
      x: margin,
      y,
      size,
      font: isBold ? bold : font,
      color: rgb(0.12, 0.13, 0.14),
    });
    y -= size + 5;
  };

  drawLine(title, 18, true);
  y -= 12;
  for (const section of sections) {
    drawLine(section.heading, 13, true);
    y -= 2;
    const paragraphs = section.body.split(/\n{2,}/);
    for (const paragraph of paragraphs) {
      for (const line of wrapText(paragraph)) drawLine(line, 10);
      y -= 6;
    }
    y -= 8;
  }
  return doc.save();
}

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}