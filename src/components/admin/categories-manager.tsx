"use client";

import { useState } from "react";
import { AdminApiError, adminFetch, errorMessage, useAdminData } from "./api";
import { AdminIcon, AdminLoading, AdminNotice, PageHeading } from "./ui";
import type { AdminCategory } from "./types";

export function CategoriesManager() {
  const result = useAdminData<{ categories: AdminCategory[] }>(
    "/api/admin/categories",
  );
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function save(event: React.FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await adminFetch(
        id ? `/api/admin/categories/${id}` : "/api/admin/categories",
        {
          method: id ? "PATCH" : "POST",
          body: JSON.stringify({ name: (id ? editName : newName).trim() }),
        },
      );
      if (id) setEditing(null);
      else setNewName("");
      setSuccess(
        id
          ? "Название категории обновлено."
          : "Категория добавлена. Теперь её можно выбрать в редакторе новости.",
      );
      result.reload();
    } catch (error) {
      setError(
        error instanceof AdminApiError && error.fieldErrors?.name
          ? error.fieldErrors.name
          : errorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(category: AdminCategory) {
    if (
      !window.confirm(
        `Удалить категорию «${category.name}»? Это действие нельзя отменить.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await adminFetch(`/api/admin/categories/${category.id}`, {
        method: "DELETE",
      });
      setSuccess("Категория удалена.");
      result.reload();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="ПОРЯДОК В ЛЕНТЕ"
        title="Категории"
        description="Помогайте читателям находить новости по интересующим темам."
      />
      {error && <AdminNotice>{error}</AdminNotice>}
      {success && <AdminNotice kind="success">{success}</AdminNotice>}
      <div className="adm-categories-layout">
        <section className="adm-panel">
          <div className="adm-panel-heading">
            <h2>Категории сайта</h2>
            {result.data && (
              <span className="adm-count">{result.data.categories.length}</span>
            )}
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
            <div className="adm-category-list">
              {result.data?.categories.length ? (
                result.data.categories.map((category) => (
                  <div className="adm-category-row" key={category.id}>
                    {editing === category.id ? (
                      <form
                        className="adm-category-edit"
                        onSubmit={(event) => save(event, category.id)}
                      >
                        <label className="adm-field">
                          Название категории
                          <input
                            autoFocus
                            value={editName}
                            onChange={(event) =>
                              setEditName(event.target.value)
                            }
                            minLength={2}
                            maxLength={60}
                            required
                            disabled={busy}
                          />
                        </label>
                        <div className="adm-button-row">
                          <button
                            type="submit"
                            className="adm-button adm-button-primary adm-button-small"
                            disabled={busy}
                          >
                            Сохранить
                          </button>
                          <button
                            type="button"
                            className="adm-button adm-button-small"
                            disabled={busy}
                            onClick={() => setEditing(null)}
                          >
                            Отмена
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <span className="adm-category-icon">
                          <AdminIcon name="categories" />
                        </span>
                        <div className="adm-category-info">
                          <strong>{category.name}</strong>
                          <span>Публикаций: {category.postCount}</span>
                        </div>
                        <div className="adm-row-actions">
                          <button
                            type="button"
                            className="adm-icon-button"
                            disabled={busy}
                            title="Переименовать"
                            aria-label={`Переименовать категорию «${category.name}»`}
                            onClick={() => {
                              setEditing(category.id);
                              setEditName(category.name);
                            }}
                          >
                            <AdminIcon name="edit" size={18} />
                          </button>
                          <button
                            type="button"
                            className="adm-icon-button adm-danger-text"
                            disabled={busy || category.postCount > 0}
                            title={
                              category.postCount
                                ? "Сначала перенесите публикации в другую категорию"
                                : "Удалить категорию"
                            }
                            aria-label={`Удалить категорию «${category.name}»`}
                            onClick={() => remove(category)}
                          >
                            <AdminIcon name="trash" size={18} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              ) : (
                <div className="adm-empty">
                  <h3>Пока нет категорий</h3>
                  <p>Добавьте первую категорию с помощью формы.</p>
                </div>
              )}
            </div>
          )}
        </section>
        <div className="adm-category-aside">
          <section className="adm-panel adm-panel-pad">
            <span className="adm-help-kicker">НОВЫЙ РАЗДЕЛ</span>
            <h2>Добавить категорию</h2>
            <p className="adm-muted">Выберите короткое и понятное название.</p>
            <form
              className="adm-category-create"
              onSubmit={(event) => save(event)}
            >
              <label className="adm-field">
                Название
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Например, Культура"
                  minLength={2}
                  maxLength={60}
                  required
                  disabled={busy}
                />
              </label>
              <button
                type="submit"
                className="adm-button adm-button-primary"
                disabled={busy}
              >
                <AdminIcon name="plus" size={18} />
                {busy ? "Подождите…" : "Добавить категорию"}
              </button>
            </form>
          </section>
          <p className="adm-aside-note">
            <AdminIcon name="categories" size={18} />
            <span>
              Категорию с публикациями удалить нельзя. Сначала откройте эти
              материалы и выберите для них другую категорию.
            </span>
          </p>
        </div>
      </div>
    </>
  );
}
