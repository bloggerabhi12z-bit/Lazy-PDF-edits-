import {
  Combine,
  Scissors,
  Minimize2,
  RotateCw,
  ImageIcon,
  Pencil,
  Trash2,
  FileOutput,
  MoveVertical,
  Crop,
  Lock,
  Unlock,
  PenTool,
  FormInput,
  Droplets,
  EraserIcon,
  Hash,
  PanelTop,
  ScanText,
  Wrench,
  Layers,
  GitCompare,
  Images,
  FileText,
  ScanLine,
  Info,
  Highlighter,
  FileType,
  FileSpreadsheet,
  Presentation,
  FileImage,
  Code2,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

export type ToolStatus = "ready" | "soon";

export type ToolCategory =
  | "organize"
  | "optimize"
  | "edit"
  | "security"
  | "convert-to"
  | "convert-from";

export interface ToolMeta {
  slug: string;
  /** SEO-friendly URL path (without leading slash). e.g. "merge-pdf" */
  seoSlug: string;
  name: string;
  tagline: string;
  description: string;
  keywords: string[];
  icon: LucideIcon;
  accentClass: string;
  status: ToolStatus;
  category: ToolCategory;
}

export const TOOLS: ToolMeta[] = [
  // Organize
  { slug: "merge", seoSlug: "merge-pdf", name: "Merge PDF", tagline: "Combine multiple PDFs into one.", description: "Drop any number of PDFs, rearrange them, and download a single stitched file.", keywords: ["merge pdf", "combine pdf", "join pdf files", "pdf merger", "merge pdf online free"], icon: Combine, accentClass: "from-amber-200 to-orange-200", status: "ready", category: "organize" },
  { slug: "split", seoSlug: "split-pdf", name: "Split PDF", tagline: "Extract a page range from a PDF.", description: "Pick a start and end page and download just that slice.", keywords: ["split pdf", "pdf splitter", "extract pdf pages", "divide pdf", "split pdf online"], icon: Scissors, accentClass: "from-sky-200 to-indigo-200", status: "ready", category: "organize" },
  { slug: "extract-pages", seoSlug: "extract-pdf-pages", name: "Extract Pages", tagline: "Pull specific pages into a new PDF.", description: "Select the pages you want and get a new document with just those.", keywords: ["extract pdf pages", "pull pages from pdf", "pdf page extractor", "save pdf pages"], icon: FileOutput, accentClass: "from-cyan-200 to-sky-200", status: "ready", category: "organize" },
  { slug: "delete-pages", seoSlug: "delete-pdf-pages", name: "Delete Pages", tagline: "Remove unwanted pages.", description: "Select the pages to drop and download the trimmed PDF.", keywords: ["delete pdf pages", "remove pages from pdf", "pdf page remover", "trim pdf"], icon: Trash2, accentClass: "from-red-200 to-rose-200", status: "ready", category: "organize" },
  { slug: "rearrange-pages", seoSlug: "rearrange-pdf-pages", name: "Rearrange Pages", tagline: "Reorder pages in a PDF.", description: "Drag pages into a new order and export in that sequence.", keywords: ["rearrange pdf pages", "reorder pdf", "pdf page order", "sort pdf pages"], icon: MoveVertical, accentClass: "from-lime-200 to-emerald-200", status: "ready", category: "organize" },
  { slug: "rotate", seoSlug: "rotate-pdf", name: "Rotate PDF", tagline: "Rotate pages in a document.", description: "Fix sideways scans instantly. Rotate 90°, 180°, or 270° across the document.", keywords: ["rotate pdf", "rotate pdf pages", "pdf rotator", "turn pdf sideways"], icon: RotateCw, accentClass: "from-rose-200 to-pink-200", status: "ready", category: "organize" },
  { slug: "crop", seoSlug: "crop-pdf", name: "Crop PDF", tagline: "Trim margins from pages.", description: "Trim the same margin from every page in a PDF.", keywords: ["crop pdf", "trim pdf margins", "pdf cropper", "resize pdf"], icon: Crop, accentClass: "from-stone-200 to-neutral-200", status: "ready", category: "organize" },

  // Optimize / Repair
  { slug: "compress", seoSlug: "compress-pdf", name: "Compress PDF", tagline: "Shrink a PDF's file size.", description: "Re-encodes objects and strips metadata to reduce file size.", keywords: ["compress pdf", "reduce pdf size", "pdf compressor", "shrink pdf", "make pdf smaller"], icon: Minimize2, accentClass: "from-emerald-200 to-teal-200", status: "ready", category: "optimize" },
  { slug: "repair", seoSlug: "repair-pdf", name: "Repair PDF", tagline: "Fix minor structural issues.", description: "Parses and re-saves the PDF, resolving many common corruption issues.", keywords: ["repair pdf", "fix corrupt pdf", "pdf repair tool", "recover pdf"], icon: Wrench, accentClass: "from-amber-200 to-yellow-200", status: "ready", category: "optimize" },
  { slug: "flatten", seoSlug: "flatten-pdf", name: "Flatten PDF", tagline: "Flatten form fields into content.", description: "Bakes form field values into the page so they can't be edited.", keywords: ["flatten pdf", "flatten pdf form", "lock pdf form", "pdf flattener"], icon: Layers, accentClass: "from-slate-200 to-zinc-200", status: "ready", category: "optimize" },

  // Edit
  { slug: "edit", seoSlug: "edit-pdf", name: "Edit PDF", tagline: "Add text to a PDF.", description: "Add text to the first page of an existing PDF.", keywords: ["edit pdf", "pdf editor", "edit pdf online", "add text to pdf"], icon: Pencil, accentClass: "from-fuchsia-200 to-pink-200", status: "ready", category: "edit" },
  { slug: "watermark", seoSlug: "add-watermark-to-pdf", name: "Add Watermark", tagline: "Overlay text on every page.", description: "Add a diagonal text watermark across all pages, with adjustable opacity.", keywords: ["add watermark to pdf", "pdf watermark", "watermark pdf online", "stamp pdf"], icon: Droplets, accentClass: "from-blue-200 to-cyan-200", status: "ready", category: "edit" },
  { slug: "remove-watermark", seoSlug: "remove-watermark-from-pdf", name: "Remove Watermark", tagline: "Cover central watermark areas.", description: "Cover the central watermark area on every page.", keywords: ["remove watermark from pdf", "delete pdf watermark", "erase pdf watermark"], icon: EraserIcon, accentClass: "from-neutral-200 to-stone-200", status: "ready", category: "edit" },
  { slug: "page-numbers", seoSlug: "add-page-numbers-to-pdf", name: "Add Page Numbers", tagline: "Stamp page numbers.", description: "Add page numbers to every page with configurable position and format.", keywords: ["add page numbers to pdf", "pdf page numbers", "number pdf pages"], icon: Hash, accentClass: "from-indigo-200 to-violet-200", status: "ready", category: "edit" },
  { slug: "header-footer", seoSlug: "add-header-footer-to-pdf", name: "Header & Footer", tagline: "Add running headers and footers.", description: "Adds a text header and footer to every page.", keywords: ["add header footer pdf", "pdf header", "pdf footer"], icon: PanelTop, accentClass: "from-teal-200 to-cyan-200", status: "ready", category: "edit" },
  { slug: "metadata", seoSlug: "edit-pdf-metadata", name: "PDF Metadata Editor", tagline: "Edit title, author, subject.", description: "View and update the PDF's document metadata.", keywords: ["edit pdf metadata", "pdf properties", "change pdf author", "pdf title"], icon: Info, accentClass: "from-purple-200 to-fuchsia-200", status: "ready", category: "edit" },
  { slug: "redact", seoSlug: "redact-pdf", name: "Redact PDF", tagline: "Black-out content.", description: "Place a black redaction box on the first page.", keywords: ["redact pdf", "black out pdf", "hide pdf content", "pdf redaction"], icon: Highlighter, accentClass: "from-zinc-200 to-slate-200", status: "ready", category: "edit" },
  { slug: "compare", seoSlug: "compare-pdf", name: "Compare PDFs", tagline: "Text diff of two PDFs.", description: "Compare extracted text from two PDF files and download a report.", keywords: ["compare pdf", "pdf diff", "compare two pdfs", "pdf comparison"], icon: GitCompare, accentClass: "from-orange-200 to-amber-200", status: "ready", category: "edit" },

  // Security
  { slug: "protect", seoSlug: "protect-pdf", name: "Protect PDF", tagline: "Password-protect a PDF.", description: "Encrypt a PDF with an opening password in your browser.", keywords: ["protect pdf", "password protect pdf", "encrypt pdf", "secure pdf"], icon: Lock, accentClass: "from-rose-200 to-red-200", status: "ready", category: "security" },
  { slug: "unlock", seoSlug: "unlock-pdf", name: "Unlock PDF", tagline: "Remove a known password.", description: "Create an unlocked copy when you know the PDF password.", keywords: ["unlock pdf", "remove pdf password", "decrypt pdf", "pdf password remover"], icon: Unlock, accentClass: "from-lime-200 to-green-200", status: "ready", category: "security" },
  { slug: "sign", seoSlug: "sign-pdf", name: "Sign PDF", tagline: "Type a signature.", description: "Add a typed signature to the first page of a PDF.", keywords: ["sign pdf", "esign pdf", "pdf signature", "add signature to pdf"], icon: PenTool, accentClass: "from-amber-200 to-orange-200", status: "ready", category: "security" },
  { slug: "fill-forms", seoSlug: "fill-pdf-forms", name: "Fill PDF Forms", tagline: "Fill interactive forms.", description: "Read form field names and fill them from JSON values.", keywords: ["fill pdf forms", "pdf form filler", "complete pdf form"], icon: FormInput, accentClass: "from-sky-200 to-blue-200", status: "ready", category: "security" },

  // Convert TO PDF
  { slug: "jpg-to-pdf", seoSlug: "jpg-to-pdf", name: "JPG to PDF", tagline: "Turn JPG images into a PDF.", description: "Drop JPG images, order them, and export a shareable PDF.", keywords: ["jpg to pdf", "jpeg to pdf", "image to pdf", "convert jpg to pdf"], icon: ImageIcon, accentClass: "from-violet-200 to-fuchsia-200", status: "ready", category: "convert-to" },
  { slug: "png-to-pdf", seoSlug: "png-to-pdf", name: "PNG to PDF", tagline: "Turn PNG images into a PDF.", description: "Drop PNG images and export a shareable PDF, one image per page.", keywords: ["png to pdf", "convert png to pdf", "image to pdf"], icon: FileImage, accentClass: "from-purple-200 to-violet-200", status: "ready", category: "convert-to" },
  { slug: "word-to-pdf", seoSlug: "word-to-pdf", name: "Word to PDF", tagline: "Convert .docx to PDF.", description: "Extract Word document text and export it as a PDF.", keywords: ["word to pdf", "docx to pdf", "convert word to pdf", "doc to pdf"], icon: FileType, accentClass: "from-blue-200 to-sky-200", status: "ready", category: "convert-to" },
  { slug: "excel-to-pdf", seoSlug: "excel-to-pdf", name: "Excel to PDF", tagline: "Convert spreadsheets to PDF.", description: "Convert workbook sheets to a readable PDF.", keywords: ["excel to pdf", "xlsx to pdf", "spreadsheet to pdf"], icon: FileSpreadsheet, accentClass: "from-green-200 to-emerald-200", status: "ready", category: "convert-to" },
  { slug: "powerpoint-to-pdf", seoSlug: "powerpoint-to-pdf", name: "PowerPoint to PDF", tagline: "Convert slides to PDF.", description: "Extract slide text and export it as a PDF.", keywords: ["powerpoint to pdf", "pptx to pdf", "ppt to pdf", "slides to pdf"], icon: Presentation, accentClass: "from-orange-200 to-red-200", status: "ready", category: "convert-to" },
  { slug: "html-to-pdf", seoSlug: "html-to-pdf", name: "HTML to PDF", tagline: "Convert HTML to PDF.", description: "Paste HTML and export its readable content as a PDF.", keywords: ["html to pdf", "convert html to pdf", "webpage to pdf"], icon: Code2, accentClass: "from-slate-200 to-gray-200", status: "ready", category: "convert-to" },
  { slug: "epub-to-pdf", seoSlug: "epub-to-pdf", name: "EPUB to PDF", tagline: "Convert an ebook to PDF.", description: "Extract EPUB chapter text and export it as a PDF.", keywords: ["epub to pdf", "ebook to pdf", "convert epub"], icon: BookOpen, accentClass: "from-yellow-200 to-amber-200", status: "ready", category: "convert-to" },
  { slug: "scan-to-pdf", seoSlug: "scan-to-pdf", name: "Scan to PDF", tagline: "Turn scans into a PDF.", description: "Upload scan photos or camera images and build a PDF.", keywords: ["scan to pdf", "camera to pdf", "photo to pdf", "receipt to pdf"], icon: ScanLine, accentClass: "from-cyan-200 to-teal-200", status: "ready", category: "convert-to" },

  // Convert FROM PDF
  { slug: "pdf-to-jpg", seoSlug: "pdf-to-jpg", name: "PDF to JPG", tagline: "Render pages as JPG images.", description: "Render every PDF page as a JPG and download a ZIP.", keywords: ["pdf to jpg", "pdf to jpeg", "pdf to image", "convert pdf to jpg"], icon: ImageIcon, accentClass: "from-fuchsia-200 to-pink-200", status: "ready", category: "convert-from" },
  { slug: "pdf-to-png", seoSlug: "pdf-to-png", name: "PDF to PNG", tagline: "Render pages as PNG images.", description: "Render every PDF page as a PNG and download a ZIP.", keywords: ["pdf to png", "convert pdf to png", "pdf to image"], icon: FileImage, accentClass: "from-violet-200 to-purple-200", status: "ready", category: "convert-from" },
  { slug: "pdf-to-word", seoSlug: "pdf-to-word", name: "PDF to Word", tagline: "Convert PDF text to .docx.", description: "Extract PDF text and export it into a Word document.", keywords: ["pdf to word", "pdf to docx", "convert pdf to word", "pdf to doc"], icon: FileType, accentClass: "from-blue-200 to-indigo-200", status: "ready", category: "convert-from" },
  { slug: "pdf-to-excel", seoSlug: "pdf-to-excel", name: "PDF to Excel", tagline: "Extract text to .xlsx.", description: "Extract PDF text into an Excel workbook.", keywords: ["pdf to excel", "pdf to xlsx", "convert pdf to excel"], icon: FileSpreadsheet, accentClass: "from-emerald-200 to-green-200", status: "ready", category: "convert-from" },
  { slug: "pdf-to-powerpoint", seoSlug: "pdf-to-powerpoint", name: "PDF to PowerPoint", tagline: "Convert pages to slides.", description: "Render each PDF page as a PowerPoint slide.", keywords: ["pdf to powerpoint", "pdf to pptx", "pdf to ppt", "pdf to slides"], icon: Presentation, accentClass: "from-red-200 to-orange-200", status: "ready", category: "convert-from" },
  { slug: "pdf-to-html", seoSlug: "pdf-to-html", name: "PDF to HTML", tagline: "Convert PDF to HTML.", description: "Extract PDF text into a simple HTML document.", keywords: ["pdf to html", "convert pdf to html", "pdf to web"], icon: Code2, accentClass: "from-gray-200 to-slate-200", status: "ready", category: "convert-from" },
  { slug: "pdf-to-epub", seoSlug: "pdf-to-epub", name: "PDF to EPUB", tagline: "Convert PDF to an ebook.", description: "Extract PDF text into a basic EPUB ebook.", keywords: ["pdf to epub", "pdf to ebook", "convert pdf to epub"], icon: BookOpen, accentClass: "from-amber-200 to-yellow-200", status: "ready", category: "convert-from" },
  { slug: "extract-text", seoSlug: "extract-text-from-pdf", name: "Extract Text", tagline: "Get plain text out of a PDF.", description: "Extract selectable text from a PDF and download a text file.", keywords: ["extract text from pdf", "pdf to text", "copy text from pdf"], icon: FileText, accentClass: "from-teal-200 to-emerald-200", status: "ready", category: "convert-from" },
  { slug: "extract-images", seoSlug: "extract-images-from-pdf", name: "Extract Images", tagline: "Render pages as images.", description: "Export PDF pages as PNG images in a ZIP.", keywords: ["extract images from pdf", "pdf image extractor", "save pdf images"], icon: Images, accentClass: "from-pink-200 to-rose-200", status: "ready", category: "convert-from" },
  { slug: "ocr", seoSlug: "ocr-pdf", name: "OCR PDF", tagline: "Read scanned PDFs.", description: "Run browser OCR on scanned PDF pages and download text.", keywords: ["ocr pdf", "scanned pdf to text", "pdf ocr online", "read scanned pdf"], icon: ScanText, accentClass: "from-indigo-200 to-blue-200", status: "ready", category: "convert-from" },
];

export const CATEGORIES: { id: ToolCategory; label: string }[] = [
  { id: "organize", label: "Organize" },
  { id: "optimize", label: "Optimize & Repair" },
  { id: "edit", label: "Edit & Annotate" },
  { id: "security", label: "Security" },
  { id: "convert-to", label: "Convert to PDF" },
  { id: "convert-from", label: "Convert from PDF" },
];

export function getTool(slug: string) {
  return TOOLS.find((t) => t.slug === slug);
}

export function getToolBySeoSlug(seoSlug: string) {
  return TOOLS.find((t) => t.seoSlug === seoSlug);
}

/** Related tools: 6 same-category peers, then top from other categories */
export function getRelatedTools(tool: ToolMeta, count = 6): ToolMeta[] {
  const sameCat = TOOLS.filter((t) => t.category === tool.category && t.slug !== tool.slug);
  const others = TOOLS.filter((t) => t.category !== tool.category && t.slug !== tool.slug);
  return [...sameCat, ...others].slice(0, count);
}

/** Popular tools used in footer / cross-links */
export const POPULAR_TOOL_SLUGS = [
  "merge",
  "split",
  "compress",
  "pdf-to-word",
  "word-to-pdf",
  "pdf-to-jpg",
  "jpg-to-pdf",
  "rotate",
  "unlock",
  "edit",
];

export function getPopularTools() {
  return POPULAR_TOOL_SLUGS.map((s) => TOOLS.find((t) => t.slug === s)!).filter(Boolean);
}
