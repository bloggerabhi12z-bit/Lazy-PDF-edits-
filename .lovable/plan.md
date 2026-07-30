## Goal
Rebuild the in-app PDF editor into a production-grade, three-panel workspace (thumbnails / preview / properties) with undo/redo, drag-reorder, multi-select, keyboard shortcuts, progressive rendering, and a post-apply success screen — while keeping the existing tool pipeline (pdf-lib) and result-preview flow.

## Scope
Applies to the four editor-driven tools already using `PdfEditor`:
- Delete Pages, Extract Pages, Rearrange Pages, Rotate

Other tools (Merge, Split, Compress, Watermark, etc.) are out of scope for this pass — they use different UIs. Item 23's long feature list is already covered by existing tools; no new tools are added here.

## What's changing

### 1. New `PdfEditor` (full rewrite of `src/components/site/PdfEditor.tsx`)
Three-panel layout:

```text
┌──────────┬─────────────────────────┬──────────┐
│ Thumbs   │      PDF Preview        │ Props    │
│ (left)   │       (center ~70%)     │ (right)  │
│ scroll   │  virtualized canvas     │ file info│
│ multi-   │  smooth zoom            │ selection│
│ select   │  page indicator         │ tool tips│
│ DnD      │                         │          │
└──────────┴─────────────────────────┴──────────┘
```

Features:
- Progressive thumbnails with skeletons; total page count shown immediately.
- Load states: `Reading PDF… → Rendering pages… → Ready to edit`.
- Center preview renders visible pages only (virtualized list, `IntersectionObserver`), high-DPR canvas, smooth zoom 25–400%, fit-width / fit-page, current page indicator overlay while scrolling.
- Multi-select: click, Shift-click (range), Ctrl/Cmd-click (toggle), Select All / Clear.
- Drag-and-drop reordering in the thumbnail rail (HTML5 DnD, no new dep).
- Right-click context menu on thumbnails (Rotate L/R, Delete, Extract, Duplicate, Select All).
- Undo / Redo / Reset with a bounded history stack of `EditorPage[]` snapshots.
- Keyboard: Ctrl/Cmd+Z / Y / A, Delete, ArrowUp/Down, Home/End, Space (toggle select).
- Sticky primary "Apply Changes" button in the right panel; large, brand-colored.
- Right panel shows: file name, size, total pages, PDF version, first-page dimensions, encryption flag, selection summary, and tool-specific hint.
- Error surface for invalid / password-protected / corrupt PDFs with a Retry action.
- Accessible: ARIA labels on all buttons, focus-visible rings, roving tabindex on the thumbnail list.
- Responsive: three columns on desktop; collapsible left/right drawers on tablet; bottom toolbar + slide-out thumbnails on mobile; pinch-to-zoom via touch gestures on the preview.
- Animations: `framer-motion` (already used in `ResultPreview`) for panel transitions, selection highlight, and drag feedback.

### 2. Success screen after Apply Changes
- Tools call a new `onApply` that returns `{ blob, filename }`; the editor swaps the workspace for a success card:
  - `✓ PDF Updated Successfully`
  - Inline preview of the edited PDF (first page canvas + page count + new size)
  - Buttons: **Download**, **Edit Again** (restores workspace), **Upload New PDF** (clears file)
- Existing `ResultPreview` below the tool still works for full preview + Download.
- Never auto-downloads (already the case).

### 3. Processing feedback
Progress states while pdf-lib runs and the new file renders: `Processing… → Updating PDF… → Optimizing… → Almost done… → Completed`. Shown in the sticky action area.

### 4. Tool wrappers (Delete/Extract/Rearrange/Rotate)
Minor updates: return `{ blob, filename }` from `onApply` instead of calling `downloadBlob` themselves, so the editor can show the success screen. `downloadBlob` still runs when the user hits Download.

### 5. Browser compatibility / Brave fix
Rendering already uses pdf.js canvas — no iframe. The "blocked by Brave" symptom comes from the `ResultPreview` iframe fallback for PDFs; swap that iframe for a pdf.js multi-page canvas preview so Brave's Shields never intercept it.

## Technical notes
- No new npm dependencies; reuse `pdfjs-dist`, `pdf-lib`, `framer-motion`, `lucide-react`, shadcn primitives, `sonner`.
- Virtualization: hand-rolled with `IntersectionObserver` — avoids adding `react-virtual`.
- DnD: native HTML5 `draggable` events on thumbnail `<li>`; keyboard fallback via existing arrow buttons.
- History stack capped at 50 entries to bound memory.
- Canvas rendered at `devicePixelRatio` for crisp text; released via `canvas.width = 0` when scrolled out of view.
- All color/spacing uses existing design tokens (`bg-card`, `text-foreground`, `ring-signal`, etc.) — no hardcoded colors.
- Keep the file under `src/components/site/PdfEditor.tsx`; extract sub-parts (`ThumbnailRail`, `PreviewCanvas`, `PropertiesPanel`, `SuccessScreen`) into sibling files under `src/components/site/pdf-editor/` to keep files small.

## Out of scope (call out to user)
- New tools from item 23 not already in the app (Crop, Duplicate as a standalone tool, Draw, Shapes, Signature, Whiteout, OCR, Search/Replace text). Duplicate Page is added as an editor action; the rest remain future work.
- Mini-map (item 22) — skipped; scroll position indicator + page counter cover navigation.
- Share button on success screen — skipped unless requested.

## Deliverables
- `src/components/site/pdf-editor/PdfEditor.tsx` (new orchestrator)
- `src/components/site/pdf-editor/ThumbnailRail.tsx`
- `src/components/site/pdf-editor/PreviewCanvas.tsx`
- `src/components/site/pdf-editor/PropertiesPanel.tsx`
- `src/components/site/pdf-editor/SuccessScreen.tsx`
- `src/components/site/pdf-editor/useEditorState.ts` (history + selection + keyboard)
- Re-export from existing `src/components/site/PdfEditor.tsx` so tool imports don't change
- Updated `DeletePagesTool`, `ExtractPagesTool`, `RearrangePagesTool`, `RotateTool` to return `{ blob, filename }`
- Updated `ResultPreview.tsx` to render PDFs with pdf.js instead of an iframe
