import { useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { SingleFilePicker } from "@/components/site/SingleFilePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadBlob } from "@/lib/download";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export function HeaderFooterTool() {
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const font = await src.embedFont(StandardFonts.Helvetica);
      const size = 10;
      const margin = 24;
      src.getPages().forEach((page) => {
        const { width, height } = page.getSize();
        if (header) {
          const w = font.widthOfTextAtSize(header, size);
          page.drawText(header, { x: width / 2 - w / 2, y: height - margin, size, font, color: rgb(0.2, 0.2, 0.2) });
        }
        if (footer) {
          const w = font.widthOfTextAtSize(footer, size);
          page.drawText(footer, { x: width / 2 - w / 2, y: margin, size, font, color: rgb(0.2, 0.2, 0.2) });
        }
      });
      downloadBlob(await src.save(), `lazy-pdf-hf-${file.name}`);
      toast.success("Header & footer added.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone onFiles={(fs) => setFile(fs[0] ?? null)} accept={{ "application/pdf": [".pdf"] }} multiple={false} hint="Drop a PDF." />
      ) : (
        <SingleFilePicker file={file} onChange={() => setFile(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="h">Header text</Label>
              <Input id="h" value={header} onChange={(e) => setHeader(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="f">Footer text</Label>
              <Input id="f" value={footer} onChange={(e) => setFooter(e.target.value)} className="mt-1" />
            </div>
          </div>
        </SingleFilePicker>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy || (!header && !footer)}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Apply
        </Button>
      </div>
    </div>
  );
}
