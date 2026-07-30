import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { getToolBySeoSlug, TOOLS } from "@/lib/tools-registry";
import { getToolSeo } from "@/lib/tool-seo";
import { buildToolSchemas } from "@/lib/tool-schemas";
import { getBreadcrumbSchema } from "@/components/site/Breadcrumbs";
import { ToolShell } from "@/components/site/ToolShell";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { renderTool } from "@/lib/render-tool";

export const Route = createFileRoute("/$slug")({
  loader: ({ params }) => {
    const tool = getToolBySeoSlug(params.slug);
    if (!tool) throw notFound();
    return { slug: tool.slug, seoSlug: tool.seoSlug };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Page not found — Lazy PDF" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const tool = getToolBySeoSlug(params.slug);
    if (!tool) return { meta: [{ name: "robots", content: "noindex" }] };
    const seo = getToolSeo(tool);
    const url = `/${tool.seoSlug}`;
    const schemas = buildToolSchemas(tool, seo, url);
    const breadcrumbSchema = getBreadcrumbSchema([
      { label: "PDF Tools", to: "/tools" },
      { label: tool.name, to: url },
    ]);
    return {
      meta: [
        { title: seo.metaTitle },
        { name: "description", content: seo.metaDescription },
        { name: "keywords", content: tool.keywords.join(", ") },
        { property: "og:title", content: seo.metaTitle },
        { property: "og:description", content: seo.metaDescription },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: seo.metaTitle },
        { name: "twitter:description", content: seo.metaDescription },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        { type: "application/ld+json", children: JSON.stringify(schemas.softwareApp) },
        { type: "application/ld+json", children: JSON.stringify(schemas.faqPage) },
        { type: "application/ld+json", children: JSON.stringify(schemas.howTo) },
        { type: "application/ld+json", children: JSON.stringify(breadcrumbSchema) },
      ],
    };
  },
  component: ToolPage,
  notFoundComponent: SeoSlugNotFound,
});

function ToolPage() {
  const { slug } = Route.useLoaderData();
  const tool = TOOLS.find((t) => t.slug === slug);
  if (!tool) return null;
  return <ToolShell tool={tool}>{renderTool(tool.slug)}</ToolShell>;
}

function SeoSlugNotFound() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="font-display text-4xl">Page not found</h1>
        <p className="mt-2 text-muted-foreground">Try one of these popular PDF tools:</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {TOOLS.slice(0, 12).map((t) => (
            <Link
              key={t.slug}
              to="/$slug"
              params={{ slug: t.seoSlug }}
              className="rounded-full border border-border bg-card px-4 py-1.5 text-sm hover:border-signal"
            >
              {t.name}
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
