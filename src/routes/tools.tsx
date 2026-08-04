import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { TOOLS, CATEGORIES } from "@/lib/tools-registry";
import { ArrowRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

const primaryGroups = [
  { label: "PDF Organization", slugs: ["merge", "split", "delete-pages", "extract-pages", "rearrange-pages", "rotate", "scan-to-pdf"] },
  { label: "PDF Optimization", slugs: ["compress", "repair"] },
  { label: "Convert to PDF", slugs: ["jpg-to-pdf", "word-to-pdf", "powerpoint-to-pdf", "excel-to-pdf", "html-to-pdf"] },
  { label: "Convert from PDF", slugs: ["pdf-to-jpg", "pdf-to-word", "pdf-to-powerpoint", "pdf-to-excel", "pdf-to-pdfa"] },
  { label: "PDF Editing", slugs: ["edit", "page-numbers", "watermark", "remove-watermark", "crop"] },
  { label: "PDF Security", slugs: ["protect", "unlock", "sign", "redact"] },
  { label: "OCR", slugs: ["ocr", "ocr-images", "searchable-pdf"] },
  { label: "Utility Tools", slugs: ["compare", "flatten", "extract-images", "remove-images", "extract-text", "metadata"] },
] as const;
const primarySlugs = new Set<string>(primaryGroups.flatMap((group) => group.slugs));

export const Route = createFileRoute("/tools")({
  component: () => <Outlet />,
});

export function ToolsIndex() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [recentSlugs, setRecentSlugs] = useState<string[]>([]);

  useEffect(() => {
    try {
      setRecentSlugs(JSON.parse(localStorage.getItem("lazy-pdf-recent-tools") ?? "[]"));
    } catch {
      setRecentSlugs([]);
    }
  }, []);

  const rememberTool = (slug: string) => {
    const next = [slug, ...recentSlugs.filter((item) => item !== slug)].slice(0, 5);
    setRecentSlugs(next);
    localStorage.setItem("lazy-pdf-recent-tools", JSON.stringify(next));
  };

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (tool: (typeof TOOLS)[number]) =>
    !normalizedQuery || `${tool.name} ${tool.tagline} ${tool.keywords.join(" ")}`.toLowerCase().includes(normalizedQuery);
  const recentTools = recentSlugs.map((slug) => TOOLS.find((tool) => tool.slug === slug)).filter(Boolean) as typeof TOOLS;
  const allTools = TOOLS.filter((tool) => tool.status === "ready");
  const visibleTools = allTools.filter((tool) => {
    const group = primaryGroups.find((item) => item.label === activeCategory);
    return (!group || group.slugs.includes(tool.slug as never)) && matches(tool);
  });

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="mx-auto max-w-4xl text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Lazy PDF toolkit</div>
          <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-6xl">Every tool you need, in one place.</h1>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">Merge, split, convert, edit, protect, and organize PDFs in your browser. Free, private, and ready when you are.</p>
        </section>

        <div className="relative mx-auto mt-8 max-w-2xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for a PDF tool" aria-label="Search PDF tools" className="h-12 rounded-full bg-card pl-11 shadow-sm" />
        </div>

        <div className="mt-8 flex gap-2 overflow-x-auto pb-2 sm:justify-center" role="tablist" aria-label="Tool categories">
          {["All", ...primaryGroups.map((group) => group.label)].map((category) => <button key={category} type="button" role="tab" aria-selected={activeCategory === category} onClick={() => setActiveCategory(category)} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${activeCategory === category ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:border-signal hover:text-foreground"}`}>{category}</button>)}
        </div>

        {!normalizedQuery && recentTools.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-2xl">Recent tools</h2>
            <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
              {recentTools.map((tool) => <Link key={tool.slug} to="/$slug" params={{ slug: tool.seoSlug }} onClick={() => rememberTool(tool.slug)} className="tool-surface min-w-44 p-4 hover:-translate-y-px hover:border-signal"><div className="text-sm font-semibold">{tool.name}</div><div className="mt-1 text-xs text-muted-foreground">{tool.tagline}</div></Link>)}
            </div>
          </section>
        )}

        <section className="mt-10">
          <div className="mb-5 flex items-center justify-between gap-4"><h2 className="font-display text-2xl">{activeCategory === "All" ? "Popular tools" : activeCategory}</h2><span className="text-sm text-muted-foreground">{visibleTools.length} tools</span></div>
          {visibleTools.length ? <ToolGrid items={visibleTools} rememberTool={rememberTool} /> : <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">No tools match that search.</div>}
        </section>

        {activeCategory === "All" && !normalizedQuery && <div className="mt-16 border-t border-border pt-10"><h2 className="font-display text-3xl">More tools</h2>{CATEGORIES.map((category) => { const items = TOOLS.filter((tool) => !primarySlugs.has(tool.slug) && tool.category === category.id); return items.length ? <ToolGroup key={category.id} label={category.label} items={items} rememberTool={rememberTool} /> : null; })}</div>}

      </main>
      <Footer />
    </div>
  );
}

function ToolGroup({ label, items, rememberTool }: { label: string; items: typeof TOOLS; rememberTool: (slug: string) => void }) {
  return <section className="mt-10"><h3 className="font-display text-2xl">{label}</h3><div className="mt-4"><ToolGrid items={items} rememberTool={rememberTool} /></div></section>;
}

function ToolGrid({ items, rememberTool }: { items: typeof TOOLS; rememberTool: (slug: string) => void }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">{items.map((tool) => <Link key={tool.slug} to="/$slug" params={{ slug: tool.seoSlug }} onClick={() => rememberTool(tool.slug)} className="group relative flex min-h-52 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-signal hover:shadow-lg"><div className={`inline-grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${tool.accentClass}`}><tool.icon className="h-5 w-5 text-ink" /></div><div className="mt-5 font-display text-lg leading-tight">{tool.name}</div><p className="mt-2 text-sm leading-5 text-muted-foreground">{tool.tagline}</p><div className="mt-auto pt-4 text-sm font-semibold text-signal">Open tool <ArrowRight className="ml-1 inline h-4 w-4 transition-transform group-hover:translate-x-1" /></div></Link>)}</div>;
}
