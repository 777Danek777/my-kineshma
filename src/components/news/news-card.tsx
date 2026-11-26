import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { formatPublicationDate, type HomeArticle } from "@/lib/public-types";

export function ArticlePlaceholder() {
  return (
    <div className="article-placeholder" aria-hidden="true">
      <svg viewBox="0 0 360 200" fill="none">
        <circle cx="278" cy="51" r="24" />
        <path d="M0 148h42v-33h24v33h20V92h30v56h27v-28h24v28h22V77h14V56h9v21h14v71h28v-40h31v40h75M0 170c45-12 45 12 90 0s45 12 90 0 45 12 90 0 45 12 90 0M0 187c45-12 45 12 90 0s45 12 90 0 45 12 90 0 45 12 90 0" />
      </svg>
      <span>МОЯ КИНЕШМА</span>
    </div>
  );
}

export function ArticleImage({
  article,
  sizes,
  eager = false,
}: {
  article: HomeArticle;
  sizes: string;
  eager?: boolean;
}) {
  if (!article.image) return <ArticlePlaceholder />;
  const isDemoImage = typeof article.image === "string";
  const source =
    typeof article.image === "string"
      ? article.image
      : `/media/${article.image.id}`;
  const alt =
    typeof article.image === "string"
      ? (article.imageAlt ?? "")
      : article.image.alt;
  return (
    <Image
      src={source}
      alt={alt}
      fill
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      unoptimized={!isDemoImage}
    />
  );
}

export function ArticleLink({
  article,
  demo,
  onOpen,
  className,
  children,
}: {
  article: HomeArticle;
  demo: boolean;
  onOpen: (article: HomeArticle) => void;
  className: string;
  children: ReactNode;
}) {
  return demo ? (
    <button
      className={className}
      onClick={() => onOpen(article)}
      aria-label={`Читать демоматериал: ${article.title}`}
    >
      {children}
    </button>
  ) : (
    <Link
      href={`/news/${encodeURIComponent(article.slug)}`}
      prefetch={false}
      className={className}
      aria-label={`Читать: ${article.title}`}
    >
      {children}
    </Link>
  );
}

export function NewsCard({
  article,
  demo,
  onOpen,
}: {
  article: HomeArticle;
  demo: boolean;
  onOpen: (article: HomeArticle) => void;
}) {
  return (
    <article className="news-card">
      <ArticleLink
        article={article}
        demo={demo}
        onOpen={onOpen}
        className="news-card-button"
      >
        <div className="news-card-image">
          <ArticleImage
            article={article}
            sizes="(max-width: 620px) 100vw, (max-width: 1000px) 50vw, 33vw"
          />
          {demo && <span className="demo-label">Демо</span>}
        </div>
        <div className="news-card-body">
          <span className="category-label">{article.category}</span>
          <h3>{article.title}</h3>
          <p>{article.excerpt}</p>
          <div className="article-meta">
            {demo ? (
              <span>Пример публикации</span>
            ) : (
              article.publishedAt && (
                <time dateTime={article.publishedAt}>
                  {formatPublicationDate(article.publishedAt)}
                </time>
              )
            )}
            <span>
              <Icon name="clock" size={14} />
              {article.readingMinutes} мин
            </span>
          </div>
        </div>
      </ArticleLink>
    </article>
  );
}
