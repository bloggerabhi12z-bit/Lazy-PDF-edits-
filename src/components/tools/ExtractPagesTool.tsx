import { useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { PdfEditor, type EditorApplyState } from "@/components/site/PdfEditor";
import { toast } from "sonner";

export function ExtractPagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(state: EditorApplyState) {
    if (!file) return;
    setBusy(true);
    try {
      const picked = state.pages.filter((p) => p.selected);
      if (!picked.length) throw new Error("Select at least one page to extract.");
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, picked.map((p) => p.originalIndex));
      copied.forEach((page, i) => {
        const rot = picked[i].rotation;
        if (rot) page.setRotation(degrees((page.getRotation().angle + rot) % 360));
        out.addPage(page);
      });
      const bytes = await out.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      toast.success(`Extracted ${picked.length} page(s).`);
      return { blob, filename: `lazy-pdf-extracted-${file.name}` };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extract failed.");
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
          mode="select"
          actionLabel="Extract selected"
          busy={busy}
          selectionHint="Tick the pages you want to extract into a new PDF."
          onReplace={() => setFile(null)}
          onApply={apply}
        />
      )}
    </div>
  );
}
