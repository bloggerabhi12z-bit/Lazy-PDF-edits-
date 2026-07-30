import type { ToolMeta } from "./tools-registry";

export interface HowToStep {
  name: string;
  text: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface ToolSeo {
  h1: string;
  metaTitle: string;
  metaDescription: string;
  intro: string; // 2-3 paragraphs
  benefits: { title: string; body: string }[];
  features: string[];
  howTo: HowToStep[];
  useCases: { title: string; body: string }[];
  tips: string[];
  problems: { problem: string; solution: string }[];
  faqs: FaqItem[];
  conclusion: string;
}

const P = "Lazy PDF";

/**
 * Build SEO content for a tool. Each tool gets templated but distinct copy,
 * with per-slug overrides for the highest-value tools.
 */
export function getToolSeo(tool: ToolMeta): ToolSeo {
  const base = defaultSeo(tool);
  const override = OVERRIDES[tool.slug];
  return override ? { ...base, ...override(base, tool) } : base;
}

function defaultSeo(tool: ToolMeta): ToolSeo {
  const kw = tool.keywords[0] ?? tool.name.toLowerCase();
  const primary = tool.name;

  return {
    h1: `${primary} — Free Online ${primary} Tool`,
    metaTitle: `${primary} Online Free — Fast, Private, In-Browser | ${P}`,
    metaDescription: `${primary} online free. ${tool.description} No sign-up, no upload — every file stays on your device.`,

    intro:
      `Need to ${lower(primary)} without installing software or uploading sensitive files to a stranger's server? ${P} is a free, in-browser ${primary.toLowerCase()} tool built for speed and privacy. Every page you drop is processed locally on your device — nothing is sent to a backend, nothing is stored, and the moment you close the tab your files are gone.\n\n` +
      `Unlike traditional desktop apps, ${P} runs instantly in your browser and works on any operating system — Windows, macOS, Linux, ChromeOS, iPad, and even most phones. Whether you're preparing a contract, cleaning up a scanned report, or just trying to ${lower(kw)} for a quick share, this tool gives you a polished, professional result in seconds.`,

    benefits: [
      { title: "100% private", body: `Your PDFs never leave your device. ${P} uses WebAssembly and modern browser APIs to run every operation locally, so confidential contracts, medical records, and financial statements stay yours.` },
      { title: "No installation", body: `Skip the 400 MB desktop suite. Open ${P} in any modern browser and start working in seconds — nothing to download, nothing to update, nothing to license.` },
      { title: "Free forever", body: `No paywalls, no page limits, no watermarks. ${P} is free for personal and professional use.` },
      { title: "Works on any device", body: `Chrome, Safari, Firefox, Edge on desktop, laptop, tablet, or phone — the same clean interface, the same fast results.` },
      { title: "Blazing fast", body: `Because processing happens on your device, there's no upload wait, no download wait, and no server queue. Small PDFs finish in milliseconds; large ones in seconds.` },
      { title: "No sign-up required", body: `No accounts, no email captures, no “verify your identity” hoops. Just open the tool and go.` },
    ],

    features: [
      `Drag-and-drop upload with instant preview`,
      `Full-document preview before and after processing`,
      `Batch-friendly workflow`,
      `Undo, redo, and reset for every change`,
      `Keyboard shortcuts for power users`,
      `Handles password-protected PDFs (when you have the password)`,
      `Preserves original fonts, layout, and quality`,
      `Works offline once loaded`,
      `Accessible interface with screen-reader labels`,
      `Automatic light and dark themes`,
    ],

    howTo: [
      { name: `Open the ${primary} tool`, text: `Head to ${P} and click ${primary}. The tool loads instantly in your browser — nothing to install.` },
      { name: "Upload your PDF", text: `Drag your PDF into the upload zone, or click to browse. Files stay on your device — nothing is uploaded to a server.` },
      { name: `Configure your ${primary.toLowerCase()} settings`, text: `Use the editor to make the changes you want. A live preview shows exactly how the output will look before you export.` },
      { name: "Apply changes", text: `Hit the Apply button. ${P} processes the file locally in a fraction of a second for most documents.` },
      { name: "Preview the result", text: `Review the final PDF right inside the browser. If something looks off, tweak your settings and re-run — no re-upload needed.` },
      { name: "Download your file", text: `Click Download to save the finished PDF. That's it — no forms, no emails, no waiting.` },
    ],

    useCases: [
      { title: "Business and legal", body: `Prepare contracts, NDAs, and proposals for clients without exposing them to a third-party server.` },
      { title: "Students and educators", body: `Assemble study packs, hand in assignments, or share lecture notes in a single tidy file.` },
      { title: "Freelancers and consultants", body: `Send invoices, portfolios, and reports that look professional across every device.` },
      { title: "Healthcare and finance", body: `Handle sensitive records under strict privacy requirements — files never leave the device.` },
      { title: "Everyday personal use", body: `Combine tickets, receipts, warranties, and scanned documents into organized PDFs.` },
    ],

    tips: [
      `For the smallest possible file, run ${primary} on the source PDF before adding images or watermarks.`,
      `If a PDF is password-protected, unlock it first with our Unlock PDF tool.`,
      `Rotating scanned pages before OCR dramatically improves recognition accuracy.`,
      `Use keyboard shortcuts (Ctrl/⌘+Z, Ctrl/⌘+A) for faster editing on long documents.`,
      `Preview every change before downloading — it's free and instant, so iterate freely.`,
    ],

    problems: [
      { problem: "The PDF won't load.", solution: `Confirm the file has a .pdf extension and isn't corrupted. If it opens in another viewer, try re-saving it and dropping the fresh copy here.` },
      { problem: "The tool says the PDF is password-protected.", solution: `Encrypted PDFs need the password before they can be edited. Use our free Unlock PDF tool, then bring the unlocked copy back.` },
      { problem: "My browser feels slow with a huge file.", solution: `Very large PDFs (hundreds of MB) can hit browser memory limits. Split the file first, run the operation on each part, then merge the results.` },
      { problem: "Fonts look different after export.", solution: `Some PDFs reference fonts that aren't embedded. Ask the original author to embed fonts, or convert to images before exporting.` },
    ],

    faqs: buildFaqs(tool),

    conclusion:
      `${P}'s ${primary} tool gives you a fast, private, and free way to ${lower(kw)} without giving up control of your files. Everything happens in your browser — no accounts, no uploads, no watermarks. Try it now, then explore the rest of our PDF toolkit for merging, splitting, converting, and securing documents.`,
  };
}

function buildFaqs(tool: ToolMeta): FaqItem[] {
  const name = tool.name;
  const nameLower = name.toLowerCase();

  const generic: FaqItem[] = [
    { q: `Is ${P}'s ${name} tool free?`, a: `Yes. Every tool on ${P} is free with no page limits, no watermarks, and no sign-up.` },
    { q: `Do I need to create an account?`, a: `No. ${name} works instantly — no email, no password, no account setup.` },
    { q: `Are my files uploaded to a server?`, a: `No. ${P} runs entirely in your browser using WebAssembly and JavaScript. Your PDFs never leave your device.` },
    { q: `Is ${name} safe for confidential documents?`, a: `Yes. Because nothing is uploaded, ${name} is safe for contracts, medical records, and other sensitive files.` },
    { q: `Which browsers are supported?`, a: `${name} works on the latest Chrome, Edge, Firefox, Safari, Brave, Opera, and other Chromium-based browsers on desktop and mobile.` },
    { q: `Does ${name} work on mobile?`, a: `Yes. The interface adapts to phones and tablets. Very large PDFs may be slower on older mobile devices due to memory limits.` },
    { q: `Is there a file size limit?`, a: `There's no hard cap — the practical limit is your device's memory. Modern laptops handle multi-hundred-MB PDFs comfortably.` },
    { q: `Will ${name} change my PDF's quality?`, a: `${name} preserves the source document's quality. Compression tools are the only ones that intentionally reduce file size, and even then quality is configurable.` },
    { q: `Does ${name} work offline?`, a: `Yes, once the page has loaded. The tool is a fully client-side application, so a dropped connection doesn't interrupt your work.` },
    { q: `Can I ${nameLower} multiple PDFs at once?`, a: `Yes — batch several files through the tool one after another, or use our Merge tool to combine outputs into a single PDF.` },
    { q: `Does ${P} store or log my files?`, a: `No. There is no server-side processing, so there is nothing to log or store. Closing the browser tab discards everything.` },
    { q: `Can I use ${name} for commercial work?`, a: `Yes. The tool is free for personal and commercial use, including client-facing agencies and enterprise teams.` },
    { q: `What happens to my PDF when I close the tab?`, a: `It's gone. ${P} keeps no copies, has no cache on our end, and stores nothing in the cloud.` },
    { q: `Do you add a watermark to the output?`, a: `Never. Files you export are pixel-perfect copies of what you preview — no ${P} branding is added.` },
    { q: `How is this different from Adobe Acrobat?`, a: `Adobe Acrobat is a paid desktop suite. ${P} is free, browser-based, and focused on the specific PDF tasks people actually need — with the same privacy guarantee you'd expect from a local app.` },
  ];

  return generic;
}

function lower(s: string) {
  return s.toLowerCase();
}

/* ---------- Per-tool overrides for the highest-value tools ---------- */

type OverrideFn = (base: ToolSeo, tool: ToolMeta) => Partial<ToolSeo>;

const OVERRIDES: Record<string, OverrideFn> = {
  merge: (base) => ({
    h1: "Merge PDF Files Online — Free PDF Merger",
    metaTitle: "Merge PDF Online Free — Combine PDFs In-Browser | Lazy PDF",
    metaDescription:
      "Merge PDF files online for free. Combine multiple PDFs into one document in seconds — no upload, no watermark, no sign-up required.",
    intro:
      `Merging PDFs used to mean expensive desktop software or handing your documents to a random online converter. ${P}'s free PDF merger does neither. Drop as many PDFs as you want, drag them into the order you need, and export a single combined file — all in your browser, in seconds.\n\n` +
      `Because every operation happens locally, sensitive contracts, medical records, and financial statements stay on your device. No account. No upload. No trace. Just a clean, fast way to combine PDF files that works on any modern browser.`,
    faqs: [
      { q: "How do I merge PDF files for free?", a: `Open ${P}'s Merge PDF tool, drop your PDFs into the upload zone, drag them into the desired order, and click Merge. The combined PDF downloads instantly.` },
      { q: "Is there a limit to how many PDFs I can merge?", a: "No hard limit. You're only bounded by your device's memory — most laptops handle 50+ PDFs comfortably." },
      { q: "Can I merge password-protected PDFs?", a: "Encrypted PDFs need to be unlocked first. Use our Unlock PDF tool with the correct password, then merge the unlocked copies." },
      { q: "Will merging reduce PDF quality?", a: "No. Merging is a lossless operation — the pages, fonts, images, and metadata of each source PDF are preserved exactly." },
      { q: "Can I rearrange pages while merging?", a: "Yes. Drag files (and individual pages) into any order before clicking Merge. Preview updates live." },
      { q: "Does the merged PDF include bookmarks?", a: "Yes. Bookmarks and outlines from source PDFs are preserved in the merged document where possible." },
      ...base.faqs.slice(0, 10),
    ],
  }),
  compress: (base) => ({
    h1: "Compress PDF — Reduce PDF File Size Online Free",
    metaTitle: "Compress PDF Online Free — Reduce PDF Size In-Browser | Lazy PDF",
    metaDescription:
      "Compress PDF files online for free. Shrink large PDFs for email, upload, or storage while preserving quality. No sign-up, no upload — everything runs locally.",
    intro:
      `Email won't accept your PDF? Upload form rejects it? You're not alone. Most PDFs exported from Word, Google Docs, or design tools contain uncompressed images and metadata that balloon file size unnecessarily. ${P}'s free PDF compressor strips that overhead in your browser — no uploads, no waiting, no watermark.\n\n` +
      `Choose your quality tier, preview the result, and download a leaner copy that fits under email limits and loads faster over slow connections. It's the fastest way to reduce PDF size without a subscription.`,
    faqs: [
      { q: "How much can I compress a PDF?", a: "It depends on the source. Image-heavy PDFs can drop 60–90%. Text-only PDFs typically shrink 10–30%." },
      { q: "Will compression reduce PDF quality?", a: "You choose. Our compressor offers low, medium, and high compression tiers. Preview the output before downloading." },
      { q: "Can I email a 100MB PDF after compressing?", a: "Usually yes. Gmail's 25MB cap and Outlook's 20MB cap fit most compressed PDFs, especially image-heavy ones." },
      { q: "Does compression remove any content?", a: "No. Text, images, links, and form fields are preserved. Only redundant metadata and image encoding are optimized." },
      { q: "Is it safe to compress confidential PDFs?", a: "Yes. Compression happens entirely in your browser — the file never leaves your device." },
      ...base.faqs.slice(0, 10),
    ],
  }),
  split: (base) => ({
    h1: "Split PDF — Extract Pages from PDF Online Free",
    metaTitle: "Split PDF Online Free — Extract PDF Pages In-Browser | Lazy PDF",
    metaDescription:
      "Split PDF files online for free. Extract a page range or split into individual pages — instantly, in your browser. No upload, no watermark.",
    faqs: base.faqs,
  }),
  "pdf-to-word": (base) => ({
    h1: "Convert PDF to Word — Free PDF to DOCX Converter",
    metaTitle: "PDF to Word Online Free — Convert PDF to DOCX | Lazy PDF",
    metaDescription:
      "Convert PDF to Word online free. Turn PDF text into an editable .docx file in your browser — no upload, no sign-up, no watermark.",
    faqs: base.faqs,
  }),
  "word-to-pdf": (base) => ({
    h1: "Word to PDF — Convert DOCX to PDF Online Free",
    metaTitle: "Word to PDF Online Free — Convert DOCX to PDF | Lazy PDF",
    metaDescription:
      "Convert Word to PDF online free. Turn any .docx file into a shareable PDF in your browser — no upload, no watermark, no sign-up.",
    faqs: base.faqs,
  }),
};
