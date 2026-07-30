import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
};

type PdfPageProxy = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
};

export async function loadPdf(file: File, password?: string): Promise<PdfDocumentProxy> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data, password: password || undefined }).promise as unknown as Promise<PdfDocumentProxy>;
}

export async function renderPdfPageToCanvas(pdf: PdfDocumentProxy, pageNumber: number, scale = 2) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

export async function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render image."))), mime, quality);
  });
}

export async function extractPdfText(file: File, password?: string) {
  const pdf = await loadPdf(file, password);
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str ?? "").join(" ").replace(/\s+/g, " ").trim());
  }
  return pages;
}
