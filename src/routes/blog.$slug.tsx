import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { marked } from "marked";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { Breadcrumbs, getBreadcrumbSchema } from "@/components/site/Breadcrumbs";
import {
  getPost,
  getAuthor,
  getRelatedPosts,
  readingTime,
  extractHeadings,
  CATEGORIES,
  POSTS,
} from "@/lib/blog-data";
import { Calendar, Clock, ArrowRight } from "lucide-react";

// Auto-slugify H2 headings for anchor links matching extractHeadings()
const renderer = new marked.Renderer();
renderer.heading = ({ tokens, depth }) => {
  const text = tokens.map((t: { raw?: string; text?: string }) => t.raw ?? t.text ?? "").join("");
  if (depth === 2) {
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    return `<h${depth} id="${id}">${text}</h${depth}>`;
  }
  return `<h${depth}>${text}</h${depth}>`;
};
marked.use({ renderer, gfm: true, breaks: false });

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = getPost(params.slug);
    if (!post) throw notFound();
    return { slug: post.slug };
  },
  head: ({ params, loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Post not found" }, { name: "robots", content: "noindex" }] };
    }
    const post = getPost(params.slug);
    if (!post) return { meta: [{ name: "robots", content: "noindex" }] };
    const author = getAuthor(post.authorSlug);
    const canonical = `/blog/${post.slug}`;
    return {
      meta: [
        { title: `${post.title} | Lazy PDF Blog` },
        { name: "description", content: post.excerpt },
        { name: "keywords", content: post.tags.join(", ") },
        { name: "author", content: author?.name ?? "Lazy PDF" },
        { property: "article:published_time", content: post.publishedAt },
        ...(post.updatedAt ? [{ property: "article:modified_time", content: post.updatedAt }] : []),
        { property: "og:title", content: post.title },
        { property: "og:description", content: post.excerpt },
        { property: "og:type", content: "article" },
        { property: "og:url", content: canonical },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: post.title },
        { name: "twitter:description", content: post.excerpt },
      ],
      links: [{ rel: "canonical", href: canonical }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.excerpt,
            datePublished: post.publishedAt,
            dateModified: post.updatedAt ?? post.publishedAt,
            author: author ? { "@type": "Person", name: author.name } : undefined,
            publisher: { "@type": "Organization", name: "Lazy PDF" },
            mainEntityOfPage: canonical,
            keywords: post.tags.join(", "),
          }),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(
            getBreadcrumbSchema([
              { label: "Blog", to: "/blog" },
              { label: post.title, to: canonical },
            ]),
          ),
        },
      ],
    };
  },
  component: BlogPost,
});

function BlogPost() {
  const { slug } = Route.useLoaderData();
  const post = getPost(slug);
  if (!post) return null;
  const author = getAuthor(post.authorSlug);
  const category = CATEGORIES.find((c) => c.slug === post.category);
  const html = marked.parse(post.content, { async: false }) as string;
  const headings = extractHeadings(post.content);
  const related = getRelatedPosts(post);
  const rt = readingTime(post.content);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Breadcrumbs
          items={[
            { label: "Blog", to: "/blog" },
            { label: post.title },
          ]}
        />

        <article className="mt-6">
          <header>
            {category && (
              <div className="text-xs font-semibold uppercase tracking-wider text-signal">
                {category.name}
              </div>
            )}
            <h1 className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl">
              {post.title}
            </h1>
            <p className="mt-3 text-lg text-muted-foreground">{post.excerpt}</p>
            <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {author && <span>By {author.name}</span>}
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(post.publishedAt)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {rt} min read
              </span>
            </div>
          </header>

          {headings.length > 2 && (
            <nav aria-label="Table of contents" className="mt-10 rounded-2xl border border-border bg-muted/20 p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this page</div>
              <ol className="mt-3 space-y-1.5 text-sm">
                {headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="text-foreground hover:text-signal">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <div
            className="prose prose-neutral mt-10 max-w-none prose-headings:font-display prose-headings:tracking-tight prose-h2:mt-12 prose-h2:text-3xl prose-h3:mt-8 prose-h3:text-xl prose-a:text-signal prose-a:no-underline hover:prose-a:underline prose-p:leading-relaxed prose-li:leading-relaxed"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {author && (
            <aside className="mt-16 rounded-2xl border border-border bg-card p-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">About the author</div>
              <div className="mt-2 font-display text-xl">{author.name}</div>
              <div className="text-sm text-muted-foreground">{author.role}</div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{author.bio}</p>
            </aside>
          )}

          {post.tags.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {post.tags.map((t) => (
                <span key={t} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </article>

        {related.length > 0 && (
          <section className="mt-16 border-t border-border pt-12">
            <h2 className="font-display text-2xl tracking-tight">Related articles</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  to="/blog/$slug"
                  params={{ slug: r.slug }}
                  className="group rounded-2xl border border-border bg-card p-5 hover:border-signal"
                >
                  <div className="font-display text-lg leading-snug group-hover:text-signal">{r.title}</div>
                  <p className="mt-2 text-sm text-muted-foreground">{r.excerpt}</p>
                  <div className="mt-3 inline-flex items-center text-xs font-medium text-signal">
                    Read <ArrowRight className="ml-1 h-3 w-3" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Keep POSTS import warning-free even if related lookup returns []
void POSTS;
