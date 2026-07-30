import { useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { SingleFilePicker } from "@/components/site/SingleFilePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadBlob } from "@/lib/download";
import { canvasToBlob, loadPdf, renderPdfPageToCanvas } from "@/lib/pdf-render";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function SplitTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [busy, setBusy] = useState(false);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);

  async function onFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    setFile(f);
    try {
      const doc = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()));
      setPageCount(doc.getPageCount());
      setFrom(1);
      setTo(doc.getPageCount());
    } catch {
      toast.error("Could not read that PDF.");
    }
  }

  // Render a thumbnail per page so the user can see what they're selecting,
  // instead of guessing page numbers blind.
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    if (!file || !pageCount) {
      setThumbnails([]);
      return;
    }

    (async () => {
      try {
        const pdf = await loadPdf(file);
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          if (cancelled) return;
          const canvas = await renderPdfPageToCanvas(pdf, pageNumber, 0.35);
          const blob = await canvasToBlob(canvas, "image/jpeg", 0.7);
          const url = URL.createObjectURL(blob);
          urls.push(url);
          if (!cancelled) setThumbnails((prev) => [...prev, url]);
        }
      } catch {
        // Password-protected or malformed — the numeric inputs still work.
      }
    })();

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, pageCount]);

  function selectPage(pageNumber: number) {
    if (rangeAnchor === null) {
      setRangeAnchor(pageNumber);
      setFrom(pageNumber);
      setTo(pageNumber);
    } else {
      setFrom(Math.min(rangeAnchor, pageNumber));
      setTo(Math.max(rangeAnchor, pageNumber));
      setRangeAnchor(null);
    }
  }

  async function split() {
    if (!file) return;
    if (from < 1 || to > pageCount || from > to) {
      toast.error(`Enter a range between 1 and ${pageCount}.`);
      return;
    }
    setBusy(true);
    try {
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const out = await PDFDocument.create();
      const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
      const pages = await out.copyPages(src, indices);
      pages.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      downloadBlob(bytes, `lazy-pdf-split-${from}-${to}.pdf`);
      toast.success("Split PDF ready.");
    } catch {
      toast.error("Split failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone
          onFiles={onFiles}
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          hint="Drop one PDF to split."
        />
      ) : (
        <SingleFilePicker file={file} onChange={() => setFile(null)}>
          <div className="text-xs text-muted-foreground mb-4">{pageCount} pages</div>

          {/* Range preview — mirrors iLovePDF's dashed "Range" box: shows the
              endpoints of the current selection, collapsing the middle with
              "..." once the range gets long, instead of always showing every page. */}
          {thumbnails.length > 0 && (
            <div className="mb-6">
              <div className="mb-2 text-sm font-medium text-foreground">Range 1</div>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed border-border p-4">
                {(() => {
                  const rangePages = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
                  const showAll = rangePages.length <= 5;
                  const shown = showAll
                    ? rangePages
                    : [...rangePages.slice(0, 2), null, ...rangePages.slice(-2)];
                  return shown.map((pageNumber, idx) =>
                    pageNumber === null ? (
                      <span key={`ellipsis-${idx}`} className="text-lg font-semibold text-muted-foreground">
                        …
                      </span>
                    ) : (
                      <div
                        key={pageNumber}
                        className="relative aspect-[3/4] w-16 overflow-hidden rounded-md border border-border/60 bg-white shadow-sm"
                      >
                        {thumbnails[pageNumber - 1] && (
                          <img
                            src={thumbnails[pageNumber - 1]}
                            alt={`Page ${pageNumber}`}
                            className="h-full w-full object-contain"
                          />
                        )}
                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 rounded bg-card/90 px-1 text-[9px] font-semibold text-muted-foreground">
                          {pageNumber}
                        </span>
                      </div>
                    ),
                  );
                })()}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="from">From page</Label>
              <Input
                id="from"
                type="number"
                min={1}
                max={pageCount}
                value={from}
                onChange={(e) => {
                  setRangeAnchor(null);
                  setFrom(+e.target.value);
                }}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="to">To page</Label>
              <Input
                id="to"
                type="number"
                min={1}
                max={pageCount}
                value={to}
                onChange={(e) => {
                  setRangeAnchor(null);
                  setTo(+e.target.value);
                }}
                className="mt-1"
              />
            </div>
          </div>

          {thumbnails.length > 0 && (
            <>
              <div className="mb-2 mt-6 text-xs text-muted-foreground">
                All pages · click one to start a range, click another to finish it
              </div>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8">
                {thumbnails.map((url, i) => {
                  const pageNumber = i + 1;
                  const inRange = pageNumber >= from && pageNumber <= to;
                  const isAnchor = rangeAnchor === pageNumber;
                  return (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => selectPage(pageNumber)}
                      className={`group relative aspect-[3/4] overflow-hidden rounded-lg border-2 bg-white shadow-sm transition-all ${
                        inRange
                          ? "border-signal ring-2 ring-signal/30"
                          : "border-border/60 hover:border-signal/50"
                      } ${isAnchor ? "ring-2 ring-signal" : ""}`}
                    >
                      <img src={url} alt={`Page ${pageNumber}`} className="h-full w-full object-contain" />
                      {inRange && (
                        <div className="absolute inset-0 bg-signal/10">
                          <div className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-signal text-signal-foreground">
                            <Check className="h-3 w-3" />
                          </div>
                        </div>
                      )}
                      <span className="absolute bottom-0.5 left-0.5 rounded bg-card/90 px-1 text-[9px] font-semibold text-muted-foreground">
                        {pageNumber}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </SingleFilePicker>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={split} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Extract pages
        </Button>
      </div>
    </div>
  );
}
