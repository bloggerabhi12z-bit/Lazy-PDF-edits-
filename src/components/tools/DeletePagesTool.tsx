import { useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { PdfEditor, type EditorApplyState } from "@/components/site/PdfEditor";
import { toast } from "sonner";

export function DeletePagesTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(state: EditorApplyState) {
    if (!file) return;
    setBusy(true);
    try {
      const keep = state.pages.filter((p) => !p.selected);
      if (!keep.length) throw new Error("You can't delete every page.");
      if (keep.length === state.pages.length) throw new Error("Select pages to delete first.");
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, keep.map((p) => p.originalIndex));
      copied.forEach((page, i) => {
        const rot = keep[i].rotation;
        if (rot) page.setRotation(degrees((page.getRotation().angle + rot) % 360));
        out.addPage(page);
      });
      const bytes = await out.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      toast.success(`Removed ${state.pages.length - keep.length} page(s).`);
      return { blob, filename: `lazy-pdf-trimmed-${file.name}` };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed.");
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
          actionLabel="Apply changes"
          busy={busy}
          selectionHint="Tick the pages you want to delete, then apply changes."
          onReplace={() => setFile(null)}
          onApply={apply}
        />
      )}
    </div>
  );
}
