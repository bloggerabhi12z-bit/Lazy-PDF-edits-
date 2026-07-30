import { useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { PdfEditor, type EditorApplyState } from "@/components/site/PdfEditor";
import { toast } from "sonner";

export function RearrangePagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(state: EditorApplyState) {
    if (!file) return;
    setBusy(true);
    try {
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, state.pages.map((p) => p.originalIndex));
      copied.forEach((page, i) => {
        const rot = state.pages[i].rotation;
        if (rot) page.setRotation(degrees((page.getRotation().angle + rot) % 360));
        out.addPage(page);
      });
      const bytes = await out.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      toast.success("Pages reordered.");
      return { blob, filename: `lazy-pdf-reordered-${file.name}` };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rearrange failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone onFiles={(fs) => setFile(fs[0] ?? null)} accept={{ "application/pdf": [".pdf"] }} multiple={false} hint="Drop a PDF." />
      ) : (
        <PdfEditor
          file={file}
          mode="reorder"
          actionLabel="Apply new order"
          busy={busy}
          onReplace={() => setFile(null)}
          onApply={apply}
        />
      )}
    </div>
  );
}
