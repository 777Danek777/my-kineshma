"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { ANONYMOUS_DISPLAY_NAME, normalizeDisplayName, validateDisplayName } from "@/lib/display-name";
import {
  announceCommentsRefresh, announceSocialUpdate, COMMENTS_REFRESH_EVENT,
  getCommentForm, getPublicationComments, sendPublicationComment, setCommentLike,
  SocialApiError, socialErrorMessage, type CommentsPage, type PublicComment,
} from "./social-client";
import "./publication-comments.css";

type ReplyTarget = { id: string; displayName: string };
type FormErrors = { displayName?: string; content?: string };

function commentDate(value: string) {
  if (Number.isNaN(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(value));
}

function Heart({ filled }: { filled: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 22l8.8-9a5.2 5.2 0 0 0 0-7.4Z" /></svg>;
}

function CommentItem({ comment, slug, rootId, onReply }: { comment: PublicComment; slug: string; rootId: string; onReply: (target: ReplyTarget) => void }) {
  const [reaction, setReaction] = useState<{ source: PublicComment; likeCount: number; liked: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = reaction?.source === comment ? reaction : comment;
  const toggle = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await setCommentLike(slug, comment.id, !current.liked);
      setReaction({ source: comment, ...response });
    } catch (reason) {
      setError(socialErrorMessage(reason, "Не удалось подтвердить лайк. Попробуйте ещё раз."));
    } finally { setBusy(false); }
  };
  return <article className="sc-comment" id={`comment-${comment.id}`}>
    <span className="sc-comment-avatar" aria-hidden="true">{[...comment.displayName.trim()][0]?.toLocaleUpperCase("ru-RU") || "•"}</span>
    <div className="sc-comment-body">
      <header><h3>{comment.displayName}</h3><time dateTime={comment.createdAt} title="Московское время">{commentDate(comment.createdAt)}</time></header>
      <p>{comment.content}</p>
      <div className="sc-comment-actions">
        <button type="button" onClick={() => onReply({ id: rootId, displayName: comment.displayName })}>Ответить</button>
        <button type="button" className={`sc-comment-like${current.liked ? " is-liked" : ""}`} aria-pressed={current.liked} aria-label={`${current.liked ? "Снять лайк" : "Лайк"} комментарию ${comment.displayName}. Лайков: ${current.likeCount}`} aria-busy={busy} disabled={busy} onClick={() => void toggle()}><Heart filled={current.liked} /><span>{current.likeCount}</span></button>
      </div>
      {error && <p className="sc-inline-error" role="alert">{error}</p>}
    </div>
  </article>;
}

function CommentThread({ comment, slug, onReply }: { comment: PublicComment; slug: string; onReply: (target: ReplyTarget) => void }) {
  const [loaded, setLoaded] = useState<{ source: PublicComment; items: PublicComment[]; page: number; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = loaded?.source === comment ? loaded : null;
  const replies = current?.items ?? comment.replies;
  const total = current?.total ?? comment.replyCount;
  const loadMore = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await getPublicationComments(slug, current ? current.page + 1 : 1, undefined, { parentId: comment.id });
      const previous = current?.items ?? [];
      const merged = [...previous, ...result.items];
      setLoaded({ source: comment, items: merged.filter((item, index) => merged.findIndex(other => other.id === item.id) === index), page: result.page, total: result.total, totalPages: result.totalPages });
    } catch (reason) {
      setError(socialErrorMessage(reason, "Не удалось загрузить ответы. Попробуйте ещё раз."));
    } finally { setBusy(false); }
  };
  return <li className="sc-thread">
    <CommentItem comment={comment} slug={slug} rootId={comment.id} onReply={onReply} />
    {replies.length > 0 && <ol className="sc-replies" aria-label={`Ответы на комментарий ${comment.displayName}`}>
      {replies.map(reply => <li key={reply.id}><CommentItem comment={reply} slug={slug} rootId={comment.id} onReply={onReply} /></li>)}
    </ol>}
    {replies.length < total && <button type="button" className="sc-more-replies" disabled={busy} onClick={() => void loadMore()}>{busy ? "Загружаем ответы…" : `Показать ещё ответы (${total - replies.length})`}</button>}
    {current && replies.length >= total && replies.length > comment.replies.length && <button type="button" className="sc-more-replies" onClick={() => setLoaded(null)}>Свернуть ответы</button>}
    {error && <p className="sc-inline-error" role="alert">{error}</p>}
  </li>;
}

