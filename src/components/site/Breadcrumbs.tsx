import { Link } from "@tanstack/react-router";
import { ChevronRight, Home } from "lucide-react";

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Accessible breadcrumbs. Also emits the corresponding BreadcrumbList JSON-LD
 * via `getBreadcrumbSchema` (used in route head()).
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        <li className="flex items-center">
          <Link to="/" className="inline-flex items-center gap-1 hover:text-foreground">
            <Home className="h-3.5 w-3.5" />
            <span className="sr-only">Home</span>
          </Link>
        </li>
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
            {item.to && i < items.length - 1 ? (
              <a href={item.to} className="hover:text-foreground">{item.label}</a>
            ) : (
              <span className="text-foreground" aria-current={i === items.length - 1 ? "page" : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function getBreadcrumbSchema(items: Crumb[]) {
  const list = [
    { name: "Home", item: "/" },
    ...items.map((c) => ({ name: c.label, item: c.to })),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: list.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.item ? { item: c.item } : {}),
    })),
  };
}
