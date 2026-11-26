"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import {
  sourceLabels,
  type HomeArticle,
  type PublicMedia,
} from "@/lib/public-types";
import { PhotoGallery } from "./photo-gallery";
import { PostActions } from "./post-actions";
import { PublicationComments } from "./publication-comments";
import { NativeVideo } from "./native-video";
import "./post-card.css";

export type SocialPostCardProps = {
  article: HomeArticle;
  demo: boolean;
  onOpen: (article: HomeArticle) => void;
  featured?: boolean;
  compact?: boolean;
};

function secureExternalUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function publicationTime(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function CommunityAvatar() {
  return (
    <svg
      className="sp-avatar"
      width="42"
      height="42"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="14" fill="#3068d9" />
      <path
        d="M11 29V15l7 8 6-8v14M28 15v14m0-7 9-7m-9 7 9 7"
        stroke="white"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11 35c4-3 7 3 11 0s7 3 15 0"
        stroke="#BDD3FF"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PostLink({
  article,
  demo,
  onOpen,
  className,
  children,
}: Pick<SocialPostCardProps, "article" | "demo" | "onOpen"> & {
  className: string;
  children: ReactNode;
}) {
  return demo ? (
    <button
      type="button"
      className={className}
      onClick={() => onOpen(article)}
      aria-label={`Читать демоматериал: ${article.title}`}
    >
      {children}
    </button>
  ) : (
    <Link
      href={`/news/${encodeURIComponent(article.slug)}`}
      className={className}
      prefetch={false}
    >
      {children}
    </Link>
  );
}

export function SocialPostCard({
  article,
  demo,
  onOpen,
  featured = false,
  compact = false,
}: SocialPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const fullText = article.content ?? article.body?.join("\n\n") ?? article.excerpt;
  const textLines = fullText.split(/\r?\n/);
  const longText = fullText.length > 320 || textLines.length > 5;
  const previewCharacters = Array.from(textLines.slice(0, 5).join("\n"));
  const previewText = previewCharacters.slice(0, 260).join("");
  const breakAt = previewText.lastIndexOf(" ");
  const preview = (previewCharacters.length > 260 && breakAt > 200 ? previewText.slice(0, breakAt) : previewText).trimEnd();
  const displayedText = longText && !expanded ? `${preview}…` : fullText;
  const accessibleTitle = article.title || "Публикация сообщества";
  const authorName = article.publicAuthorName?.trim() || (article.sourceType === "RESIDENT" ? "Читатель сообщества" : "Моя Кинешма");
  const sourceUrl = secureExternalUrl(article.sourceUrl);
  const videoUrl = secureExternalUrl(article.videoUrl);
  const sourceLabel = sourceLabels[article.sourceType ?? "COMMUNITY"];
  const sourceName = article.sourceName?.trim();
  const timeLabel = demo ? null : publicationTime(article.publishedAt);
  const imageList: (PublicMedia | string)[] = [];
  const imageKeys = new Set<string>();
  for (const image of [article.image, ...(article.images || [])]) {
    if (!image) continue;
    if (typeof image !== "string" && image.kind === "VIDEO") continue;
    const key = typeof image === "string" ? image : image.id;
    if (imageKeys.has(key)) continue;
    imageKeys.add(key);
    imageList.push(image);
  }
  const categoryKind =
    article.category === "Афиша"
      ? "event"
      : article.category === "Объявления"
        ? "announcement"
        : "news";
  const shareUrl = demo
    ? `/demo?post=${encodeURIComponent(article.slug)}`
    : `/news/${encodeURIComponent(article.slug)}`;

  return (
    <article
      className={`sp-post sp-post--${categoryKind}${featured ? " sp-post--featured" : ""}${compact ? " sp-post--compact" : ""}`}
    >
      <header className="sp-post-header">
        <CommunityAvatar />
        <div className="sp-author">
          <span className="sp-author-name">{authorName}</span>
          <div className="sp-post-meta">
            {demo ? (
              <span className="sp-demo-mark">Демонстрационный материал</span>
            ) : timeLabel ? (
              <time dateTime={article.publishedAt}>{timeLabel} · МСК</time>
            ) : (
              <span>Публикация редакции</span>
            )}
          </div>
        </div>
      </header>
      <div className="sp-post-copy">
        <div className="sp-post-tags">
          <span className="sp-category">{article.category}</span>
          {sourceLabel && (
            <span
              className={`sp-source-badge sp-source-badge--${article.sourceType?.toLowerCase()}`}
            >
              {sourceLabel}
            </span>
          )}
        </div>
        {article.title && <h3 className="sp-post-title">
          <PostLink
            article={article}
            demo={demo}
            onOpen={onOpen}
            className="sp-title-link"
          >
            {article.title}
          </PostLink>
        </h3>}
        {fullText && <div className="sp-text-content">
          <p id={textId} className={`sp-post-text${longText && !expanded ? " sp-post-text--collapsed" : ""}`}>{displayedText}</p>
          {longText && <button type="button" className="sp-expand-text" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={textId}>{expanded ? "Свернуть" : "Показать ещё"}<Icon name="chevron" size={15} /></button>}
        </div>}
        {(sourceName || sourceUrl) && (
          <p className="sp-source-line">
            <span>Источник: </span>
            {sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                {sourceName || new URL(sourceUrl).hostname}
                <Icon name="external" size={13} />
                <span className="sr-only"> (откроется в новой вкладке)</span>
              </a>
            ) : (
              <span>{sourceName}</span>
            )}
          </p>
        )}
      </div>
      {imageList.length > 0 && (
        <PhotoGallery
          images={imageList}
          title={accessibleTitle}
          imageAlt={article.imageAlt}
          demo={demo}
          eager={featured}
        />
      )}
      {article.videos?.map((video) => <NativeVideo key={video.id} media={video} title={accessibleTitle} />)}
      {videoUrl && (
        <div className="sp-video">
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sp-video-link"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="m8 4 12 8-12 8V4Z" strokeLinejoin="round" />
            </svg>
            Смотреть видео
            <Icon name="external" size={15} />
          </a>
          <span>Видео на сайте автора</span>
        </div>
      )}
      <PostActions
        url={shareUrl}
        title={accessibleTitle}
        demo={demo}
        slug={demo ? undefined : article.slug}
        initialStats={demo ? undefined : article.social}
        onDiscuss={demo ? undefined : () => window.dispatchEvent(new CustomEvent("my-kineshma:open-comments", { detail: { slug: article.slug } }))}
      />
      {!demo && <PublicationComments slug={article.slug} compact />}
    </article>
  );
}
