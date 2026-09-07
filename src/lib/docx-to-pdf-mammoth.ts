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
        color: #111827;
      }

      h1 {
        font-size: 24px;
      }

      h2 {
        font-size: 20px;
      }

      h3 {
        font-size: 17px;
      }

      p {
        margin: 0 0 0.75em;
      }

      ul, ol {
        margin: 0 0 0.75em;
        padding-left: 1.5em;
      }

      li {
        margin-bottom: 0.25em;
      }

      table {
        border-collapse: collapse;
        width: 100%;
        margin: 0 0 1em;
      }

      table, th, td {
        border: 1px solid #d1d5db;
      }

      th, td {
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
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