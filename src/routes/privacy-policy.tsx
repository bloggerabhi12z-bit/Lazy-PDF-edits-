import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/site/ContentPage";
import { PRIVACY_POLICY } from "@/lib/company-page-content";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({ meta: [{ title: "Privacy Policy | Lazy PDF" }, { name: "description", content: "How Lazy PDF collects, uses, and protects your information." }], links: [{ rel: "canonical", href: "/privacy-policy" }] }),
  component: () => <ContentPage title="Privacy Policy" content={PRIVACY_POLICY} />,
});
