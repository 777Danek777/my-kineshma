"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ThemeSelect } from "@/components/ui/theme-select";
import { AdminApiError, adminFetch, errorMessage } from "./api";
import { AdminIcon, AdminLoading, AdminNotice, PageHeading } from "./ui";
import { dateLabel, type AdminCategory, type AdminImage } from "./types";
import { type AdminSubmission, SubmissionBadge } from "./submissions-types";

type EditorFields = { title: string; content: string; categoryId: string; images: AdminImage[]; videos: AdminImage[] };
type LoadedData = { submission: AdminSubmission; categories: AdminCategory[]; revision: number; id: string };

function fieldsFrom(submission: AdminSubmission): EditorFields {
  return { title: submission.title, content: submission.content, categoryId: submission.categoryId ?? "", images: submission.images, videos: submission.videos ?? [] };
}

function snapshot(fields: EditorFields) {
  return JSON.stringify({ title: fields.title, content: fields.content, categoryId: fields.categoryId, imageIds: fields.images.map((image) => image.id), videoIds: fields.videos.map(video => video.id) });
}

export function SubmissionEditorLoader({ id }: { id: string }) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [error, setError] = useState<{ message: string; revision: number; id: string } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      adminFetch<{ submission: AdminSubmission }>(`/api/admin/submissions/${id}`, { signal: controller.signal }),
      adminFetch<{ categories: AdminCategory[] }>("/api/admin/categories", { signal: controller.signal }),
    ]).then(([submission, categories]) => {
      if (!controller.signal.aborted) setData({ submission: submission.submission, categories: categories.categories, revision, id });
    }).catch((error) => {
      if (!controller.signal.aborted) setError({ message: errorMessage(error), revision, id });
    });
    return () => controller.abort();
  }, [id, revision]);

  if (error?.revision === revision && error.id === id) return <><PageHeading eyebrow="ВХОДЯЩИЕ ЗАЯВКИ" title="Не удалось открыть заявку" description="Повторите попытку или вернитесь ко входящим." /><AdminNotice>{error.message}</AdminNotice><div className="adm-button-row"><button className="adm-button" onClick={() => setRevision(revision + 1)}>Повторить</button><Link href="/admin/submissions" className="adm-button">К заявкам</Link></div></>;
  if (!data || data.revision !== revision || data.id !== id) return <AdminLoading />;
  return <SubmissionEditor key={`${id}:${revision}`} initialSubmission={data.submission} categories={data.categories} reload={() => setRevision(revision + 1)} />;
}