function CommentComposer({ slug, replyTo, onCancelReply }: { slug: string; replyTo: ReplyTarget | null; onCancelReply: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [withName, setWithName] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [content, setContent] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [mode, setMode] = useState<boolean | null>(null);
  const [needsTokenRefresh, setNeedsTokenRefresh] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [success, setSuccess] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const readyAt = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const requested = useRef(false);
  const formId = useId();

  const requestForm = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await getCommentForm(slug, signal);
      if (signal.aborted) return;
      if (typeof response.token !== "string" || !response.token) throw new Error("Missing token");
      setToken(response.token); setMode(response.moderationEnabled); setNeedsTokenRefresh(false); setTokenError("");
      readyAt.current = Date.now() + Math.max(0, response.minimumWaitMs ?? 3000);
    } catch (reason) {
      if (signal.aborted) return;
      setToken(null);
      setTokenError(socialErrorMessage(reason, "Не удалось подготовить отправку. Проверьте подключение и повторите."));
    } finally { if (!signal.aborted) setTokenLoading(false); }
  }, [slug]);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => { if (replyTo) textareaRef.current?.focus(); }, [replyTo]);

  const refreshForm = () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller; requested.current = true;
    setTokenLoading(true); setToken(null); setTokenError(""); setError("");
    void requestForm(controller.signal);
  };
  const activate = () => {
    setExpanded(true);
    if (!requested.current) refreshForm();
  };
  const showError = (message: string, errors: FormErrors = {}) => {
    setError(message); setFieldErrors(errors);
    window.requestAnimationFrame(() => errorRef.current?.focus());
  };
  const chooseIdentity = (named: boolean) => {
    setWithName(named);
    if (!named) setDisplayName("");
    if (fieldErrors.displayName && !fieldErrors.content) setError("");
    setFieldErrors(previous => ({ ...previous, displayName: undefined }));
    setSuccess("");
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || tokenLoading || !token || needsTokenRefresh) return;
    const errors: FormErrors = {};
    const chosenName = withName ? displayName : "";
    const nameError = validateDisplayName(chosenName);
    if (nameError) errors.displayName = nameError;
    if (content.trim().length < 3 || content.trim().length > 2000) errors.content = "Комментарий должен содержать от 3 до 2 000 символов.";
    if (Object.keys(errors).length) { showError("Проверьте отмеченные поля.", errors); return; }
    const payload = { displayName: chosenName.trim() ? normalizeDisplayName(chosenName) : "", content: content.trim(), token, parentId: replyTo?.id ?? null, website: String(new FormData(event.currentTarget).get("website") || "") };
    setPending(true); setError(""); setSuccess(""); setFieldErrors({});
    try {
      const delay = readyAt.current - Date.now();
      if (delay > 0) await new Promise(resolve => window.setTimeout(resolve, delay));
      const response = await sendPublicationComment(slug, payload);
      if (response.success !== true || !["PENDING", "APPROVED"].includes(response.status)) throw new Error("Unconfirmed comment");
      setContent(""); setSuccess(response.status === "APPROVED" ? "Комментарий опубликован." : "Комментарий отправлен на модерацию и появится после одобрения.");
      onCancelReply();
      if (response.status === "APPROVED") announceCommentsRefresh(slug, payload.parentId);
      refreshForm();
    } catch (reason) {
      if (reason instanceof SocialApiError) {
        if (reason.status === 403 || reason.fieldErrors.token) setNeedsTokenRefresh(true);
        const field = (key: string) => { const value = reason.fieldErrors[key]; return Array.isArray(value) ? value.join(" ") : value; };
        showError(reason.message, { displayName: field("displayName"), content: field("content") });
      } else showError("Не удалось получить подтверждение. Имя и текст остались в форме — проверьте подключение и отправьте ещё раз.");
    } finally { setPending(false); }
  };

  return <form className={`sc-composer${expanded ? " is-expanded" : ""}`} onSubmit={submit} noValidate aria-busy={pending}>
    {success && <p className="sc-success" role="status"><Icon name="check" size={17} />{success}</p>}
    {replyTo && <div className="sc-reply-target"><span>Ответ для <strong>{replyTo.displayName}</strong></span><button type="button" disabled={pending} onClick={onCancelReply} aria-label="Отменить ответ"><Icon name="close" size={17} /></button></div>}
    {error && <div className="sc-error" role="alert" ref={errorRef} tabIndex={-1}><p>{error}</p>{needsTokenRefresh && <button type="button" className="sc-text-button" disabled={tokenLoading} onClick={refreshForm}>Обновить защиту формы — текст сохранится</button>}</div>}
    <label className="sr-only" htmlFor={`${formId}-content`}>{replyTo ? "Текст ответа" : "Ваш комментарий"}</label>
    <textarea ref={textareaRef} id={`${formId}-content`} className="sc-compose-text" name="content" value={content} onFocus={activate} onChange={(event) => { setContent(event.target.value); setSuccess(""); setFieldErrors(previous => ({ ...previous, content: undefined })); }} required minLength={3} maxLength={2000} disabled={pending} rows={expanded ? 3 : 1} placeholder={replyTo ? "Написать ответ…" : "Написать комментарий…"} aria-invalid={Boolean(fieldErrors.content)} aria-describedby={`${formId}-content-error`} />
    {fieldErrors.content && <p className="sc-field-error" id={`${formId}-content-error`}>{fieldErrors.content}</p>}
    {expanded && <div className="sc-composer-options">
      <div className="sc-identity-choice" role="group" aria-label="Подпись комментария" aria-describedby={`${formId}-identity-hint`}>
        <button type="button" aria-pressed={!withName} disabled={pending} onClick={() => chooseIdentity(false)}>Без имени</button>
        <button type="button" aria-pressed={withName} disabled={pending} onClick={() => chooseIdentity(true)}>С именем</button>
      </div>
      <p className="sc-identity-hint" id={`${formId}-identity-hint`}>Имя можно не указывать.{!withName && <> Подпись: «{ANONYMOUS_DISPLAY_NAME}».</>}</p>
      {withName && <div className="sc-name-field"><label htmlFor={`${formId}-name`}>Имя или псевдоним <span className="sc-name-optional">(необязательно)</span></label><input id={`${formId}-name`} name="displayName" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setFieldErrors(previous => ({ ...previous, displayName: undefined })); }} minLength={2} maxLength={60} disabled={pending} autoComplete="nickname" placeholder={ANONYMOUS_DISPLAY_NAME} aria-invalid={Boolean(fieldErrors.displayName)} aria-describedby={`${formId}-identity-hint ${formId}-name-error`} /></div>}
      {fieldErrors.displayName && <p id={`${formId}-name-error`} className="sc-field-error">{fieldErrors.displayName}</p>}
      <div className="sc-composer-bottom"><span>{mode === null ? "Готовим отправку…" : mode ? "Сначала проверит редакция" : "Комментарий появится сразу"}<span className="sc-text-count"> · {content.length} / 2 000</span></span><button type="submit" className="sc-submit" disabled={pending || tokenLoading || !token || needsTokenRefresh}>{pending ? "Отправляем…" : "Отправить"}</button></div>
    </div>}
    <div className="sc-bot-field" aria-hidden="true"><label htmlFor={`${formId}-website`}>Ваш сайт</label><input id={`${formId}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
    {tokenError && <div className="sc-error" role="alert"><p>{tokenError}</p><button type="button" className="sc-text-button" onClick={refreshForm} disabled={tokenLoading}>Повторить подготовку</button></div>}
    <span className="sr-only" role="status">{pending ? "Идёт отправка комментария." : ""}</span>
    <noscript><p className="sc-field-error">Для комментариев включите JavaScript в браузере.</p></noscript>
  </form>;
}

export function PublicationComments({ slug, compact = false }: { slug: string; compact?: boolean }) {
  const [result, setResult] = useState<CommentsPage | null>(null);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(!compact);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headingId = useId();

  useEffect(() => {
    const controller = new AbortController();
    void getPublicationComments(slug, page, controller.signal, { preview: compact && !expanded }).then(data => {
      if (controller.signal.aborted) return;
      setResult(data); setError("");
      announceSocialUpdate(slug, { commentCount: data.total });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(socialErrorMessage(reason, "Не удалось загрузить комментарии. Попробуйте ещё раз."));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, page, reload, compact, expanded]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ slug: string; parentId: string | null }>).detail;
      if (detail?.slug !== slug) return;
      if (expanded && !detail.parentId) setPage(999999);
      setLoading(true); setReload(value => value + 1);
    };
    const open = (event: Event) => {
      if ((event as CustomEvent<{ slug: string }>).detail?.slug !== slug) return;
      setExpanded(true); setLoading(true); setPage(1); setReload(value => value + 1);
      window.requestAnimationFrame(() => {
        const textarea = sectionRef.current?.querySelector<HTMLTextAreaElement>(".sc-compose-text");
        textarea?.focus({ preventScroll: true });
        textarea?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      });
    };
    window.addEventListener(COMMENTS_REFRESH_EVENT, refresh);
    window.addEventListener("my-kineshma:open-comments", open);
    return () => { window.removeEventListener(COMMENTS_REFRESH_EVENT, refresh); window.removeEventListener("my-kineshma:open-comments", open); };
  }, [slug, expanded]);

  const refresh = () => { setLoading(true); setReload(value => value + 1); };
  const showAll = () => { setExpanded(true); setPage(1); setLoading(true); };
  const changePage = (next: number) => { setPage(next); setLoading(true); };

  return <section ref={sectionRef} id={compact ? `comments-${slug}` : "comments"} className={`sc-comments${compact ? " sc-comments--compact" : ""}`} aria-labelledby={headingId}>
    <div className="sc-heading"><h2 id={headingId}>Комментарии{result && <span className="sc-total">{result.total.toLocaleString("ru-RU")}</span>}</h2><button type="button" className="sc-refresh" disabled={loading} onClick={refresh} aria-label="Обновить комментарии">Обновить</button></div>
    <div className="sc-comment-feed" aria-busy={loading}>
      {loading && !result && <p className="sc-list-status" role="status">Загружаем комментарии…</p>}
      {error && <div className="sc-error" role="alert"><p>{error}</p><button type="button" className="sc-text-button" onClick={refresh} disabled={loading}>Повторить</button></div>}
      {result && result.items.length > 0 && <ol className="sc-comment-list">{result.items.map(comment => <CommentThread key={comment.id} comment={comment} slug={slug} onReply={setReplyTo} />)}</ol>}
      {!loading && !error && result?.total === 0 && <p className="sc-empty">Будьте первым, кто поделится мнением.</p>}
      {compact && !expanded && result && result.total > result.items.reduce((count, item) => count + 1 + item.replies.length, 0) && <button type="button" className="sc-show-all" onClick={showAll}>Посмотреть все комментарии ({result.total})</button>}
      {expanded && result && result.totalPages > 1 && <nav className="sc-pagination" aria-label="Страницы обсуждения"><button type="button" disabled={loading || result.page <= 1} onClick={() => changePage(result.page - 1)}>Назад</button><span>{result.page} / {result.totalPages}</span><button type="button" disabled={loading || result.page >= result.totalPages} onClick={() => changePage(result.page + 1)}>Далее</button></nav>}
      {compact && expanded && <button type="button" className="sc-show-all" onClick={() => { setExpanded(false); setPage(1); setLoading(true); }}>Свернуть обсуждение</button>}
    </div>
    <CommentComposer slug={slug} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
  </section>;
}
