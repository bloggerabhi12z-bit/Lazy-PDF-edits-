import { PDFDocument } from "pdf-lib";
import { toCanvas } from "html-to-image";

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const PAGE_MARGIN = 48;

const HOST_WIDTH = 720;
const HOST_PADDING = 48;

function sanitiseHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "");
}

function collectSafeBreaks(host: HTMLElement): number[] {
  const breaks = new Set<number>([0]);
  const hostTop = host.getBoundingClientRect().top;

  const visit = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const style = window.getComputedStyle(child);

      if (style.display === "none") {
        continue;
      }

      const rect = (child as HTMLElement).getBoundingClientRect();

      if (
        style.display.includes("block") ||
        style.display === "table" ||
        style.display === "list-item" ||
        style.display === "flex"
      ) {
        breaks.add(rect.top - hostTop);
        breaks.add(rect.bottom - hostTop);

        if (child.tagName === "TABLE") {
          for (const row of Array.from(
            child.querySelectorAll(
              ":scope > tbody > tr, :scope > tr"
            )
          )) {
            const rowRect = row.getBoundingClientRect();

            breaks.add(rowRect.top - hostTop);
            breaks.add(rowRect.bottom - hostTop);
          }
        } else {
          visit(child);
        }
      }
    }
  };

  visit(host);

  return Array.from(breaks)
    .filter((y) => y >= 0)
    .sort((a, b) => a - b);
}

/**
 * Render browser HTML to a paginated PDF.
 *
 * Page breaks are placed between block elements where possible,
 * preventing paragraphs, table rows and images from being cut in half.
 */
export async function renderHtmlPdf(
  html: string,
  title = "Document"
): Promise<Blob> {
  const host = document.createElement("article");

  host.setAttribute("aria-label", title);

  host.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    `width:${HOST_WIDTH}px`,
    `padding:${HOST_PADDING}px`,
    "box-sizing:border-box",
    "background:#fff",
    "color:#111827",
    "font:16px/1.5 Arial, sans-serif",
    "overflow:visible",
    "word-wrap:break-word",
  ].join(";");

  host.innerHTML = sanitiseHtml(html);

  document.body.appendChild(host);

  try {
    await document.fonts?.ready;

    const images = Array.from(host.querySelectorAll("img"));

    await Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener(
                "load",
                () => resolve(),
                { once: true }
              );

              img.addEventListener(
                "error",
                () => resolve(),
                { once: true }
              );
            })
      )
    );

    const safeBreaksCss = collectSafeBreaks(host);

    const totalHeightCss = Math.ceil(
      host.getBoundingClientRect().height
    );

    if (
      safeBreaksCss[safeBreaksCss.length - 1] <
      totalHeightCss
    ) {
      safeBreaksCss.push(totalHeightCss);
    }

    const pixelRatio = 2;

    const canvas = await toCanvas(host, {
      backgroundColor: "#ffffff",
      pixelRatio,
      cacheBust: true,
    });

    const scale = canvas.width / HOST_WIDTH;

    const drawWidth =
      LETTER_WIDTH - PAGE_MARGIN * 2;

    const maxPageHeightCss =
      (LETTER_HEIGHT - PAGE_MARGIN * 2) *
      (HOST_WIDTH / drawWidth);

    const pageBoundariesCss: number[] = [];

    let cursor = 0;

    while (cursor < totalHeightCss - 0.5) {
      const limit = cursor + maxPageHeightCss;

      let candidate = safeBreaksCss
        .filter(
          (y) =>
            y > cursor &&
            y <= limit
        )
        .pop();

      if (candidate === undefined) {
        candidate = Math.min(
          cursor + maxPageHeightCss,
          totalHeightCss
        );
      }

      pageBoundariesCss.push(candidate);

      cursor = candidate;
    }

    const pdf = await PDFDocument.create();

    let previousCss = 0;

    for (const boundaryCss of pageBoundariesCss) {
      const sliceTop = Math.round(
        previousCss * scale
      );

      const sliceHeightPx = Math.max(
        1,
        Math.round(
          (boundaryCss - previousCss) * scale
        )
      );

      const slice = document.createElement("canvas");

      slice.width = canvas.width;
      slice.height = sliceHeightPx;

      const context = slice.getContext("2d");

      if (!context) {
        throw new Error(
          "Canvas is not available in this browser."
        );
      }

      context.fillStyle = "#ffffff";

      context.fillRect(
        0,
        0,
        slice.width,
        slice.height
      );

      context.drawImage(
        canvas,
        0,
        sliceTop,
        canvas.width,
        sliceHeightPx,
        0,
        0,
        canvas.width,
        sliceHeightPx
      );

      const image = await pdf.embedPng(
        slice.toDataURL("image/png")
      );

      const page = pdf.addPage([
        LETTER_WIDTH,
        LETTER_HEIGHT,
      ]);

      const drawHeight =
        sliceHeightPx *
        (drawWidth / canvas.width);

      page.drawImage(image, {
        x: PAGE_MARGIN,
        y:
          LETTER_HEIGHT -
          PAGE_MARGIN -
          drawHeight,
        width: drawWidth,
        height: drawHeight,
      });

      previousCss = boundaryCss;
    }

    return new Blob(
      [(await pdf.save()) as BlobPart],
      {
        type: "application/pdf",
      }
    );
  } finally {
    host.remove();
  }
}