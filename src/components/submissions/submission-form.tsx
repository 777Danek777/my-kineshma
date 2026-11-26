"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { normalizeDisplayName, validateDisplayName } from "@/lib/display-name";

type Attachment = { file: File; preview: string };
type Field = "title" | "content" | "photos" | "video" | "displayName" | "contact";
type Result = { token?: string; minDelayMs?: number; moderationEnabled?: boolean; success?: boolean; status?: "PENDING" | "APPROVED"; message?: string; post?: { slug: string }; error?: string; fieldErrors?: Record<string, string | string[]> };
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);

function VideoIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none" /></svg>;
}

export function SubmissionForm() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [contact, setContact] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [extra, setExtra] = useState(false);
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [video, setVideo] = useState<Attachment | null>(null);
  const [processing, setProcessing] = useState(false);
  const [token, setToken] = useState("");
  const [moderationEnabled, setModerationEnabled] = useState(true);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [success, setSuccess] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [notice, setNotice] = useState("");
  const photosRef = useRef<Attachment[]>([]);
  const videoRef = useRef<Attachment | null>(null);
  const mounted = useRef(true);
  const readyAt = useRef(0);
  const tokenRequest = useRef<AbortController | null>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const disabled = pending || processing;

  const requestToken = useCallback((signal: AbortSignal) => {
    return fetch("/api/submissions/form", { cache: "no-store", credentials: "same-origin", signal }).then(async response => {
      const result = await response.json().catch(() => null) as Result | null;
      if (signal.aborted) return;
      if (!response.ok || !result?.token) throw new Error(result?.error || "Не удалось подготовить форму.");
      setToken(result.token); setModerationEnabled(result.moderationEnabled !== false);
      readyAt.current = Date.now() + Math.max(0, result.minDelayMs ?? 3000);
      setTokenError(""); setNeedsRefresh(false);
    }).catch(reason => {
      if (!signal.aborted) { setToken(""); setTokenError(reason instanceof Error ? reason.message : "Нет связи с сайтом. Попробуйте ещё раз."); }
    }).finally(() => { if (!signal.aborted) setTokenLoading(false); });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(); tokenRequest.current = controller;
    void requestToken(controller.signal);
    return () => {
      mounted.current = false; tokenRequest.current?.abort(); uploadRequest.current?.abort();
      photosRef.current.forEach(photo => URL.revokeObjectURL(photo.preview));
      if (videoRef.current) URL.revokeObjectURL(videoRef.current.preview);
    };
  }, [requestToken]);
  useEffect(() => { if (success) successRef.current?.focus(); }, [success]);
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  function refreshToken() {
    tokenRequest.current?.abort(); const controller = new AbortController(); tokenRequest.current = controller;
    setTokenLoading(true); setTokenError(""); setToken(""); void requestToken(controller.signal);
  }
  function clearField(field: Field) { setFieldErrors(current => ({ ...current, [field]: undefined })); setError(""); }
  function showError(message: string, fields: Partial<Record<Field, string>> = {}) {
    setError(message); setFieldErrors(fields); if (fields.title || fields.contact) setExtra(true);
    window.requestAnimationFrame(() => errorRef.current?.focus());
  }
  async function addPhotos(files: File[]) {
    if (!files.length || disabled) return;
    if (photosRef.current.length + files.length > 4) { showError("Можно прикрепить до четырёх фотографий.", { photos: "Уберите лишнее фото или выберите меньше файлов." }); return; }
    if (files.some(file => !PHOTO_TYPES.has(file.type) || !file.size || file.size > 5 * 1024 * 1024)) { showError("Выберите JPEG, PNG или WebP до 5 МБ каждый.", { photos: "Файл должен быть непустым и не больше 5 МБ." }); return; }
    setProcessing(true); clearField("photos"); const added: Attachment[] = [];
    try {
      for (const file of files) {
        const item = { file, preview: URL.createObjectURL(file) }; added.push(item);
        const image = new window.Image(); image.src = item.preview; await image.decode();
        if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 20_000_000) throw new Error("Уменьшите фотографию: максимум 20 мегапикселей.");
      }
      if (!mounted.current) { added.forEach(item => URL.revokeObjectURL(item.preview)); return; }
      photosRef.current = [...photosRef.current, ...added]; setPhotos(photosRef.current); setNotice(`Добавлено фото: ${photosRef.current.length} из 4.`);
    } catch (reason) {
      added.forEach(item => URL.revokeObjectURL(item.preview));
      if (mounted.current) showError(reason instanceof Error && reason.message.includes("мегапикселей") ? reason.message : "Не удалось открыть фото. Выберите исправный JPEG, PNG или WebP.");
    } finally { if (mounted.current) setProcessing(false); }
  }
  function addVideo(file?: File) {
    if (!file || disabled) return;
    if (!VIDEO_TYPES.has(file.type) || !file.size || file.size > 50 * 1024 * 1024) { showError("Подойдёт одно видео MP4 или WebM до 50 МБ.", { video: "Проверьте формат и размер видео." }); return; }
    if (videoRef.current) URL.revokeObjectURL(videoRef.current.preview);
    videoRef.current = { file, preview: URL.createObjectURL(file) }; setVideo(videoRef.current); clearField("video"); setNotice("Видео прикреплено.");
  }
  function removePhoto(index: number) {
    URL.revokeObjectURL(photosRef.current[index].preview);
    photosRef.current = photosRef.current.filter((_, position) => position !== index); setPhotos(photosRef.current); clearField("photos");
  }
  function removeVideo() { if (videoRef.current) URL.revokeObjectURL(videoRef.current.preview); videoRef.current = null; setVideo(null); clearField("video"); }
  function send(body: FormData) {
    return new Promise<{ status: number; result: Result }>((resolve, reject) => {
      const request = new XMLHttpRequest(); uploadRequest.current = request;
      request.open("POST", "/api/submissions"); request.responseType = "json"; request.timeout = 120_000;
      request.upload.onprogress = event => { if (mounted.current && event.lengthComputable) setProgress(Math.min(100, Math.round(event.loaded / event.total * 100))); };
      request.onload = () => resolve({ status: request.status, result: request.response ?? {} });
      request.onerror = () => reject(new Error("Нет подтверждения отправки. Проверьте соединение и отправьте ту же форму ещё раз."));
      request.ontimeout = () => reject(new Error("Загрузка заняла слишком много времени. Проверьте соединение или уменьшите видео."));
      request.onabort = () => reject(new Error("Отправка прервана.")); request.send(body);
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || tokenLoading || !token || needsRefresh) return;
    if (!title.trim() && !content.trim() && !photos.length && !video) { showError("Добавьте текст, фотографию или видео — и можно отправлять."); return; }
    const chosenName = anonymous ? "" : displayName;
    const nameError = validateDisplayName(chosenName);
    if (nameError) { showError("Проверьте имя или отправьте публикацию анонимно.", { displayName: nameError }); return; }
    const body = new FormData(); body.set("title", title.trim()); body.set("content", content.trim()); body.set("token", token);
    body.set("anonymous", String(anonymous)); body.set("displayName", chosenName.trim() ? normalizeDisplayName(chosenName) : ""); body.set("contact", contact.trim());
    if (contact.trim()) body.set("contactConsent", "true");
    body.set("website", String(new FormData(event.currentTarget).get("website") ?? ""));
    photos.forEach(photo => body.append("photos", photo.file)); if (video) body.append("video", video.file);
    setPending(true); setProgress(0); setError(""); setFieldErrors({});
    try {
      const wait = readyAt.current - Date.now(); if (wait > 0) await new Promise(resolve => window.setTimeout(resolve, wait));
      if (!mounted.current) return;
      const { status, result } = await send(body); if (!mounted.current) return;
      if (status < 200 || status >= 300 || !result.success || !["PENDING", "APPROVED"].includes(result.status ?? "")) {
        const fields: Partial<Record<Field, string>> = {};
        for (const field of ["title", "content", "photos", "video", "displayName", "contact"] as const) { const value = result.fieldErrors?.[field]; if (value) fields[field] = Array.isArray(value) ? value.join(" ") : value; }
        if (result.fieldErrors?.token || status === 403) setNeedsRefresh(true);
        showError(result.error || (status === 413 ? "Вложения слишком большие. Фото — до 5 МБ, видео — до 50 МБ." : "Не удалось отправить публикацию. Попробуйте ещё раз."), fields); return;
      }
      setSuccess(result); setTitle(""); setContent(""); setDisplayName(""); setContact(""); setToken("");
      photosRef.current.forEach(photo => URL.revokeObjectURL(photo.preview)); photosRef.current = []; setPhotos([]); removeVideo();
    } catch (reason) { if (mounted.current) showError(reason instanceof Error ? reason.message : "Не удалось отправить публикацию."); }
    finally { if (mounted.current) setPending(false); uploadRequest.current = null; }
  }

  if (success) return <div className="suggest-success" role="status" ref={successRef} tabIndex={-1}><span className="suggest-success-icon"><Icon name="check" size={30} /></span><h2>{success.status === "APPROVED" ? success.post?.slug ? "Ваша публикация в ленте" : "Публикация принята" : "Спасибо! История у редакции"}</h2><p>{success.message || (success.status === "APPROVED" ? success.post?.slug ? "Публикация уже доступна читателям." : "Материал сохранён на сайте." : "Мы рассмотрим материал. Пока он виден только редакции.")}</p><div className="suggest-success-actions">{success.status === "APPROVED" && success.post?.slug ? <Link className="button button-primary" href={`/news/${encodeURIComponent(success.post.slug)}`}>Открыть публикацию</Link> : <Link className="button button-primary" href="/">В ленту города</Link>}<button className="button button-secondary" type="button" onClick={() => { setSuccess(null); setExtra(false); setNotice(""); refreshToken(); }}>Поделиться ещё</button></div></div>;

  return <form className="suggest-composer" onSubmit={submit} noValidate aria-busy={pending}>
    <div className="suggest-composer-author"><span className="suggest-composer-avatar">{anonymous ? "?" : displayName.trim().slice(0, 1).toLocaleUpperCase("ru-RU") || "Я"}</span><div><strong>{anonymous ? "Анонимная публикация" : displayName.trim() || "Публикация от жителя"}</strong><span>В городское сообщество</span></div><span className="suggest-composer-tag">Моя Кинешма</span></div>
    {error && <div className="suggest-error-summary" role="alert" ref={errorRef} tabIndex={-1}><strong>Пока не получилось</strong><p>{error}</p>{needsRefresh && <button type="button" className="suggest-inline-button" disabled={tokenLoading || pending} onClick={refreshToken}>Обновить защиту формы</button>}</div>}
    <label className="sr-only" htmlFor="suggest-content">Текст публикации, необязательно</label><textarea id="suggest-content" className="suggest-composer-text" value={content} maxLength={20000} rows={4} disabled={disabled} onChange={event => { setContent(event.target.value); clearField("content"); }} placeholder="Что нового, Кинешма? Расскажите историю или просто добавьте фото…" aria-invalid={Boolean(fieldErrors.content)} />
    {fieldErrors.content && <p className="suggest-field-error">{fieldErrors.content}</p>}
    {(photos.length > 0 || video) && <div className="suggest-attachments">{photos.map((photo, index) => <div className="suggest-photo" key={photo.preview}><Image src={photo.preview} alt={`Выбранная фотография ${index + 1}`} fill unoptimized sizes="(max-width: 600px) 42vw, 170px" /><button type="button" disabled={disabled} onClick={() => removePhoto(index)} aria-label={`Убрать фотографию ${index + 1}`}><Icon name="close" size={17} /></button></div>)}{video && <div className="suggest-video"><video src={video.preview} controls preload="metadata" playsInline /><div><span>{video.file.name} · {(video.file.size / 1024 / 1024).toFixed(1)} МБ</span><button type="button" disabled={disabled} onClick={removeVideo}>Убрать видео</button></div></div>}</div>}
    <div className="suggest-compose-tools"><label className={`suggest-attach-button${disabled || photos.length === 4 ? " is-disabled" : ""}`}><Icon name="camera" size={21} /><span>Фото</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || photos.length === 4} aria-label="Добавить фотографии" onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addPhotos(files); }} /></label><label className={`suggest-attach-button${disabled ? " is-disabled" : ""}`}><VideoIcon /><span>{video ? "Заменить видео" : "Видео"}</span><input type="file" accept="video/mp4,video/webm" disabled={disabled} aria-label="Добавить видео" onChange={event => { addVideo(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label><button type="button" className={`suggest-extra-button${extra ? " is-active" : ""}`} aria-expanded={extra} aria-controls="suggest-extra" disabled={disabled} onClick={() => setExtra(!extra)}>Дополнительно <Icon name="chevron" size={15} /></button></div>
    {(fieldErrors.photos || fieldErrors.video) && <p className="suggest-field-error">{fieldErrors.photos || fieldErrors.video}</p>}<p className="suggest-file-hint">До 4 фото по 5 МБ · видео MP4/WebM до 50 МБ и 10 мин</p>
    {extra && <div id="suggest-extra" className="suggest-extra"><label htmlFor="suggest-title">Заголовок <span>необязательно</span><input id="suggest-title" value={title} maxLength={180} disabled={disabled} onChange={event => { setTitle(event.target.value); clearField("title"); }} placeholder="Если хочется выделить главное" aria-invalid={Boolean(fieldErrors.title)} />{fieldErrors.title && <span className="suggest-field-error">{fieldErrors.title}</span>}</label><label htmlFor="suggest-contact">Контакт для редакции <span>необязательно, на сайте не появится</span><input id="suggest-contact" value={contact} maxLength={200} disabled={disabled} onChange={event => { setContact(event.target.value); clearField("contact"); }} placeholder="Телефон, почта или профиль" aria-invalid={Boolean(fieldErrors.contact)} />{fieldErrors.contact && <span className="suggest-field-error">{fieldErrors.contact}</span>}</label></div>}
    <div className="suggest-identity"><div className="suggest-identity-switch" role="group" aria-label="Как подписать публикацию"><button type="button" disabled={disabled} aria-pressed={anonymous} className={anonymous ? "is-active" : ""} onClick={() => setAnonymous(true)}>Анонимно</button><button type="button" disabled={disabled} aria-pressed={!anonymous} className={!anonymous ? "is-active" : ""} onClick={() => setAnonymous(false)}>От своего имени</button></div>{anonymous ? <p className="suggest-identity-note">Имя не будет видно. Контакт, если укажете, — только редакции.</p> : <label className="suggest-name-label" htmlFor="suggest-display-name"><span className="sr-only">Имя в публикации, необязательно</span><input id="suggest-display-name" value={displayName} maxLength={60} disabled={disabled} onChange={event => { setDisplayName(event.target.value); clearField("displayName"); }} placeholder="Имя или псевдоним (необязательно)" aria-invalid={Boolean(fieldErrors.displayName)} /><span>Это имя будет видно читателям. Можно оставить пустым.</span>{fieldErrors.displayName && <span className="suggest-field-error">{fieldErrors.displayName}</span>}</label>}</div>
    <div className="suggest-bot-field" aria-hidden="true"><label htmlFor="suggest-website">Ваш сайт</label><input id="suggest-website" name="website" tabIndex={-1} autoComplete="off" /></div>
    {tokenError && <div className="suggest-token-error" role="alert"><p>{tokenError}</p><button type="button" className="suggest-inline-button" onClick={refreshToken} disabled={tokenLoading}>Подготовить форму ещё раз</button></div>}
    {pending && <div className="suggest-upload-progress" role="status"><progress max={100} value={progress} /><span>{progress < 100 ? `Отправляем${photos.length || video ? ` · ${progress}%` : "…"}` : "Материал получен, завершаем обработку…"}</span></div>}
    <div className="suggest-composer-bottom"><p><Icon name={moderationEnabled ? "clock" : "check"} size={17} />{tokenLoading ? "Уточняем условия публикации…" : moderationEnabled ? "Сначала проверка редакции" : "Публикация сразу появится в ленте"}</p><button type="submit" className="button button-primary suggest-submit" disabled={disabled || tokenLoading || !token || needsRefresh}>{pending ? "Отправляем…" : processing ? "Проверяем фото…" : moderationEnabled ? "Отправить" : "Опубликовать"}<Icon name="chevron" size={18} /></button></div>
    <span className="suggest-live-status" role="status">{notice}</span><noscript><p className="suggest-field-error">Для отправки включите JavaScript в браузере.</p></noscript>
  </form>;
}
