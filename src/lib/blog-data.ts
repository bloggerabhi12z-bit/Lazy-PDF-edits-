export interface BlogAuthor {
  slug: string;
  name: string;
  bio: string;
  role: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  tags: string[];
  authorSlug: string;
  publishedAt: string; // ISO
  updatedAt?: string;
  /** Markdown body */
  content: string;
}

export const AUTHORS: BlogAuthor[] = [
  {
    slug: "lazy-pdf-team",
    name: "The Lazy PDF Team",
    bio: "We build the fastest, most private PDF tools on the web. Everything runs in your browser — nothing is uploaded.",
    role: "Product & Engineering",
  },
  {
    slug: "maya-ortiz",
    name: "Maya Ortiz",
    bio: "Technical writer covering document workflows, privacy, and productivity.",
    role: "Editor",
  },
];

export const CATEGORIES = [
  { slug: "tutorials", name: "Tutorials" },
  { slug: "pdf-tips", name: "PDF Tips" },
  { slug: "security", name: "Security" },
  { slug: "productivity", name: "Productivity" },
];

export const POSTS: BlogPost[] = [
  // --- ORIGINAL 4 ARTICLES ---
  {
    slug: "how-to-merge-pdf-files",
    title: "How to Merge PDF Files: The Complete 2026 Guide",
    excerpt: "Combine PDFs on any device without uploading them to a server. A step-by-step guide with tips, keyboard shortcuts, and privacy notes.",
    category: "tutorials",
    tags: ["merge pdf", "combine pdf", "tutorial"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-06-01",
    updatedAt: "2026-07-01",
    content: `## Why merging PDFs still matters in 2026

Even with cloud drives and shared docs, the PDF is still the format most organizations trust for anything that needs to look identical everywhere. Merging PDFs — combining several separate files into one clean document — is one of the most common tasks people run into: assembling a report, stitching signed contracts, bundling receipts for expenses, or preparing a submission packet.

The problem is that most "merge PDF online" websites you'll find in search results upload your files to their servers. That works, but it's not always appropriate for confidential material, and it's slow when your files are large.

This guide shows you how to merge PDFs the modern way: **entirely in your browser**, in seconds, with zero uploads.

## Step-by-step: merging PDFs online

### 1. Open the Merge PDF tool

Go to Lazy PDF's free [Merge PDF](/merge-pdf) tool. Nothing installs; the page loads instantly.

### 2. Drop your PDFs

Drag every PDF you want to combine into the upload zone, or click to browse. There's no upload progress bar because there's no upload — files are read directly from your device.

### 3. Reorder pages

Drag file tiles into the sequence you want. Zoom into individual pages to check them before combining. You can also drop new files in mid-flow.

### 4. Merge and download

Click **Merge**. Your PDFs are combined locally using WebAssembly, and the finished file downloads directly to your computer. Nothing is stored on our end.

## Try it now

[Open the Merge PDF tool →](/merge-pdf)`
  },
  {
    slug: "compress-pdf-without-losing-quality",
    title: "How to Compress a PDF Without Losing Quality",
    excerpt: "Shrink a PDF for email or upload while keeping text sharp and images crisp. Understand what compression actually does.",
    category: "pdf-tips",
    tags: ["compress pdf", "reduce pdf size", "quality"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-05-18",
    content: `## The 25 MB email limit

Gmail caps attachments at 25 MB. Outlook is 20 MB. Most upload forms cap somewhere between 5 and 10 MB. Compressing a PDF is usually the answer — but compress too aggressively and text turns fuzzy.

## What actually happens when you compress a PDF

A quality compressor doesn't just "shrink the file"; it makes several targeted decisions:
1. **Re-encode images** using more efficient formats.
2. **Downscale oversize images.** 
3. **Strip metadata** — thumbnails, unused fonts, revision history.

## Choosing a compression level

Lazy PDF's [Compress PDF](/compress-pdf) tool offers three preset tiers: Low, Medium, and High compression. Select the one that fits your balance of file size versus image clarity.

[Open Compress PDF →](/compress-pdf)`
  },
  {
    slug: "best-free-pdf-editor",
    title: "The Best Free PDF Editor in 2026 (No Sign-Up, No Watermark)",
    excerpt: "Adobe Acrobat is powerful — and expensive. Here's an honest look at the free PDF editors worth using in 2026.",
    category: "productivity",
    tags: ["pdf editor", "free", "adobe alternative"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-04-12",
    content: `## Why "free" usually means "we take your files"

Most free PDF editors upload your PDF to their servers. In 2026, there's no reason to hand your documents to a stranger's server just to add a signature.

## What to look for in a free PDF editor

- **In-browser processing.** No uploads.
- **No account required.** 
- **No watermarks.** 

We built [Lazy PDF](/tools) because we wanted an editor that ticked every box above. Everything runs locally in your browser.

[Browse all tools →](/tools)`
  },
  {
    slug: "protect-pdf-online-security-guide",
    title: "How to Protect a PDF Online: A Practical Security Guide",
    excerpt: "Passwords, permissions, and privacy: everything you need to know about protecting a PDF in 2026.",
    category: "security",
    tags: ["protect pdf", "password", "privacy"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-03-22",
    content: `## Passwords aren't the only layer

When people say "protect this PDF," they usually mean encrypting it or restricting permissions.

## Step 1: Choose a strong password

For anything sensitive, use a 16+ character password. 

## Step 2: Encrypt with a modern cipher

Lazy PDF's [Protect PDF](/protect-pdf) tool uses AES-256 — the standard PDF encryption used by Adobe Acrobat.

## Step 3: Don't upload the file

The whole point of encryption is privacy. Uploading to a cloud converter defeats the purpose. In-browser tools like Lazy PDF never see your file.

[Protect a PDF now →](/protect-pdf)`
  },

  // --- 16 PREVIOUSLY GENERATED ARTICLES ---
  {
    slug: "how-to-convert-jpg-images-to-pdf",
    title: "How to Convert JPG Images to PDF (Zero Uploads)",
    excerpt: "Turn photos of receipts, whiteboard notes, and scanned documents into a single, shareable PDF document instantly.",
    category: "tutorials",
    tags: ["jpg to pdf", "convert images", "images to pdf"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-01",
    content: `## The problem with sharing images

Sending someone ten separate JPG files is inconvenient. Whether you are submitting a visual portfolio or expense receipts, wrapping your images in a single PDF is the professional standard.

## How to convert JPG to PDF in your browser

Using our [JPG to PDF](/jpg-to-pdf) tool, you can do this securely in seconds:
1. **Select your images:** Drag and drop your JPG/PNG files into the browser.
2. **Arrange the order:** Drag the thumbnail previews.
3. **Convert and save:** Click generate. The PDF is created locally.`
  },
  {
    slug: "how-to-convert-pdf-to-word",
    title: "How to Convert PDF to Word (Without Breaking Formatting)",
    excerpt: "Learn how to turn uneditable PDFs back into fully editable Microsoft Word documents while preserving fonts, tables, and layouts.",
    category: "tutorials",
    tags: ["pdf to word", "convert pdf", "editing"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-02",
    content: `## Why is editing a PDF so hard?

PDFs lock formatting in place. If you need to rewrite paragraphs or change a layout, you need to convert the file back to its source format.

## Converting PDF to Word (.docx)

Our [PDF to Word](/pdf-to-word) converter analyzes the text, fonts, and structural elements of your PDF and rebuilds them into an editable document locally. Financial reports and resumes shouldn't sit on a random server. Because LazyPDF runs completely in your browser, your proprietary information stays on your device.`
  },
  {
    slug: "how-to-split-pdf-pages",
    title: "How to Split a PDF or Extract Pages",
    excerpt: "Break large PDF files into smaller chunks or extract just the pages you need without downloading bulky software.",
    category: "tutorials",
    tags: ["split pdf", "extract pages", "organize"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-03",
    content: `## Dealing with massive documents

Sending an entire 100-page document when you only need one page wastes bandwidth. 

Using our [Split PDF](/split-pdf) tool, you can:
1. **Extract Specific Pages:** Pick individual pages (e.g., pages 3, 7).
2. **Split by Range:** Cut the document into separate files based on page numbers.

Because LazyPDF reads the file directly from your local hard drive, you can load a massive document and extract pages in seconds.`
  },
  {
    slug: "what-is-ocr-how-does-it-work",
    title: "What is OCR? Extracting Text from Scanned PDFs",
    excerpt: "Optical Character Recognition (OCR) turns flat images of text into searchable, selectable data.",
    category: "pdf-tips",
    tags: ["ocr", "scanned pdf", "extract text"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-04",
    content: `## The "Image-Only" PDF problem

If your cursor draws a blue box over a whole page instead of highlighting text, your PDF is a flat scan.

## Enter Optical Character Recognition (OCR)

OCR scans an image, identifies letters, and translates them back into text. Run your document through our [OCR PDF](/ocr-pdf) tool to create an invisible layer of selectable text over the original image. This enables searchability, copy/pasting, and screen-reader accessibility.`
  },
  {
    slug: "convert-word-to-pdf-formatting",
    title: "How to Convert Word to PDF (And Why You Should)",
    excerpt: "Lock your Microsoft Word documents into place before emailing them to clients or printing them.",
    category: "tutorials",
    tags: ["word to pdf", "convert", "formatting"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-05",
    content: `## The formatting disaster

You spend hours formatting a resume in Word, but it breaks when your recipient opens it on a Mac. This is why you should always share finished documents as PDFs.

To freeze your document's layout, use our [Word to PDF](/word-to-pdf) tool. It reads the XML structure of the Word file and maps it strictly to the PDF coordinate system locally in your browser.`
  },
  {
    slug: "pdf-vs-word-which-format-to-use",
    title: "PDF vs. Word: Which Format Should You Use?",
    excerpt: "Stop using the wrong file type. A breakdown of when to use Microsoft Word and when you absolutely must use a PDF.",
    category: "productivity",
    tags: ["pdf vs word", "file formats", "best practices"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-06",
    content: `## Two different tools for two different jobs

Microsoft Word is designed for *creation and collaboration*. PDF was designed for *presentation and preservation*.

- **When to use Word:** Drafting, collaborating, and data extraction.
- **When to use PDF:** External sharing, commercial printing, and legally binding contracts.

The optimal workflow is to draft in Word, then use a [Word to PDF](/word-to-pdf) converter for the final audience.`
  },
  {
    slug: "how-to-organize-reorder-pdf-pages",
    title: "How to Reorder and Organize PDF Pages",
    excerpt: "Delete blank pages, swap the order of chapters, and clean up messy PDFs using a visual dashboard.",
    category: "tutorials",
    tags: ["organize pdf", "reorder", "delete pages"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-07",
    content: `## The messy PDF problem

When dealing with bulk scans, you might find a blank page or an upside-down appendix. Our [Organize PDF](/organize-pdf) tool gives you a bird's-eye view of your document. 

You can drag and drop to reorder, click the trash can to delete, or rotate individual pages. Because it renders locally via WebAssembly, large files export instantly without upload times.`
  },
  {
    slug: "how-to-remove-password-from-pdf",
    title: "How to Remove a Password from a PDF",
    excerpt: "Tired of typing a password every time you open your own bank statement? Learn how to permanently unlock encrypted PDFs.",
    category: "security",
    tags: ["unlock pdf", "remove password", "encryption"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-08",
    content: `## The frustration of owned passwords

If you have a password-protected PDF on your personal hard drive, typing the password daily gets annoying. If you know the password, you can strip the encryption entirely using our [Unlock PDF](/unlock-pdf) tool.

When you type your password, it is never transmitted over the internet. The decryption math happens directly inside your browser's memory.`
  },
  {
    slug: "convert-excel-to-pdf-guide",
    title: "How to Convert Excel to PDF (Without Cutting Off Columns)",
    excerpt: "Stop printing spreadsheets that spill over onto 50 different pages. Learn how to convert Excel to PDF cleanly.",
    category: "tutorials",
    tags: ["excel to pdf", "spreadsheets", "convert"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-09",
    content: `## The spreadsheet formatting nightmare

Spreadsheets are built for infinite scrolling. When converting to PDF, they often cut columns in half. 

First, set your Print Area in Excel. Then, drop the file into our [Excel to PDF](/excel-to-pdf) tool. It locks the grids and background colors into a clean, uneditable PDF perfectly suited for sharing monthly financial statements.`
  },
  {
    slug: "how-to-watermark-pdf",
    title: "How to Add a Watermark to a PDF",
    excerpt: "Protect your intellectual property, stamp documents as 'Confidential', and brand your files with custom watermarks.",
    category: "security",
    tags: ["watermark pdf", "branding", "protect"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-10",
    content: `## Why watermark your documents?

Watermarks stamp a document's status (e.g., "DRAFT") or protect copyright. You can brand documents instantly using our [Watermark PDF](/watermark-pdf) tool.

Add custom text or upload a transparent PNG logo. For maximum security, combine your watermark with our [Protect PDF](/protect-pdf) tool to lock editing permissions.`
  },
  {
    slug: "how-to-convert-pdf-to-powerpoint",
    title: "How to Convert a PDF into a PowerPoint Presentation",
    excerpt: "Turn static PDF slides and reports into fully editable PowerPoint (.pptx) presentations for your next meeting.",
    category: "tutorials",
    tags: ["pdf to ppt", "powerpoint", "presentations"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-11",
    content: `## Recovering lost presentations

If you lose the original \`.pptx\` file but have the PDF export, you can reconstruct it. Our [PDF to PowerPoint](/pdf-to-powerpoint) tool analyzes the document structure, turning text blocks into editable text boxes and extracting graphics locally in your browser.`
  },
  {
    slug: "student-pdf-workflows-college",
    title: "The Ultimate PDF Workflow for College Students",
    excerpt: "From combining lecture notes to shrinking heavy textbook files, here are the free PDF tricks every student needs.",
    category: "productivity",
    tags: ["students", "study tips", "workflow"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-12",
    content: `## Managing digital coursework

1. **Compress heavy readings:** Use [Compress PDF](/compress-pdf) to shrink 50MB scans.
2. **Merge study materials:** Use [Merge PDF](/merge-pdf) to combine syllabuses and notes into one file.
3. **Extract text for citations:** Use [OCR PDF](/ocr-pdf) on scanned journal articles to copy and paste quotes directly into your essays.`
  },
  {
    slug: "how-to-extract-images-from-pdf",
    title: "How to Extract High-Quality Images from a PDF",
    excerpt: "Stop using the snipping tool. Learn how to extract the original, full-resolution images embedded inside any PDF.",
    category: "tutorials",
    tags: ["pdf to jpg", "extract images", "images"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-13",
    content: `## The screenshot problem

Screenshots are low-resolution. To get high-quality images out of a document, use our [PDF to JPG](/pdf-to-jpg) tool. You can choose to convert entire pages into JPGs or extract only the native, high-resolution image files embedded within the document code.`
  },
  {
    slug: "pdf-security-for-small-business",
    title: "PDF Management and Security for Small Businesses",
    excerpt: "How to handle invoices, contracts, and employee data securely without paying for expensive enterprise software.",
    category: "security",
    tags: ["small business", "invoices", "security"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-14",
    content: `## Document management on a budget

Small businesses process a massive amount of paperwork. Using LazyPDF bridges the gap by offering secure, browser-side processing. Use [Merge PDF](/merge-pdf) for onboarding packets, [Excel to PDF](/excel-to-pdf) for invoice archiving, and [Protect PDF](/protect-pdf) for contract security. Your files never touch our servers.`
  },
  {
    slug: "how-to-rotate-pdf-pages-permanently",
    title: "How to Permanently Rotate PDF Pages",
    excerpt: "Fix upside-down scans and landscape pages that are stuck in portrait mode. Save the rotation permanently.",
    category: "tutorials",
    tags: ["rotate pdf", "fix scans", "formatting"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-15",
    content: `## The temporary rotation trick

Rotating a page in your PDF reader is temporary. To permanently change the orientation so they open correctly for everyone, use our [Rotate PDF](/rotate-pdf) tool. The new file has its orientation hardcoded and downloads instantly to your local machine.`
  },
  {
    slug: "why-browser-based-pdf-tools-are-safer",
    title: "Why Browser-Based PDF Tools are the Future of Privacy",
    excerpt: "Understand the technology that allows LazyPDF to process your documents without ever uploading them to a cloud server.",
    category: "security",
    tags: ["privacy", "webassembly", "security"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-16",
    content: `## The new way: WebAssembly

LazyPDF is built on WebAssembly (Wasm), allowing heavy software to run directly inside your web browser. When you use our tools, no file is ever uploaded. The file is read from your hard drive, edited in your RAM, and saved back to your hard drive, ensuring absolute privacy and lightning-fast speeds.`
  },

  // --- 20 BRAND NEW ARTICLES ---
  {
    slug: "how-to-sign-pdf-online-securely",
    title: "How to Sign a PDF Document Online (Zero Uploads)",
    excerpt: "Add your electronic signature to contracts and forms safely. Learn why browser-based signing protects your identity.",
    category: "security",
    tags: ["sign pdf", "e-signature", "contracts"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-17",
    content: `## The risk of online signing

Signing a contract usually involves sensitive data: your name, address, payment terms, and your actual legal signature. Uploading this to a third-party server creates a major security vulnerability.

## Sign locally, stay secure

With LazyPDF's [Sign PDF](/sign-pdf) tool, your browser does the work. You can draw your signature, type it, or upload a scan of your physical signature. The tool overlays it onto your document entirely within your local memory. Once applied, the document is flattened to prevent anyone from copying your signature file off the page.`
  },
  {
    slug: "how-to-add-page-numbers-to-pdf",
    title: "How to Add Page Numbers to a PDF Document",
    excerpt: "Make your reports professional by batch-adding page numbers to your headers or footers in seconds.",
    category: "tutorials",
    tags: ["page numbers", "formatting", "edit pdf"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-18",
    content: `## Organization matters

If someone prints out your 50-page business proposal and drops the stack, how will they put it back together? Page numbers are an essential part of document formatting that often gets forgotten before exporting to PDF.

## Batch numbering

Instead of going back to the source Word file, use our [Add Page Numbers](/edit-pdf) functionality. You can select the position (bottom-right, top-center), choose the font style, and dictate which page the numbering should start on (skipping the title page). The changes apply locally in milliseconds.`
  },
  {
    slug: "what-is-pdf-a-archiving",
    title: "The Ultimate Guide to PDF/A for Document Archiving",
    excerpt: "Why legal systems and libraries require PDF/A formats for long-term document storage.",
    category: "pdf-tips",
    tags: ["pdf/a", "archiving", "compliance"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-19",
    content: `## Built to last forever

Standard PDFs are great, but they can include dynamic content like audio, video, or external font references. If you open a standard PDF 50 years from now and the font no longer exists on computers, the document breaks.

## Enter PDF/A

PDF/A is a standardized version of the Portable Document Format designed strictly for archiving. It forces all fonts to be embedded, forbids audio/video, and removes encryption to ensure future readability. If you are preparing legal records, using a PDF/A converter ensures absolute compliance.`
  },
  {
    slug: "how-to-flatten-a-pdf",
    title: "How to Flatten a PDF (And Why You Need To)",
    excerpt: "Lock interactive forms and layered graphics into a single, uneditable image layer for safe sharing.",
    category: "security",
    tags: ["flatten pdf", "security", "forms"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-20",
    content: `## The danger of interactive forms

When you fill out an interactive PDF form (like a tax document) and email it, the form fields often remain active. The recipient could accidentally alter your answers.

## Flattening secures the data

Flattening a PDF merges all form fields, annotations, and visual layers into one flat background layer. This makes the data permanent. You can use our [Edit PDF](/edit-pdf) tools to flatten your documents locally, ensuring nobody modifies your signed agreements after the fact.`
  },
  {
    slug: "how-to-crop-pdf-pages",
    title: "How to Crop PDF Pages Easily",
    excerpt: "Remove large white margins, printer marks, and unnecessary white space from your documents.",
    category: "tutorials",
    tags: ["crop pdf", "margins", "formatting"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-21",
    content: `## Trimming the excess

Sometimes a PDF is generated with massive white margins, making it difficult to read on smaller screens like iPads or Kindles. 

Using our visual [Crop PDF](/edit-pdf) utility, you can draw a bounding box around the core content of your document. The software will trim the canvas of every page to match that box, drastically improving mobile readability without losing the vector sharpness of the text.`
  },
  {
    slug: "how-to-convert-pdf-to-excel-extract-tables",
    title: "How to Convert PDF to Excel and Extract Tables",
    excerpt: "Stop manually retyping data. Pull data tables directly out of PDFs and into cleanly formatted spreadsheets.",
    category: "tutorials",
    tags: ["pdf to excel", "spreadsheets", "data extraction"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-22",
    content: `## The manual data entry trap

When an accountant receives a bank statement as a PDF, getting those numbers into financial software is tedious. Retyping leads to human error.

## Automated table extraction

Our [PDF to Excel](/pdf-to-excel) tool uses intelligent table-recognition algorithms. It scans the document for grid structures, extracts the numbers and text, and places them into exact cells within a new \`.xlsx\` file. Because it runs locally, even highly sensitive financial data remains completely private.`
  },
  {
    slug: "how-to-redact-sensitive-information-pdf",
    title: "How to Safely Redact Sensitive Information in a PDF",
    excerpt: "Drawing a black box over text isn't enough. Learn how to truly scrub hidden data from your files.",
    category: "security",
    tags: ["redact pdf", "privacy", "security"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-23",
    content: `## The black box mistake

Many users think they can just draw a black rectangle over a Social Security Number in a PDF editor. The problem? The text still exists underneath the shape. Anyone can drag their cursor over the box, copy the hidden text, and paste it elsewhere.

## True redaction

True redaction requires wiping the text from the file's underlying code. When using proper redaction tools, the text characters are permanently deleted and replaced by a visual black box, making recovery impossible.`
  },
  {
    slug: "how-to-compare-two-pdf-files",
    title: "How to Compare Two PDF Files for Differences",
    excerpt: "Spot contract changes, revised layouts, and hidden alterations quickly using document comparison.",
    category: "productivity",
    tags: ["compare pdf", "revisions", "workflow"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-24",
    content: `## Finding the hidden edits

If a client sends back a 40-page contract, how do you know what they changed if they didn't track their edits? Reading it line-by-line takes hours.

Advanced PDF comparison tools layer the two documents over each other, highlighting deleted text in red and inserted text in green. This side-by-side visual diffing guarantees you won't miss a subtly altered clause before signing.`
  },
  {
    slug: "why-are-my-pdf-files-so-large",
    title: "Why Are My PDF Files So Large? 3 Common Causes",
    excerpt: "Diagnose bloated documents. Learn what causes massive file sizes and how to fix them.",
    category: "pdf-tips",
    tags: ["file size", "compress pdf", "optimization"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-25",
    content: `## Diagnosing the bloat

If your 10-page document is somehow 85MB, one of three things went wrong during creation:
1. **Unoptimized Images:** You inserted raw 4K photos instead of web-sized versions.
2. **Embedded Fonts:** The creator software embedded entire font families (including bold, italic, and foreign characters) instead of subsetting just the characters used.
3. **Hidden Layers:** Design files exported from Illustrator or CAD software often retain hidden editing layers.

Running the file through our [Compress PDF](/compress-pdf) tool will automatically resolve all three issues.`
  },
  {
    slug: "best-pdf-tools-for-teachers-educators",
    title: "The Best Free PDF Tools for Teachers and Educators",
    excerpt: "Simplify your classroom workflow. Prepare worksheets, protect answer keys, and organize lesson plans.",
    category: "productivity",
    tags: ["teachers", "education", "workflow"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-26",
    content: `## Managing the digital classroom

Teachers handle massive amounts of digital paper. Using browser-based tools streamlines lesson prep:
- **Worksheet prep:** Use [Split PDF](/split-pdf) to rip a single quiz out of a massive publisher's workbook.
- **Answer keys:** Use [Protect PDF](/protect-pdf) to add passwords to answer keys before uploading them to shared drives.
- **Combining resources:** Stitch articles and prompts together for students using [Merge PDF](/merge-pdf).`
  },
  {
    slug: "how-to-fix-a-corrupted-pdf-file",
    title: "How to Fix a Corrupted or Broken PDF File",
    excerpt: "What to do when Adobe Acrobat says 'This file is damaged and could not be repaired.'",
    category: "pdf-tips",
    tags: ["corrupted pdf", "repair", "troubleshooting"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-27",
    content: `## The source of corruption

PDFs usually break due to interrupted downloads, failing hard drives, or bad email encoding. 

## Attempting a repair

Sometimes, the file structure is just slightly malformed. You can often repair a PDF by forcing a new software engine to rebuild it. Try running the broken file through a tool like [Compress PDF](/compress-pdf) or [PDF to Word](/pdf-to-word). Our internal rendering engine will attempt to ignore the broken syntax and generate a fresh, clean file.`
  },
  {
    slug: "how-to-convert-epub-to-pdf",
    title: "How to Convert ePub Books to PDF",
    excerpt: "Make your digital books readable on any device by converting ePub formats to universal PDFs.",
    category: "tutorials",
    tags: ["epub to pdf", "ebooks", "convert"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-28",
    content: `## The ePub limitation

The \`.epub\` format is standard for e-readers, but it's terrible if you want to print a chapter or annotate a book on a standard PC without dedicated software. 

Converting ePub to PDF locks the reflowable text into fixed pages. This makes it infinitely easier to cite page numbers for academic papers or share a specific diagram with a colleague.`
  },
  {
    slug: "how-to-convert-pdf-to-text",
    title: "How to Convert PDF to Plain Text (.txt)",
    excerpt: "Strip away all formatting, images, and tables to extract pure text from any document.",
    category: "tutorials",
    tags: ["pdf to text", "extract", "plain text"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-29",
    content: `## When you only need the words

Sometimes you don't care about the fonts, the margins, or the header logos. You just want the raw data. 

A PDF to Text converter aggressively strips all visual formatting and outputs a lightweight \`.txt\` file. This is ideal for programmers feeding documents into language models, or data analysts compiling text for sentiment analysis. If the PDF is scanned, remember to use [OCR PDF](/ocr-pdf) first.`
  },
  {
    slug: "how-to-convert-html-webpage-to-pdf",
    title: "How to Convert a Webpage (HTML) to PDF",
    excerpt: "Capture receipts, articles, and web dashboards perfectly without relying on the messy browser print function.",
    category: "tutorials",
    tags: ["html to pdf", "webpage", "convert"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-08-30",
    content: `## The browser print problem

Pressing \`Ctrl+P\` to print a webpage to PDF often results in broken layouts, missing background colors, and awkwardly split images.

Dedicated HTML to PDF conversion tools read the website's CSS exactly as a browser does, but they map it intelligently to paper dimensions. This ensures your digital receipts, news articles, and analytic dashboards look exactly like they do on screen.`
  },
  {
    slug: "how-to-convert-pdf-to-png",
    title: "How to Convert PDF to PNG (For Transparent Backgrounds)",
    excerpt: "Extract vectors and logos from a PDF with absolute pixel clarity and transparency.",
    category: "tutorials",
    tags: ["pdf to png", "images", "design"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-08-31",
    content: `## PNG vs JPG for PDF extraction

If you are extracting a photograph from a PDF, use [PDF to JPG](/pdf-to-jpg). However, if you are converting a text document, a logo, or a line drawing, you should convert it to PNG. 

PNG is a lossless format that supports transparent backgrounds. It prevents the text from looking blurry and ensures the crisp edges of vector shapes remain perfect for graphic design use.`
  },
  {
    slug: "remove-pages-from-pdf-fast",
    title: "How to Quickly Remove Pages from a PDF",
    excerpt: "Delete cover pages, blank pages, and unwanted sections directly in your browser.",
    category: "tutorials",
    tags: ["remove pages", "organize pdf", "delete"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-09-01",
    content: `## Fast document cleanup

If someone sends you a 10-page document but page 2 is completely blank, it looks unprofessional to forward it. 

Load the file into the [Organize PDF](/organize-pdf) module. Hover over the offending page and hit delete. The software automatically re-indexes the document and outputs a clean 9-page file in milliseconds.`
  },
  {
    slug: "how-to-convert-word-to-pdf-on-mac",
    title: "How to Convert Word to PDF on a Mac",
    excerpt: "The fastest, OS-agnostic way to lock your Word documents on Apple devices.",
    category: "productivity",
    tags: ["mac", "word to pdf", "apple"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-09-02",
    content: `## Bypassing native limitations

While Mac's "Preview" app is great, converting complex Microsoft Word formatting on macOS can sometimes yield weird margin shifts if you don't have Office installed.

Using a browser-based [Word to PDF](/word-to-pdf) tool bypasses the operating system entirely. Whether you are on an M2 MacBook, a Windows PC, or a Linux machine, the conversion engine runs identically, guaranteeing exact formatting.`
  },
  {
    slug: "how-to-add-background-color-pdf",
    title: "How to Add a Background Color to a PDF",
    excerpt: "Change the harsh white background of your PDFs for better nighttime reading and brand consistency.",
    category: "pdf-tips",
    tags: ["background", "design", "reading"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-09-03",
    content: `## Eye strain and aesthetics

Reading a glaring white PDF on a monitor at night causes eye strain. Adding a soft sepia or dark gray background instantly improves readability.

You can also use this for branding—adding your company's hex color to a plain text document before sharing it. This can be achieved by utilizing watermarking or background-layering tools directly within advanced PDF editors.`
  },
  {
    slug: "is-it-safe-to-merge-medical-records-online",
    title: "Is it Safe to Merge Medical Records Online?",
    excerpt: "HIPAA, privacy, and the dangers of uploading health data to free PDF websites.",
    category: "security",
    tags: ["medical", "privacy", "merge pdf"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-09-04",
    content: `## Health data is highly targeted

If you are combining medical records or lab results to send to a specialist, you must avoid traditional cloud-based PDF tools. Uploading health data to unverified servers violates basic privacy practices.

Use our local [Merge PDF](/merge-pdf) engine. Because it utilizes WebAssembly, the files are stitched together within your own RAM. They never leave your device, ensuring maximum confidentiality for sensitive medical information.`
  },
  {
    slug: "how-to-make-pdf-read-only",
    title: "How to Make a PDF Read-Only",
    excerpt: "Lock your documents so recipients can view and print, but cannot alter the text.",
    category: "security",
    tags: ["read only", "protect pdf", "permissions"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-09-05",
    content: `## Restricting permissions

When sending out a price list or a policy guide, you want to guarantee nobody can edit the numbers. 

Using our [Protect PDF](/protect-pdf) tool, you can apply a permissions password. This is different from a document-open password. The recipient can open the file normally without typing anything, but the software will gray out all editing, copying, and form-filling capabilities.`
  }
];

export function getPost(slug: string) {
  return POSTS.find((p) => p.slug === slug);
}

export function getAuthor(slug: string) {
  return AUTHORS.find((a) => a.slug === slug);
}

export function getRelatedPosts(post: BlogPost, count = 3) {
  return POSTS.filter((p) => p.slug !== post.slug)
    .sort((a, b) => {
      // Same category first, then by shared tags
      const aScore = (a.category === post.category ? 5 : 0) + a.tags.filter((t) => post.tags.includes(t)).length;
      const bScore = (b.category === post.category ? 5 : 0) + b.tags.filter((t) => post.tags.includes(t)).length;
      return bScore - aScore;
    })
    .slice(0, count);
}

/** Rough reading time in minutes (200 wpm). */
export function readingTime(md: string) {
  const words = md.split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

/** Extract H2 headings for a table of contents. */
export function extractHeadings(md: string) {
  return md
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => {
      const text = l.replace(/^##\s+/, "").trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");
      return { id, text };
    });
}