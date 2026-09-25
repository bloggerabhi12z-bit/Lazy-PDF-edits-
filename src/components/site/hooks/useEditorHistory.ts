import { useCallback, useMemo, useReducer } from "react";
import type { AnyElement } from "@/lib/pdf-annotations";
import type { EditorPage } from "../editor-types";

export type EditorSnapshot = {
  pages: EditorPage[];
  elements: AnyElement[];
};

type HistoryState = {
  past: EditorSnapshot[];
  present: EditorSnapshot;
  future: EditorSnapshot[];
};

type HistoryAction =
  | { type: "reset"; snapshot: EditorSnapshot }
  | { type: "commit"; snapshot: EditorSnapshot }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "replace"; snapshot: EditorSnapshot };

export const MAX_HISTORY = 50;

export function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function editorHistoryReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "reset":
      return { past: [], present: action.snapshot, future: [] };
    case "replace":
      return { ...state, present: action.snapshot };
    case "commit": {
      if (snapshotsEqual(state.present, action.snapshot)) return state;
      const past = [...state.past, state.present];
      if (past.length > MAX_HISTORY) past.shift();
      return { past, present: action.snapshot, future: [] };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future].slice(0, MAX_HISTORY),
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present].slice(-MAX_HISTORY),
        present: next,
        future: state.future.slice(1),
      };
    }
  }
}

export function useEditorHistory(initialSnapshot: EditorSnapshot) {
  const [state, dispatch] = useReducer(editorHistoryReducer, {
    past: [],
    present: initialSnapshot,
    future: [],
  });

  const reset = useCallback((snapshot: EditorSnapshot) => dispatch({ type: "reset", snapshot }), []);
  const commit = useCallback((snapshot: EditorSnapshot) => dispatch({ type: "commit", snapshot }), []);
  const replace = useCallback((snapshot: EditorSnapshot) => dispatch({ type: "replace", snapshot }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  return useMemo(
    () => ({
      pages: state.present.pages,
      elements: state.present.elements,
      present: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      reset,
      commit,
      replace,
      undo,
      redo,
    }),
    [state.present, state.past.length, state.future.length, reset, commit, replace, undo, redo],
  );
}
