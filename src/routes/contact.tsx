import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/site/ContentPage";
import { CONTACT_US } from "@/lib/company-page-content";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "Contact Us | Lazy PDF" }, { name: "description", content: "Get in touch with the Lazy PDF team." }], links: [{ rel: "canonical", href: "/contact" }] }),
  component: () => <ContentPage title="Contact Us" content={CONTACT_US} />,
});
