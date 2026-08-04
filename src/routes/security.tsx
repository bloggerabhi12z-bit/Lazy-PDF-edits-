import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/site/ContentPage";
import { SECURITY } from "@/lib/company-page-content";

export const Route = createFileRoute("/security")({
  head: () => ({ meta: [{ title: "Security | Lazy PDF" }, { name: "description", content: "How Lazy PDF keeps documents private with local, in-browser processing." }], links: [{ rel: "canonical", href: "/security" }] }),
  component: () => <ContentPage title="Security" content={SECURITY} />,
});
