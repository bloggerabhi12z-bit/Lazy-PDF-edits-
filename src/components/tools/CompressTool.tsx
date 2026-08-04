import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { SingleFilePicker } from "@/components/site/SingleFilePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadBlob, formatBytes } from "@/lib/download";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Level = "low" | "medium" | "high";
type Mode = "preset" | "manual";
type Unit = "KB" | "MB";

const LEVELS: { id: Level; label: string; desc: string; objectsPerTick: number }[] = [
  { id: "low", label: "Low", desc: "Best quality, smaller savings", objectsPerTick: 40 },
  { id: "medium", label: "Medium", desc: "Balanced quality & size", objectsPerTick: 100 },
  { id: "high", label: "High", desc: "Smallest size, more aggressive", objectsPerTick: 300 },
];

// Heuristic: small files are almost always text-only (little room to shrink).
// Anything under this is flagged as "lean" so we don't overpromise.
const LEAN_FILE_THRESHOLD_BYTES = 1024 * 1024; // 1 MB

export function CompressTool() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("preset");
  const [level, setLevel] = useState<Level>("medium");
  const [targetValue, setTargetValue] = useState<string>("");
  const [targetUnit, setTargetUnit] = useState<Unit>("KB");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ before: number; after: number; hitTarget?: boolean } | null>(null);

  const isLeanFile = !!file && file.size < LEAN_FILE_THRESHOLD_BYTES;

  function handleFileSet(f: File | null) {
    setFile(f);
    setResult(null);
    if (f) {
      setTargetUnit(f.size < 1024 * 1024 ? "KB" : "MB");
      setTargetValue("");
    }
  }

  async function stripMetadata(src: PDFDocument) {
    src.setTitle("");
    src.setSubject("");
    src.setKeywords([]);
    src.setProducer("");
    src.setCreator("");
    src.setAuthor("");
  }

  async function saveAt(src: PDFDocument, objectsPerTick: number) {
    return src.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick,
    });
  }

  function targetToBytes(): number {
    const n = parseFloat(targetValue);
    if (!n || n <= 0) return 0;
    return targetUnit === "KB" ? n * 1024 : n * 1024 * 1024;
  }

  async function compress() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      if (mode === "preset") {
        const src = await PDFDocument.load(bytes, { updateMetadata: false });
        await stripMetadata(src);
        const cfg = LEVELS.find((l) => l.id === level)!;
        const out = await saveAt(src, cfg.objectsPerTick);
        setResult({ before: file.size, after: out.byteLength });
        downloadBlob(out, `lazy-pdf-compressed-${file.name}`);
        toast.success("Compressed PDF ready.");
      } else {
        const targetBytes = targetToBytes();
        if (!targetBytes) {
          toast.error(`Enter a valid target size in ${targetUnit}.`);
          return;
        }
        if (targetBytes >= file.size) {
          toast.error(
            `Target (${formatBytes(targetBytes)}) is larger than the original (${formatBytes(file.size)}) — nothing to compress.`
          );
          return;
        }

        const attempts = [40, 100, 200, 300, 500];
        let best: Uint8Array | null = null;

        for (const objectsPerTick of attempts) {
          const src = await PDFDocument.load(bytes, { updateMetadata: false });
          await stripMetadata(src);
          const out = await saveAt(src, objectsPerTick);
          if (!best || out.byteLength < best.byteLength) best = out;
          if (out.byteLength <= targetBytes) {
            best = out;
            break;
          }
        }

        if (best) {
          const hitTarget = best.byteLength <= targetBytes;
          setResult({ before: file.size, after: best.byteLength, hitTarget });
          downloadBlob(best, `lazy-pdf-compressed-${file.name}`);
          if (hitTarget) {
            toast.success("Compressed PDF ready — target size reached.");
          } else if (isLeanFile) {
            toast.warning(
              "This file is already lean — expect 10–20% savings. We reduced it as much as possible, but couldn't hit your exact target."
            );
          } else {
            toast.warning(
              `Couldn't fully reach ${targetValue} ${targetUnit} — this is the smallest we could get without re-encoding images.`
            );
          }
        }
      }
    } catch {
      toast.error("Compression failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone
          onFiles={(fs) => handleFileSet(fs[0] ?? null)}
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          hint="Drop a PDF to shrink."
        />
      ) : (
        <SingleFilePicker file={file} onChange={() => handleFileSet(null)}>
          {result && (
            <div className="rounded-xl bg-signal-soft/40 p-4 text-sm">
              <div className="font-medium">
                Saved {(((result.before - result.after) / result.before) * 100).toFixed(1)}%
              </div>
              <div className="text-muted-foreground">
                {formatBytes(result.before)} → {formatBytes(result.after)}
              </div>
              {mode === "manual" && result.hitTarget === false && (
                <div className="mt-1 text-xs text-amber-600">
                  {isLeanFile
                    ? "This file is already lean — expect 10–20% savings. Reduced as much as possible, but not to the exact target."
                    : "Target not fully reached — see note above."}
                </div>
              )}
            </div>
          )}
        </SingleFilePicker>
      )}

      {file && (
        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="inline-flex rounded-xl border border-border p-1">
            {(["preset", "manual"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                  mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {m === "preset" ? "Presets" : "Manual size"}
              </button>
            ))}
          </div>

          {mode === "preset" ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Compression level</div>
              <div className="grid grid-cols-3 gap-2">
                {LEVELS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLevel(l.id)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      level === l.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    )}
                  >
                    <div className="text-sm font-medium">{l.label}</div>
                    <div className="text-xs text-muted-foreground">{l.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-medium">Target size</div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder={targetUnit === "KB" ? "e.g. 12" : "e.g. 0.5"}
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  className="w-32"
                />
                <div className="inline-flex rounded-lg border border-border p-0.5">
                  {(["KB", "MB"] as Unit[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setTargetUnit(u)}
                      className={cn(
                        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                        targetUnit === u
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {u}
                    </button>
                  ))}
                </div>
                <span className="text-sm text-muted-foreground">
                  (original: {formatBytes(file.size)})
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                We'll try to get as close as possible. Since embedded images aren't re-encoded,
                very small targets on image-heavy PDFs may not be fully reachable.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="action"
          size="xl"
          onClick={compress}
          disabled={!file || busy || (mode === "manual" && !targetValue)}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Compress PDF
        </Button>
      </div>
    </div>
  );
}