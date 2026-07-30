import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { TOOLS, CATEGORIES } from "@/lib/tools-registry";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/tools")({
  component: () => <Outlet />,
});

export function ToolsIndex() {
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

        {CATEGORIES.map((cat) => {
          const items = TOOLS.filter((t) => t.category === cat.id);
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
