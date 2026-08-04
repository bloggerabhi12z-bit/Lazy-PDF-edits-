import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/site/ContentPage";
import { TERMS } from "@/lib/company-page-content";

export const Route = createFileRoute("/terms-and-conditions")({
  head: () => ({ meta: [{ title: "Terms & Conditions | Lazy PDF" }, { name: "description", content: "The terms that govern your use of Lazy PDF." }], links: [{ rel: "canonical", href: "/terms-and-conditions" }] }),
  component: () => <ContentPage title="Terms & Conditions" content={TERMS} />,
});
