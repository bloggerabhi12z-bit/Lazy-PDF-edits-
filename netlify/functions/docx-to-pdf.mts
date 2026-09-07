import { Handler, HandlerEvent } from "@netlify/functions";

const CONVERTER_URL = process.env.DOCX_CONVERTER_URL || "http://localhost:8080";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function extractFileFromMultipart(bodyBuffer: Buffer, boundary: string): Buffer | null {
  const boundaryStr = `--${boundary}`;
  const boundaryBuffer = Buffer.from(boundaryStr);
  
  let idx = bodyBuffer.indexOf(boundaryBuffer);
  if (idx === -1) return null;
  
  idx += boundaryBuffer.length;
  
  let headersEnd = bodyBuffer.indexOf("\r\n\r\n", idx);
  if (headersEnd === -1) {
    headersEnd = bodyBuffer.indexOf("\n\n", idx);
    if (headersEnd === -1) return null;
    idx = headersEnd + 2;
  } else {
    idx = headersEnd + 4;
  }
  
  let endIdx = bodyBuffer.indexOf(boundaryBuffer, idx);
  if (endIdx === -1) return null;
  
  if (bodyBuffer[endIdx - 2] === 13 && bodyBuffer[endIdx - 1] === 10) {
    endIdx -= 2;
  } else if (bodyBuffer[endIdx - 1] === 10) {
    endIdx -= 1;
  }
  
  return bodyBuffer.slice(idx, endIdx);
}

async function convertDocxToPdf(docxBuffer: Buffer): Promise<{ success: boolean; pdfBuffer?: Buffer; error?: string; message?: string }> {
  try {
    const formData = new FormData();
    const blob = new Blob([docxBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    formData.append("file", blob, "document.docx");
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    
    const response = await fetch(`${CONVERTER_URL}/convert`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      let message = "Conversion failed";
      try {
        const data = await response.json();
        message = data.message || data.error || message;
      } catch {}
      
      return {
        success: false,
        error: response.status === 503 ? "Service unavailable" : "Conversion failed",
        message,
      };
    }
    
    const pdfBuffer = await response.arrayBuffer();
    
    if (pdfBuffer.byteLength === 0) {
      return {
        success: false,
        error: "Empty PDF",
        message: "The conversion produced an empty PDF.",
      };
    }
    
    return {
      success: true,
      pdfBuffer: Buffer.from(pdfBuffer),
    };
  } catch (error) {
    console.error("Conversion error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    
    if (message.includes("aborted") || message.includes("timeout")) {
      return {
        success: false,
        error: "Timeout",
        message: "The document took too long to convert. Please try a smaller document.",
      };
    }
    
    if (message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("network")) {
      return {
        success: false,
        error: "Service unavailable",
        message: "Unable to connect to conversion service. Please ensure the service is running.",
      };
    }
    
    return {
      success: false,
      error: "Conversion error",
      message,
    };
  }
}

/**
 * Extracts file buffer from multipart form data.
 * This is a simplified parser that works for single file uploads.
 */
function extractFileFromMultipart(bodyBuffer: Buffer, boundary: string): Buffer | null {
  const boundaryStr = `--${boundary}`;
  const boundaryBuffer = Buffer.from(boundaryStr);
  
  // Find first boundary
  let idx = bodyBuffer.indexOf(boundaryBuffer);
  if (idx === -1) return null;
  
  // Move past first boundary
  idx += boundaryBuffer.length;
  
  // Find end of headers (double CRLF or double LF)
  let headersEnd = bodyBuffer.indexOf("\r\n\r\n", idx);
  if (headersEnd === -1) {
    headersEnd = bodyBuffer.indexOf("\n\n", idx);
    if (headersEnd === -1) return null;
    idx = headersEnd + 2;
  } else {
    idx = headersEnd + 4;
  }
  
  // Find next boundary (which marks end of file)
  let endIdx = bodyBuffer.indexOf(boundaryBuffer, idx);
  if (endIdx === -1) return null;
  
  // Remove trailing CRLF before boundary
  if (bodyBuffer[endIdx - 2] === 13 && bodyBuffer[endIdx - 1] === 10) {
    endIdx -= 2;
  } else if (bodyBuffer[endIdx - 1] === 10) {
    endIdx -= 1;
  }
  
  return bodyBuffer.slice(idx, endIdx);
}

/**
 * Handles DOCX to PDF conversion requests.
 * Expects multipart form data with file field containing the DOCX document.
 */
const handler: Handler = async (event: HandlerEvent) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Method not allowed",
        message: "Only POST requests are accepted.",
      }),
    };
  }

  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Bad request",
          message: "No file provided.",
        }),
      };
    }

    // Parse multipart boundary
    const contentType = event.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Bad request",
          message: "Invalid multipart form data (no boundary).",
        }),
      };
    }

    const boundary = boundaryMatch[1].replace(/^["']|["']$/g, "");
    const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf-8");
    
    // Extract file data
    const docxBuffer = extractFileFromMultipart(bodyBuffer, boundary);
    if (!docxBuffer || docxBuffer.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Bad request",
          message: "No file content found in request.",
        }),
      };
    }

    // Validate file size (50 MB limit)
    if (docxBuffer.length > 50 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Payload too large",
          message: "File size exceeds 50 MB limit.",
        }),
      };
    }

    // Validate DOCX magic bytes (ZIP file: 50 4B 03 04)
    if (docxBuffer.length < 4 || !docxBuffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Invalid file type",
          message: "File is not a valid DOCX document. Ensure the file is a valid .docx file.",
        }),
      };
    }

    // Perform conversion
    const result = await convertDocxToPdf(docxBuffer);

    if (!result.success) {
      const statusCode = result.error === "Service unavailable" ? 503 : 400;
      return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: result.error,
          message: result.message,
        }),
      };
    }

    // Return PDF as binary
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": result.pdfBuffer!.length.toString(),
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
      body: result.pdfBuffer!.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error("Unexpected error in DOCX to PDF handler:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Internal server error",
        message: "An unexpected error occurred during conversion.",
      }),
    };
  }
};

export { handler };
