import { useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { Button } from "@/components/ui/button";
import { downloadBlob, formatBytes } from "@/lib/download";
import { Loader2, X, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const UNIVERSAL_IMAGE_ACCEPT = {
  "image/*": [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif", ".gif", ".svg", ".tiff", ".tif"]
};

export function ImagesToPdfTool({
  hint,
  accept, // We capture this but override it to force all-image support
}: {
  accept?: Record<string, string[]>;
  hint?: string;
}) {
  const [items, setItems] = useState<{ id: string; file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

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
        try {
          const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
          const isJpg = file.type === "image/jpeg" || file.type === "image/jpg" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg");

          let imageBytes: Uint8Array;
          let type: "png" | "jpg" = "jpg";

          // If it's natively supported, use the raw buffer to preserve 100% original quality
          if (isPng || isJpg) {
            imageBytes = new Uint8Array(await file.arrayBuffer());
            type = isPng ? "png" : "jpg";
          } else {
            // For WebP, HEIC, GIF, SVG, etc. -> convert via Canvas.
            // createImageBitmap natively respects EXIF rotation in modern browsers.
            const bmp = await createImageBitmap(file);
            const cvs = document.createElement("canvas");
            cvs.width = bmp.width;
            cvs.height = bmp.height;
            
            const ctx = cvs.getContext("2d");
            if (!ctx) throw new Error("Canvas rendering not supported");
            ctx.drawImage(bmp, 0, 0);
            
            // Export as PNG to safely preserve transparency for GIFs/SVGs/WebPs
            const blob = await new Promise<Blob | null>((res) => cvs.toBlob(res, "image/png"));
            if (!blob) throw new Error("Conversion failed");
            
            imageBytes = new Uint8Array(await blob.arrayBuffer());
            type = "png";
          }

          const image = type === "png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
          
          // Size the PDF page exactly to the image dimensions to prevent any stretching
          const page = doc.addPage([image.width, image.height]);
          page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

        } catch (imageErr) {
          throw new Error(`Failed to process "${file.name}". The image may be corrupted or unsupported.`);
        }
      }
      
      downloadBlob(await doc.save(), "lazy-pdf-images.pdf");
      toast.success("PDF created successfully.");
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
        accept={UNIVERSAL_IMAGE_ACCEPT}
        multiple={true}
        hint={hint || "Drop any images here. They'll be added in the order shown."}
      />
      
      {items.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
            <span className="text-base font-semibold text-foreground">
              {items.length} image{items.length > 1 ? "s" : ""} selected
            </span>
            <span className="text-sm text-muted-foreground bg-secondary/50 px-3 py-1 rounded-full w-fit">
              Drag images or use arrows to change PDF page order
            </span>
          </div>
          
          <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2 pb-2">
            {items.map((item, i) => (
              <div 
                key={item.id} 
                draggable
                onDragStart={(e) => {
                  setDraggedIdx(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverIdx(i);
                }}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedIdx === null || draggedIdx === i) {
                    setDragOverIdx(null);
                    setDraggedIdx(null);
                    return;
                  }
                  const newItems = [...items];
                  const [moved] = newItems.splice(draggedIdx, 1);
                  newItems.splice(i, 0, moved);
                  setItems(newItems);
                  setDragOverIdx(null);
                  setDraggedIdx(null);
                }}
                className={cn(
                  "flex items-center gap-3 sm:gap-4 bg-card border p-3 rounded-xl transition-all",
                  dragOverIdx === i 
                    ? "border-[var(--brand)] ring-1 ring-[var(--brand)] shadow-md bg-secondary/40 scale-[1.01]" 
                    : "border-border hover:bg-secondary/20 hover:shadow-sm"
                )}
              >
                <div className="hidden sm:flex cursor-grab active:cursor-grabbing text-muted-foreground p-1 hover:text-foreground">
                  <GripVertical className="w-5 h-5" />
                </div>

                <span className="text-sm font-bold text-muted-foreground w-6 text-center shrink-0">
                  {i + 1}
                </span>

                <img 
                  src={item.url} 
                  alt="thumbnail" 
                  className="w-16 h-16 sm:w-20 sm:h-20 object-contain rounded bg-white shadow-sm border border-border/50 shrink-0" 
                />
                
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <span className="truncate text-base font-medium text-foreground" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide mt-1">
                    {item.file.type.split('/')[1] || "IMAGE"} • {formatBytes(item.file.size)}
                  </span>
                </div>
                
                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-foreground" onClick={() => moveUp(i)} disabled={i === 0}>
                    <ChevronUp className="h-5 w-5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-foreground" onClick={() => moveDown(i)} disabled={i === items.length - 1}>
                    <ChevronDown className="h-5 w-5" />
                  </Button>
                  <div className="hidden sm:block w-px h-6 bg-border mx-1 sm:mx-2" />
                  <Button variant="ghost" size="icon" className="h-10 w-10 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => remove(i)}>
                    <X className="h-5 w-5" />
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