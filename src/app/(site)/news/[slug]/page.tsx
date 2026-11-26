import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/ui/icon";
import { CommunityHeader } from "@/components/community/community-header";
import { CommunityFooter } from "@/components/community/community-footer";
import { PhotoGallery } from "@/components/community/photo-gallery";
import { NativeVideo } from "@/components/community/native-video";
import { PostActions } from "@/components/community/post-actions";
import { PublicationComments } from "@/components/community/publication-comments";
import { serverConfig } from "@/server/config";
import {
  formatPublicationDate,
  formatPublicationTime,
  sourceLabels,
} from "@/lib/public-types";
import { getPublishedArticle, getPublicCategories } from "@/server/news/public";
import "../../public-news.css";
import "../../community.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getPublishedArticle((await params).slug);
  if (!article) notFound();
  const title = article.title.trim() || article.content.trim().replace(/\s+/g, " ").slice(0, 75) || "Публикация жителя";
  const description = article.excerpt.trim() || (article.videos?.length ? "Видео и моменты из жизни Кинешмы — в городском сообществе «Моя Кинешма»." : "Фотографии и моменты из жизни Кинешмы — в городском сообществе «Моя Кинешма».");
  const canonical = new URL(`/news/${encodeURIComponent(article.slug)}`, serverConfig().origin).href;
  const image = { url: `${canonical}/preview.jpg`, width: 1200, height: 630, alt: title, type: "image/jpeg" };
  return {
    title: `${title} — Моя Кинешма`,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "article",
      publishedTime: article.publishedAt,
      url: canonical,
      siteName: "Моя Кинешма",
      locale: "ru_RU",
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function NewsPage({ params }: Props) {
  const article = await getPublishedArticle((await params).slug);
  if (!article) notFound();
  const categories = await getPublicCategories();
  const accessibleTitle = article.title || "Публикация сообщества";
  const authorName = article.publicAuthorName?.trim() || (article.sourceType === "RESIDENT" ? "Читатель сообщества" : "Моя Кинешма");
  return (
    <div className="community-site">
      <a href="#article" className="skip-link">
        Перейти к публикации
      </a>
      <CommunityHeader categories={categories} />
      <main className="cm-container public-article-main" id="article">
        <nav aria-label="Хлебные крошки" className="public-breadcrumb">
          <Link href="/">Лента города</Link>
          <span aria-hidden="true">/</span>
          <span>{article.category}</span>
        </nav>
        <article className="public-article" aria-label={accessibleTitle}>
          <header className="public-article-heading">
            <div className="public-author"><Brand compact /><div><span className="public-author-name">{authorName}</span><time dateTime={article.publishedAt}>{formatPublicationDate(article.publishedAt)} · {formatPublicationTime(article.publishedAt)}</time></div></div>
            <div className="cm-article-source">
              <span className="category-label">{article.category}</span>
              <span>{sourceLabels[article.sourceType]}</span>
              {article.sourceUrl ? (
                <a
                  href={article.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Источник:{" "}
                  {article.sourceName || new URL(article.sourceUrl).hostname}
                  <span className="sr-only"> (новая вкладка)</span>
                </a>
              ) : (
                article.sourceName && (
                  <span>Источник: {article.sourceName}</span>
                )
              )}
            </div>
            {article.title && <h1>{article.title}</h1>}
          </header>
          {article.content && <div className="public-article-content">
            {article.content
              .split(/\n\s*\n/u)
              .filter((paragraph) => paragraph.trim())
              .map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
          </div>}
          {article.images.length > 0 && <PhotoGallery images={article.images} title={accessibleTitle} eager />}
          {article.videos?.map((video) => <NativeVideo key={video.id} media={video} title={accessibleTitle} />)}
          {article.videoUrl && (
            <div className="sp-video">
              <a
                className="sp-video-link"
                href={article.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Смотреть видео
                <Icon name="external" size={16} />
              </a>
              <span>Видео откроется на сайте источника</span>
            </div>
          )}
          <PostActions
            slug={article.slug}
            initialStats={article.social}
            url={`/news/${encodeURIComponent(article.slug)}`}
            title={accessibleTitle}
          />
          <PublicationComments slug={article.slug} />
          <div className="public-article-end">
            <span>Есть своя история о городе?</span>
            <Link href="/suggest-news" className="button button-secondary">
              Предложить публикацию
            </Link>
          </div>
        </article>
      </main>
      <CommunityFooter />
    </div>
  );
}
