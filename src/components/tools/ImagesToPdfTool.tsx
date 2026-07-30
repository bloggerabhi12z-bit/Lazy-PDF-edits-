import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { Button } from "@/components/ui/button";
import { downloadBlob, formatBytes } from "@/lib/download";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Handles both JPG and PNG. Bound to a specific accept map per route.
 */
export function ImagesToPdfTool({ accept, hint, label = "Build PDF" }: {
  accept: Record<string, string[]>;
  hint: string;
  label?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  async function convert() {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.create();
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
        const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      downloadBlob(await doc.save(), "lazy-pdf-images.pdf");
      toast.success("PDF ready.");
    } catch {
      toast.error("Conversion failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <DropZone onFiles={(fs) => setFiles((prev) => [...prev, ...fs])} accept={accept} hint={hint} />
      {files.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {files.map((f, i) => (
            <div key={i} className="group relative overflow-hidden rounded-xl border border-border bg-card">
              <img src={URL.createObjectURL(f)} alt={f.name} className="aspect-square w-full object-cover" />
              <button
                onClick={() => setFiles((fs) => fs.filter((_, idx) => idx !== i))}
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-background/90 opacity-0 shadow transition group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="truncate px-2 py-1 text-xs text-muted-foreground">
                {i + 1}. {f.name} · {formatBytes(f.size)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={convert} disabled={files.length === 0 || busy} size="lg">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {label}
        </Button>
      </div>
    </div>
  );
}
