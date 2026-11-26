"use client";

import Link from "next/link";
import { useState } from "react";
import { adminFetch, errorMessage, useAdminData } from "./api";
import {
  AdminIcon,
  AdminLoading,
  AdminNotice,
  PageHeading,
  StatusBadge,
} from "./ui";
import { dateLabel, type AdminPost, type PostStatus } from "./types";

type PostsResult = {
  posts: AdminPost[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function PostsList({ initialStatus = "" }: { initialStatus?: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const path = `/api/admin/posts?${new URLSearchParams({ q: query, status, page: String(page) })}`;
  const result = useAdminData<PostsResult>(path);
  async function changeStatus(post: AdminPost, nextStatus: PostStatus) {
    if (
      nextStatus === "UNPUBLISHED" &&
      !window.confirm(
        `Снять с публикации «${post.title || "Без заголовка"}»? Материал исчезнет с сайта, но останется в кабинете.`,
      )
    )
      return;
    if (
      nextStatus === "PUBLISHED" &&
      !window.confirm(
        `Опубликовать «${post.title || "Без заголовка"}»? Материал станет доступен всем посетителям сайта.`,
      )
    )
      return;
    setPending(post.id);
    setError("");
    setSuccess("");
    try {
      await adminFetch(`/api/admin/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, version: post.version }),
      });
      setSuccess(
        nextStatus === "PUBLISHED"
          ? "Новость опубликована и доступна на сайте."
          : "Новость снята с публикации. Посетители больше её не видят.",
      );
      result.reload();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(null);
    }
  }
  async function remove(post: AdminPost) {
    if (
      !window.confirm(`Удалить «${post.title || "Без заголовка"}»? Это действие нельзя отменить.`)
    )
      return;
    setPending(post.id);
    setError("");
    setSuccess("");
    try {
      await adminFetch(`/api/admin/posts/${post.id}`, {
        method: "DELETE",
        body: JSON.stringify({ version: post.version }),
      });
      setSuccess("Публикация удалена.");
      if (result.data?.posts.length === 1 && page > 1) setPage(page - 1);
      else result.reload();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="МАТЕРИАЛЫ РЕДАКЦИИ"
        title="Публикации"
        description="Пишите новости, редактируйте материалы и управляйте их видимостью."
        action={
          <Link
            href="/admin/posts/new"
            className="adm-button adm-button-primary"
          >
            <AdminIcon name="plus" />
            Создать новость
          </Link>
        }
      />
      {error && <AdminNotice>{error}</AdminNotice>}
      {success && <AdminNotice kind="success">{success}</AdminNotice>}
      <section className="adm-panel adm-posts-panel">
        <div className="adm-list-toolbar">
          <div className="adm-tabs" role="group" aria-label="Статус публикаций">
            {[
              { value: "", label: "Все" },
              { value: "PUBLISHED", label: "Опубликовано" },
              { value: "DRAFT", label: "Черновики" },
              { value: "UNPUBLISHED", label: "Снято с публикации" },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={status === tab.value}
                className={status === tab.value ? "is-active" : ""}
                onClick={() => {
                  setStatus(tab.value);
                  setPage(1);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <form
            className="adm-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
              setPage(1);
            }}
          >
            <AdminIcon name="search" size={18} />
            <input
              type="search"
              aria-label="Поиск публикаций"
              placeholder="Найти публикацию…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="submit" className="adm-search-submit">
              Найти
            </button>
          </form>
        </div>
        {result.loading ? (
          <AdminLoading />
        ) : result.error ? (
          <div className="adm-panel-pad">
            <AdminNotice>
              {result.error}{" "}
              <button className="adm-inline-button" onClick={result.reload}>
                Повторить
              </button>
            </AdminNotice>
          </div>
        ) : (
          result.data && (
            <>
              {result.data.posts.length ? (
                <>
                  <div className="adm-table-wrap">
                    <table className="adm-posts-table">
                      <thead>
                        <tr>
                          <th>Публикация</th>
                          <th>Статус</th>
                          <th>Изменено, МСК</th>
                          <th>
                            <span className="sr-only">Действия</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.posts.map((post) => (
                          <tr key={post.id}>
                            <td>
                              <Link
                                href={`/admin/posts/${post.id}`}
                                className="adm-post-cell"
                              >
                                <span className="adm-post-thumb">
                                  {post.images[0] ? (
                                    // Private drafts require the authenticated media endpoint rather than Next image optimization.
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={post.images[0].url}
                                      alt=""
                                      width={64}
                                      height={52}
                                    />
                                  ) : (
                                    <AdminIcon name="image" size={24} />
                                  )}
                                </span>
                                <span>
                                  <strong>{post.title || "Без заголовка"}</strong>
                                  <small>{post.category.name}</small>
                                </span>
                              </Link>
                            </td>
                            <td>
                              <StatusBadge status={post.status} />
                            </td>
                            <td className="adm-table-date">
                              {dateLabel(post.updatedAt)}
                            </td>
                            <td>
                              <div className="adm-row-actions">
                                <Link
                                  href={`/admin/posts/${post.id}`}
                                  className="adm-icon-button"
                                  title="Редактировать"
                                  aria-label={`Редактировать «${post.title || "Без заголовка"}»`}
                                >
                                  <AdminIcon name="edit" size={17} />
                                </Link>
                                <button
                                  type="button"
                                  disabled={pending !== null}
                                  className="adm-row-status"
                                  onClick={() =>
                                    changeStatus(
                                      post,
                                      post.status === "PUBLISHED"
                                        ? "UNPUBLISHED"
                                        : "PUBLISHED",
                                    )
                                  }
                                >
                                  {pending === post.id
                                    ? "Подождите…"
                                    : post.status === "PUBLISHED"
                                      ? "Снять"
                                      : "Опубликовать"}
                                </button>
                                <button
                                  type="button"
                                  className="adm-icon-button adm-danger-text"
                                  disabled={pending !== null}
                                  onClick={() => remove(post)}
                                  title="Удалить"
                                  aria-label={`Удалить «${post.title || "Без заголовка"}»`}
                                >
                                  <AdminIcon name="trash" size={17} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="adm-pagination">
                    <span>Всего: {result.data.total}</span>
                    <div>
                      <button
                        className="adm-button adm-button-small"
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                      >
                        Назад
                      </button>
                      <span>
                        {page} / {Math.max(1, result.data.totalPages)}
                      </span>
                      <button
                        className="adm-button adm-button-small"
                        type="button"
                        disabled={page >= result.data.totalPages}
                        onClick={() => setPage(page + 1)}
                      >
                        Далее
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="adm-empty">
                  <span className="adm-empty-icon">
                    <AdminIcon name="posts" size={30} />
                  </span>
                  <h3>
                    {query || status
                      ? "Ничего не найдено"
                      : "Здесь появятся ваши новости"}
                  </h3>
                  <p>
                    {query || status
                      ? "Попробуйте другой запрос или выберите все публикации."
                      : "Создайте первую публикацию. Её можно сохранить как черновик."}
                  </p>
                  {query || status ? (
                    <button
                      type="button"
                      className="adm-button"
                      onClick={() => {
                        setQuery("");
                        setSearch("");
                        setStatus("");
                        setPage(1);
                      }}
                    >
                      Сбросить фильтры
                    </button>
                  ) : (
                    <Link
                      className="adm-button adm-button-primary"
                      href="/admin/posts/new"
                    >
                      <AdminIcon name="plus" size={18} />
                      Создать новость
                    </Link>
                  )}
                </div>
              )}
            </>
          )
        )}
      </section>
    </>
  );
}
