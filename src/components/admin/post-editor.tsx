"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ThemeSelect } from "@/components/ui/theme-select";
import { AdminApiError, adminFetch, errorMessage } from "./api";
import {
  AdminIcon,
  AdminLoading,
  AdminNotice,
  PageHeading,
  StatusBadge,
} from "./ui";
import {
  dateLabel,
  sourceLabels,
  type AdminCategory,
  type AdminImage,
  type AdminPost,
  type PostStatus,
  type PublicationSourceType,
} from "./types";

type EditorData = { post: AdminPost | null; categories: AdminCategory[] };
type EditorFields = {
  title: string;
  content: string;
  categoryId: string;
  images: AdminImage[];
  videos: AdminImage[];
  sourceType: PublicationSourceType;
  sourceName: string;
  sourceUrl: string;
  videoUrl: string;
};

function snapshot(fields: EditorFields) {
  return JSON.stringify({
    title: fields.title,
    content: fields.content,
    categoryId: fields.categoryId,
    imageIds: fields.images.map((image) => image.id),
    videoIds: fields.videos.map((video) => video.id),
    sourceType: fields.sourceType,
    sourceName: fields.sourceName,
    sourceUrl: fields.sourceUrl,
    videoUrl: fields.videoUrl,
  });
}

export function PostEditorLoader({ id }: { id?: string }) {
  const [data, setData] = useState<EditorData | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      adminFetch<{ categories: AdminCategory[] }>("/api/admin/categories", {
        signal: controller.signal,
      }),
      id
        ? adminFetch<{ post: AdminPost }>(`/api/admin/posts/${id}`, {
            signal: controller.signal,
          })
        : Promise.resolve({ post: null }),
    ])
      .then(([categories, post]) => {
        setData({ categories: categories.categories, post: post.post });
        setError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [id, revision]);
  if (error)
    return (
      <>
        <PageHeading
          eyebrow="РЕДАКТОР"
          title="Не удалось открыть материал"
          description="Проверьте подключение или вернитесь к списку публикаций."
        />
        <AdminNotice>{error}</AdminNotice>
        <div className="adm-button-row">
          <button
            className="adm-button"
            onClick={() => setRevision(revision + 1)}
          >
            Повторить
          </button>
          <Link href="/admin/posts" className="adm-button">
            К публикациям
          </Link>
        </div>
      </>
    );
  if (!data) return <AdminLoading />;
  return (
    <PostEditor
      key={data.post?.id ?? "new"}
      initialPost={data.post}
      categories={data.categories}
    />
  );
}

