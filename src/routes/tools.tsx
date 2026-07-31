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
const primarySlugs = new Set(primaryGroups.flatMap((group) => group.slugs));

export const Route = createFileRoute("/tools")({
  component: () => <Outlet />,
});

export function ToolsIndex() {
  const [query, setQuery] = useState("");
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

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-xs font-semibold uppercase tracking-widest text-signal">
          Toolkit
        </div>
        <h1 className="mt-2 font-display text-5xl">Every tool, one place.</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {TOOLS.filter((t) => t.status === "ready").length} tools ready today, more shipping soon.
          Everything runs locally in your browser — nothing uploaded.
        </p>

        <div className="relative mt-8 max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search PDF tools" aria-label="Search PDF tools" className="h-12 rounded-xl bg-card pl-10 shadow-sm" />
        </div>

        {!normalizedQuery && recentTools.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-2xl">Recent tools</h2>
            <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
              {recentTools.map((tool) => <Link key={tool.slug} to="/$slug" params={{ slug: tool.seoSlug }} onClick={() => rememberTool(tool.slug)} className="tool-surface min-w-44 p-4 hover:-translate-y-px hover:border-signal"><div className="text-sm font-semibold">{tool.name}</div><div className="mt-1 text-xs text-muted-foreground">{tool.tagline}</div></Link>)}
            </div>
          </section>
        )}

        {primaryGroups.map((group) => {
          const items = group.slugs.map((slug) => TOOLS.find((tool) => tool.slug === slug)).filter((tool) => tool && matches(tool)) as typeof TOOLS;
          if (!items.length) return null;
          return <ToolGroup key={group.label} label={group.label} items={items} rememberTool={rememberTool} />;
        })}

        <div className="mt-16 border-t border-border pt-10">
          <h2 className="font-display text-3xl">More tools</h2>
          {CATEGORIES.map((cat) => {
            const items = TOOLS.filter((tool) => !primarySlugs.has(tool.slug) && tool.category === cat.id && matches(tool));
            if (!items.length) return null;
            return <ToolGroup key={cat.id} label={cat.label} items={items} rememberTool={rememberTool} compact />;
          })}
        </div>

      </main>
      <Footer />
    </div>
  );
}

function ToolGroup({ label, items, rememberTool, compact = false }: { label: string; items: typeof TOOLS; rememberTool: (slug: string) => void; compact?: boolean }) {
  return (
    <section className={compact ? "mt-10" : "mt-12"}>
      <h2 className="font-display text-2xl">{label}</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((tool) => (
          <Link key={tool.slug} to="/$slug" params={{ slug: tool.seoSlug }} onClick={() => rememberTool(tool.slug)} className="group relative rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-1 hover:border-signal hover:shadow-lg">
            <div className={`inline-grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${tool.accentClass}`}><tool.icon className="h-5 w-5 text-ink" /></div>
            <div className="mt-4 font-display text-lg">{tool.name}</div>
            <p className="mt-1 text-sm text-muted-foreground">{tool.tagline}</p>
            <div className="mt-4 inline-flex items-center text-sm font-medium text-signal">Open <ArrowRight className="ml-1 h-4 w-4" /></div>
          </Link>
        ))}
      </div>
    </section>
  );
}
