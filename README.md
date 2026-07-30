# Lazy PDF

Lazy PDF is a production-focused, browser-first PDF workspace built with TanStack Start and Netlify. It provides real document organization, editing, conversion, OCR, signing, security, and export workflows while keeping normal file processing on the user's device.

## Highlights

- 45 client-side PDF and conversion tools powered by `pdf-lib`, PDF.js, Tesseract, JSZip, Mammoth, PptxGenJS, and browser APIs.
- Validated drag-and-drop intake with automatic routing to the appropriate tool.
- Google Drive and Dropbox public shared-link import with host allowlisting, timeouts, size limits, and no server retention.
- Full PDF editor with text, highlights, drawing, images, shapes, form filling, annotations, undo/redo, zoom, and page navigation.
- Netlify Identity email, Google, and GitHub authentication with verification, recovery, and session handling.
- Optional dashboard backed by Netlify Database. Only operation metadata is stored; document bytes are never persisted.
- Responsive light/dark interface, accessible controls, structured error states, and bounded PDF previews.

## Technology

- React 19, TypeScript strict mode, TanStack Start/Router, Vite, Tailwind CSS 4, Radix UI, Framer Motion
- Netlify Functions, Netlify Identity, Netlify Database, Drizzle ORM
- PDF.js, pdf-lib, qpdf-wasm, Tesseract.js, JSZip, Mammoth, docx, PptxGenJS

## Local Setup

1. Install Node.js 22 or newer.
2. Install dependencies with `npm install`.
3. Start the full Netlify environment with `netlify dev --port 8889`.
4. Open `http://localhost:8889`.

Netlify Database is provisioned automatically. Database migrations live in `netlify/database/migrations` and deploy automatically. Netlify Identity must be enabled for email authentication; Google and GitHub buttons become active after those providers are configured for the site.

## Architecture

- `src/routes` contains the landing page, dashboard, tool routes, blog, sitemap, and RSS endpoints.
- `src/components/tools` contains concrete PDF processing implementations.
- `src/components/site` contains product-level upload, account, editor, preview, navigation, and layout components.
- `src/lib` contains PDF rendering, range parsing, result transport, file handoff, download, and registry utilities.
- `netlify/functions` contains authenticated history and allowlisted cloud-import endpoints.
- `db` defines the Drizzle schema and Netlify Database client.

## Privacy and Security

Normal PDF processing is local to the browser. The history endpoint stores filename, MIME type, output size, tool name, favorite state, and timestamp for authenticated users. Cloud import accepts only Google Drive and Dropbox shared links, limits downloads to 50 MB, applies a 20-second timeout, and returns bytes directly without persistence.

Production dependencies currently report zero known npm audit vulnerabilities. Build-tool advisories may still appear in development-only dependency trees and should be reviewed during routine dependency upgrades.
