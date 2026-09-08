import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 8081);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 90_000;

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function corsHeaders(origin) {
  const allowed =
    origin &&
    (ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has(origin));

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers":
      "Content-Disposition, Content-Length",
    Vary: "Origin",
  };
}

function sendJson(res, status, body, origin) {
  const payload = JSON.stringify(body);

  res.writeHead(status, {
    ...corsHeaders(origin),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  res.end(payload);
}

function sendPdf(res, pdf, filename, origin) {
  const safeFilename = filename.replace(/[\r\n"\\]/g, "_");

  res.writeHead(200, {
    ...corsHeaders(origin),
    "Content-Type": "application/pdf",
    "Content-Length": pdf.length,
    "Content-Disposition": `attachment; filename="${safeFilename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  res.end(pdf);
}

function isAllowedOrigin(origin) {
  return (
    !origin ||
    ALLOWED_ORIGINS.size === 0 ||
    ALLOWED_ORIGINS.has(origin)
  );
}

async function findLibreOffice() {
  const commands = [
    process.env.LIBREOFFICE_PATH,
    "libreoffice",
    "soffice",
  ].filter(Boolean);

  for (const command of commands) {
    const available = await new Promise((resolve) => {
      const child = spawn(
        command,
        ["--version"],
        {
          stdio: ["ignore", "pipe", "ignore"],
        },
      );

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(false);
      }, 5000);

      child.once("error", () => {
        clearTimeout(timer);
        resolve(false);
      });

      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });

    if (available) {
      return command;
    }
  }

  return null;
}

async function convertDocxToPdf(docx, originalName) {
  const root = await mkdtemp(
    join(tmpdir(), "lazypdf-docx-"),
  );

  const profile = join(root, "profile");
  const input = join(root, "document.docx");
  const output = join(root, "document.pdf");

  await mkdir(profile, { recursive: true });
  await writeFile(input, docx);

  const libreOffice = await findLibreOffice();

  if (!libreOffice) {
    await rm(root, {
      recursive: true,
      force: true,
    });

    const error = new Error(
      "LibreOffice is not available on the conversion worker.",
    );

    error.code = "LIBREOFFICE_UNAVAILABLE";

    throw error;
  }

  try {
    await new Promise((resolve, reject) => {
      const args = [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=file://${profile}`,
        "--convert-to",
        "pdf:writer_pdf_Export",
        "--outdir",
        root,
        input,
      ];

      const child = spawn(libreOffice, args, {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");

        const error = new Error(
          "LibreOffice conversion timed out.",
        );

        error.code = "CONVERSION_TIMEOUT";

        reject(error);
      }, CONVERSION_TIMEOUT_MS);

      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.once("exit", (code, signal) => {
        clearTimeout(timer);

        if (code !== 0) {
          const error = new Error(
            stderr.trim() ||
              stdout.trim() ||
              `LibreOffice exited with code ${
                code ?? "unknown"
              }.`,
          );

          error.code = signal
            ? "CONVERSION_TERMINATED"
            : "CONVERSION_FAILED";

          reject(error);
          return;
        }

        resolve();
      });
    });

    if (!existsSync(output)) {
      const error = new Error(
        "LibreOffice completed without producing a PDF.",
      );

      error.code = "PDF_NOT_GENERATED";

      throw error;
    }

    const pdf = await readFile(output);

    if (
      pdf.length < 5 ||
      pdf.subarray(0, 5).toString() !== "%PDF-"
    ) {
      const error = new Error(
        "LibreOffice produced an invalid PDF.",
      );

      error.code = "INVALID_PDF";

      throw error;
    }

    const baseName =
      originalName
        .replace(/\.docx$/i, "")
        .trim() || "document";

    return {
      pdf,
      filename: `${baseName}.pdf`,
    };
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
}

async function parseUpload(req) {
  const contentLength = Number(
    req.headers["content-length"] || 0,
  );

  if (
    contentLength >
    MAX_FILE_SIZE + 2 * 1024 * 1024
  ) {
    const error = new Error(
      "Request exceeds the 50 MB upload limit.",
    );

    error.code = "PAYLOAD_TOO_LARGE";

    throw error;
  }

  const request = new Request(
    `http://localhost:${PORT}/convert`,
    {
      method: "POST",
      headers: req.headers,
      body: req,
      duplex: "half",
    },
  );

  const form = await request.formData();
  const value = form.get("file");

  if (!(value instanceof File)) {
    const error = new Error(
      "No DOCX file was provided in the file field.",
    );

    error.code = "MISSING_FILE";

    throw error;
  }

  if (value.size === 0) {
    const error = new Error(
      "The uploaded file is empty.",
    );

    error.code = "EMPTY_FILE";

    throw error;
  }

  if (value.size > MAX_FILE_SIZE) {
    const error = new Error(
      "File size exceeds the 50 MB limit.",
    );

    error.code = "PAYLOAD_TOO_LARGE";

    throw error;
  }

  const name = value.name || "document.docx";

  if (!/\.docx$/i.test(name)) {
    const error = new Error(
      "Only .docx files are supported.",
    );

    error.code = "INVALID_FILE_TYPE";

    throw error;
  }

  const buffer = Buffer.from(
    await value.arrayBuffer(),
  );

  const isZip = buffer
    .subarray(0, 4)
    .equals(
      Buffer.from([
        0x50,
        0x4b,
        0x03,
        0x04,
      ]),
    );

  if (buffer.length < 4 || !isZip) {
    const error = new Error(
      "The uploaded file is not a valid DOCX package.",
    );

    error.code = "INVALID_FILE_TYPE";

    throw error;
  }

  return {
    buffer,
    name,
  };
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;

  if (!isAllowedOrigin(origin)) {
    sendJson(
      res,
      403,
      {
        error: "ORIGIN_NOT_ALLOWED",
        message: "Origin not allowed.",
      },
      origin,
    );

    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(
      204,
      corsHeaders(origin),
    );

    res.end();

    return;
  }

  if (
    req.method === "GET" &&
    req.url === "/health"
  ) {
    const libreOffice =
      await findLibreOffice();

    sendJson(
      res,
      libreOffice ? 200 : 503,
      {
        ok: Boolean(libreOffice),
        service: "docx-converter",
        libreOffice: libreOffice
          ? "available"
          : "unavailable",
      },
      origin,
    );

    return;
  }

  if (
    req.method !== "POST" ||
    req.url !== "/convert"
  ) {
    sendJson(
      res,
      404,
      {
        error: "NOT_FOUND",
        message: "Not found.",
      },
      origin,
    );

    return;
  }

  try {
    const {
      buffer,
      name,
    } = await parseUpload(req);

    const result =
      await convertDocxToPdf(
        buffer,
        name,
      );

    sendPdf(
      res,
      result.pdf,
      result.filename,
      origin,
    );
  } catch (error) {
    const requestId =
      randomUUID();

    console.error(
      "DOCX conversion failed",
      {
        requestId,
        code: error?.code,
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );

    let status = 500;

    if (
      error?.code ===
      "PAYLOAD_TOO_LARGE"
    ) {
      status = 413;
    } else if (
      error?.code ===
      "LIBREOFFICE_UNAVAILABLE"
    ) {
      status = 503;
    } else if (
      error?.code ===
      "CONVERSION_TIMEOUT"
    ) {
      status = 504;
    } else if (
      [
        "MISSING_FILE",
        "EMPTY_FILE",
        "INVALID_FILE_TYPE",
      ].includes(error?.code)
    ) {
      status = 400;
    }

    sendJson(
      res,
      status,
      {
        error:
          error?.code ||
          "CONVERSION_FAILED",

        message:
          error instanceof Error
            ? error.message
            : "Word to PDF conversion failed.",

        requestId,
      },
      origin,
    );
  }
});

server.requestTimeout =
  CONVERSION_TIMEOUT_MS + 15_000;

server.headersTimeout = 30_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, () => {
  console.log(
    `LazyPDF DOCX converter listening on port ${PORT}`,
  );
});