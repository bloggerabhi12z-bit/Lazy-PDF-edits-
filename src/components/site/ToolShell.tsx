import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
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
  {
    label: "Organize",
    tools: [
      ["merge", "Merge PDF"],
      ["split", "Split PDF"],
      ["extract-pages", "Extract pages"],
      ["delete-pages", "Delete pages"],
      ["rearrange-pages", "Rearrange"],
    ],
  },
  {
    label: "Edit",
    tools: [
      ["edit", "Edit PDF"],
      ["watermark", "Watermark"],
      ["page-numbers", "Page numbers"],
      ["redact", "Redact"],
    ],
  },
  {
    label: "Convert",
    tools: [
      ["pdf-to-word", "PDF to Word"],
      ["pdf-to-excel", "PDF to Excel"],
      ["pdf-to-powerpoint", "PDF to PowerPoint"],
      ["pdf-to-jpg", "PDF to JPG"],
    ],
  },
  {
    label: "Secure",
    tools: [
      ["protect", "Protect PDF"],
      ["unlock", "Unlock PDF"],
      ["sign", "Sign PDF"],
    ],
  },
] as const;

function ToolTabs({ activeSlug }: { activeSlug: string }) {
  const activeGroup = toolTabs.find((group) => group.tools.some(([slug]) => slug === activeSlug)) ?? toolTabs[0];
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  return (
    <nav className="mt-6 border-b border-border" aria-label="PDF tool navigation">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {toolTabs.map((group) => {
          const active = group === activeGroup;
          const open = openGroup === group.label;
          return (
            <div key={group.label} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setOpenGroup(open ? null : group.label)}
                aria-expanded={open}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-signal-soft text-signal" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
                aria-label={`Show ${group.label} tools`}
              >
                {group.label}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {open && <div className="absolute left-0 top-full z-30 mt-2 min-w-48 rounded-xl border border-border bg-card p-1.5 shadow-xl">
                {group.tools.map(([slug, label]) => (
                  <Link
                    key={slug}
                    to="/tools/$slug"
                    onClick={() => setOpenGroup(null)}
                    params={{ slug }}
                    className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                      slug === activeSlug ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </div>}
            </div>
          );
        })}
        <Link to="/tools" className="ml-auto shrink-0 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
          All tools
        </Link>
      </div>
    </nav>
  );
}
