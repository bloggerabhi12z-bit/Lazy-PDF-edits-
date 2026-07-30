import { X, GripVertical, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/download";

interface FileListProps {
  files: File[];
  onRemove: (index: number) => void;
  onMove?: (index: number, dir: -1 | 1) => void;
}

export function FileList({ files, onRemove, onMove }: FileListProps) {
  if (files.length === 0) return null;

  return (
    <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {files.map((f, i) => (
        <li
          key={`${f.name}-${i}`}
          className="flex items-center gap-3 border-b border-border/70 p-3 last:border-b-0 hover:bg-secondary/40"
        >
          {onMove && <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-signal-soft text-signal">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{f.name}</div>
            <div className="text-xs text-muted-foreground">{formatBytes(f.size)}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onMove && (
              <>
                <Button variant="ghost" size="sm" onClick={() => onMove(i, -1)} disabled={i === 0}>
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onMove(i, 1)}
                  disabled={i === files.length - 1}
                >
                  ↓
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={() => onRemove(i)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