function PostEditor({
  initialPost,
  categories,
}: {
  initialPost: AdminPost | null;
  categories: AdminCategory[];
}) {
  const router = useRouter();
  const [post, setPost] = useState(initialPost);
  const [fields, setFields] = useState<EditorFields>({
    title: initialPost?.title ?? "",
    content: initialPost?.content ?? "",
    categoryId: initialPost?.categoryId ?? "",
    images: initialPost?.images ?? [],
    videos: initialPost?.videos ?? [],
    sourceType: initialPost?.sourceType ?? "COMMUNITY",
    sourceName: initialPost?.sourceName ?? "",
    sourceUrl: initialPost?.sourceUrl ?? "",
    videoUrl: initialPost?.videoUrl ?? "",
  });
  const [baseline, setBaseline] = useState(() => snapshot(fields));
  const [pending, setPending] = useState<"save" | "upload" | "delete" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const allowLeave = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = snapshot(fields) !== baseline;
  const status = post?.status ?? "DRAFT";
  const wordCount = fields.content.trim()
    ? fields.content.trim().split(/\s+/u).length
    : 0;
  useEffect(() => {
    if (!dirty && pending !== "upload") return;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!allowLeave.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    function beforeNavigate(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href, window.location.href);
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      if (
        !window.confirm(
          "Есть несохранённые изменения. Уйти со страницы и потерять их?",
        )
      ) {
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

  function change<K extends keyof EditorFields>(
    key: K,
    value: EditorFields[K],
  ) {
    setFields((current) => ({ ...current, [key]: value }));
    setSuccess("");
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }

  async function save(nextStatus: PostStatus) {
    const invalid: Record<string, string> = {};
    if (!fields.title.trim() && !fields.content.trim() && !fields.images.length && !fields.videos.length && !fields.videoUrl.trim())
      invalid.content = "Добавьте текст, заголовок, фотографию или видео.";
    if (!fields.categoryId) invalid.categoryId = "Выберите категорию новости.";
    if (Object.keys(invalid).length) {
      setFieldErrors(invalid);
      setError("Добавьте содержание публикации и выберите категорию.");
      setPreview(false);
      return;
    }
    if (!formRef.current?.reportValidity()) return;
    setPending("save");
    setError("");
    setSuccess("");
    setFieldErrors({});
    try {
      const { post: saved } = await adminFetch<{ post: AdminPost }>(
        post ? `/api/admin/posts/${post.id}` : "/api/admin/posts",
        {
          method: post ? "PATCH" : "POST",
          body: JSON.stringify({
            title: fields.title.trim(),
            content: fields.content,
            categoryId: fields.categoryId,
            imageIds: fields.images.map((image) => image.id),
            videoIds: fields.videos.map((video) => video.id),
            status: nextStatus,
            sourceType: fields.sourceType,
            sourceName: fields.sourceName.trim(),
            sourceUrl: fields.sourceUrl.trim(),
            videoUrl: fields.videoUrl.trim(),
            ...(post ? { version: post.version } : {}),
          }),
        },
      );
      const savedFields = {
        title: saved.title,
        content: saved.content,
        categoryId: saved.categoryId,
        images: saved.images,
        videos: saved.videos ?? [],
        sourceType: saved.sourceType,
        sourceName: saved.sourceName ?? "",
        sourceUrl: saved.sourceUrl ?? "",
        videoUrl: saved.videoUrl ?? "",
      };
      setFields(savedFields);
      setBaseline(snapshot(savedFields));
      setPost(saved);
      setSuccess(
        nextStatus === "PUBLISHED"
          ? "Новость опубликована. Она доступна читателям на сайте."
          : nextStatus === "UNPUBLISHED"
            ? "Изменения сохранены. Новость скрыта от посетителей сайта."
            : "Черновик сохранён. Он виден только редакции.",
      );
      if (!post)
        window.history.replaceState(null, "", `/admin/posts/${saved.id}`);
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof AdminApiError && error.fieldErrors)
        setFieldErrors(error.fieldErrors);
    } finally {
      setPending(null);
    }
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    setError("");
    setSuccess("");
    if (selected.length + fields.images.length > 6) {
      setError(
        "К новости можно прикрепить до 6 фотографий. Выберите меньше файлов.",
      );
      return;
    }
    if (
      selected.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 5 * 1024 * 1024 ||
          file.size === 0,
      )
    ) {
      setError(
        "Выберите непустые фотографии в формате JPEG, PNG или WebP размером не более 5 МБ каждая.",
      );
      return;
    }
    setPending("upload");
    try {
      for (const file of selected) {
        const body = new FormData();
        body.append("file", file);
        const { image } = await adminFetch<{ image: AdminImage }>(
          "/api/admin/uploads",
          { method: "POST", body },
        );
        setFields((current) => ({
          ...current,
          images: [...current.images, image],
        }));
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function uploadVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || pending) return;
    if (!["video/mp4", "video/webm"].includes(file.type) || !file.size || file.size > 50 * 1024 * 1024) {
      setError("Выберите одно видео MP4 или WebM размером до 50 МБ.");
      return;
    }
    setPending("upload"); setError(""); setSuccess("");
    try {
      const body = new FormData(); body.append("file", file);
      const result = await adminFetch<{ media: AdminImage; image: AdminImage }>("/api/admin/uploads", { method: "POST", body });
      setFields(current => ({ ...current, videos: [result.media ?? result.image] }));
      setFieldErrors(current => ({ ...current, videoIds: "" }));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setPending(null); }
  }

  async function remove() {
    if (
      !post ||
      !window.confirm(
        `Удалить «${post.title || "Без заголовка"}»? Публикация будет удалена без возможности восстановления.`,
      )
    )
      return;
    setPending("delete");
    setError("");
    setSuccess("");
    try {
      await adminFetch(`/api/admin/posts/${post.id}`, {
        method: "DELETE",
        body: JSON.stringify({ version: post.version }),
      });
      allowLeave.current = true;
      router.replace("/admin/posts");
    } catch (error) {
      setError(errorMessage(error));
      setPending(null);
    }
  }

  return (
    <>
      <Link className="adm-editor-back" href="/admin/posts">
        Все публикации
      </Link>
      <PageHeading
        eyebrow="РЕДАКТОР ПУБЛИКАЦИИ"
        title={post ? "Редактировать новость" : "Новая новость"}
        description="Расскажите о том, что важно для города и его жителей."
        action={
          <span className={`adm-save-indicator${dirty ? " is-dirty" : ""}`}>
            <span />
            {pending === "upload"
              ? "Загрузка фотографий…"
              : dirty
                ? "Есть несохранённые изменения"
                : post
                  ? "Все изменения сохранены"
                  : "Новый материал"}
          </span>
        }
      />
      {error && <AdminNotice>{error}</AdminNotice>}
      {success && <AdminNotice kind="success">{success}</AdminNotice>}
      {!categories.length && (
        <AdminNotice kind="info">
          Для новости нужна категория.{" "}
          <Link className="adm-text-link" href="/admin/categories">
            Добавьте первую категорию
          </Link>
          , затем вернитесь в редактор.
        </AdminNotice>
      )}
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void save(status === "PUBLISHED" ? "PUBLISHED" : "DRAFT");
        }}
      >
        <div className="adm-editor-layout">
          <div className="adm-editor-main">
            <section className="adm-panel adm-panel-pad">
              <div className="adm-editor-section-heading">
                <h2>Содержание новости</h2>
                <div
                  className="adm-editor-toggle"
                  role="group"
                  aria-label="Режим редактора"
                >
                  <button
                    type="button"
                    aria-pressed={!preview}
                    className={!preview ? "is-active" : ""}
                    onClick={() => setPreview(false)}
                  >
                    Редактор
                  </button>
                  <button
                    type="button"
                    aria-pressed={preview}
                    className={preview ? "is-active" : ""}
                    onClick={() => setPreview(true)}
                  >
                    Предпросмотр
                  </button>
                </div>
              </div>
              <div hidden={preview} className="adm-editor-fields">
                <label className="adm-field" htmlFor="post-title">
                  Заголовок <span className="adm-field-hint">необязательно</span>
                  <input
                    id="post-title"
                    className="adm-title-input"
                    value={fields.title}
                    onChange={(event) => change("title", event.target.value)}
                    placeholder="О чём ваша новость?"
                    maxLength={180}
                    disabled={pending !== null}
                    aria-invalid={Boolean(fieldErrors.title)}
                    aria-describedby="post-title-hint"
                  />
                  <span
                    id="post-title-hint"
                    className={
                      fieldErrors.title ? "adm-field-error" : "adm-field-hint"
                    }
                  >
                    {fieldErrors.title ||
                      `Коротко и по делу. ${fields.title.length} / 180 символов`}
                  </span>
                </label>
                <label className="adm-field" htmlFor="post-content">
                  Текст новости
                  <textarea
                    id="post-content"
                    value={fields.content}
                    onChange={(event) => change("content", event.target.value)}
                    placeholder="Начните с главного, затем добавьте подробности…"
                    rows={16}
                    maxLength={50000}
                    disabled={pending !== null}
                    aria-invalid={Boolean(fieldErrors.content)}
                    aria-describedby="post-content-hint"
                  />
                  <span className="adm-textarea-foot">
                    <span
                      id="post-content-hint"
                      className={
                        fieldErrors.content
                          ? "adm-field-error"
                          : "adm-field-hint"
                      }
                    >
                      {fieldErrors.content ||
                        "Разделяйте абзацы пустой строкой. HTML-код не используется."}
                    </span>
                    <span className="adm-word-count">Слов: {wordCount}</span>
                  </span>
                </label>
              </div>
              {preview && (
                <article className="adm-article-preview">
                  <span className="adm-help-kicker">
                    ПРЕДВАРИТЕЛЬНЫЙ ПРОСМОТР
                  </span>
                  <span className="adm-preview-category">
                    {categories.find(
                      (category) => category.id === fields.categoryId,
                    )?.name || "Категория не выбрана"}
                  </span>
                  {fields.title && <h2>{fields.title}</h2>}
                  <p className="adm-field-hint">
                    {sourceLabels[fields.sourceType]}
                    {fields.sourceName.trim() &&
                      ` · ${fields.sourceName.trim()}`}
                  </p>
                  {fields.images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="adm-preview-cover"
                      src={fields.images[0].url}
                      width={fields.images[0].width}
                      height={fields.images[0].height}
                      alt={fields.images[0].alt || "Обложка публикации"}
                    />
                  )}
                  <p className="adm-preview-content">
                    {fields.content}
                  </p>
                  {fields.videos.map(video => <video key={video.id} className="adm-attached-video" src={video.url} controls playsInline preload="metadata" />)}
                  <p className="adm-field-hint">
                    Предпросмотр содержания. Расположение элементов на сайте
                    может отличаться.
                  </p>
                </article>
              )}
            </section>
            <section className="adm-panel adm-panel-pad">
              <div className="adm-editor-section-heading">
                <div>
                  <h2>Фотографии</h2>
                  <p className="adm-muted">
                    Первая фотография станет обложкой новости.
                  </p>
                </div>
                <span className="adm-count">{fields.images.length} / 6</span>
              </div>
              {fields.images.length > 0 && (
                <div className="adm-upload-grid">
                  {fields.images.map((image, index) => (
                    <div className="adm-upload-card" key={image.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={image.alt || `Фотография ${index + 1}`}
                        width={image.width}
                        height={image.height}
                      />
                      {index === 0 && (
                        <span className="adm-cover-label">Обложка</span>
                      )}
                      <button
                        type="button"
                        className="adm-remove-image"
                        aria-label={`Убрать фотографию ${index + 1}`}
                        title="Убрать фотографию"
                        disabled={pending !== null}
                        onClick={() =>
                          change(
                            "images",
                            fields.images.filter(
                              (item) => item.id !== image.id,
                            ),
                          )
                        }
                      >
                        ×
                      </button>
                      {index !== 0 && (
                        <button
                          type="button"
                          className="adm-make-cover"
                          disabled={pending !== null}
                          onClick={() =>
                            change("images", [
                              image,
                              ...fields.images.filter(
                                (item) => item.id !== image.id,
                              ),
                            ])
                          }
                        >
                          Сделать обложкой
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {fields.images.length < 6 && (
                <label
                  className={`adm-upload-zone${pending !== null ? " is-disabled" : ""}`}
                >
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={pending !== null}
                    onChange={upload}
                  />
                  <span className="adm-upload-icon">
                    <AdminIcon name="image" size={25} />
                  </span>
                  <strong>
                    {pending === "upload"
                      ? "Загружаем фотографии…"
                      : "Выбрать фотографии"}
                  </strong>
                  <span>JPEG, PNG или WebP · до 5 МБ каждая</span>
                </label>
              )}
              {fieldErrors.imageIds && (
                <p className="adm-field-error">{fieldErrors.imageIds}</p>
              )}
              <p className="adm-upload-note">
                Добавляйте только изображения, которые вы имеете право
                публиковать. Можно сохранить новость без фотографий.
              </p>
            </section>
            <section className="adm-panel adm-panel-pad">
              <div className="adm-editor-section-heading"><div><h2>Прикреплённое видео</h2><p className="adm-muted">Одно видео MP4 или WebM до 50 МБ. Оно будет воспроизводиться прямо в публикации.</p></div><span className="adm-count">{fields.videos.length} / 1</span></div>
              {fields.videos.map(video => <div key={video.id} className="adm-video-attachment"><video className="adm-attached-video" src={video.url} controls playsInline preload="metadata" /><button type="button" className="adm-button adm-button-small" disabled={pending !== null} onClick={() => change("videos", [])}><AdminIcon name="trash" size={16} />Убрать видео</button></div>)}
              <label className={`adm-upload-zone${pending !== null ? " is-disabled" : ""}`}><input type="file" accept="video/mp4,video/webm" disabled={pending !== null} onChange={uploadVideo} /><span className="adm-upload-icon"><AdminIcon name="image" size={25} /></span><strong>{pending === "upload" ? "Загружаем вложение…" : fields.videos.length ? "Заменить видео" : "Выбрать видео"}</strong><span>MP4 (H.264/AAC), WebM (VP8/VP9) · до 50 МБ</span></label>
              {fieldErrors.videoIds && <p className="adm-field-error">{fieldErrors.videoIds}</p>}
              <p className="adm-upload-note">После загрузки сохраните публикацию, чтобы прикрепить видео.</p>
            </section>
            <section
              className="adm-panel adm-panel-pad"
              aria-labelledby="post-source-heading"
            >
              <div className="adm-editor-section-heading">
                <div>
                  <h2 id="post-source-heading">Источник и внешняя ссылка</h2>
                  <p className="adm-muted">
                    Необязательные сведения. Источник показывает, откуда пришёл
                    материал, а категория — о чём он.
                  </p>
                </div>
              </div>
              <div className="adm-editor-fields">
                <div className="adm-field">
                  <label htmlFor="post-source-type">Происхождение публикации</label>
                  <ThemeSelect
                    id="post-source-type"
                    aria-label="Происхождение публикации"
                    value={fields.sourceType}
                    onValueChange={(value) => change("sourceType", value as PublicationSourceType)}
                    disabled={pending !== null}
                    aria-invalid={Boolean(fieldErrors.sourceType)}
                    aria-describedby="post-source-type-hint"
                    options={Object.entries(sourceLabels).map(([value, label]) => ({ value, label }))}
                  />
                  <span
                    id="post-source-type-hint"
                    className={
                      fieldErrors.sourceType
                        ? "adm-field-error"
                        : "adm-field-hint"
                    }
                  >
                    {fieldErrors.sourceType ||
                      "Выбирайте «Официальное сообщение» только для материала из официального источника."}
                  </span>
                </div>
                <label className="adm-field" htmlFor="post-source-name">
                  Название источника
                  <input
                    id="post-source-name"
                    value={fields.sourceName}
                    onChange={(event) =>
                      change("sourceName", event.target.value)
                    }
                    placeholder="Например, городская библиотека"
                    maxLength={100}
                    disabled={pending !== null}
                    aria-invalid={Boolean(fieldErrors.sourceName)}
                    aria-describedby="post-source-name-hint"
                  />
                  <span
                    id="post-source-name-hint"
                    className={
                      fieldErrors.sourceName
                        ? "adm-field-error"
                        : "adm-field-hint"
                    }
                  >
                    {fieldErrors.sourceName ||
                      "Можно оставить пустым. До 100 символов."}
                  </span>
                </label>
                <label className="adm-field" htmlFor="post-source-url">
                  Ссылка на первоисточник
                  <input
                    id="post-source-url"
                    type="url"
                    value={fields.sourceUrl}
                    onChange={(event) =>
                      change("sourceUrl", event.target.value)
                    }
                    placeholder="https://…"
                    maxLength={2048}
                    disabled={pending !== null}
                    aria-invalid={Boolean(fieldErrors.sourceUrl)}
                    aria-describedby="post-source-url-hint"
                  />
                  <span
                    id="post-source-url-hint"
                    className={
                      fieldErrors.sourceUrl
                        ? "adm-field-error"
                        : "adm-field-hint"
                    }
                  >
                    {fieldErrors.sourceUrl ||
                      "Полный адрес https:// без логина и пароля. Можно оставить пустым."}
                  </span>
                </label>
                <label className="adm-field" htmlFor="post-video-url">
                  Ссылка на видео на внешнем сайте
                  <input
                    id="post-video-url"
                    type="url"
                    value={fields.videoUrl}
                    onChange={(event) => change("videoUrl", event.target.value)}
                    placeholder="https://…"
                    maxLength={2048}
                    disabled={pending !== null}
                    aria-invalid={Boolean(fieldErrors.videoUrl)}
                    aria-describedby="post-video-url-hint"
                  />
                  <span
                    id="post-video-url-hint"
                    className={
                      fieldErrors.videoUrl
                        ? "adm-field-error"
                        : "adm-field-hint"
                    }
                  >
                    {fieldErrors.videoUrl ||
                      "Необязательно. Читатель сможет открыть видео на внешнем сайте. Нужна ссылка https:// без логина и пароля."}
                  </span>
                </label>
              </div>
            </section>
          </div>
          <aside className="adm-editor-aside">
            <section className="adm-panel adm-panel-pad adm-publish-panel">
              <h2>Публикация</h2>
              <div className="adm-current-status">
                <span>Статус</span>
                <StatusBadge status={status} />
              </div>
              <div className="adm-field">
                <label htmlFor="post-category">Категория <span className="adm-required">*</span></label>
                <ThemeSelect
                  id="post-category"
                  aria-label="Категория"
                  value={fields.categoryId}
                  onValueChange={(value) => change("categoryId", value)}
                  required
                  disabled={pending !== null}
                  aria-invalid={Boolean(fieldErrors.categoryId)}
                  aria-describedby={fieldErrors.categoryId ? "post-category-error" : undefined}
                  options={[{ value: "", label: "Выберите категорию", disabled: true }, ...categories.map(category => ({ value: category.id, label: category.name }))]}
                />
                {fieldErrors.categoryId && (
                  <span className="adm-field-error" id="post-category-error">
                    {fieldErrors.categoryId}
                  </span>
                )}
              </div>
              <Link href="/admin/categories" className="adm-manage-categories">
                Управление категориями
              </Link>
              <div className="adm-publish-actions">
                <button
                  type="button"
                  className="adm-button adm-button-primary"
                  disabled={pending !== null || !categories.length}
                  onClick={() => save("PUBLISHED")}
                >
                  <AdminIcon name="check" size={18} />
                  {pending === "save"
                    ? "Сохраняем…"
                    : status === "PUBLISHED"
                      ? "Сохранить изменения"
                      : "Опубликовать"}
                </button>
                {status !== "PUBLISHED" && (
                  <button
                    type="button"
                    className="adm-button"
                    disabled={pending !== null || !categories.length}
                    onClick={() =>
                      save(status === "UNPUBLISHED" ? "UNPUBLISHED" : "DRAFT")
                    }
                  >
                    {status === "UNPUBLISHED"
                      ? "Сохранить без публикации"
                      : "Сохранить черновик"}
                  </button>
                )}
                {status === "PUBLISHED" && (
                  <button
                    type="button"
                    className="adm-button"
                    disabled={pending !== null}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Снять новость с публикации? Она исчезнет с сайта. Текущие изменения будут сохранены в кабинете.",
                        )
                      )
                        void save("UNPUBLISHED");
                    }}
                  >
                    Снять с публикации
                  </button>
                )}
              </div>
              <p className="adm-publish-explanation">
                {status === "PUBLISHED"
                  ? "Эта новость видна всем посетителям сайта."
                  : "После публикации новость появится в общей ленте сайта."}
              </p>
              {post && (
                <div className="adm-save-details">
                  <span>Последнее сохранение</span>
                  <time dateTime={post.updatedAt}>
                    {dateLabel(post.updatedAt)} МСК
                  </time>
                  {post.status === "PUBLISHED" && (
                    <Link
                      href={`/news/${post.slug}`}
                      className="adm-text-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Открыть на сайте <AdminIcon name="external" size={14} />
                    </Link>
                  )}
                </div>
              )}
            </section>
            <div className="adm-editor-tip">
              <AdminIcon name="edit" size={20} />
              <p>
                <strong>Можно не спешить.</strong> Черновик виден только вам и
                другим администраторам. Вернитесь к нему, когда будет удобно.
              </p>
            </div>
            {post && (
              <button
                type="button"
                className="adm-delete-post"
                disabled={pending !== null}
                onClick={remove}
              >
                <AdminIcon name="trash" size={17} />
                {pending === "delete" ? "Удаляем…" : "Удалить публикацию"}
              </button>
            )}
          </aside>
        </div>
      </form>
    </>
  );
}
