# Lazy PDF Agent Guide

## Architecture

Lazy PDF is a TanStack Start application. Routing is file-based under `src/routes`. Tool metadata and URL mapping live in `src/lib/tools-registry.ts`, while `src/lib/render-tool.tsx` maps each tool slug to a concrete component in `src/components/tools`.

Document bytes should remain client-side. Use `pdf-lib`, PDF.js, WebAssembly, Canvas, and browser file APIs for processing. Netlify Functions may receive explicit cloud shared-link imports, but must never persist document contents. Persistent structured metadata belongs in Netlify Database through the Drizzle schema in `db/schema.ts`.

## Key Directories

- `src/components/tools`: individual PDF and conversion workflows
- `src/components/site`: shared uploader, authentication, editor, result preview, layout, header, and footer
- `src/components/ui`: Radix-based design primitives
- `src/lib`: PDF helpers, registries, download/result transport, and staged-file handoff
- `netlify/functions`: serverless APIs using standard Web `Request` and `Response`
- `db`: Netlify Database client and Drizzle schema
- `netlify/database/migrations`: generated database migrations

## Conventions

- Keep TypeScript strict and avoid `any` except documented router boundary wrappers.
- Preserve local-first privacy. Store metadata only unless the product explicitly states otherwise.
- Validate file type and size before processing and show failures through Sonner toasts.
- Publish generated files through `downloadBlob` or `publishResult` so users receive a reviewable result.
- Add tools to both `tools-registry.ts` and `render-tool.tsx`.
- Use semantic controls, visible focus states, keyboard support, and responsive layouts.
- Use CSS variables from `src/styles.css`; maintain both light and dark themes.
- Database schema changes require a named Drizzle migration.
- Identity code must use `@netlify/identity`; do not add deprecated identity packages.

## Non-Obvious Decisions

The homepage stages selected `File` objects in a short-lived module store before route navigation. The destination tool's `DropZone` consumes those objects immediately, avoiding uploads and serialization. Spreadsheet support uses ZIP/XML handling through JSZip instead of vulnerable spreadsheet packages. Result previews render at most eight PDF pages to prevent memory spikes on large documents.