function SubmissionEditor({ initialSubmission, categories, reload }: { initialSubmission: AdminSubmission; categories: AdminCategory[]; reload: () => void }) {
  const router = useRouter();
  const [submission, setSubmission] = useState(initialSubmission);
  const [fields, setFields] = useState(() => fieldsFrom(initialSubmission));
  const [baseline, setBaseline] = useState(() => snapshot(fieldsFrom(initialSubmission)));
  const [pending, setPending] = useState<"save" | "approve" | "reject" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(initialSubmission.status === "APPROVED");
  const allowLeave = useRef(false);
  const dirty = snapshot(fields) !== baseline;
  const approved = submission.status === "APPROVED";
  const disabled = pending !== null || approved;

  useEffect(() => {
    if (!dirty && !pending) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (allowLeave.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function beforeNavigate(event: MouseEvent) {
      if (allowLeave.current || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(pending ? "Действие ещё выполняется. Уйти со страницы?" : "Есть несохранённые изменения. Уйти со страницы и потерять их?")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeNavigate, true);
    };
  }, [dirty, pending]);

  function updateField<K extends keyof EditorFields>(key: K, value: EditorFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
    setSuccess("");
  }

  function validate(publishing: boolean) {
    const errors: Record<string, string> = {};
    if (fields.title.trim().length > 180) errors.title = "Заголовок — до 180 символов.";
    if (fields.content.trim().length > 20000) errors.content = "Текст — до 20 000 символов.";
    if (!fields.title.trim() && !fields.content.trim() && !fields.images.length && !fields.videos.length) errors.content = "Оставьте хотя бы текст, заголовок, фотографию или видео.";
    if (publishing && !fields.categoryId) errors.categoryId = "Выберите категорию для публикации.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError("Проверьте отмеченные поля.");
      if (preview && (errors.title || errors.content)) setPreview(false);
      return false;
    }
    return true;
  }

  function acceptSaved(next: AdminSubmission) {
    const nextFields = fieldsFrom(next);
    setSubmission(next);
    setFields(nextFields);
    setBaseline(snapshot(nextFields));
    setConflict(false);
  }

  async function save(publish: boolean) {
    if (pending || approved || !validate(publish)) return;
    if (publish && !window.confirm(`Одобрить и опубликовать «${fields.title.trim() || "Без заголовка"}»? Материал и публичное имя автора, если оно указано, станут видны читателям. Контакт останется только редакции.`)) return;
    setPending(publish ? "approve" : "save");
    setError("");
    setSuccess("");
    setConflict(false);
    try {
      const result = await adminFetch<{ submission: AdminSubmission }>(`/api/admin/submissions/${submission.id}${publish ? "/approve" : ""}`, {
        method: publish ? "POST" : "PATCH",
        body: JSON.stringify({ version: submission.version, title: fields.title.trim(), content: fields.content.trim(), categoryId: fields.categoryId || null, imageIds: fields.images.map((image) => image.id), videoIds: fields.videos.map(video => video.id) }),
      });
      acceptSaved(result.submission);
      setSuccess(publish ? "Заявка одобрена. Новость опубликована на сайте." : "Изменения сохранены. Новость ещё не опубликована.");
      if (publish) setPreview(true);
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof AdminApiError) {
        setFieldErrors(error.fieldErrors ?? {});
        setConflict(error.status === 409);
      }
    } finally {
      setPending(null);
    }
  }

  async function reject() {
    if (pending || approved || submission.status === "REJECTED") return;
    if (!window.confirm(dirty ? "Отклонить заявку? Несохранённые изменения не сохранятся. Заявка останется во входящих, новость не будет опубликована." : "Отклонить заявку? Она останется в разделе «Отклонённые». Новость не будет опубликована.")) return;
    setPending("reject");
    setError("");
    setSuccess("");
    setConflict(false);
    try {
      const result = await adminFetch<{ submission: AdminSubmission }>(`/api/admin/submissions/${submission.id}/reject`, { method: "POST", body: JSON.stringify({ version: submission.version }) });
      acceptSaved(result.submission);
      setSuccess("Заявка отклонена. Она сохранена в кабинете и не видна читателям.");
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof AdminApiError) setConflict(error.status === 409);
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (pending) return;
    if (!window.confirm(approved ? "Удалить заявку и сведения об отправителе? Созданная публикация сохранится в разделе «Публикации». Удаление заявки нельзя отменить." : "Удалить заявку вместе с вложениями и сведениями об отправителе? Это действие нельзя отменить.")) return;
    setPending("delete");
    setError("");
    setSuccess("");
    setConflict(false);
    try {
      await adminFetch(`/api/admin/submissions/${submission.id}`, { method: "DELETE", body: JSON.stringify({ version: submission.version }) });
      allowLeave.current = true;
      router.replace("/admin/submissions?status=ALL");
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof AdminApiError) setConflict(error.status === 409);
      setPending(null);
    }
  }

  function reloadLatest() {
    if (dirty && !window.confirm("Загрузить свежую версию заявки? Ваши несохранённые изменения будут потеряны.")) return;
    reload();
  }

  return (
    <>
      <Link className="adm-editor-back" href="/admin/submissions">← Ко входящим заявкам</Link>
      <PageHeading eyebrow="РЕДАКЦИОННАЯ ПРОВЕРКА" title="Заявка читателя" description="Проверьте факты и фотографии, отредактируйте текст перед публикацией." action={<span className={`adm-save-indicator${dirty ? " is-dirty" : ""}`} role="status">{pending ? "Выполняем действие…" : dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}</span>} />
      {error && <AdminNotice>{error}{conflict && <> <button className="adm-inline-button" type="button" disabled={pending !== null} onClick={reloadLatest}>Загрузить свежую версию</button></>}</AdminNotice>}
      {success && <AdminNotice kind="success">{success}</AdminNotice>}
      {approved && <AdminNotice kind="info">Из этой заявки уже создана публикация. Дальнейшие изменения вносите в ней. {submission.post && <Link className="adm-text-link" href={`/admin/posts/${submission.post.id}`}>Редактировать публикацию →</Link>}</AdminNotice>}
      {submission.status === "REJECTED" && <AdminNotice kind="info">Заявка отклонена и не видна читателям. Если решение изменилось, отредактируйте материал и одобрите его.</AdminNotice>}
      <form className="adm-submission-editor-layout" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
        <div className="adm-submission-main">
          <section className="adm-panel adm-panel-pad">
            <div className="adm-editor-section-heading"><h2>Материал для публикации</h2><div className="adm-editor-toggle" role="group" aria-label="Режим просмотра"><button type="button" className={!preview ? "is-active" : ""} onClick={() => setPreview(false)}>{approved ? "Текст заявки" : "Редактирование"}</button><button type="button" className={preview ? "is-active" : ""} onClick={() => setPreview(true)}>Предпросмотр</button></div></div>
            {preview ? <article className="adm-article-preview">
              {fields.categoryId && <span className="adm-preview-category">{categories.find((category) => category.id === fields.categoryId)?.name ?? submission.category?.name}</span>}
              {fields.title && <h2>{fields.title}</h2>}
              {fields.images[0] && (
                // Private submission media must keep the current authenticated session.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="adm-preview-cover" src={fields.images[0].url} width={fields.images[0].width} height={fields.images[0].height} alt={fields.images[0].alt || "Обложка новости"} />
              )}
              <p className="adm-preview-content">{fields.content}</p>
              {fields.videos.map(video => <video key={video.id} className="adm-attached-video" src={video.url} controls playsInline preload="metadata" />)}
              <p className="adm-field-hint">Предпросмотр материала. Контактные данные отправителя в публикацию не добавляются.</p>
            </article> : <div className="adm-submission-fields">
              <label className="adm-field" htmlFor="submission-title">Заголовок <span className="adm-field-hint">необязательно</span><input className="adm-title-input" id="submission-title" name="title" value={fields.title} maxLength={180} disabled={disabled} aria-invalid={Boolean(fieldErrors.title)} aria-describedby="submission-title-help" onChange={(event) => updateField("title", event.target.value)} /><span id="submission-title-help" className={fieldErrors.title ? "adm-field-error" : "adm-field-hint"}>{fieldErrors.title || `${fields.title.length} / 180 символов`}</span></label>
              <label className="adm-field" htmlFor="submission-content">Текст публикации <span className="adm-field-hint">необязательно</span><textarea id="submission-content" name="content" value={fields.content} maxLength={20000} rows={16} disabled={disabled} aria-invalid={Boolean(fieldErrors.content)} aria-describedby="submission-content-help" onChange={(event) => updateField("content", event.target.value)} /><span id="submission-content-help" className={fieldErrors.content ? "adm-field-error" : "adm-field-hint"}>{fieldErrors.content || `${fields.content.length.toLocaleString("ru-RU")} / 20 000 символов. Для нового абзаца нажмите Enter дважды.`}</span></label>
            </div>}
          </section>
          <section className="adm-panel adm-panel-pad">
            <div className="adm-submission-section-heading"><div><h2>Фотографии читателя</h2><p className="adm-field-hint">{fields.images.length ? "Первая фотография станет обложкой. Нажмите на фото, чтобы рассмотреть его." : "В заявке нет выбранных фотографий."}</p></div><span className="adm-submission-photo-count">{fields.images.length} фото</span></div>
            {fields.images.length > 0 && <div className="adm-submission-photo-grid">{fields.images.map((photo, index) => <div className="adm-submission-photo" key={photo.id}>
              <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Открыть фотографию ${index + 1} в новой вкладке`}>
                {/* Authenticated images are intentionally rendered without Next image optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} width={photo.width} height={photo.height} alt={photo.alt || `Фотография ${index + 1} к заявке`} />
                {index === 0 && <span className="adm-cover-label">Обложка</span>}
                <span className="adm-submission-photo-zoom"><AdminIcon name="external" size={17} /></span>
              </a>
              {!approved && <div className="adm-submission-photo-actions"><button type="button" disabled={pending !== null || index === 0} onClick={() => updateField("images", [photo, ...fields.images.filter((image) => image.id !== photo.id)])}>{index === 0 ? "Обложка" : "На обложку"}</button><button type="button" disabled={pending !== null} className="adm-danger-text" aria-label={`Убрать фотографию ${index + 1}`} onClick={() => updateField("images", fields.images.filter((image) => image.id !== photo.id))}><AdminIcon name="trash" size={17} />Убрать</button></div>}
            </div>)}</div>}
            {fieldErrors.imageIds && <p className="adm-field-error">{fieldErrors.imageIds}</p>}
            {!approved && <p className="adm-submission-photo-note">Уберите фотографии, которые не должны попасть на сайт. Изменения применятся после сохранения или публикации.</p>}
          </section>
          {fields.videos.length > 0 && <section className="adm-panel adm-panel-pad"><h2>Видео читателя</h2><p className="adm-field-hint">Проверьте содержимое перед публикацией.</p>{fields.videos.map(video => <div key={video.id} className="adm-video-attachment"><video className="adm-attached-video" src={video.url} controls playsInline preload="metadata" />{!approved && <button type="button" className="adm-button adm-button-small" disabled={pending !== null} onClick={() => updateField("videos", [])}><AdminIcon name="trash" size={16} />Убрать видео</button>}</div>)}{fieldErrors.videoIds && <p className="adm-field-error">{fieldErrors.videoIds}</p>}</section>}
        </div>
        <aside className="adm-submission-aside">
          <section className="adm-panel adm-panel-pad adm-submission-decision">
            <h2>Решение редакции</h2>
            <div className="adm-current-status"><span>Статус заявки</span><SubmissionBadge status={submission.status} /></div>
            <div className="adm-field"><label htmlFor="submission-category">Категория</label><span className="adm-field-hint" id="submission-category-hint">Нужна для публикации</span><ThemeSelect id="submission-category" name="categoryId" aria-label="Категория" value={fields.categoryId} disabled={disabled} aria-invalid={Boolean(fieldErrors.categoryId)} aria-describedby={fieldErrors.categoryId ? "submission-category-error" : "submission-category-hint"} onValueChange={(value) => updateField("categoryId", value)} options={[{ value: "", label: "Выберите категорию" }, ...categories.map(category => ({ value: category.id, label: category.name }))]} />{fieldErrors.categoryId && <span className="adm-field-error" id="submission-category-error">{fieldErrors.categoryId}</span>}</div>
            {!categories.length && !approved && <p className="adm-submission-photo-note">Для публикации сначала <Link href="/admin/categories" className="adm-text-link">создайте категорию</Link>, затем обновите заявку.</p>}
            <div className="adm-submission-decision-actions">
              {approved ? submission.post ? <><Link href={`/admin/posts/${submission.post.id}`} className="adm-button adm-button-primary"><AdminIcon name="edit" size={18} />Редактировать публикацию</Link>{submission.post.status === "PUBLISHED" && <Link href={`/news/${submission.post.slug}`} className="adm-button" target="_blank" rel="noreferrer"><AdminIcon name="external" size={18} />Открыть на сайте</Link>}</> : <p className="adm-submission-photo-note">Связанная публикация удалена. Заявка сохранена для истории.</p> : <>
                <button type="button" className="adm-button adm-button-primary" disabled={pending !== null || !categories.length} onClick={() => void save(true)}><AdminIcon name="check" size={18} />{pending === "approve" ? "Публикуем…" : "Одобрить и опубликовать"}</button>
                <button type="submit" className="adm-button" disabled={pending !== null || !dirty}><AdminIcon name="edit" size={18} />{pending === "save" ? "Сохраняем…" : "Сохранить изменения"}</button>
                {submission.status === "PENDING" && <button type="button" className="adm-button adm-submission-reject" disabled={pending !== null} onClick={() => void reject()}>{pending === "reject" ? "Отклоняем…" : "Отклонить заявку"}</button>}
              </>}
            </div>
            {!approved && <p className="adm-submission-photo-note">Публикация произойдёт только после нажатия «Одобрить и опубликовать». Сохранение изменений не публикует новость.</p>}
            {dirty && !approved && <button type="button" className="adm-inline-button adm-submission-discard" disabled={pending !== null} onClick={() => { if (window.confirm("Отменить несохранённые изменения и вернуть сохранённый текст и фотографии?")) { setFields(fieldsFrom(submission)); setFieldErrors({}); setError(""); setSuccess(""); } }}>Отменить мои изменения</button>}
          </section>
          <section className="adm-panel adm-panel-pad adm-submission-sender">
            <div className="adm-submission-private"><AdminIcon name="lock" size={15} />Сведения об отправителе</div>
            <h2>Отправитель</h2>
            <dl>{submission.senderName && <div><dt>Прежнее имя (только для редакции)</dt><dd>{submission.senderName}</dd></div>}<div><dt>Публичное имя автора</dt><dd>{submission.anonymous ? "Анонимно" : submission.publicAuthorName || "Не указано"}</dd></div><div><dt>Контакт</dt><dd>{submission.contact || "Не указан"}</dd></div><div><dt>Получено, МСК</dt><dd><time dateTime={submission.createdAt}>{dateLabel(submission.createdAt)}</time></dd></div>{submission.reviewedAt && <div><dt>Решение принято, МСК</dt><dd><time dateTime={submission.reviewedAt}>{dateLabel(submission.reviewedAt)}</time></dd></div>}</dl>
            <p>Публичное имя будет видно на сайте. Контакт и прежнее приватное имя отправителя доступны только редакции.</p>
          </section>
          <div className="adm-submission-delete"><button type="button" className="adm-delete-post" disabled={pending !== null} onClick={() => void remove()}><AdminIcon name="trash" size={17} />{pending === "delete" ? "Удаляем…" : "Удалить заявку"}</button><p>{approved ? "Созданная публикация сохранится в разделе «Публикации»." : "Заявка и её вложения будут удалены без возможности восстановления."}</p></div>
        </aside>
      </form>
    </>
  );
}
