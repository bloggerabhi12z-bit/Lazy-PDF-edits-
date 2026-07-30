import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { Loader2, Trash2, MoveLeft, MoveRight, FileText, Plus } from "lucide-react";
import { toast } from "sonner";

interface RichFile {
  id: string;
  file: File;
  pageCount: number;
  thumbnailUrl?: string; // Cache canvas-rendered thumbnail URL
}

export function MergeTool() {
  const [richFiles, setRichFiles] = useState<RichFile[]>([]);
  const [busy, setBusy] = useState(false);

  const processNewFiles = async (droppedFiles: File[]) => {
    const newRichFiles: RichFile[] = [];

    // Dynamically import your project's PDF canvas renderer utility
    const { loadPdf, renderPdfPageToCanvas, canvasToBlob } = await import("@/lib/pdf-render");

    for (const file of droppedFiles) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(new Uint8Array(arrayBuffer), { updateMetadata: false });
        const pageCount = pdfDoc.getPageCount();

        // Generate a visual image thumbnail of page 1 using the local canvas renderer
        let thumbnailUrl: string | undefined = undefined;
        try {
          const pdfInstance = await loadPdf(file);
          const canvas = await renderPdfPageToCanvas(pdfInstance, 1, 0.4); // lower scale for light thumbnail sizing
          const blob = await canvasToBlob(canvas, "image/jpeg", 0.7);
          thumbnailUrl = URL.createObjectURL(blob);
        } catch { thumbnailUrl = undefined; }

        newRichFiles.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          file,
          pageCount,
          thumbnailUrl,
        });
      } catch {
        toast.error(`Could not read ${file.name}.`);
      }
    }

    setRichFiles((prev) => [...prev, ...newRichFiles]);
  };

  const remove = (id: string) => {
    setRichFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.thumbnailUrl) URL.revokeObjectURL(target.thumbnailUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= richFiles.length) return;
    setRichFiles((prev) => {
      const updated = [...prev];
      const temp = updated[index];
      updated[index] = updated[nextIndex];
      updated[nextIndex] = temp;
      return updated;
    });
  };

  async function merge() {
    if (richFiles.length < 2) {
      toast.error("Add at least two PDFs to merge.");
      return;
    }
    setBusy(true);
    try {
      const out = await PDFDocument.create();
      for (const richFile of richFiles) {
        const bytes = new Uint8Array(await richFile.file.arrayBuffer());
        const src = await PDFDocument.load(bytes);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const merged = await out.save();

      // Publish the merged file blob to feed your app's ResultPreview system automatically
      const mergedBlob = new Blob([merged], { type: "application/pdf" });
      const { publishResult } = await import("@/lib/result-store");
      publishResult({
        url: URL.createObjectURL(mergedBlob),
        name: "lazy-pdf-merged.pdf",
        size: mergedBlob.size,
        mime: "application/pdf"
      });

      toast.success("Merged PDF ready.");
    } catch {
      toast.error("Could not merge these files.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {richFiles.length === 0 ? (
        <DropZone
          onFiles={processNewFiles}
          accept={{ "application/pdf": [".pdf"] }}
          hint="Select or drag multiple PDF files here to begin"
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 p-4 border border-dashed border-border rounded-2xl bg-muted/20">
            {richFiles.map((richFile, idx) => (
              <div
                key={richFile.id}
                className="group relative flex flex-col justify-between items-center rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-signal hover:shadow-lg text-center"
              >
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                  <button
                    onClick={() => remove(richFile.id)}
                    className="p-1.5 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-md transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* PDF Document Live Rendered Thumbnail Image */}
                <div className="relative w-full aspect-[3/4] max-h-36 mb-3 rounded-lg border border-border/60 bg-white shadow-sm flex flex-col items-center justify-center overflow-hidden p-1">
                  {richFile.thumbnailUrl ? (
                    <img src={richFile.thumbnailUrl} alt="PDF Preview" className="h-full w-full object-contain" />
                  ) : (
                    <FileText className="h-12 w-12 text-muted-foreground/60 mb-1" />
                  )}

                  <span className="absolute bottom-1 right-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground bg-card/90 backdrop-blur-sm border border-border/50 px-1.5 py-0.5 rounded shadow-sm">
                    {richFile.pageCount} {richFile.pageCount === 1 ? "page" : "pages"}
                  </span>

                  <span className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-signal text-[11px] font-bold text-signal-foreground shadow-sm">
                    {idx + 1}
                  </span>
                </div>

                <div className="w-full">
                  <p className="text-xs font-medium text-foreground truncate px-1" title={richFile.file.name}>
                    {richFile.file.name}
                  </p>
                </div>

                <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/40 w-full justify-center">
                  <button
                    disabled={idx === 0}
                    onClick={() => move(idx, -1)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <MoveLeft className="h-4 w-4" />
                  </button>
                  <button
                    disabled={idx === richFiles.length - 1}
                    onClick={() => move(idx, 1)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <MoveRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}

            <label className="flex flex-col items-center justify-center border-2 border-dashed border-border/80 hover:border-signal/80 rounded-xl aspect-[3/4] max-h-[200px] bg-card/40 cursor-pointer transition-all hover:bg-card group shadow-sm">
              <input
                type="file"
                multiple
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) processNewFiles(Array.from(e.target.files));
                }}
              />
              <div className="p-3 bg-muted group-hover:bg-signal-soft rounded-full text-muted-foreground group-hover:text-signal mb-2">
                <Plus className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-muted-foreground group-hover:text-foreground">Add files</span>
            </label>
          </div>

          <div className="flex justify-end items-center gap-4">
            <Button
              variant="action"
              size="xl"
              onClick={merge}
              disabled={busy || richFiles.length < 2}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Merge PDF
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
