// Thin adapter around `docx-to-pdf-wasm`. Kept separate from `docx-to-pdf.ts`
// (the existing pdf-lib renderer) so the old renderer stays untouched and can
// be used as a fallback. Feature-flagged: only attempted when
// VITE_ENABLE_WASM_WORD_TO_PDF is not explicitly "false".
//
// docx-to-pdf-wasm is a single-author, v0.1.0 package (unaudited, no track
// record). Treat failures as expected, not exceptional — always catch and
// fall back to the pdf-lib renderer.

import wasmUrl from "docx-to-pdf-wasm/wasm?url";

type WasmModule = WebAssembly.Module;

let cachedModulePromise: Promise<WasmModule> | undefined;

function isWasmWordToPdfEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_WASM_WORD_TO_PDF as string | undefined;
  return flag !== "false";
}

async function getWasmModule(): Promise<WasmModule> {
  if (!cachedModulePromise) {
    cachedModulePromise = WebAssembly.compileStreaming(fetch(wasmUrl)).catch((error) => {
      cachedModulePromise = undefined;
      throw error;
    });
  }
  return cachedModulePromise;
}

export class WordToPdfWasmUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `docx-to-pdf-wasm conversion failed: ${cause.message}`
        : "docx-to-pdf-wasm conversion failed.",
    );
    this.name = "WordToPdfWasmUnavailableError";
    this.cause = cause;
  }
}

export async function convertWordToPdfWithWasm(file: File): Promise<Blob> {
  if (!isWasmWordToPdfEnabled()) {
    throw new WordToPdfWasmUnavailableError(new Error("Feature flag disabled."));
  }

  try {
    const { convert } = await import("docx-to-pdf-wasm");
    const wasmModule = await getWasmModule();
    const docxBytes = new Uint8Array(await file.arrayBuffer());
    const pdfBytes = await convert(wasmModule, docxBytes);

    if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
      throw new Error("Converter returned an empty PDF.");
    }

    const buffer = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(buffer).set(pdfBytes);
    return new Blob([buffer], { type: "application/pdf" });
  } catch (error) {
    throw new WordToPdfWasmUnavailableError(error);
  }
}