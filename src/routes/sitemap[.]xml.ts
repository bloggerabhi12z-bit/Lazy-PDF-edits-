import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { TOOLS } from "@/lib/tools-registry";
import { POSTS } from "@/lib/blog-data";

const BASE_URL = "https://www.lazypdf.in";

interface Entry {
  path: string;
  lastmod?: string;
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const today = new Date().toISOString().slice(0, 10);

        const staticEntries: Entry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0", lastmod: today },
          { path: "/tools", changefreq: "weekly", priority: "0.9", lastmod: today },
          { path: "/blog", changefreq: "weekly", priority: "0.8", lastmod: today },
        ];

        // Each tool at its SEO URL (canonical). Skip /tools/{slug} — canonical
        // there points to /{seoSlug}, so we don't emit duplicate URLs.
        const toolEntries: Entry[] = TOOLS.filter((t) => t.status === "ready").map((t) => ({
          path: `/${t.seoSlug}`,
          changefreq: "monthly",
          priority: "0.8",
          lastmod: today,
        }));

        const blogEntries: Entry[] = POSTS.map((p) => ({
          path: `/blog/${p.slug}`,
          changefreq: "monthly",
          priority: "0.7",
          lastmod: p.updatedAt ?? p.publishedAt,
        }));

        const all = [...staticEntries, ...toolEntries, ...blogEntries];

        const urls = all
          .map((e) =>
            [
              `  <url>`,
              `    <loc>${BASE_URL}${e.path}</loc>`,
              e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
              e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
              e.priority ? `    <priority>${e.priority}</priority>` : null,
              `  </url>`,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n");

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
