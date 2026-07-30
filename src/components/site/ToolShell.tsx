import { useEffect, type ReactNode } from "react";
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
      <main id="top" className="mx-auto max-w-5xl px-6 py-10">
        <Breadcrumbs items={[{ label: "PDF Tools", to: "/tools" }, { label: tool.name }]} />

        <header className="mt-6 flex items-start gap-4">
          <div
            className={`grid h-14 w-14 flex-shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${tool.accentClass}`}
          >
            <tool.icon className="h-6 w-6 text-ink" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-4xl tracking-tight sm:text-5xl">{seo.h1}</h1>
            <p className="mt-2 text-lg text-muted-foreground">{tool.description}</p>
          </div>
        </header>

        <div className="mt-10">{children}</div>

        <ResultPreview />

        <ToolSeoContent tool={tool} seo={seo} />
      </main>
      <Footer />
    </div>
  );
}
