import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { ResultPreview } from "@/components/site/ResultPreview";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { ToolSeoContent } from "@/components/site/ToolSeoContent";
import type { ToolMeta } from "@/lib/tools-registry";
import { getToolSeo } from "@/lib/tool-seo";
import { publishResult } from "@/lib/result-store";

export function ToolShell({
  tool,
  children,
}: {
  tool: ToolMeta;
  children: ReactNode;
}) {
  // Clear any lingering result when switching tools
  useEffect(() => {
    publishResult(null);
    return () => publishResult(null);
  }, [tool.slug]);

  const seo = getToolSeo(tool);

  return (
    <div className="min-h-screen">
      <Header />
      <main id="top" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Breadcrumbs items={[{ label: "PDF Tools", to: "/tools" }, { label: tool.name }]} />

        <header className="mt-6 flex items-start gap-4 border-b border-border pb-7">
          <div
            className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl bg-signal-soft text-signal"
          >
            <tool.icon className="h-6 w-6 text-ink" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-3xl tracking-tight sm:text-4xl">{seo.h1}</h1>
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">{tool.description}</p>
          </div>
        </header>

        <ToolTabs activeSlug={tool.slug} />

        <div className="mt-10">{children}</div>

        <ResultPreview />

        <ToolSeoContent tool={tool} seo={seo} />
      </main>
      <Footer />
    </div>
  );
}

const toolTabs = [
  ["merge", "Merge"],
  ["split", "Split"],
  ["compress", "Compress"],
  ["edit", "Edit"],
  ["rotate", "Rotate"],
  ["unlock", "Unlock"],
  ["protect", "Protect"],
] as const;

function ToolTabs({ activeSlug }: { activeSlug: string }) {
  return (
    <nav className="mt-6 border-b border-border" aria-label="PDF tool navigation">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {toolTabs.map(([slug, label]) => (
          <Link key={slug} to="/tools/$slug" params={{ slug }} className={`shrink-0 rounded-t-lg border-b-2 px-3.5 py-3 text-sm font-medium transition-colors ${slug === activeSlug ? "border-signal text-signal" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"}`}>
            {label}
          </Link>
        ))}
        <Link to="/tools" className="ml-auto shrink-0 rounded-t-lg border-b-2 border-transparent px-3.5 py-3 text-sm font-medium text-muted-foreground hover:border-border hover:text-foreground">
          More tools
        </Link>
      </div>
    </nav>
  );
}
