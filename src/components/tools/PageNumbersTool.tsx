import { useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { SingleFilePicker } from "@/components/site/SingleFilePicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { downloadBlob } from "@/lib/download";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Position = "bottom-center" | "bottom-right" | "bottom-left" | "top-center" | "top-right" | "top-left";

export function PageNumbersTool() {
  const [file, setFile] = useState<File | null>(null);
  const [position, setPosition] = useState<Position>("bottom-center");
  const [format, setFormat] = useState("{n} / {total}");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const font = await src.embedFont(StandardFonts.Helvetica);
      const pages = src.getPages();
      const total = pages.length;
      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        const text = format.replace("{n}", String(i + 1)).replace("{total}", String(total));
        const size = 10;
        const w = font.widthOfTextAtSize(text, size);
        const margin = 24;
        let x = margin;
        let y = margin;
        if (position.endsWith("center")) x = width / 2 - w / 2;
        else if (position.endsWith("right")) x = width - w - margin;
        if (position.startsWith("top")) y = height - margin;
        page.drawText(text, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) });
      });
      downloadBlob(await src.save(), `lazy-pdf-numbered-${file.name}`);
      toast.success("Page numbers added.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  const positions: Position[] = ["bottom-left", "bottom-center", "bottom-right", "top-left", "top-center", "top-right"];

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone onFiles={(fs) => setFile(fs[0] ?? null)} accept={{ "application/pdf": [".pdf"] }} multiple={false} hint="Drop a PDF." />
      ) : (
        <SingleFilePicker file={file} onChange={() => setFile(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Position</Label>
              <div className="mt-2 grid grid-cols-3 gap-1">
                {positions.map((p) => (
                  <Button key={p} size="sm" variant={position === p ? "default" : "outline"} onClick={() => setPosition(p)}>
                    {p.replace("-", " ")}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="fmt">Format</Label>
              <input id="fmt" value={format} onChange={(e) => setFormat(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <p className="mt-2 text-xs text-muted-foreground">Use {"{n}"} and {"{total}"}.</p>
            </div>
          </div>
        </SingleFilePicker>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add page numbers
        </Button>
      </div>
    </div>
  );
}
