import { Progress } from "@/components/ui/progress";

interface ToolProgressBarProps {
  /** Current step, 1-indexed */
  current: number;
  total: number;
  /** e.g. "Rendering pages", "Running OCR" */
  label: string;
}

/**
 * Determinate progress bar for tool operations that loop over pages
 * (image export, OCR, PPTX/EPUB generation). Wraps the existing shadcn
 * `Progress` primitive (components/ui/progress.tsx) so it stays on the
 * same Radix component and theme tokens as the rest of the app, instead
 * of introducing a one-off bar implementation.
 */
export function ToolProgressBar({ current, total, label }: ToolProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {current} / {total} · {pct}%
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}
