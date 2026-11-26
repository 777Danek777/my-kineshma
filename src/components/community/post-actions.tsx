"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  announceSocialUpdate,
  getSocialStats,
  setPostLike,
  SOCIAL_UPDATED_EVENT,
  socialErrorMessage,
  type SocialStats,
  type SocialUpdate,
} from "./social-client";
import "./post-card.css";

export type PostActionsProps = {
  url?: string;
  title: string;
  demo?: boolean;
  slug?: string;
  initialStats?: { likeCount: number; commentCount: number };
  onOpen?: () => void;
  onDiscuss?: () => void;
};

function ActionIcon({ name, filled = false }: { name: "copy" | "share" | "heart" | "comment" | "telegram"; filled?: boolean }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "copy" && <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>}
    {name === "share" && <path d="M12 15V3m-4 4 4-4 4 4M6 11H4v9h16v-9h-2" />}
    {name === "heart" && <path d="M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 22l8.8-9a5.2 5.2 0 0 0 0-7.4Z" />}
    {name === "comment" && <path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 9 9 0 0 1-4-.9L3 21l1.5-5A8.5 8.5 0 1 1 21 11.5Z" />}
    {name === "telegram" && <><path d="m3 10 18-7-5 18-5-7-8-4Z" /><path d="m11 14 10-11" /></>}
  </svg>;
}

function countLabel(value?: number) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("ru-RU", value >= 10000 ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(value);
}

