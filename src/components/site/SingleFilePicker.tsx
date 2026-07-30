import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/download";

interface SingleFilePickerProps {
  file: File;
  onChange: () => void;
  children?: React.ReactNode;
}

export function SingleFilePicker({ file, onChange, children }: SingleFilePickerProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-signal-soft text-signal">
          <FileText className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{file.name}</div>
          <div className="text-sm text-muted-foreground">{formatBytes(file.size)}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={onChange} aria-label="Remove file">
          <X className="h-4 w-4" />
        </Button>
      </div>
      {children && <div className="mt-4 border-t border-border/70 pt-4">{children}</div>}
    </div>
  );
}
