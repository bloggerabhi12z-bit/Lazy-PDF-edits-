import { useState } from "react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { SingleFilePicker } from "@/components/site/SingleFilePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadBlob } from "@/lib/download";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export function WatermarkTool() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(0.2);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const font = await src.embedFont(StandardFonts.HelveticaBold);
      src.getPages().forEach((page) => {
        const { width, height } = page.getSize();
        const size = Math.min(width, height) / 8;
        const w = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: width / 2 - w / 2,
          y: height / 2,
          size,
          font,
          color: rgb(0.6, 0.1, 0.1),
          opacity,
          rotate: degrees(-30),
        });
      });
      downloadBlob(await src.save(), `lazy-pdf-watermarked-${file.name}`);
      toast.success("Watermark added.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Watermark failed.");
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
              <Label htmlFor="wm">Watermark text</Label>
              <Input id="wm" value={text} onChange={(e) => setText(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="op">Opacity ({opacity.toFixed(2)})</Label>
              <input id="op" type="range" min={0.05} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} className="mt-3 w-full" />
            </div>
          </div>
        </SingleFilePicker>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy || !text}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add watermark
        </Button>
      </div>
    </div>
  );
}