export function PostActions({ url, title, demo = false, slug, initialStats, onOpen, onDiscuss }: PostActionsProps) {
  const [stats, setStats] = useState<SocialStats | null>(initialStats ? { ...initialStats, liked: false } : null);
  const [statsReady, setStatsReady] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [likeBusy, setLikeBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const shareWrapRef = useRef<HTMLDivElement>(null);
  const statsVersion = useRef(0);
  const commentVersion = useRef(0);
  const latestCommentCount = useRef<number | null>(null);
  const inputId = useId();
  const menuId = useId();
  const realPublication = Boolean(slug && !demo);

  useEffect(() => {
    if (!slug || demo) return;
    const controller = new AbortController();
    const version = statsVersion.current;
    const commentsAtStart = commentVersion.current;
    void getSocialStats(slug, controller.signal).then((result) => {
      if (controller.signal.aborted || version !== statsVersion.current) return;
      setStats({ ...result, commentCount: commentsAtStart !== commentVersion.current && latestCommentCount.current !== null ? latestCommentCount.current : result.commentCount });
      setStatsReady(true);
      setStatsError("");
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setStatsError(socialErrorMessage(error, "Не удалось загрузить реакции. Попробуйте ещё раз."));
    });
    const receiveUpdate = (event: Event) => {
      const detail = (event as CustomEvent<SocialUpdate>).detail;
      if (detail?.slug !== slug) return;
      if (typeof detail.stats.commentCount === "number") {
        latestCommentCount.current = detail.stats.commentCount;
        commentVersion.current += 1;
      }
      if (typeof detail.stats.liked === "boolean") {
        statsVersion.current += 1;
        setStatsReady(true);
      }
      setStats((previous) => previous ? { ...previous, ...detail.stats } : typeof detail.stats.liked === "boolean" && typeof detail.stats.likeCount === "number" && typeof detail.stats.commentCount === "number" ? detail.stats as SocialStats : null);
    };
    window.addEventListener(SOCIAL_UPDATED_EVENT, receiveUpdate);
    return () => {
      controller.abort();
      window.removeEventListener(SOCIAL_UPDATED_EVENT, receiveUpdate);
    };
  }, [slug, demo]);

  useEffect(() => {
    if (!manualUrl) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [manualUrl]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !shareWrapRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);

  const refreshStats = async () => {
    if (!slug || demo) return;
    setStatsError("");
    const version = statsVersion.current;
    const commentsAtStart = commentVersion.current;
    try {
      const result = await getSocialStats(slug);
      if (version !== statsVersion.current) return;
      setStats({ ...result, commentCount: commentsAtStart !== commentVersion.current && latestCommentCount.current !== null ? latestCommentCount.current : result.commentCount });
      setStatsReady(true);
    } catch (error) {
      setStatsError(socialErrorMessage(error, "Не удалось загрузить реакции. Проверьте подключение."));
    }
  };

  const toggleLike = async () => {
    if (!slug || demo || !statsReady || !stats || likeBusy) return;
    setLikeBusy(true);
    setStatsError("");
    statsVersion.current += 1;
    try {
      const result = await setPostLike(slug, !stats.liked);
      setStats(result);
      announceSocialUpdate(slug, result);
      setFeedback(result.liked ? "Вы поставили лайк." : "Лайк снят.");
    } catch (error) {
      setStatsError(socialErrorMessage(error, "Не удалось подтвердить лайк. Попробуйте ещё раз."));
    } finally {
      setLikeBusy(false);
    }
  };

  const getLink = () => {
    const permalink = realPublication ? `/news/${encodeURIComponent(slug!)}` : url || (demo ? "/demo" : window.location.href);
    const link = new URL(permalink, window.location.origin);
    if (!["https:", "http:"].includes(link.protocol) || link.origin !== window.location.origin) throw new Error("Unsupported URL");
    link.hash = "";
    return link.href;
  };

  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) shareButtonRef.current?.focus();
  };

  const toggleMenu = () => {
    if (menuOpen) { closeMenu(true); return; }
    try {
      setShareLink(getLink());
      setNativeShareAvailable(typeof navigator.share === "function");
      setMenuOpen(true);
    } catch {
      setFeedback("Не удалось подготовить ссылку.");
    }
  };

  const copyLink = async () => {
    setFeedback("");
    closeMenu(true);
    let link: string;
    try { link = getLink(); } catch { setFeedback("Не удалось подготовить ссылку."); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setManualUrl("");
      setFeedback("Ссылка скопирована");
    } catch {
      setManualUrl(link);
      setFeedback("Браузер не разрешил копирование. Скопируйте выделенную ссылку вручную.");
      window.requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    }
  };

  const shareNative = async () => {
    if (shareBusy) return;
    if (typeof navigator.share !== "function") { await copyLink(); return; }
    setShareBusy(true);
    setFeedback("");
    closeMenu(true);
    try {
      await navigator.share({ title: demo ? `${title} — демоматериал` : title, url: getLink() });
      setManualUrl("");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) await copyLink();
    } finally { setShareBusy(false); }
  };

  const shareTitle = demo ? `${title} — демоматериал` : title;
  const vkUrl = `https://vk.com/share.php?${new URLSearchParams({ url: shareLink, title: shareTitle })}`;
  const telegramUrl = `https://t.me/share/url?${new URLSearchParams({ url: shareLink, text: shareTitle })}`;

  return <div className={`sp-actions${realPublication ? " sp-actions--social" : ""}`}>
    <div className="sp-action-buttons">
      {realPublication && <>
        <button type="button" className={`sp-action sp-like${statsReady && stats?.liked ? " is-liked" : ""}`} onClick={() => void toggleLike()} disabled={!statsReady || likeBusy} aria-pressed={statsReady && Boolean(stats?.liked)} aria-label={`${statsReady && stats?.liked ? "Снять лайк" : "Поставить лайк"}: ${title}`} aria-busy={likeBusy}>
          <ActionIcon name="heart" filled={statsReady && Boolean(stats?.liked)} /><span>Лайк</span><span className="sp-count" title={stats ? `${stats.likeCount} лайков` : "Загружаем количество лайков"}>{countLabel(stats?.likeCount)}</span>
        </button>
        <button type="button" className="sp-action sp-discuss" onClick={() => { if (onDiscuss) onDiscuss(); else window.dispatchEvent(new CustomEvent("my-kineshma:open-comments", { detail: { slug } })); }} aria-label={`Обсудить: ${title}${stats ? `. Опубликованных комментариев: ${stats.commentCount}` : ""}`}><ActionIcon name="comment" /><span>Обсудить</span><span className="sp-count" title={stats ? `${stats.commentCount} комментариев` : "Загружаем количество комментариев"}>{countLabel(stats?.commentCount)}</span></button>
      </>}
      {onOpen && <button type="button" className="sp-action" onClick={onOpen}>{demo ? "Открыть демоматериал" : "Открыть материал"}</button>}
      <div className="sp-share-wrap" ref={shareWrapRef} onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) closeMenu(); }} onKeyDown={(event) => { if (event.key === "Escape" && menuOpen) { event.preventDefault(); event.stopPropagation(); closeMenu(true); } }}>
        <button type="button" className="sp-action sp-share" ref={shareButtonRef} onClick={toggleMenu} disabled={shareBusy} aria-label={`Поделиться: ${title}`} aria-expanded={menuOpen} aria-controls={menuId}><ActionIcon name="share" /><span>Поделиться</span></button>
        {menuOpen && <div className="sp-share-menu" id={menuId} ref={menuRef} role="group" aria-label="Поделиться публикацией">
          <button type="button" onClick={() => void copyLink()}><ActionIcon name="copy" />Скопировать ссылку</button>
          <a href={vkUrl} target="_blank" rel="noopener noreferrer" onClick={() => closeMenu(true)}><Icon name="vk" size={20} />ВКонтакте<span className="sr-only"> (откроется в новой вкладке)</span></a>
          <a href={telegramUrl} target="_blank" rel="noopener noreferrer" onClick={() => closeMenu(true)}><ActionIcon name="telegram" />Telegram<span className="sr-only"> (откроется в новой вкладке)</span></a>
          {nativeShareAvailable && <button type="button" onClick={() => void shareNative()}><ActionIcon name="share" />Другие приложения</button>}
        </div>}
      </div>
    </div>
    {demo && <p className="sp-demo-social-note">Лайки и обсуждение доступны у опубликованных материалов.</p>}
    {statsError && <div className="sp-social-error" role="alert"><span>{statsError}</span><button type="button" onClick={() => void refreshStats()}>Обновить</button></div>}
    <p className="sp-action-feedback" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
    {manualUrl && <div className="sp-copy-fallback"><label htmlFor={inputId}>Ссылка на {demo ? "демоматериал" : "публикацию"}</label><input id={inputId} ref={inputRef} type="text" value={manualUrl} readOnly onFocus={(event) => event.currentTarget.select()} /><span>Скопируйте её через меню выделенного текста или Ctrl+C.</span></div>}
  </div>;
}
