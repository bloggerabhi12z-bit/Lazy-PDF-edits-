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
  {
    slug: "how-to-merge-pdf-files",
    title: "How to Merge PDF Files: The Complete 2026 Guide",
    excerpt:
      "Combine PDFs on any device without uploading them to a server. A step-by-step guide with tips, keyboard shortcuts, and privacy notes.",
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

## Tips for a clean merged PDF

- **Compress first if the sources are heavy.** Merging doesn't grow files unnecessarily, but if the sources are already bloated, running [Compress PDF](/compress-pdf) first keeps the output lean.
- **Unlock protected PDFs.** Encrypted PDFs need to be unlocked with the correct password before they can be merged. [Unlock PDF](/unlock-pdf) does it in the browser.
- **Rotate sideways scans.** Photocopied documents are often rotated. Fix them with [Rotate PDF](/rotate-pdf) before merging so the output reads cleanly.
- **Preserve bookmarks.** Modern PDF mergers preserve bookmarks and outlines from source files. Give your final document a clean navigation tree.

## FAQ

**How many PDFs can I merge at once?** As many as your device's memory allows — usually dozens without breaking a sweat.

**Will merging reduce quality?** No. Merging is a lossless operation. Fonts, images, and metadata are preserved.

**Is it really private?** Yes. Lazy PDF runs entirely in your browser. Nothing is uploaded, logged, or stored.

## Try it now

[Open the Merge PDF tool →](/merge-pdf)`,
  },
  {
    slug: "compress-pdf-without-losing-quality",
    title: "How to Compress a PDF Without Losing Quality",
    excerpt:
      "Shrink a PDF for email or upload while keeping text sharp and images crisp. Understand what compression actually does — and what it doesn't.",
    category: "pdf-tips",
    tags: ["compress pdf", "reduce pdf size", "quality"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-05-18",
    content: `## The 25 MB email limit

Gmail caps attachments at 25 MB. Outlook is 20 MB. Most upload forms cap somewhere between 5 and 10 MB. A single high-resolution scan can blow past all of those before you've added anything else.

Compressing a PDF is usually the answer — but compress too aggressively and text turns fuzzy, images pixelate, and small type becomes unreadable. This guide shows you how to compress a PDF *without* wrecking it.

## What actually happens when you compress a PDF

A PDF is a container of objects: text, fonts, images, vector graphics, and metadata. A quality compressor doesn't just "shrink the file"; it makes several targeted decisions:

1. **Re-encode images** using more efficient formats (JPEG 2000, WebP, or higher-compression JPEG) at a chosen quality level.
2. **Downscale oversize images.** A 4000×4000 photo displayed at 500×500 doesn't need 4000×4000 of pixels.
3. **Deduplicate resources.** If the same logo appears on every page, it's stored once and referenced.
4. **Strip metadata** — thumbnails, unused fonts, revision history — that most readers never see.
5. **Recompress streams** using stronger algorithms.

Text and vectors typically stay untouched; the savings mostly come from images and metadata.

## Choosing a compression level

Lazy PDF's [Compress PDF](/compress-pdf) tool offers three preset tiers:

- **Low compression** — visually identical to the source. Best for legal documents and archival copies. Typical savings: 10–30%.
- **Medium compression** — the sweet spot. Images look great on screen and print well. Typical savings: 40–70%.
- **High compression** — best for screen-only sharing and email. Typical savings: 70–90%. Fine detail in photos may soften.

Preview the result before downloading. If you're not happy, bump the tier and re-run — it's free and instant.

## Related reading

- [How to Merge PDF Files](/blog/how-to-merge-pdf-files)
- [The Best Free PDF Editor in 2026](/blog/best-free-pdf-editor)

[Open Compress PDF →](/compress-pdf)`,
  },
  {
    slug: "best-free-pdf-editor",
    title: "The Best Free PDF Editor in 2026 (No Sign-Up, No Watermark)",
    excerpt:
      "Adobe Acrobat is powerful — and expensive. Here's an honest look at the free PDF editors worth using in 2026, ranked on privacy, speed, and features.",
    category: "productivity",
    tags: ["pdf editor", "free", "adobe alternative"],
    authorSlug: "lazy-pdf-team",
    publishedAt: "2026-04-12",
    content: `## Why "free" usually means "we take your files"

Most free PDF editors follow the same playbook: you upload your PDF to their servers, they process it, and you download the result. That's fine for a birthday card. It's not fine for a contract, a medical record, or a financial statement.

Modern browsers now support WebAssembly and file-system-level APIs that let PDF editing run *entirely on your device*. In 2026, there's no reason to hand your documents to a stranger's server just to add a signature.

## What to look for in a free PDF editor

- **In-browser processing.** If it asks you to upload, keep looking.
- **No account required.** If you have to sign up before editing, it's tracking you.
- **No watermarks.** Some free tools stamp their logo across your document. Avoid.
- **Full-featured.** Merge, split, compress, rotate, sign, and convert should all be available.
- **Fast.** No queues, no waiting.

## Our take

We built [Lazy PDF](/tools) because we wanted an editor that ticked every box above. It's free, in-browser, and covers the tasks most people actually need — no accounts, no uploads, no watermarks, ever.

Popular tools:

- [Merge PDF](/merge-pdf)
- [Split PDF](/split-pdf)
- [Compress PDF](/compress-pdf)
- [Edit PDF](/edit-pdf)
- [Sign PDF](/sign-pdf)
- [Convert PDF to Word](/pdf-to-word)

## FAQ

**Is a browser-based PDF editor as capable as Adobe Acrobat?** For 95% of everyday tasks — merging, splitting, compressing, rotating, adding text, signing, converting — yes. For heavy prepress, forensic redaction, or PDF/A archival, dedicated desktop software still has an edge.

**Can I use a browser editor offline?** Yes, once the page has loaded. Everything runs client-side, so a dropped connection doesn't break your work.

[Browse all tools →](/tools)`,
  },
  {
    slug: "protect-pdf-online-security-guide",
    title: "How to Protect a PDF Online: A Practical Security Guide",
    excerpt:
      "Passwords, permissions, and privacy: everything you need to know about protecting a PDF in 2026 — including which tools are safe to trust.",
    category: "security",
    tags: ["protect pdf", "password", "privacy"],
    authorSlug: "maya-ortiz",
    publishedAt: "2026-03-22",
    content: `## Passwords aren't the only layer

When people say "protect this PDF," they usually mean one of three things:

1. **Encrypt it** so that a password is required to open it.
2. **Restrict permissions** — for example, allow viewing but block printing or copying.
3. **Keep it private in transit** — make sure it doesn't leak while being edited or shared.

The first two are features of the PDF format. The third is a choice you make about the tools you use.

## Step 1: Choose a strong password

For anything sensitive, use a 16+ character password mixing letters, numbers, and symbols. A password manager (1Password, Bitwarden) is the easiest way to generate and store one.

## Step 2: Encrypt with a modern cipher

Lazy PDF's [Protect PDF](/protect-pdf) tool uses AES-256 — the standard PDF encryption used by Adobe Acrobat and legally recognized in most jurisdictions. Weaker RC4-40 encryption should be avoided.

## Step 3: Don't upload the file to encrypt it

The whole point of encryption is to keep your document private. Uploading an unencrypted copy to a random online converter defeats the purpose. In-browser tools like Lazy PDF never see your file.

## Step 4: Set permissions if needed

You can require a password to *edit* while leaving *viewing* open. This is handy for signed contracts you want anyone to be able to read but nobody to be able to modify.

## Recovering a forgotten password

If you've forgotten a password to your own PDF, there's no shortcut — modern PDF encryption is genuinely secure. If you have the password, [Unlock PDF](/unlock-pdf) removes it in seconds.

## Try it

[Protect a PDF now →](/protect-pdf)`,
  },
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
