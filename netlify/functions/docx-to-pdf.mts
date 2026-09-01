import { Handler, HandlerEvent } from "@netlify/functions";
import { execSync, spawnSync } from "child_process";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { extname, join, basename } from "path";
import { tmpdir } from "os";

interface ConversionResult {
  success: boolean;
  pdfBuffer?: Buffer;
  error?: string;
  message?: string;
}

/**
 * Detects if LibreOffice is available on the system.
 * Checks multiple common installation paths and PATH environment.
 */
function detectLibreOffice(): { path: string; version?: string } | null {
  const possiblePaths = [
    "libreoffice",
    "soffice",
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/usr/local/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ];

  for (const path of possiblePaths) {
    try {
      const result = spawnSync(path, ["--version"], {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      });
      
      if (result.status === 0) {
        const version = result.stdout?.toString().trim() || undefined;
        console.log(`Found LibreOffice at ${path}: ${version}`);
        return { path, version };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Converts a DOCX file to PDF using LibreOffice headless mode.
 * Returns a Buffer containing the PDF data.
 */
async function convertDocxToPdfLibreOffice(docxBuffer: Buffer): Promise<ConversionResult> {
  const libreOffice = detectLibreOffice();
  
  if (!libreOffice) {
    return {
      success: false,
      error: "LibreOffice not available",
      message: "This server is not configured for DOCX→PDF conversion. LibreOffice is required. " +
        "For setup instructions, see: /docs/DOCX_TO_PDF_IMPLEMENTATION.md",
    };
  }

  // Create a temporary directory for processing
  let tempDir: string | null = null;
  let docxPath: string | null = null;
  let pdfPath: string | null = null;

  try {
    tempDir = mkdtempSync(join(tmpdir(), "docx-convert-"));
    docxPath = join(tempDir, "document.docx");
    pdfPath = join(tempDir, "document.pdf");

    // Write DOCX buffer to temp file
    writeFileSync(docxPath, docxBuffer);

    // Run LibreOffice headless conversion
    // Using the export filter ensures proper PDF generation
    const result = spawnSync(
      libreOffice.path,
      [
        "--headless",
        "--convert-to", "pdf:writer_pdf_Export:author=Lazy-PDF",
        "--outdir", tempDir,
        docxPath,
      ],
      {
        timeout: 60000, // 60 seconds timeout
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      }
    );

    // Log conversion attempt for debugging
    console.log("LibreOffice conversion:", {
      path: libreOffice.path,
      status: result.status,
      signal: result.signal,
      stderr: result.stderr?.substring(0, 200),
    });

    if (result.error) {
      return {
        success: false,
        error: "Process execution failed",
        message: `Failed to execute LibreOffice: ${result.error.message}`,
      };
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.trim() || "";
      
      // Common LibreOffice errors
      if (stderr.includes("UnsupportedEncoding")) {
        return {
          success: false,
          error: "Unsupported document encoding",
          message: "The document contains unsupported character encoding.",
        };
      }

      if (stderr.includes("Stream")) {
        return {
          success: false,
          error: "Document corruption detected",
          message: "The DOCX file appears to be corrupted or partially damaged.",
        };
      }

      return {
        success: false,
        error: "Conversion failed",
        message: stderr || `LibreOffice conversion failed (exit code ${result.status}). The document may be incompatible.`,
      };
    }

    // Check if PDF was created
    if (!existsSync(pdfPath)) {
      return {
        success: false,
        error: "PDF not generated",
        message: "LibreOffice did not produce a PDF output. The document may be unsupported.",
      };
    }

    // Read and validate PDF
    const pdfBuffer = readFileSync(pdfPath);
    
    if (pdfBuffer.length === 0) {
      return {
        success: false,
        error: "Empty PDF",
        message: "The conversion produced an empty PDF. The document may be blank or corrupted.",
      };
    }

    // Validate PDF magic bytes (%PDF)
    if (pdfBuffer.length < 4 || !pdfBuffer.subarray(0, 4).equals(Buffer.from("%PDF"))) {
      return {
        success: false,
        error: "Invalid PDF",
        message: "The generated file is not a valid PDF.",
      };
    }

    return {
      success: true,
      pdfBuffer,
    };
  } catch (error) {
    console.error("DOCX to PDF conversion error:", error);
    return {
      success: false,
      error: "Conversion error",
      message: error instanceof Error ? error.message : "Unknown error during conversion.",
    };
  } finally {
    // Cleanup temporary files - be aggressive to prevent disk space issues
    try {
      if (docxPath && existsSync(docxPath)) {
        unlinkSync(docxPath);
      }
      if (pdfPath && existsSync(pdfPath)) {
        unlinkSync(pdfPath);
      }
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error("Error cleaning up temporary files:", cleanupError);
      // Don't throw - cleanup errors shouldn't fail the conversion
    }
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
    const result = await convertDocxToPdfLibreOffice(docxBuffer);

    if (!result.success) {
      const statusCode = result.error === "LibreOffice not available" ? 503 : 400;
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
