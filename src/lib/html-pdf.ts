import { toCanvas } from "html-to-image";
import { PDFDocument } from "pdf-lib";

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const PAGE_MARGIN = 36;

function sanitiseHtml(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, iframe, object, embed").forEach((node) => node.remove());
  document.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith("on")) node.removeAttribute(attribute.name);
    });
  });
  return document.body.innerHTML;
}

/** Render browser HTML to paginated PDF pages without sending document contents anywhere. */
export async function renderHtmlPdf(html: string, title = "Document") {
  const host = document.createElement("article");
  host.setAttribute("aria-label", title);
  host.style.cssText = [
    "position:fixed", "left:-100000px", "top:0", "width:720px", "padding:48px",
    "box-sizing:border-box", "background:#fff", "color:#111827", "font:16px/1.5 Arial, sans-serif",
    "overflow:visible",
  ].join(";");
  host.innerHTML = sanitiseHtml(html);
  document.body.appendChild(host);

  try {
    await document.fonts?.ready;
    const canvas = await toCanvas(host, { backgroundColor: "#ffffff", pixelRatio: 1, cacheBust: true });
    const pdf = await PDFDocument.create();
    const printableHeight = Math.floor((LETTER_HEIGHT - PAGE_MARGIN * 2) * (canvas.width / (LETTER_WIDTH - PAGE_MARGIN * 2)));

    for (let offset = 0; offset < canvas.height; offset += printableHeight) {
      const sliceHeight = Math.min(printableHeight, canvas.height - offset);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceHeight;
      const context = slice.getContext("2d");
      if (!context) throw new Error("Canvas is not available in this browser.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, slice.width, slice.height);
      context.drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, slice.width, sliceHeight);
      const image = await pdf.embedPng(slice.toDataURL("image/png"));
      const page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
      const drawWidth = LETTER_WIDTH - PAGE_MARGIN * 2;
      page.drawImage(image, {
        x: PAGE_MARGIN,
        y: LETTER_HEIGHT - PAGE_MARGIN - sliceHeight * (drawWidth / canvas.width),
        width: drawWidth,
        height: sliceHeight * (drawWidth / canvas.width),
      });
    }
    return new Blob([await pdf.save() as BlobPart], { type: "application/pdf" });
  } finally {
    host.remove();
  }
}
