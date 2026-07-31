# Stirling PDF Feature Gap

Reviewed against Stirling PDF's public repository and documentation on 2026-07-31. Stirling describes 60+ tools and a server-backed processing platform; Lazy PDF remains browser-first, so only operations supported safely by the current client stack are exposed as ready tools.

## Existing coverage

Lazy PDF already had working coverage for merge, split, compression, rotation, extraction, deletion, rearranging, cropping, editing, watermarking, redaction, signing, forms, flattening, metadata editing, repair, comparison, protection, unlocking, images-to-PDF, Office/text/image conversion, OCR PDF, and PDF previews.

## Added in this pass

- Duplicate Pages: duplicates a selected page up to 20 times.
- Remove Blank Pages: removes pages with no extractable text.
- Remove Metadata: clears common document property fields.
- Markdown to PDF: accepts Markdown files or typed Markdown and exports a PDF.
- OCR Images: OCRs multiple image files locally with Tesseract.
- PDF to Long Image: renders all PDF pages into one vertically joined PNG.
- Tool search and recent tools: local-only discovery on the tools index.

## Remaining gaps and reason

These are intentionally not registered as fake or incomplete tools:

- PDF/A conversion, signature verification, sanitize/normalization, and deep repair require standards-aware PDF engines that `pdf-lib` does not provide.
- Remove/change password and some encryption/decryption flows require a full PDF security engine; the existing protect/unlock paths remain unchanged.
- Searchable PDF and multiple OCR languages need a worker-language asset strategy and larger runtime downloads than the current English OCR flow.
- Accurate PDF-to-Word/Excel/PowerPoint layout conversion needs Office-grade document layout engines; the current browser exports preserve content or page imagery according to each existing tool's behavior.
- Barcode/QR generation, image compression/resizing/format conversion, and advanced annotation/form removal need dedicated browser libraries and focused validation before exposing them.
- Bookmarks, table of contents, page labels, long-image-to-PDF, batch orchestration, and ZIP workflows need new user-facing settings and result contracts rather than registry-only entries.

No unsupported item is presented as ready. This preserves the site's local-first behavior and avoids claiming functionality that the current browser toolchain cannot deliver reliably.
