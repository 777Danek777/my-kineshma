"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/ui/icon";
import { communityUrl } from "@/lib/demo-content";
import { ThemeToggle } from "@/components/theme-toggle";
import { FeedNavigation, type FeedView } from "./feed-navigation";
import "./community-motion.css";

export function CommunityHeader({ categories, activeView, onView, query, onQuery, onSearch }: {
  categories?: string[];
  activeView?: FeedView | null;
  onView?: (view: FeedView) => void;
  query?: string;
  onQuery?: (value: string) => void;
  onSearch?: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const [localQuery, setLocalQuery] = useState("");
  const header = useRef<HTMLElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const currentQuery = query ?? localQuery;
  useEffect(() => {
    const element = header.current;
    const site = element?.closest<HTMLElement>(".community-site");
    if (!element || !site) return;
    const observer = new ResizeObserver(() => site.style.setProperty("--community-header-height", `${Math.ceil(element.getBoundingClientRect().height)}px`));
    observer.observe(element);
    return () => { observer.disconnect(); site.style.removeProperty("--community-header-height"); };
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    if (onSearch) { event.preventDefault(); onSearch(); }
  }
  return <header ref={header} className="ch-header" id="community-header" onKeyDown={event => {
    if (event.key === "Escape" && searchOpen) { setSearchOpen(false); searchButton.current?.focus(); }
  }}>
    <div className="ch-masthead cm-container">
      <Link href="/" className="brand-link" aria-label="Моя Кинешма — главная"><Brand /></Link>
      <span className="ch-location"><Icon name="pin" size={16} />Город на Волге</span>
      <div className="ch-actions">
        <ThemeToggle />
        <a className="ch-icon ch-vk" href={communityUrl} target="_blank" rel="noopener noreferrer" aria-label="Сообщество ВКонтакте, новая вкладка"><Icon name="vk" size={23} /></a>
        <button ref={searchButton} type="button" className={`ch-icon${searchOpen ? " is-active" : ""}`} aria-label={searchOpen ? "Закрыть поиск" : "Поиск по публикациям"} aria-expanded={searchOpen} aria-controls="community-search" onClick={() => setSearchOpen(!searchOpen)}><Icon name={searchOpen ? "close" : "search"} /></button>
        <Link href="/suggest-news" className="button button-primary ch-suggest" aria-label="Написать в ленту"><Icon name="plus" size={17} /><span className="ch-suggest-label">Написать в ленту</span></Link>
      </div>
    </div>
    <FeedNavigation hasEvents={!categories || categories.includes("Афиша")} activeView={activeView} onView={onView} />
    {searchOpen && <div className="ch-search" id="community-search">
      <form className="cm-container" role="search" action="/#community-feed" method="get" onSubmit={submit}>
        <Icon name="search" /><label htmlFor="community-search-input" className="sr-only">Поиск публикаций</label>
        <input id="community-search-input" name="q" type="search" value={currentQuery} onChange={event => onQuery ? onQuery(event.target.value) : setLocalQuery(event.target.value)} placeholder="Что происходит в вашем городе?" autoFocus maxLength={180} />
        <button className="button button-primary" type="submit">Найти</button>
      </form>
    </div>}
  </header>;
}
