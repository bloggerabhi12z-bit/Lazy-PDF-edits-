import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { getTool, TOOLS } from "@/lib/tools-registry";
import { ToolShell } from "@/components/site/ToolShell";
import { renderTool } from "@/lib/render-tool";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";

export const Route = createFileRoute("/tools/$slug")({
  loader: ({ params }) => {
    const tool = getTool(params.slug);
    if (!tool) throw notFound();
    return { slug: tool.slug, seoSlug: tool.seoSlug, name: tool.name };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Tool not found — Lazy PDF" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    // Canonical points to the SEO URL to consolidate ranking signal.
    const canonical = `/${loaderData.seoSlug}`;
    return {
      meta: [
        { title: `${loaderData.name} — Lazy PDF` },
        { property: "og:url", content: canonical },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: ToolPage,
  notFoundComponent: ToolNotFound,
});

function ToolPage() {
  const { slug } = Route.useParams();
  const tool = getTool(slug);
  if (!tool) return null;
  return <ToolShell tool={tool}>{renderTool(slug)}</ToolShell>;
}

function ToolNotFound() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="font-display text-4xl">Tool not found</h1>
        <p className="mt-2 text-muted-foreground">That tool isn't part of Lazy PDF. Here's what we offer:</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {TOOLS.map((t) => (
            <Link key={t.slug} to="/$slug" params={{ slug: t.seoSlug }} className="rounded-full border border-border bg-card px-4 py-1.5 text-sm hover:border-signal">
              {t.name}
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
