import { Link } from "@tanstack/react-router";
import { TOOLS, CATEGORIES, getPopularTools } from "@/lib/tools-registry";
import { POSTS } from "@/lib/blog-data";

export function Footer() {
  const popular = getPopularTools();
  const latestPosts = [...POSTS]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 4);
  const cols = CATEGORIES.map((c) => ({
    label: c.label,
    tools: TOOLS.filter((t) => t.category === c.id),
  }));

  return (
    <footer className="mt-24 border-t border-border/60 bg-background/50">
      <div className="mx-auto max-w-7xl px-6 py-14">
        {/* Top: brand + quick nav */}
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-1">
            <div className="font-display text-lg font-semibold">Lazy PDF</div>
            <p className="mt-2 text-sm text-muted-foreground">
              A calmer way to work with PDFs. Everything runs in your browser — nothing uploaded.
            </p>
            <div className="mt-4 text-xs text-muted-foreground">
              🔒 100% private, in-browser processing
            </div>
          </div>

          <FooterCol title="Popular tools">
            {popular.map((t) => (
              <FooterLink key={t.slug} to="/$slug" params={{ slug: t.seoSlug }}>
                {t.name}
              </FooterLink>
            ))}
          </FooterCol>

          <FooterCol title="Latest from the blog">
            {latestPosts.map((p) => (
              <FooterLink key={p.slug} to="/blog/$slug" params={{ slug: p.slug }}>
                {p.title}
              </FooterLink>
            ))}
            <li className="pt-1">
              <Link to="/blog" className="text-signal hover:underline">
                All articles →
              </Link>
            </li>
          </FooterCol>

          <FooterCol title="Company">
            <FooterLink to="/tools">All tools</FooterLink>
            <FooterLink to="/blog">Blog</FooterLink>
            <li>
              <a href="/#how" className="hover:text-signal">
                How it works
              </a>
            </li>
            <li>
              <a href="/#faq" className="hover:text-signal">
                FAQ
              </a>
            </li>
            <li>
              <a href="/sitemap.xml" className="hover:text-signal">
                Sitemap
              </a>
            </li>
            <li>
              <a href="/rss.xml" className="hover:text-signal">
                RSS feed
              </a>
            </li>
          </FooterCol>
        </div>

        {/* Category directory */}
        <div className="mt-14 border-t border-border/60 pt-10">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            All PDF tools
          </div>
          <div className="mt-6 grid gap-8 md:grid-cols-3 lg:grid-cols-6">
            {cols.map((col) => (
              <div key={col.label}>
                <div className="text-sm font-semibold text-foreground">{col.label}</div>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {col.tools.map((t) => (
                    <li key={t.slug}>
                      <Link
                        to="/$slug"
                        params={{ slug: t.seoSlug }}
                        className="text-muted-foreground hover:text-signal"
                      >
                        {t.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Lazy PDF. Crafted with care.
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ul className="mt-3 space-y-2 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({
  to,
  params,
  children,
}: {
  to: string;
  params?: Record<string, string>;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic footer link wrapper; TanStack Router's typed `to` union doesn't accept a plain string here
        to={to as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
        params={params as any}
        className="text-muted-foreground hover:text-signal"
      >
        {children}
      </Link>
    </li>
  );
}