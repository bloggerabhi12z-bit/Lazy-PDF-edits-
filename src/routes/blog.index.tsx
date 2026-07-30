import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { Breadcrumbs, getBreadcrumbSchema } from "@/components/site/Breadcrumbs";
import { POSTS, CATEGORIES, getAuthor, readingTime } from "@/lib/blog-data";
import { Calendar, Clock, Tag as TagIcon } from "lucide-react";

export const Route = createFileRoute("/blog/")({
  head: () => {
    const canonical = "/blog";
    return {
      meta: [
        { title: "PDF Blog — Tutorials, Tips & Guides | Lazy PDF" },
        { name: "description", content: "Tutorials, comparison guides, and productivity tips for working with PDFs in 2026. All content by the Lazy PDF team." },
        { property: "og:title", content: "PDF Blog — Lazy PDF" },
        { property: "og:description", content: "Tutorials, comparison guides, and productivity tips for working with PDFs." },
        { property: "og:url", content: canonical },
        { property: "og:type", content: "website" },
      ],
      links: [
        { rel: "canonical", href: canonical },
        { rel: "alternate", type: "application/rss+xml", title: "Lazy PDF Blog RSS", href: "/rss.xml" },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Blog",
            name: "Lazy PDF Blog",
            url: canonical,
            blogPost: POSTS.map((p) => ({
              "@type": "BlogPosting",
              headline: p.title,
              url: `/blog/${p.slug}`,
              datePublished: p.publishedAt,
            })),
          }),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(getBreadcrumbSchema([{ label: "Blog", to: "/blog" }])),
        },
      ],
    };
  },
  component: BlogIndex,
});

function BlogIndex() {
  const sorted = [...POSTS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Breadcrumbs items={[{ label: "Blog" }]} />

        <header className="mt-6">
          <h1 className="font-display text-5xl tracking-tight">The Lazy PDF Blog</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
            Tutorials, comparison guides, and productivity tips for working with PDFs.
          </p>
        </header>

        <div className="mt-8 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <span key={c.slug} className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              {c.name}
            </span>
          ))}
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {sorted.map((post) => {
            const author = getAuthor(post.authorSlug);
            const rt = readingTime(post.content);
            return (
              <Link
                key={post.slug}
                to="/blog/$slug"
                params={{ slug: post.slug }}
                className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-1 hover:border-signal hover:shadow-lg"
              >
                <div className="text-xs font-semibold uppercase tracking-wider text-signal">
                  {CATEGORIES.find((c) => c.slug === post.category)?.name ?? post.category}
                </div>
                <h2 className="mt-2 font-display text-2xl leading-snug group-hover:text-signal">{post.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{post.excerpt}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(post.publishedAt)}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{rt} min read</span>
                  {author && <span>By {author.name}</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {post.tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      <TagIcon className="h-2.5 w-2.5" />
                      {t}
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
