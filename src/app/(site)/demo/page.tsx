import type { Metadata } from "next";
import { HomePage } from "@/components/home-page";
import { categories, demoArticles } from "@/lib/demo-content";

export const metadata: Metadata = {
  title: "Демонстрация дизайна — Моя Кинешма",
  description:
    "Примеры оформления сайта. Все материалы на этой странице демонстрационные и не являются реальными новостями.",
  robots: { index: false, follow: false },
};

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string }>;
}) {
  const params = await searchParams;
  return (
    <HomePage
      key={params.post ?? "demo"}
      articles={demoArticles}
      categories={categories.filter((category) => category !== "Все новости")}
      demo
      initialArticleSlug={
        typeof params.post === "string" ? params.post : undefined
      }
    />
  );
}
