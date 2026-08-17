import { useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { Loader2, X, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export function ImagesToPdfTool({
  hint,
}: {
  accept?: Record<string, string[]>;
  hint?: string;
}) {
  const [items, setItems] = useState<{ id: string; file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);

  // Clean up object URLs to prevent memory leaks when components unmount
  useEffect(() => {
    return () => {
      items.forEach(item => URL.revokeObjectURL(item.url));
    };
  }, [items]);

  function addFiles(newFiles: File[]) {
    const mapped = newFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      url: URL.createObjectURL(file) 
    }));
    setItems((current) => [...current, ...mapped]);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...items];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setItems(next);
  }

  function moveDown(index: number) {
    if (index === items.length - 1) return;
    const next = [...items];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setItems(next);
  }

  function remove(index: number) {
    URL.revokeObjectURL(items[index].url);
    setItems(items.filter((_, i) => i !== index));
  }

  async function run() {
    if (!items.length) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.create();
      for (const item of items) {
        const { file } = item;
        
        const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
        const isJpg = file.type === "image/jpeg" || file.type === "image/jpg" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg");

        let imageBytes: Uint8Array;
        let type: "png" | "jpg" = "jpg";

        // If it's a native format supported by pdf-lib, use raw bytes directly
        if (isPng || isJpg) {
          imageBytes = new Uint8Array(await file.arrayBuffer());
          type = isPng ? "png" : "jpg";
        } else {
          // If it's WebP, BMP, GIF, HEIC etc., draw it to a canvas and convert to JPEG
          const bmp = await createImageBitmap(file);
          const cvs = document.createElement("canvas");
          cvs.width = bmp.width;
          cvs.height = bmp.height;
          const ctx = cvs.getContext("2d");
          if (!ctx) throw new Error("Canvas rendering not supported");
          ctx.drawImage(bmp, 0, 0);
          
          const blob = await new Promise<Blob | null>((res) => cvs.toBlob(res, "image/jpeg", 0.92));
          if (!blob) throw new Error("Could not process " + file.name);
          imageBytes = new Uint8Array(await blob.arrayBuffer());
          type = "jpg";
        }

        const image = type === "png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
        const page = doc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      downloadBlob(await doc.save(), "images-to-pdf.pdf");
      toast.success("PDF ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <DropZone
        onFiles={addFiles}
        // Force overriding to accept all image types, regardless of what the parent page requests
        accept={{ "image/*": [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".gif"] }}
        hint={hint || "Drop any images here. They'll be added in the order shown."}
      />
      
      {items.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
          <div className="text-sm font-medium text-muted-foreground mb-2 flex justify-between items-center">
            <span>{items.length} image{items.length > 1 ? "s" : ""} selected</span>
            <span className="text-xs">Use arrows to reorder</span>
          </div>
          
          <div className="max-h-80 overflow-y-auto space-y-2 pr-2">
            {items.map((item, i) => (
              <div key={item.id} className="flex items-center gap-3 bg-secondary/30 border border-border p-2 rounded-lg transition-colors hover:bg-secondary/50">
                <img src={item.url} alt="thumbnail" className="w-14 h-14 object-cover rounded bg-white shadow-sm" />
                <span className="flex-1 truncate text-sm font-medium text-foreground" title={item.file.name}>
                  {item.file.name}
                </span>
                
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => moveUp(i)} disabled={i === 0}>
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => moveDown(i)} disabled={i === items.length - 1}>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <div className="w-px h-5 bg-border mx-1" />
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => remove(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!items.length || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create PDF
        </Button>
      </div>
    </div>
  );
}