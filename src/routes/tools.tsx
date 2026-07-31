import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { TOOLS, CATEGORIES } from "@/lib/tools-registry";
import { ArrowRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

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

        {CATEGORIES.map((cat) => {
          const items = TOOLS.filter((t) => t.category === cat.id && matches(t));
          if (!items.length) return null;
          return (
            <section key={cat.id} className="mt-14">
              <h2 className="font-display text-2xl">{cat.label}</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((tool) => (
                  <Link
                    key={tool.slug}
                    to="/$slug"
                    params={{ slug: tool.seoSlug }}
                    onClick={() => rememberTool(tool.slug)}
                    className="group relative rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-1 hover:border-signal hover:shadow-lg"
                  >
                    {tool.status === "soon" && (
                      <span className="absolute right-3 top-3 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Soon
                      </span>
                    )}
                    <div className={`inline-grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${tool.accentClass}`}>
                      <tool.icon className="h-5 w-5 text-ink" />
                    </div>
                    <div className="mt-4 font-display text-lg">{tool.name}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{tool.tagline}</p>
                    <div className="mt-4 inline-flex items-center text-sm font-medium text-signal">
                      Open <ArrowRight className="ml-1 h-4 w-4" />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

      </main>
      <Footer />
    </div>
  );
}
