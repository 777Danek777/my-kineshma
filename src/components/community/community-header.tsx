"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/ui/icon";
import { communityUrl } from "@/lib/demo-content";
import { ThemeToggle } from "@/components/theme-toggle";

export function CommunityHeader({
  categories = [
    "Город",
    "Происшествия",
    "Афиша",
    "Развлечения",
    "Фото города",
    "Объявления",
  ],
  activeCategory = null,
  onCategory,
  query,
  onQuery,
  onSearch,
}: {
  categories?: string[];
  activeCategory?: string | null;
  onCategory?: (value: string | null) => void;
  query?: string;
  onQuery?: (value: string) => void;
  onSearch?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const [localQuery, setLocalQuery] = useState("");
  const currentQuery = query ?? localQuery;
  function categoryLink(name: string | null) {
    return name
      ? `/?category=${encodeURIComponent(name)}#community-feed`
      : "/#community-feed";
  }
  function choose(name: string | null) {
    setMenuOpen(false);
    onCategory?.(name);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (onSearch) {
      event.preventDefault();
      onSearch();
    }
  }
  return (
    <header
      className="ch-header"
      id="community-header"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setMenuOpen(false);
          setSearchOpen(false);
        }
      }}
    >
      <div className="ch-masthead cm-container">
        <Link
          href="/"
          className="brand-link"
          aria-label="Моя Кинешма — главная"
        >
          <Brand />
        </Link>
        <span className="ch-location">
          <Icon name="pin" size={16} />
          Город на Волге
        </span>
        <div className="ch-actions">
          <ThemeToggle />
          <a
            className="ch-icon ch-vk"
            href={communityUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Сообщество ВКонтакте, новая вкладка"
          >
            <Icon name="vk" size={23} />
          </a>
          <button
            className={`ch-icon${searchOpen ? " is-active" : ""}`}
            aria-label={searchOpen ? "Закрыть поиск" : "Поиск по публикациям"}
            aria-expanded={searchOpen}
            aria-controls="community-search"
            onClick={() => {
              setSearchOpen(!searchOpen);
              setMenuOpen(false);
            }}
          >
            <Icon name={searchOpen ? "close" : "search"} />
          </button>
          <Link
            href="/suggest-news"
            className="button button-primary ch-suggest"
          >
            <Icon name="plus" size={17} />
            Написать в ленту
          </Link>
          <button
            className="ch-icon ch-menu-toggle"
            aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={menuOpen}
            aria-controls="community-mobile-nav"
            onClick={() => {
              setMenuOpen(!menuOpen);
              setSearchOpen(false);
            }}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>
        </div>
      </div>
      <nav
        className="ch-nav cm-container"
        aria-label="Разделы городского сообщества"
      >
        {[null, ...categories].map((name) =>
          onCategory ? (
            <button
              key={name ?? "all"}
              className={activeCategory === name ? "is-active" : ""}
              aria-pressed={activeCategory === name}
              onClick={() => choose(name)}
            >
              {name ?? "Лента"}
            </button>
          ) : (
            <Link key={name ?? "all"} href={categoryLink(name)}>
              {name ?? "Лента"}
            </Link>
          ),
        )}
      </nav>
      {menuOpen && (
        <nav
          id="community-mobile-nav"
          className="ch-mobile cm-container"
          aria-label="Мобильные разделы"
        >
          {[null, ...categories].map((name) =>
            onCategory ? (
              <button
                key={name ?? "all"}
                className={activeCategory === name ? "is-active" : ""}
                onClick={() => choose(name)}
              >
                {name ?? "Все публикации"}
              </button>
            ) : (
              <Link key={name ?? "all"} href={categoryLink(name)}>
                {name ?? "Все публикации"}
              </Link>
            ),
          )}
          <Link href="/suggest-news" className="button button-primary">
            Предложить публикацию
          </Link>
        </nav>
      )}
      {searchOpen && (
        <div className="ch-search" id="community-search">
          <form
            className="cm-container"
            role="search"
            action="/#community-feed"
            method="get"
            onSubmit={submit}
          >
            <Icon name="search" />
            <label htmlFor="community-search-input" className="sr-only">
              Поиск публикаций
            </label>
            <input
              id="community-search-input"
              name="q"
              type="search"
              value={currentQuery}
              onChange={(event) => {
                if (onQuery) onQuery(event.target.value);
                else setLocalQuery(event.target.value);
              }}
              placeholder="Что происходит в вашем городе?"
              autoFocus
              maxLength={180}
            />
            <button className="button button-primary" type="submit">
              Найти
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
