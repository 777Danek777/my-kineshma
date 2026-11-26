import { HomePage } from "@/components/home-page";
import { getPublishedNews, getPublicCategories } from "@/server/news/public";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const params = await searchParams;
  const [articles, categories] = await Promise.all([
    getPublishedNews(),
    getPublicCategories(),
  ]);
  return (
    <HomePage
      key={`${params.category ?? ""}:${params.q ?? ""}`}
      articles={articles}
      categories={categories}
      demo={false}
      initialCategory={
        typeof params.category === "string" ? params.category : undefined
      }
      initialQuery={typeof params.q === "string" ? params.q.slice(0, 180) : ""}
    />
  );
}
