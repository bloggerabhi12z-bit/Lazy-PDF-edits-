import { renderHtmlPdf } from "./html-pdf";

/**
 * Convert a .docx file to a PDF blob.
 *
 * Mammoth converts the DOCX into HTML, then the HTML renderer
 * creates the paginated PDF.
 */
export async function renderWordToPdfMammoth(file: File): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();

  if (arrayBuffer.byteLength === 0) {
    throw new Error("The document is empty or contains no convertible content.");
  }

  const { default: mammoth } = await import("mammoth/mammoth.browser");

  let html: string;

  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: mammoth.images.imgElement((image) =>
          image.read("base64").then((imageBuffer) => ({
            src: `data:${image.contentType};base64,${imageBuffer}`,
          }))
        ),
      }
    );

    html = result.value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/central directory|not a valid zip|corrupt/i.test(message)) {
      throw new Error(
        "The file appears to be corrupted or not a valid DOCX document."
      );
    }

    throw new Error(`Unsupported document formatting: ${message}`);
  }

  if (!html || !html.replace(/<[^>]+>/g, "").trim()) {
    throw new Error(
      "The document is empty or contains no convertible content."
    );
  }

  const styledHtml = `
    <style>
      article, article * {
        box-sizing: border-box;
      }

      h1, h2, h3, h4, h5, h6 {
        font-family: Arial, sans-serif;
        font-weight: 700;
        margin: 0.8em 0 0.4em;
        color: #9d174d;
      }

      h1 {
        font-size: 24px;
        border-bottom: 2px solid #9d174d;
        padding-bottom: 4px;
      }

      h2 {
        font-size: 20px;
        border-bottom: 2px solid #9d174d;
        padding-bottom: 4px;
      }

      h3 {
        font-size: 17px;
      }

      p {
        margin: 0 0 0.75em;
        white-space: pre-wrap;
      }

      /* Lists */
      ul, ol {
        margin: 0 0 0.75em;
        padding: 0;
        list-style: none;
      }

      li {
        position: relative;
        margin-bottom: 0.25em;
        padding-left: 1.4em;
      }

      ul > li::before {
        content: "•";
        position: absolute;
        left: 0.3em;
        top: 0;
      }

      ol {
        counter-reset: ol-counter;
      }

      ol > li {
        counter-increment: ol-counter;
      }

      ol > li::before {
        content: counter(ol-counter) ".";
        position: absolute;
        left: 0;
        top: 0;
      }

      table {
        border-collapse: collapse;
        width: 100%;
        margin: 0 0 1em;
        table-layout: auto;
      }

      table, th, td {
        border: 1px solid #d1d5db;
      }

      th, td {
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
        min-width: 60px;
        overflow-wrap: normal;
        word-break: normal;
      }

      img {
        max-width: 100%;
        height: auto;
      }

      a {
        color: #2563eb;
      }

      strong, b {
        font-weight: 700;
      }

      em, i {
        font-style: italic;
      }
    </style>

    ${html}
  `;

  return renderHtmlPdf(
    styledHtml,
    file.name.replace(/\.docx?$/i, "") || "Document"
  );
}