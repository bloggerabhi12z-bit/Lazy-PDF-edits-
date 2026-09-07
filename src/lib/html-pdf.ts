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

const HOST_WIDTH = 720; // CSS px, matches padding below
const HOST_PADDING = 48;

/**
 * Walk the rendered host and collect the CSS-pixel Y coordinates that sit
 * *between* top-level elements (and between block children inside them).
 * These are the only positions it is safe to cut a page at — cutting
 * anywhere else risks slicing a line of text or an image in half.
 */
function collectSafeBreaks(host: HTMLElement): number[] {
  const breaks = new Set<number>([0]);
  const hostTop = host.getBoundingClientRect().top;

  const visit = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const style = window.getComputedStyle(child);
      // Only block-level boxes make sensible break points; inline runs
      // (bold/italic spans, links, etc.) must never be split mid-element.
      if (style.display === "none") continue;
      const rect = (child as HTMLElement).getBoundingClientRect();
      if (style.display.includes("block") || style.display === "table" || style.display === "list-item" || style.display === "flex") {
        breaks.add(rect.top - hostTop);
        breaks.add(rect.bottom - hostTop);
        // Recurse so we can also break between paragraphs inside e.g. a <div>
        // or between table rows, without breaking inside a single row's cells.
        if (child.tagName === "TABLE") {
          for (const row of Array.from(child.querySelectorAll(":scope > tbody > tr, :scope > tr"))) {
            const r = row.getBoundingClientRect();
            breaks.add(r.top - hostTop);
            breaks.add(r.bottom - hostTop);
          }
        } else {
          visit(child);
        }
      }
    }
  };
  visit(host);
  const sorted = Array.from(breaks).filter((y) => y >= 0).sort((a, b) => a - b);
  return sorted;
}

/** Render browser HTML to paginated PDF pages, breaking only between block
 * elements so text lines, table rows, and images are never sliced in half. */
export async function renderHtmlPdf(html: string, title = "Document") {
  const host = document.createElement("article");
  host.setAttribute("aria-label", title);
  host.style.cssText = [
    "position:fixed", "left:-100000px", "top:0", `width:${HOST_WIDTH}px`, `padding:${HOST_PADDING}px`,
    "box-sizing:border-box", "background:#fff", "color:#111827", "font:16px/1.5 Arial, sans-serif",
    "overflow:visible", "word-wrap:break-word",
  ].join(";");
  host.innerHTML = sanitiseHtml(html);
  document.body.appendChild(host);

  try {
    await document.fonts?.ready;
    // Let images inside the HTML finish loading before we measure/rasterize.
    const images = Array.from(host.querySelectorAll("img"));
    await Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            })
      )
    );

    const safeBreaksCss = collectSafeBreaks(host);
    const totalHeightCss = Math.ceil(host.getBoundingClientRect().height);
    if (safeBreaksCss[safeBreaksCss.length - 1] < totalHeightCss) safeBreaksCss.push(totalHeightCss);

    const pixelRatio = 2; // sharper text than the previous pixelRatio:1
    const canvas = await toCanvas(host, { backgroundColor: "#ffffff", pixelRatio, cacheBust: true });
    const scale = canvas.width / HOST_WIDTH; // css px -> canvas px

    const drawWidth = LETTER_WIDTH - PAGE_MARGIN * 2;
    const maxPageHeightCss = (LETTER_HEIGHT - PAGE_MARGIN * 2) * (HOST_WIDTH / drawWidth);

    // Build page boundaries in CSS px, snapping each page end to the last
    // safe break at or before the max page height so nothing gets cut.
    const pageBoundariesCss: number[] = [];
    let cursor = 0;
    while (cursor < totalHeightCss - 0.5) {
      const limit = cursor + maxPageHeightCss;
      let candidate = safeBreaksCss.filter((y) => y > cursor && y <= limit).pop();
      if (candidate === undefined) {
        // No safe break fits on one page (a very tall single block, e.g. a
        // huge image) — fall back to a hard cut so we still make progress.
        candidate = Math.min(cursor + maxPageHeightCss, totalHeightCss);
      }
      pageBoundariesCss.push(candidate);
      cursor = candidate;
    }

    const pdf = await PDFDocument.create();
    let prevCss = 0;
    for (const boundaryCss of pageBoundariesCss) {
      const sliceTop = Math.round(prevCss * scale);
      const sliceHeightPx = Math.max(1, Math.round((boundaryCss - prevCss) * scale));
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceHeightPx;
      const context = slice.getContext("2d");
      if (!context) throw new Error("Canvas is not available in this browser.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, slice.width, slice.height);
      context.drawImage(canvas, 0, sliceTop, canvas.width, sliceHeightPx, 0, 0, slice.width, sliceHeightPx);
      const image = await pdf.embedPng(slice.toDataURL("image/png"));
      const page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
      const drawHeight = sliceHeightPx * (drawWidth / canvas.width);
      page.drawImage(image, {
        x: PAGE_MARGIN,
        y: LETTER_HEIGHT - PAGE_MARGIN - drawHeight,
        width: drawWidth,
        height: drawHeight,
      });
      prevCss = boundaryCss;
    }

    return new Blob([await pdf.save() as BlobPart], { type: "application/pdf" });
  } finally {
    host.remove();
  }
}