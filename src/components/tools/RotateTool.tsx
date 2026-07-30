import { useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { PdfEditor, type EditorApplyState } from "@/components/site/PdfEditor";
import { toast } from "sonner";

export function RotateTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(state: EditorApplyState) {
    if (!file) return;
    setBusy(true);
    try {
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      src.getPages().forEach((page, i) => {
        const rot = state.pages[i]?.rotation ?? 0;
        if (rot) page.setRotation(degrees((page.getRotation().angle + rot) % 360));
      });
      const bytes = await src.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      toast.success("Rotation applied.");
      return { blob, filename: `lazy-pdf-rotated-${file.name}` };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rotate failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone
          onFiles={(fs) => setFile(fs[0] ?? null)}
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          hint="Drop a PDF. Use the rotate button on each page or in the toolbar."
        />
      ) : (
        <PdfEditor
          file={file}
          mode="rotate"
          actionLabel="Apply rotation"
          busy={busy}
          onReplace={() => setFile(null)}
          onApply={apply}
        />
      )}
    </div>
  );
}
