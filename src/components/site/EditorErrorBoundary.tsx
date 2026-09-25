import React from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { clearEditorDraft } from "./hooks/useEditorDraft";

interface Props {
  fileKey: string;
  onReplace: () => void;
  children: React.ReactNode;
}

interface State { hasError: boolean; message: string | null }

export class EditorErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : "The editor encountered an unexpected error." };
  }

  private reloadFromDraft = () => {
    window.location.reload();
  };

  private startOver = () => {
    clearEditorDraft(this.props.fileKey);
    this.props.onReplace();
    this.setState({ hasError: false, message: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="fixed inset-0 z-[99999] grid place-items-center bg-slate-100 p-6 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40">
            <RefreshCw className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">The editor needs to reload</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Your work is autosaved locally every 10 seconds. Reloading will restore the latest saved draft.</p>
          {this.state.message && <p className="mt-3 truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:bg-slate-950">{this.state.message}</p>}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button onClick={this.reloadFromDraft} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700">
              <RotateCcw className="h-4 w-4" /> Reload & restore draft
            </button>
            <button onClick={this.startOver} className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              Start over
            </button>
          </div>
        </div>
      </div>
    );
  }
}
