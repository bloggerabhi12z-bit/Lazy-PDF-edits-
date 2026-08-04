import { Link } from "@tanstack/react-router";

const toolGroups = [
  { title: "Organize", links: [{ label: "Merge PDF", href: "/merge-pdf" }, { label: "Split PDF", href: "/split-pdf" }, { label: "Extract pages", href: "/extract-pages" }, { label: "Rotate PDF", href: "/rotate-pdf" }] },
  { title: "Optimize", links: [{ label: "Compress PDF", href: "/compress-pdf" }, { label: "Repair PDF", href: "/repair-pdf" }, { label: "Flatten PDF", href: "/flatten-pdf" }] },
  { title: "Edit", links: [{ label: "Edit PDF", href: "/edit-pdf" }, { label: "Add watermark", href: "/watermark-pdf" }, { label: "Page numbers", href: "/add-page-numbers" }] },
  { title: "Security", links: [{ label: "Protect PDF", href: "/protect-pdf" }, { label: "Unlock PDF", href: "/unlock-pdf" }, { label: "Sign PDF", href: "/sign-pdf" }] },
  { title: "Convert to", links: [{ label: "JPG to PDF", href: "/jpg-to-pdf" }, { label: "Word to PDF", href: "/word-to-pdf" }, { label: "HTML to PDF", href: "/html-to-pdf" }] },
  { title: "Convert from", links: [{ label: "PDF to JPG", href: "/pdf-to-jpg" }, { label: "PDF to Word", href: "/pdf-to-word" }, { label: "PDF to Excel", href: "/pdf-to-excel" }] },
];

const companyLinks = [{ label: "About us", to: "/about" }, { label: "Contact us", to: "/contact" }, { label: "Blog", to: "/blog" }, { label: "Press", to: "/press" }];
const legalLinks = [{ label: "Security", to: "/security" }, { label: "Privacy policy", to: "/privacy-policy" }, { label: "Terms", to: "/terms-and-conditions" }, { label: "Cookies", to: "/cookies" }];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-secondary/35">
      <div className="mx-auto max-w-7xl px-6 py-10 sm:py-12">
        <Link to="/" className="inline-flex items-center gap-3" aria-label="Lazy PDF home">
          <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl border border-signal/25 bg-signal-soft p-0.5 shadow-sm dark:border-white/20 dark:bg-white">
            <img src="/lazy-pdf-favicon.svg" alt="" className="h-full w-full object-cover" />
          </span>
          <span className="font-display text-2xl font-semibold tracking-tight text-foreground">Lazy <span className="text-signal">PDF</span></span>
        </Link>

        <section className="mt-9" aria-labelledby="footer-tools-title">
          <h2 id="footer-tools-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">All tools</h2>
          <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
            {toolGroups.map((group) => <ToolGroup key={group.title} {...group} />)}
          </div>
        </section>

        <div className="mt-10 grid gap-8 border-t border-border pt-7 md:grid-cols-2">
          <FooterLinks title="Company" links={companyLinks} />
          <FooterLinks title="Legal" links={legalLinks} />
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Lazy PDF. Crafted with care.</span>
          <span>Simple tools, done right.</span>
        </div>
      </div>
    </footer>
  );
}

function ToolGroup({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return <div><h3 className="text-sm font-semibold text-foreground">{title}</h3><ul className="mt-3 space-y-2 text-sm">{links.map((link) => <li key={link.href}><a href={link.href} className="text-muted-foreground transition hover:text-signal hover:underline">{link.label}</a></li>)}</ul></div>;
}

function FooterLinks({ title, links }: { title: string; links: { label: string; to: string }[] }) {
  return <div><h2 className="text-sm font-semibold text-foreground">{title}</h2><ul className="mt-4 flex flex-wrap gap-x-7 gap-y-3 text-sm">{links.map((link) => <li key={link.to}><Link to={link.to} className="text-muted-foreground transition hover:text-signal hover:underline">{link.label}</Link></li>)}</ul></div>;
}
