import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/site/ContentPage";
import { ABOUT_US } from "@/lib/company-page-content";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "About Us | Lazy PDF" }, { name: "description", content: "Why we built Lazy PDF and what we believe about privacy." }], links: [{ rel: "canonical", href: "/about" }] }),
  component: () => <ContentPage title="About Us" content={ABOUT_US} />,
});
