import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Shield, Zap, HelpCircle } from "lucide-react";
import type { ToolMeta } from "@/lib/tools-registry";
import { getRelatedTools, getPopularTools } from "@/lib/tools-registry";
import type { ToolSeo } from "@/lib/tool-seo";

interface Props {
  tool: ToolMeta;
  seo: ToolSeo;
}

export function ToolSeoContent({ tool, seo }: Props) {
  const related = getRelatedTools(tool);
  const popular = getPopularTools();

  return (
    <div className="mt-16 space-y-16">
      {/* Introduction */}
      <section aria-labelledby="about-heading">
        <h2 id="about-heading" className="font-display text-3xl tracking-tight">
          About {tool.name}
        </h2>
        <div className="mt-4 space-y-4 text-base leading-relaxed text-muted-foreground">
          {seo.intro.split("\n\n").map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section aria-labelledby="benefits-heading">
        <h2 id="benefits-heading" className="font-display text-3xl tracking-tight">
          Why choose {tool.name}
        </h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {seo.benefits.map((b) => (
            <div key={b.title} className="rounded-2xl border border-border bg-card p-5">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal">
                <Shield className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-lg">{b.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="font-display text-3xl tracking-tight">
          Features
        </h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {seo.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-signal" />
              <span className="text-foreground/90">{f}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* How to */}
      <section aria-labelledby="howto-heading">
        <h2 id="howto-heading" className="font-display text-3xl tracking-tight">
          How to {tool.name.toLowerCase()} in {seo.howTo.length} steps
        </h2>
        <ol className="mt-6 space-y-4">
          {seo.howTo.map((step, i) => (
            <li key={step.name} className="flex gap-4 rounded-2xl border border-border bg-card p-5">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-signal text-ink font-bold">
                {i + 1}
              </div>
              <div>
                <h3 className="font-display text-lg">{step.name}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Use cases */}
      <section aria-labelledby="usecases-heading">
        <h2 id="usecases-heading" className="font-display text-3xl tracking-tight">
          Who uses {tool.name}
        </h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          {seo.useCases.map((u) => (
            <div key={u.title} className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-display text-lg">{u.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{u.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tips */}
      <section aria-labelledby="tips-heading">
        <h2 id="tips-heading" className="font-display text-3xl tracking-tight">
          Pro tips
        </h2>
        <ul className="mt-6 space-y-3">
          {seo.tips.map((t) => (
            <li key={t} className="flex items-start gap-2.5 rounded-xl bg-signal-soft/30 p-4 text-sm">
              <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-signal" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Common problems */}
      <section aria-labelledby="problems-heading">
        <h2 id="problems-heading" className="font-display text-3xl tracking-tight">
          Common problems and fixes
        </h2>
        <div className="mt-6 space-y-3">
          {seo.problems.map((p) => (
            <details key={p.problem} className="group rounded-2xl border border-border bg-card p-5 open:shadow-sm">
              <summary className="cursor-pointer list-none font-medium">
                <span className="mr-2 text-signal">▸</span>
                {p.problem}
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.solution}</p>
            </details>
          ))}
        </div>
      </section>

      {/* FAQs */}
      <section aria-labelledby="faq-heading">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-6 w-6 text-signal" />
          <h2 id="faq-heading" className="font-display text-3xl tracking-tight">
            Frequently asked questions
          </h2>
        </div>
        <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card">
          {seo.faqs.map((f) => (
            <details key={f.q} className="group p-5 open:bg-muted/20">
              <summary className="cursor-pointer list-none font-medium leading-snug">
                <span className="mr-2 text-signal">▸</span>
                {f.q}
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Related tools */}
      <section aria-labelledby="related-heading">
        <h2 id="related-heading" className="font-display text-3xl tracking-tight">
          Related PDF tools
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {related.map((r) => (
            <Link
              key={r.slug}
              to="/$slug"
              params={{ slug: r.seoSlug }}
              className="group rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-signal hover:shadow-md"
            >
              <div className={`inline-grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br ${r.accentClass}`}>
                <r.icon className="h-4 w-4 text-ink" />
              </div>
              <div className="mt-3 font-medium">{r.name}</div>
              <p className="mt-1 text-xs text-muted-foreground">{r.tagline}</p>
              <div className="mt-3 inline-flex items-center text-xs font-medium text-signal">
                Open <ArrowRight className="ml-1 h-3 w-3" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Popular tools strip */}
      <section aria-labelledby="popular-heading">
        <h2 id="popular-heading" className="font-display text-2xl tracking-tight">
          Popular on Lazy PDF
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {popular.map((p) => (
            <Link
              key={p.slug}
              to="/$slug"
              params={{ slug: p.seoSlug }}
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm hover:border-signal hover:text-signal"
            >
              {p.name}
            </Link>
          ))}
        </div>
      </section>

      {/* Conclusion + CTA */}
      <section className="rounded-3xl border border-border bg-gradient-to-br from-signal-soft/40 to-transparent p-8 text-center">
        <h2 className="font-display text-3xl tracking-tight">Ready to {tool.name.toLowerCase()}?</h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{seo.conclusion}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href="#top" className="inline-flex items-center rounded-full bg-signal px-5 py-2.5 text-sm font-medium text-ink hover:opacity-90">
            Start using {tool.name}
          </a>
          <Link to="/tools" className="inline-flex items-center rounded-full border border-border bg-card px-5 py-2.5 text-sm hover:border-signal">
            Browse all tools
          </Link>
        </div>
      </section>
    </div>
  );
}
