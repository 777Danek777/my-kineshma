"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/ui/icon";
import { ThemeSelect } from "@/components/ui/theme-select";
import { CommunityHeader } from "@/components/community/community-header";
import { CategoryCarousel } from "@/components/community/category-carousel";
import { CommunitySidebar } from "@/components/community/community-sidebar";
import type { FeedView } from "@/components/community/feed-navigation";
import { CommunityFooter } from "@/components/community/community-footer";
import { RiverLines } from "@/components/community/river-lines";
import { SocialPostCard } from "@/components/community/post-card";
import { ArticleImage, ArticleLink } from "@/components/news/news-card";
import { communityUrl } from "@/lib/demo-content";
import {
  sourceLabels,
  type HomeArticle,
  type PublicationSourceType,
} from "@/lib/public-types";
import "@/app/(site)/community.css";

type Modal = { kind: "article"; article: HomeArticle } | { kind: "about" };
type MediaFilter = "all" | "photos" | "video";
const navPriority = [
  "Город",
  "Происшествия",
  "ЖКХ",
  "Транспорт",
  "Общество",
  "Афиша",
  "Развлечения",
  "Объявления",
  "Спорт",
  "Фото города",
  "Интересное",
];

function CommunityDialog({
  content,
  onClose,
}: {
  content: Modal | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !content) return;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
    };
  }, [content]);
  return (
    <dialog
      ref={ref}
      className="content-dialog content-dialog--article cm-dialog"
      aria-labelledby="community-dialog-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {content && (
        <div className="dialog-inner">
          <button
            className="icon-button dialog-close"
            aria-label="Закрыть окно"
            onClick={onClose}
            autoFocus
          >
            <Icon name="close" />
          </button>
          {content.kind === "article" ? (
            <>
              {content.article.image && (
                <div className="dialog-photo">
                  <ArticleImage
                    article={content.article}
                    sizes="(max-width: 760px) 100vw, 760px"
                    eager
                  />
                  <span className="demo-label">
                    Демонстрационная публикация
                  </span>
                </div>
              )}
              <div className="dialog-copy">
                <span className="category-label">
                  {content.article.category}
                </span>
                <h2 id="community-dialog-title">{content.article.title}</h2>
                <p className="demo-notice">
                  <Icon name="info" size={18} />
                  Пример оформления. Этот материал не сообщает о реальных
                  событиях.
                </p>
                {content.article.body?.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
                <div className="dialog-end">
                  Моя Кинешма <span>Город. Люди. События.</span>
                </div>
              </div>
            </>
          ) : (
            <div className="dialog-copy dialog-copy--simple">
              <Brand />
              <h2 id="community-dialog-title">Здесь всё, чем живёт город</h2>
              <p>
                «Моя Кинешма» — городское интернет-сообщество. Здесь встречаются
                истории жителей, фотографии, полезная информация, объявления,
                афиша, юмор и сообщения о событиях.
              </p>
              <p>
                Это самостоятельная площадка сообщества, а не официальный
                городской орган или классическое СМИ. Категория помогает найти
                тему, а отдельная отметка источника показывает происхождение
                материала.
              </p>
              <p>
                Здесь можно поделиться текстом, фотографией или видео.
                Контакт для связи видит только редакция. Вы сами решаете,
                указать имя автора или отправить публикацию анонимно.
              </p>
              <Link className="button button-primary" href="/suggest-news">
                Поделиться своей историей
              </Link>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export function HomePage({
  articles: sourceArticles,
  categories: categoryNames,
  demo = false,
  initialArticleSlug,
  initialCategory,
  initialQuery = "",
  initialView = "all",
}: {
  articles: HomeArticle[];
  categories: string[];
  demo?: boolean;
  initialArticleSlug?: string;
  initialCategory?: string;
  initialQuery?: string;
  initialView?: FeedView;
}) {
  const [category, setCategory] = useState<string | null>(
    initialView === "events" && categoryNames.includes("Афиша") ? "Афиша" : initialCategory && categoryNames.includes(initialCategory)
      ? initialCategory
      : null,
  );
  const [query, setQuery] = useState(initialQuery);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>(initialView === "photos" ? "photos" : "all");
  const [source, setSource] = useState<PublicationSourceType | "ALL">(initialView === "resident" ? "RESIDENT" : "ALL");
  const [sort, setSort] = useState("newest");
  const [visible, setVisible] = useState(5);
  const [modal, setModal] = useState<Modal | null>(() => {
    const found =
      demo && initialArticleSlug
        ? sourceArticles.find((article) => article.slug === initialArticleSlug)
        : undefined;
    return found ? { kind: "article", article: found } : null;
  });
  const feedRef = useRef<HTMLElement>(null);
  const normalized = query
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е");
  const categories = [
    ...new Set([
      ...navPriority.filter((name) => categoryNames.includes(name)),
      ...categoryNames,
    ]),
  ];
  const matching = sourceArticles.filter((article) => {
    const text = `${article.title} ${article.content ?? article.body?.join(" ") ?? article.excerpt} ${article.category}`
      .toLocaleLowerCase("ru-RU")
      .replaceAll("ё", "е");
    return (
      (!category || article.category === category) &&
      (!normalized || text.includes(normalized)) &&
      (source === "ALL" || (article.sourceType ?? "COMMUNITY") === source) &&
      (mediaFilter === "all" ||
        (mediaFilter === "photos"
          ? Boolean(article.image || article.images?.length)
          : Boolean(article.videoUrl || article.videos?.length)))
    );
  });
  const articles = sort === "oldest" ? [...matching].reverse() : matching;
  const topics = categories
    .map((name) => ({
      name,
      count: sourceArticles.filter((article) => article.category === name)
        .length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const latest = sourceArticles.slice(0, 3);
  const filtered = Boolean(
    category || normalized || mediaFilter !== "all" || source !== "ALL",
  );
  const openArticle = (article: HomeArticle) =>
    setModal({ kind: "article", article });
  function scrollToFeed() {
    window.requestAnimationFrame(() => {
      if (!feedRef.current) return;
      const headerHeight =
        document.getElementById("community-header")?.getBoundingClientRect()
          .height ?? 140;
      const top =
        window.scrollY +
        feedRef.current.getBoundingClientRect().top -
        headerHeight -
        18;
      window.scrollTo({
        top,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    });
  }
  function chooseCategory(name: string | null, scroll = true) {
    setCategory(name);
    setVisible(5);
    if (scroll) scrollToFeed();
  }
  function reset() {
    setCategory(null);
    setQuery("");
    setSource("ALL");
    setMediaFilter("all");
    setVisible(5);
  }
  function quickFilter(kind: FeedView) {
    reset();
    if (kind === "photos") setMediaFilter("photos");
    if (kind === "resident") setSource("RESIDENT");
    if (kind === "events" && categories.includes("Афиша")) setCategory("Афиша");
    scrollToFeed();
  }

  return (
    <div className="community-site">
      <a href="#community-feed" className="skip-link">
        Перейти к публикациям
      </a>
      {demo && (
        <div className="cm-demo-strip">
          <span>ДЕМО</span>Примеры публикаций для знакомства с дизайном. Это не
          реальные новости.
        </div>
      )}
      <CommunityHeader
        categories={categories}
        activeView={normalized ? null : !category && source === "ALL" ? (mediaFilter === "photos" ? "photos" : mediaFilter === "all" ? "all" : null) : !category && mediaFilter === "all" && source === "RESIDENT" ? "resident" : category === "Афиша" && mediaFilter === "all" && source === "ALL" ? "events" : null}
        onView={quickFilter}
        query={query}
        onQuery={(value) => {
          setQuery(value);
          setVisible(5);
        }}
        onSearch={scrollToFeed}
      />
      <main className="cm-container cm-main">
        <section className="cm-city-banner" aria-labelledby="community-title">
          <Image
            src="/images/city-panorama.jpg"
            alt="Кинешма: берег Волги и исторический центр"
            fill
            sizes="(max-width: 1320px) 100vw, 1240px"
            preload
          />
          <div className="cm-banner-shade" />
          <RiverLines className="cm-banner-river" />
          <div className="cm-banner-copy">
            <span className="cm-eyebrow">
              МОЯ КИНЕШМА · ГОРОД. ЛЮДИ. СОБЫТИЯ.
            </span>
            <h1 id="community-title">
              Город рядом.<br /><span>Люди — ещё ближе.</span>
            </h1>
            <p>Ваши истории, фотографии и разговоры о Кинешме.</p>
          </div>
          <div className="cm-banner-caption"><span className="cm-banner-dot" />Своя точка на карте Волги</div>
          <span className="cm-banner-place">
            <Icon name="pin" size={16} />
            На берегу Волги
          </span>
        </section>

        <div className="cm-columns">
          <section
            ref={feedRef}
            id="community-feed"
            className="cm-feed"
            aria-labelledby="feed-title"
          >
            <Link href="/suggest-news" className="cm-feed-composer cm-glass">
              <span className="cm-composer-avatar"><Icon name="plus" size={22} /></span>
              <span><strong>Что нового в вашей Кинешме?</strong><small>Поделитесь моментом, историей или полезной находкой</small></span>
              <span className="cm-composer-tools"><Icon name="camera" size={21} /><span className="cm-composer-write">Написать</span><Icon name="chevron" size={17} /></span>
            </Link>
            <div className="cm-feed-heading">
              <div>
                <span className="cm-eyebrow">ИСТОРИИ, КОТОРЫЕ РЯДОМ</span>
                <h2 id="feed-title">Лента города</h2>
              </div>
              <div className="cm-sort">
                <ThemeSelect
                  aria-label="Порядок публикаций"
                  variant="quiet"
                  value={sort}
                  onValueChange={setSort}
                  options={[{ value: "newest", label: "Сначала новые" }, { value: "oldest", label: "Сначала старые" }]}
                />
              </div>
            </div>
            <div className="cm-filters cm-glass">
              <CategoryCarousel categories={categories} activeCategory={category} onCategory={name => chooseCategory(name, false)} />
              <div className="cm-filter-bottom">
                <div
                  className="cm-media-filters"
                  role="group"
                  aria-label="Формат публикации"
                >
                  {(
                    [
                      { value: "all", label: "Все форматы" },
                      { value: "photos", label: "С фото" },
                      { value: "video", label: "Видео" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.value}
                      className={mediaFilter === item.value ? "is-active" : ""}
                      aria-pressed={mediaFilter === item.value}
                      onClick={() => {
                        setMediaFilter(item.value);
                        setVisible(5);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="cm-source-select">
                  <ThemeSelect
                    aria-label="Источник публикаций"
                    variant="quiet"
                    value={source}
                    onValueChange={(value) => {
                      setSource(value as PublicationSourceType | "ALL");
                      setVisible(5);
                    }}
                    options={[{ value: "ALL", label: "Все источники" }, ...Object.entries(sourceLabels).map(([value, label]) => ({ value, label }))]}
                  />
                </div>
              </div>
            </div>
            {filtered && (
              <div className="cm-results" aria-live="polite">
                <span>
                  {query ? `По запросу «${query}»` : "Найдено публикаций"}:{" "}
                  {articles.length}
                </span>
                <button onClick={reset}>Сбросить фильтры</button>
              </div>
            )}
            <div className="cm-posts">
              {articles.slice(0, visible).map((article, index) => (
                <SocialPostCard
                  key={article.slug}
                  article={article}
                  demo={demo}
                  onOpen={openArticle}
                  featured={index === 0 && !filtered}
                  compact={!article.image && !article.images?.length && !article.videos?.length && !article.videoUrl}
                />
              ))}
            </div>
            {!articles.length && (
              <div className="cm-empty">
                <RiverLines className="cm-empty-river" />
                <span className="cm-empty-symbol">
                  <Icon
                    name={sourceArticles.length ? "search" : "message"}
                    size={30}
                  />
                </span>
                <h3>
                  {sourceArticles.length
                    ? "Таких публикаций пока нет"
                    : "Городская лента начинается с вас"}
                </h3>
                <p>
                  {sourceArticles.length
                    ? "Попробуйте другую тему или снимите фильтры."
                    : "Фотография с прогулки, один короткий вопрос или большая история — всему найдётся место. Начните с того, чем хочется поделиться."}
                </p>
                {sourceArticles.length ? (
                  <button className="button button-secondary" onClick={reset}>
                    Показать все публикации
                  </button>
                ) : (
                  <Link className="button button-primary" href="/suggest-news">
                    Предложить публикацию
                  </Link>
                )}
                {!sourceArticles.length && (
                  <Link className="cm-empty-demo" href="/demo">
                    Посмотреть примеры оформления
                  </Link>
                )}
              </div>
            )}
            {articles.length > visible && (
              <button
                className="cm-load-more"
                onClick={() => setVisible((count) => count + 5)}
              >
                <Icon name="plus" size={18} />
                Показать ещё публикации<span>{articles.length - visible}</span>
              </button>
            )}
            {demo && (
              <p className="cm-demo-note">
                <Icon name="info" size={15} />
                Все тексты здесь — демонстрационные примеры. Фотографии
                показывают настоящую Кинешму.
              </p>
            )}
          </section>

          <CommunitySidebar>
            <section className="cm-vk-card cm-glass">
              <div className="cm-sidebar-icon">
                <Icon name="vk" size={28} />
              </div>
              <span className="cm-eyebrow">СВОИ ЛЮДИ НА СВЯЗИ</span>
              <h2>
                Встречаемся{" "}
                <br />
                ВКонтакте
              </h2>
              <p>Истории, фотографии и разговоры о нашем городе.</p>
              <a
                className="button button-primary"
                href={communityUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Перейти в сообщество
              </a>
              <RiverLines className="cm-vk-river" />
            </section>
            <section className="cm-topics cm-glass">
              <div className="cm-panel-title">
                <h2>Темы города</h2>
                <Icon name="pin" size={17} />
              </div>
              <p className="cm-panel-description">Найдите своё в общей ленте</p>
              <div>
                {topics.map((topic) => (
                  <button
                    key={topic.name}
                    onClick={() => {
                      reset();
                      chooseCategory(topic.name);
                    }}
                  >
                    <span className="cm-topic-hash">#</span>
                    <span>{topic.name}</span>
                    {topic.count > 0 && (
                      <span
                        className="cm-topic-count"
                        aria-label={`${topic.count} публикаций${demo ? " в демоподборке" : " в ленте"}`}
                      >
                        {topic.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
            <section className="cm-latest cm-glass">
              <div className="cm-panel-title">
                <h2>Последние публикации</h2>
                <Icon name="clock" size={17} />
              </div>
              {latest.length ? (
                latest.map((article) => (
                  <ArticleLink
                    key={article.slug}
                    article={article}
                    demo={demo}
                    onOpen={openArticle}
                    className="cm-latest-item"
                  >
                    <span>
                      {article.category}
                      {demo ? " · Демо" : ""}
                    </span>
                    <h3>{article.title || article.content?.trim().slice(0, 90) || "Фотографии и моменты города"}</h3>
                  </ArticleLink>
                ))
              ) : (
                <p className="cm-panel-description">
                  Здесь появятся новые материалы сообщества после публикации.
                </p>
              )}
            </section>
            <section className="cm-suggest-card cm-glass">
              <div className="cm-sidebar-icon">
                <Icon name="message" size={24} />
              </div>
              <h2>Есть чем поделиться?</h2>
              <p>
                Большие события и маленькие моменты. Нам интересно всё, чем
                живёт Кинешма.
              </p>
              <Link className="button button-secondary" href="/suggest-news">
                <Icon name="plus" size={17} />
                Предложить публикацию
              </Link>
              <span className="cm-panel-foot">
                Текст, фото или видео · Можно анонимно
              </span>
            </section>
            <div className="cm-side-note">
              <button onClick={() => setModal({ kind: "about" })}>
                О сообществе
              </button>
              <a
                href="/image-credits.txt"
                target="_blank"
                rel="noopener noreferrer"
              >
                Авторы фотографий
              </a>
              <span>Моя Кинешма · Город. Люди. События.</span>
            </div>
          </CommunitySidebar>
        </div>
      </main>
      <CommunityFooter
        demo={demo}
        onAbout={() => setModal({ kind: "about" })}
      />
      <CommunityDialog content={modal} onClose={() => setModal(null)} />
    </div>
  );
}
