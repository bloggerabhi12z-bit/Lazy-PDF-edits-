import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/site/ContentPage";
import { COOKIES } from "@/lib/company-page-content";

export const Route = createFileRoute("/cookies")({
  head: () => ({ meta: [{ title: "Cookies Policy | Lazy PDF" }, { name: "description", content: "How Lazy PDF uses cookies and similar technologies." }], links: [{ rel: "canonical", href: "/cookies" }] }),
  component: () => <ContentPage title="Cookies Policy" content={COOKIES} />,
});
