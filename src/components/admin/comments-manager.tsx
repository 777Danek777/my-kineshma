"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminFetch, errorMessage } from "./api";
import { AdminIcon, AdminLoading, AdminNotice, PageHeading } from "./ui";
import { dateLabel } from "./types";
import {
  commentStatusLabels,
  type AdminComment,
  type AdminCommentsResult,
  type AdminCommentStatus,
} from "./comments-types";
import styles from "./comments-manager.module.css";

type ModerationAction = {
  kind: "approve" | "reject" | "pending" | "edit" | "delete";
  comment: AdminComment;
};
type CommentChanges = { displayName: string; content: string };

type ListState = {
  key: string;
  data: AdminCommentsResult | null;
  error: string;
};

function CommentBadge({ status }: { status: AdminCommentStatus }) {
  return (
    <span className={`adm-status ${styles.badge} ${styles[status.toLowerCase()]}`}>
      <span />
      {commentStatusLabels[status]}
    </span>
  );
}

function ModerationDialog({
  action,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  action: ModerationAction;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (changes?: CommentChanges) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [displayName, setDisplayName] = useState(action.comment.displayName);
  const [content, setContent] = useState(action.comment.content);
  const heading =
    action.kind === "edit" ? "Редактировать комментарий"
    : action.kind === "pending" ? "Вернуть на модерацию?"
    : action.kind === "approve"
      ? "Одобрить комментарий?"
      : action.kind === "reject"
        ? "Отклонить комментарий?"
        : "Удалить комментарий?";
  const explanation =
    action.kind === "edit" ? "Исправьте имя или текст. Статус комментария останется прежним."
    : action.kind === "pending" ? "Комментарий и его ответы будут скрыты с сайта до одобрения."
    : action.kind === "approve"
      ? "Комментарий появится в обсуждении, если публикация и исходный комментарий доступны на сайте."
      : action.kind === "reject"
        ? "Комментарий не будет виден посетителям. Он останется в разделе «Отклонённые», и решение можно будет изменить."
        : `Комментарий будет удалён без возможности восстановления.${action.comment._count.replies ? ` Ответы (${action.comment._count.replies}) и их лайки тоже удалятся.` : ""} Сама публикация останется на месте.`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="comment-confirmation-title"
      aria-describedby="comment-confirmation-description"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <form className={styles.dialogInner} onSubmit={(event) => { event.preventDefault(); onConfirm(action.kind === "edit" ? { displayName, content } : undefined); }}>
        <span className={styles.dialogKicker}>РЕШЕНИЕ РЕДАКЦИИ</span>
        <h2 id="comment-confirmation-title">{heading}</h2>
        <p id="comment-confirmation-description">{explanation}</p>
        {action.kind === "edit" ? <div className={styles.editFields}>
          <label htmlFor="comment-edit-name">Отображаемое имя</label>
          <input id="comment-edit-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} maxLength={60} disabled={busy} />
          <label htmlFor="comment-edit-content">Текст комментария</label>
          <textarea id="comment-edit-content" value={content} onChange={(event) => setContent(event.target.value)} required minLength={3} maxLength={2000} rows={7} disabled={busy} />
        </div> : <div className={styles.dialogComment}>
          <strong>{action.comment.displayName}</strong>
          <p>{action.comment.content}</p>
        </div>}
        {error && <AdminNotice>{error}</AdminNotice>}
        <div className={styles.dialogActions}>
          <button
            type="button"
            className="adm-button"
            autoFocus
            disabled={busy}
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            type="submit"
            className={`adm-button ${action.kind === "approve" || action.kind === "edit" ? "adm-button-primary" : styles.destructive}`}
            disabled={busy}
          >
            {busy
              ? "Выполняем…"
              : action.kind === "edit" ? "Сохранить изменения"
                : action.kind === "pending" ? "На модерацию"
                : action.kind === "approve"
                ? "Одобрить"
                : action.kind === "reject"
                  ? "Отклонить"
                  : "Удалить комментарий"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function CommentsManager({
  initialStatus = "PENDING",
}: {
  initialStatus?: AdminCommentStatus;
}) {
  const [status, setStatus] = useState<AdminCommentStatus>(initialStatus);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<ListState | null>(null);
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const requestKey = `${status}:${page}:${revision}`;
  const loading = list?.key !== requestKey;
  const data = !loading ? list?.data : null;

  useEffect(() => {
    const controller = new AbortController();
    const key = `${status}:${page}:${revision}`;
    const path = `/api/admin/comments?${new URLSearchParams({ status, page: String(page) })}`;
    adminFetch<AdminCommentsResult>(path, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (page > Math.max(1, result.totalPages)) {
          setPage(Math.max(1, result.totalPages));
          return;
        }
        setList({ key, data: result, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setList({ key, data: null, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [status, page, revision]);

  function refresh() {
    setRevision((value) => value + 1);
    setError("");
  }

  function selectStatus(next: AdminCommentStatus) {
    setStatus(next);
    setPage(1);
    setError("");
    setSuccess("");
  }

  function openAction(kind: ModerationAction["kind"], comment: AdminComment) {
    setActionError("");
    setAction({ kind, comment });
  }

  async function confirmAction(changes?: CommentChanges) {
    if (!action || busy) return;
    setBusy(true);
    setActionError("");
    setError("");
    setSuccess("");
    try {
      const result = await adminFetch<{ comment: AdminComment } | { success: true }>(`/api/admin/comments/${action.comment.id}`, {
        method: action.kind === "delete" ? "DELETE" : action.kind === "edit" ? "PUT" : "PATCH",
        body: JSON.stringify({
          version: action.comment.version,
          ...(action.kind === "edit" ? changes : action.kind === "delete"
            ? {}
            : { status: action.kind === "approve" ? "APPROVED" : action.kind === "pending" ? "PENDING" : "REJECTED" }),
        }),
      });
      const published = "comment" in result && result.comment.post.status === "PUBLISHED" && (!result.comment.parent || result.comment.parent.status === "APPROVED");
      setSuccess(
        action.kind === "edit" ? "Комментарий сохранён. Его статус не изменился."
          : action.kind === "pending" ? "Комментарий возвращён на модерацию и скрыт с сайта."
          : action.kind === "approve"
          ? published
            ? "Комментарий одобрен и доступен в обсуждении публикации."
            : "Комментарий одобрен. Он станет виден, когда публикация и исходный комментарий будут доступны на сайте."
          : action.kind === "reject"
            ? "Комментарий отклонён. Посетители его не видят."
            : "Комментарий удалён.",
      );
      setAction(null);
      if (action.kind !== "edit" && data?.items.length === 1 && page > 1) setPage(page - 1);
      else setRevision((value) => value + 1);
      window.requestAnimationFrame(() => listHeadingRef.current?.focus({ preventScroll: true }));
    } catch (error) {
      if (error instanceof AdminApiError && (error.status === 409 || error.status === 404)) {
        setAction(null);
        setError(errorMessage(error));
        window.requestAnimationFrame(() => listHeadingRef.current?.focus({ preventScroll: true }));
      } else {
        setActionError(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <PageHeading
        eyebrow="ОБЩЕНИЕ В СООБЩЕСТВЕ"
        title="Комментарии"
        description="Редактируйте сообщения читателей, управляйте их видимостью и разбирайте очередь модерации."
        action={
          <button type="button" className="adm-button" disabled={loading || busy} onClick={refresh}>
            Обновить список
          </button>
        }
      />
      <div className={styles.explanation}>
        <span><AdminIcon name="lock" size={20} /></span>
        <div>
          <strong>Режим публикации задаётся в настройках</strong>
          <p>При выключенной модерации новые комментарии публикуются сразу. При включённой — ждут решения. Переключение режима не меняет статус уже полученных комментариев. <Link href="/admin/settings">Настройки модерации</Link></p>
        </div>
      </div>
      {error && (
        <AdminNotice>
          {error}{" "}
          <button type="button" className="adm-inline-button" onClick={refresh}>
            Обновить список
          </button>
        </AdminNotice>
      )}
      {success && <AdminNotice kind="success">{success}</AdminNotice>}
      <section className="adm-panel" aria-labelledby="comment-list-title" aria-busy={loading || busy}>
        <div className={styles.toolbar}>
          <div className="adm-tabs" role="group" aria-label="Статус комментариев">
            {([
              { value: "PENDING", label: "На модерации" },
              { value: "APPROVED", label: "Опубликованные" },
              { value: "REJECTED", label: "Отклонённые" },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={status === tab.value}
                className={status === tab.value ? "is-active" : ""}
                disabled={busy}
                onClick={() => selectStatus(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <h2 id="comment-list-title" ref={listHeadingRef} tabIndex={-1} className={styles.listTitle}>
            {loading ? "Загружаем комментарии" : data ? `Комментариев в разделе: ${data.total}` : "Комментарии"}
          </h2>
        </div>
        {loading ? <AdminLoading /> : list?.error ? (
          <div className="adm-panel-pad">
            <AdminNotice>{list.error}{" "}<button type="button" className="adm-inline-button" onClick={refresh}>Повторить</button></AdminNotice>
          </div>
        ) : data && (
          data.items.length ? <>
            <ol className={styles.list}>
              {data.items.map((comment) => (
                <li key={comment.id}>
                  <article className={styles.comment} aria-labelledby={`comment-author-${comment.id}`}>
                    <header className={styles.commentHeader}>
                      <span className={styles.avatar} aria-hidden="true">{comment.displayName.slice(0, 1).toLocaleUpperCase("ru-RU")}</span>
                      <div className={styles.author}>
                        <h3 id={`comment-author-${comment.id}`}>{comment.displayName}</h3>
                        <time dateTime={comment.createdAt}>{dateLabel(comment.createdAt)} МСК</time>
                      </div>
                      <CommentBadge status={comment.status} />
                      <details className={styles.menu} onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
                        <summary aria-label={`Действия с комментарием ${comment.displayName}`}><svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg></summary>
                        <div className={styles.menuItems} role="group" aria-label="Управление комментарием">
                          <button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); openAction("edit", comment); }}>Редактировать</button>
                          {comment.status !== "APPROVED" && <button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); openAction("approve", comment); }}>Одобрить и показать</button>}
                          {comment.status !== "PENDING" && <button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); openAction("pending", comment); }}>На модерацию</button>}
                          {comment.status !== "REJECTED" && <button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); openAction("reject", comment); }}>Скрыть и отклонить</button>}
                          <button type="button" className={styles.menuDelete} disabled={busy} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); openAction("delete", comment); }}>Удалить</button>
                        </div>
                      </details>
                    </header>
                    {comment.parent && <div className={styles.parentComment}><span>Ответ на комментарий {comment.parent.displayName}</span><p>{comment.parent.content}</p>{comment.parent.status !== "APPROVED" && <strong>Исходный комментарий скрыт — этот ответ тоже не виден на сайте.</strong>}</div>}
                    <p className={styles.commentText}>{comment.content}</p>
                    <div className={styles.publication}>
                      <AdminIcon name="posts" size={19} />
                      <div>
                        <span>К публикации</span>
                        <Link
                          href={comment.post.status === "PUBLISHED" ? `/news/${encodeURIComponent(comment.post.slug)}#comments` : `/admin/posts/${comment.post.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {comment.post.title}<AdminIcon name="external" size={14} />
                          <span className="sr-only"> (новая вкладка)</span>
                        </Link>
                        {comment.post.status !== "PUBLISHED" && <p>Публикация скрыта. Её комментарии не видны посетителям.</p>}
                      </div>
                    </div>
                    <footer className={styles.commentFooter}>
                      <span className={styles.replyCount}>{comment._count.replies > 0 ? `Ответов: ${comment._count.replies}` : ""}</span>
                      <Link className="adm-text-link" href={`/admin/posts/${comment.post.id}`}>Публикация в кабинете</Link>
                    </footer>
                  </article>
                </li>
              ))}
            </ol>
            <div className="adm-pagination">
              <span>Всего: {data.total} · по {data.pageSize} на странице</span>
              <div>
                <button type="button" className="adm-button adm-button-small" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Назад</button>
                <span>{page} / {Math.max(1, data.totalPages)}</span>
                <button type="button" className="adm-button adm-button-small" disabled={page >= data.totalPages || busy} onClick={() => setPage(page + 1)}>Далее</button>
              </div>
            </div>
          </> : (
            <div className="adm-empty">
              <span className="adm-empty-icon"><AdminIcon name={status === "PENDING" ? "check" : "posts"} size={30} /></span>
              <h3>{status === "PENDING" ? "Всё разобрано" : "Здесь пока нет комментариев"}</h3>
              <p>{status === "PENDING" ? "Здесь появляются сообщения, отправленные при включённой модерации или возвращённые на проверку." : status === "APPROVED" ? "Здесь будут опубликованные комментарии: одобренные редакцией или принятые при выключенной модерации." : "Отклонённые сообщения сохраняются здесь. Их можно пересмотреть или удалить."}</p>
            </div>
          )
        )}
      </section>
      {action && (
        <ModerationDialog action={action} busy={busy} error={actionError} onCancel={() => { setAction(null); setActionError(""); }} onConfirm={(changes) => void confirmAction(changes)} />
      )}
    </div>
  );
}
