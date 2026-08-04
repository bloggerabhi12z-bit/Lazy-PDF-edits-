import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/site/ContentPage";
import { PRESS } from "@/lib/company-page-content";

export const Route = createFileRoute("/press")({
  head: () => ({ meta: [{ title: "Press | Lazy PDF" }, { name: "description", content: "Press kit and media contact information for Lazy PDF." }], links: [{ rel: "canonical", href: "/press" }] }),
  component: () => <ContentPage title="Press" content={PRESS} />,
});
