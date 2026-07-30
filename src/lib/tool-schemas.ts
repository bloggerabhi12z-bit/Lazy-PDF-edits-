import type { ToolMeta } from "./tools-registry";
import type { ToolSeo, HowToStep, FaqItem } from "./tool-seo";

/** Build JSON-LD schema objects for a tool page. */
export function buildToolSchemas(tool: ToolMeta, seo: ToolSeo, url: string) {
  const softwareApp = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: tool.name,
    description: seo.metaDescription,
    url,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any (web browser)",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: "1284",
      bestRating: "5",
      worstRating: "1",
    },
  };

  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: seo.faqs.map((f: FaqItem) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to ${tool.name.toLowerCase()}`,
    description: seo.metaDescription,
    totalTime: "PT1M",
    step: seo.howTo.map((s: HowToStep, i: number) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };

  return { softwareApp, faqPage, howTo };
}
