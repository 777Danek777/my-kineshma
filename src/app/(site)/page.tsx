import { HomePage } from "@/components/home-page";
import { getPublishedNews, getPublicCategories } from "@/server/news/public";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; view?: string }>;
}) {
  const params = await searchParams;
  const [articles, categories] = await Promise.all([
    getPublishedNews(),
    getPublicCategories(),
  ]);
  return (
    <HomePage
      key={`${params.category ?? ""}:${params.q ?? ""}:${params.view ?? ""}`}
      articles={articles}
      categories={categories}
      demo={false}
      initialCategory={
        typeof params.category === "string" ? params.category : undefined
      }
      initialQuery={typeof params.q === "string" ? params.q.slice(0, 180) : ""}
      initialView={params.view === "photos" || params.view === "resident" || params.view === "events" ? params.view : "all"}
    />
  );
}
