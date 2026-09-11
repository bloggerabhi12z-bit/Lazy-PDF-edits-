import { Document, ImageRun, Packer, Paragraph } from "docx";
import { canvasToBlob, extractPdfText as extractPdfTextFromRender, loadPdf, renderPdfPageToCanvas } from "@/lib/pdf-render";

/**
 * Image-based PDF -> Word conversion.
 *
 * Strategy: each PDF page is rendered at high resolution (via pdf.js, same
 * renderer used for the on-screen preview) and placed as a single full-page
 * PNG image on a matching DOCX page. Page size and margins are set to match
 * the source PDF exactly, so tables, fonts, signatures, images, borders and
 * spacing are all preserved pixel-for-pixel — because the DOCX page *is* a
 * picture of the PDF page.
 *
 * Trade-off: the resulting Word document is not editable text — it is a
 * paginated image document, the same trade-off any "visual fidelity" PDF ->
 * Word conversion makes. This is the strategy the user explicitly chose.
 *
 * convertPdfToWord(file): Promise<Blob> keeps its existing signature so no
 * caller (AdvancedTools.tsx) needs to change.
 */

// Render scale: 1 PDF point = 1/72in. Rendering at this many px-per-point
// gives ~220 DPI, which is sharp enough for text/signatures without
// producing unreasonably large DOCX files.
const RENDER_SCALE = 3;

// docx's ImageRun `transformation` width/height are interpreted in pixels
// at 96 DPI (it converts px -> EMU using 9525 EMU/px, the 96 DPI constant).
// Page size in the Document section is in twips (1/20 pt).
const TWIPS_PER_POINT = 20;
const PIXELS_PER_POINT_AT_96DPI = 96 / 72;

export async function convertPdfToWord(file: File): Promise<Blob> {
  const pdf = await loadPdf(file);

  const sections: Array<{
    properties: {
      page: {
        margin: { top: number; right: number; bottom: number; left: number };
        size: { width: number; height: number };
      };
    };
    children: Paragraph[];
  }> = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    // Scale 1 viewport == PDF user-space units == points. Used only to get
    // the page's true point dimensions for the DOCX page size.
    const baseViewport = page.getViewport({ scale: 1 });
    const pageWidthPt = baseViewport.width;
    const pageHeightPt = baseViewport.height;

    const canvas = await renderPdfPageToCanvas(pdf, pageNumber, RENDER_SCALE);
    const pngBlob = await canvasToBlob(canvas, "image/png");
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());

    const imageWidthPx = Math.round(pageWidthPt * PIXELS_PER_POINT_AT_96DPI);
    const imageHeightPx = Math.round(pageHeightPt * PIXELS_PER_POINT_AT_96DPI);

    sections.push({
      properties: {
        page: {
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
          size: {
            width: Math.round(pageWidthPt * TWIPS_PER_POINT),
            height: Math.round(pageHeightPt * TWIPS_PER_POINT),
          },
        },
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [
            new ImageRun({
              data: pngBytes,
              transformation: {
                width: Math.max(1, imageWidthPx),
                height: Math.max(1, imageHeightPx),
              },
              type: "png",
            }),
          ],
        }),
      ],
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
      children: [new Paragraph({ children: [] })],
    });
  }

  const doc = new Document({ sections });
  return Packer.toBlob(doc);
}

// Kept for backward compatibility with any existing callers that import
// text extraction from this module; delegates to the shared implementation
// in pdf-render.ts rather than duplicating pdf.js text-content logic.
export async function extractPdfText(file: File): Promise<string[]> {
  return extractPdfTextFromRender(file);
}