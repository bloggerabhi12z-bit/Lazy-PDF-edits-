import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { marked } from "marked";
import { createWorker } from "tesseract.js";
import { Copy, FileMinus2, FileOutput, ImageDown, Loader2, ScanText, Trash2 } from "lucide-react";
import { DropZone } from "@/components/site/DropZone";
import { SingleFilePicker } from "@/components/site/SingleFilePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canvasToBlob, extractPdfText, loadPdf, renderPdfPageToCanvas } from "@/lib/pdf-render";
import { createTextPdf, stripHtml } from "@/lib/text-pdf";
import { downloadBlob, formatBytes } from "@/lib/download";
import { toast } from "sonner";

function PdfAction({ file, setFile, busy, run, children }: { file: File | null; setFile: (file: File | null) => void; busy: boolean; run: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      {!file ? <DropZone onFiles={(files) => setFile(files[0] ?? null)} accept={{ "application/pdf": [".pdf"] }} multiple={false} hint="Drop one PDF to begin." /> : <SingleFilePicker file={file} onChange={() => setFile(null)} />}
      <div className="flex justify-stretch sm:justify-end">
        <Button variant="action" size="xl" className="w-full sm:w-auto" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {children}
        </Button>
      </div>
    </div>
  );
}

export function DuplicatePagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const source = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      if (page < 1 || page > source.getPageCount() || copies < 1 || copies > 20) throw new Error("Choose a valid page and between 1 and 20 copies.");
      const output = await PDFDocument.create();
      for (let index = 0; index < source.getPageCount(); index += 1) {
        const [original] = await output.copyPages(source, [index]);
        output.addPage(original);
        if (index === page - 1) {
          const duplicates = await output.copyPages(source, Array.from({ length: copies }, () => index));
          duplicates.forEach((duplicate) => output.addPage(duplicate));
        }
      }
      downloadBlob(await output.save(), `lazy-pdf-duplicated-${file.name}`);
      toast.success("Pages duplicated.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not duplicate pages."); }
    finally { setBusy(false); }
  }
  return <PdfAction file={file} setFile={setFile} busy={busy} run={run}><Copy className="h-4 w-4" />Duplicate pages</PdfAction>;
}

export function RemoveMetadataTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      pdf.setTitle(""); pdf.setAuthor(""); pdf.setSubject(""); pdf.setKeywords([]); pdf.setCreator(""); pdf.setProducer("");
      downloadBlob(await pdf.save(), `lazy-pdf-no-metadata-${file.name}`);
      toast.success("Metadata removed.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not remove metadata."); }
    finally { setBusy(false); }
  }
  return <PdfAction file={file} setFile={setFile} busy={busy} run={run}><Trash2 className="h-4 w-4" />Remove metadata</PdfAction>;
}

export function RemoveBlankPagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const pages = await extractPdfText(file);
      const keep = pages.map((text, index) => text.trim() ? index : -1).filter((index) => index >= 0);
      if (!keep.length) throw new Error("No text-bearing pages were found.");
      if (keep.length === pages.length) throw new Error("No blank text pages were found.");
      const source = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const output = await PDFDocument.create();
      const copied = await output.copyPages(source, keep);
      copied.forEach((page) => output.addPage(page));
      downloadBlob(await output.save(), `lazy-pdf-no-blank-pages-${file.name}`);
      toast.success(`${pages.length - keep.length} blank pages removed.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not remove blank pages."); }
    finally { setBusy(false); }
  }
  return <PdfAction file={file} setFile={setFile} busy={busy} run={run}><FileMinus2 className="h-4 w-4" />Remove blank pages</PdfAction>;
}

export function MarkdownToPdfTool() {
  const [markdown, setMarkdown] = useState("# Markdown document\n\nWrite your content here, or choose a Markdown file.");
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!markdown.trim()) { toast.error("Add some Markdown first."); return; }
    setBusy(true);
    try {
      const html = await marked.parse(markdown);
      const pdf = await createTextPdf("Markdown document", [{ heading: "Markdown document", body: stripHtml(html) }]);
      downloadBlob(pdf, "lazy-pdf-markdown.pdf", "application/pdf");
      toast.success("Markdown PDF ready.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not convert Markdown."); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-6">
      <DropZone
        onFiles={async (files) => { const file = files[0]; if (file) setMarkdown(await file.text()); }}
        accept={{ "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] }}
        multiple={false}
        hint="Drop a Markdown file, or write below."
      />
      <Textarea value={markdown} onChange={(event) => setMarkdown(event.target.value)} className="min-h-72 font-mono" aria-label="Markdown content" />
      <div className="flex justify-stretch sm:justify-end"><Button variant="action" size="xl" className="w-full sm:w-auto" onClick={run} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}<FileOutput className="h-4 w-4" />Convert Markdown</Button></div>
    </div>
  );
}

export function OcrImagesTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!files.length) return;
    setBusy(true);
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    try {
      worker = await createWorker("eng");
      const output: string[] = [];
      for (const file of files) {
        const result = await worker.recognize(file);
        output.push(`## ${file.name}\n\n${result.data.text.trim()}`);
      }
      downloadBlob(new Blob([output.join("\n\n")], { type: "text/plain" }), "lazy-pdf-ocr-images.txt", "text/plain");
      toast.success("Image text ready.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "OCR failed."); }
    finally { await worker?.terminate(); setBusy(false); }
  }
  return (
    <div className="space-y-6">
      {files.length ? <div className="tool-surface p-5"><div className="font-medium">{files.length} images selected</div><div className="mt-1 text-sm text-muted-foreground">{formatBytes(files.reduce((total, file) => total + file.size, 0))}</div></div> : <DropZone onFiles={setFiles} accept={{ "image/*": [".png", ".jpg", ".jpeg", ".webp", ".bmp"] }} hint="Drop one or more images for OCR." />}
      <div className="flex justify-stretch sm:justify-end"><Button variant="action" size="xl" className="w-full sm:w-auto" onClick={run} disabled={!files.length || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}<ScanText className="h-4 w-4" />Read image text</Button></div>
    </div>
  );
}

export function PdfToLongImageTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const pdf = await loadPdf(file);
      const first = await renderPdfPageToCanvas(pdf, 1, 1.2);
      const gap = 24;
      const output = document.createElement("canvas");
      output.width = first.width;
      output.height = (first.height + gap) * pdf.numPages - gap;
      const context = output.getContext("2d");
      if (!context) throw new Error("Canvas is not available in this browser.");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, output.width, output.height);
      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = index === 1 ? first : await renderPdfPageToCanvas(pdf, index, 1.2);
        context.drawImage(page, 0, (page.height + gap) * (index - 1));
      }
      const blob = await canvasToBlob(output, "image/png");
      downloadBlob(blob, `lazy-pdf-long-${file.name.replace(/\.pdf$/i, "")}.png`, "image/png");
      toast.success("Long image ready.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create a long image."); }
    finally { setBusy(false); }
  }
  return <PdfAction file={file} setFile={setFile} busy={busy} run={run}><ImageDown className="h-4 w-4" />Create long image</PdfAction>;
}
