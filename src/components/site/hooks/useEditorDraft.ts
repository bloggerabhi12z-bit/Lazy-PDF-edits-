import { useEffect, useRef } from "react";
import type { AnyElement } from "@/lib/pdf-annotations";
import type { EditorPage } from "../editor-types";

export type EditorDraft = {
  version: 1;
  savedAt: number;
  fileKey: string;
  pages: EditorPage[];
  elements: AnyElement[];
};

function storageKey(fileKey: string) {
  return `lazypdf:editor-draft:${fileKey}`;
}

export function makeEditorFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function loadEditorDraft(fileKey: string): EditorDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(fileKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EditorDraft;
    if (parsed.version !== 1 || parsed.fileKey !== fileKey || !Array.isArray(parsed.pages) || !Array.isArray(parsed.elements)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveEditorDraft(draft: EditorDraft) {
  try {
    localStorage.setItem(storageKey(draft.fileKey), JSON.stringify(draft));
  } catch {
    // Quota/private-mode failures must never break editing.
  }
}

export function clearEditorDraft(fileKey: string) {
  try {
    localStorage.removeItem(storageKey(fileKey));
  } catch {
    // Ignore storage failures.
  }
}

export function useEditorDraftAutosave(fileKey: string | null, pages: EditorPage[], elements: AnyElement[], enabled = true) {
  const stateRef = useRef({ pages, elements });
  stateRef.current = { pages, elements };

  useEffect(() => {
    if (!fileKey || !enabled) return;
    const save = () => {
      const state = stateRef.current;
      saveEditorDraft({ version: 1, savedAt: Date.now(), fileKey, pages: state.pages, elements: state.elements });
    };
    const interval = window.setInterval(save, 10_000);
    return () => window.clearInterval(interval);
  }, [fileKey, enabled]);
}
