import { marked } from "marked";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";

export function ContentPage({ title, content }: { title: string; content: string }) {
  const html = marked.parse(content, { async: false });

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
        <Breadcrumbs items={[{ label: title }]} />
        <article
          className="prose prose-neutral mt-8 max-w-none prose-headings:font-display prose-headings:tracking-tight prose-h1:text-4xl prose-h1:sm:text-5xl prose-h2:mt-10 prose-h2:text-3xl prose-h3:text-xl prose-a:text-signal prose-a:no-underline hover:prose-a:underline prose-p:leading-relaxed prose-li:leading-relaxed dark:prose-invert dark:prose-a:text-signal"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>
      <Footer />
    </div>
  );
}
