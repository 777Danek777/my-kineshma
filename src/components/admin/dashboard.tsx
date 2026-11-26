"use client";

import Link from "next/link";
import { useAdminData } from "./api";
import {
  AdminIcon,
  AdminLoading,
  AdminNotice,
  PageHeading,
  StatusBadge,
} from "./ui";
import { dateLabel, type AdminPost } from "./types";

type Overview = {
  stats: {
    total: number;
    published: number;
    drafts: number;
    unpublished: number;
    categories: number;
    pendingSubmissions: number;
  };
  recentPosts: AdminPost[];
  comments: {
    pending: number;
    approved: number;
    rejected: number;
    total: number;
  };
};

export function Dashboard() {
  const { data, loading, error, reload } = useAdminData<Overview>(
    "/api/admin/overview",
  );
  return (
    <>
      <PageHeading
        eyebrow="ВАША РЕДАКЦИЯ"
        title="Обзор"
        description="Всё, что нужно для работы с новостями города."
        action={
          <Link
            className="adm-button adm-button-primary"
            href="/admin/posts/new"
          >
            <AdminIcon name="plus" />
            Создать новость
          </Link>
        }
      />
      {loading ? (
        <AdminLoading />
      ) : error ? (
        <AdminNotice>
          {error}{" "}
          <button className="adm-inline-button" onClick={reload}>
            Повторить
          </button>
        </AdminNotice>
      ) : (
        data && (
          <>
            <div className="adm-stats">
              {[
                {
                  label: "Всего публикаций",
                  value: data.stats.total,
                  href: "/admin/posts",
                  caption: "Все материалы редакции",
                  icon: "posts" as const,
                },
                {
                  label: "Опубликовано",
                  value: data.stats.published,
                  href: "/admin/posts?status=PUBLISHED",
                  caption: "Доступны читателям",
                  icon: "check" as const,
                },
                {
                  label: "Черновики",
                  value: data.stats.drafts,
                  href: "/admin/posts?status=DRAFT",
                  caption: "Можно продолжить позже",
                  icon: "edit" as const,
                },
                {
                  label: "Категории",
                  value: data.stats.categories,
                  href: "/admin/categories",
                  caption: "Разделы вашей ленты",
                  icon: "categories" as const,
                },
              ].map((item) => (
                <Link className="adm-stat" key={item.label} href={item.href}>
                  <div>
                    <span>{item.label}</span>
                    <AdminIcon name={item.icon} />
                  </div>
                  <strong>{item.value}</strong>
                  <p>{item.caption}</p>
                </Link>
              ))}
            </div>
            <AdminNotice kind="info">
              <strong>Заявки читателей на модерации: {data.stats.pendingSubmissions}.</strong>{" "}
              <Link href="/admin/submissions" className="adm-text-link">
                Открыть входящие →
              </Link>
            </AdminNotice>
            <AdminNotice kind="info">
              <strong>Комментарии на модерации: {data.comments.pending}.</strong>{" "}
              <Link href="/admin/comments" className="adm-text-link">
                Проверить комментарии →
              </Link>
            </AdminNotice>
            <div className="adm-dashboard-columns">
              <section className="adm-panel">
                <div className="adm-panel-heading">
                  <h2>Последние материалы</h2>
                  <Link className="adm-text-link" href="/admin/posts">
                    Все публикации
                  </Link>
                </div>
                {data.recentPosts.length ? (
                  <div className="adm-recent-list">
                    {data.recentPosts.map((post) => (
                      <Link
                        href={`/admin/posts/${post.id}`}
                        className="adm-recent"
                        key={post.id}
                      >
                        <span className="adm-recent-icon">
                          <AdminIcon name="posts" />
                        </span>
                        <span className="adm-recent-copy">
                          <strong>{post.title || "Без заголовка"}</strong>
                          <span>
                            {post.category.name} · {dateLabel(post.updatedAt)}
                          </span>
                        </span>
                        <StatusBadge status={post.status} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="adm-empty">
                    <span className="adm-empty-icon">
                      <AdminIcon name="posts" size={30} />
                    </span>
                    <h3>Всё начинается с первой новости</h3>
                    <p>
                      Напишите материал и сохраните его в черновик.
                      <br />
                      Когда всё будет готово — опубликуйте на сайте.
                    </p>
                    <Link
                      href="/admin/posts/new"
                      className="adm-button adm-button-primary"
                    >
                      <AdminIcon name="plus" size={18} />
                      Создать первую новость
                    </Link>
                  </div>
                )}
              </section>
              <aside className="adm-panel adm-help-panel">
                <Link href="/admin/settings" className="adm-button adm-settings-shortcut">
                  <AdminIcon name="dashboard" size={18} />
                  Настройки модерации
                </Link>
                <span className="adm-help-kicker">БЫСТРЫЙ СТАРТ</span>
                <h2>От идеи до публикации</h2>
                <ol className="adm-steps">
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Напишите новость</strong>
                      <p>Добавьте заголовок, текст и подходящую категорию.</p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Добавьте фотографии</strong>
                      <p>Первое изображение станет обложкой материала.</p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Проверьте и опубликуйте</strong>
                      <p>
                        Или сохраните черновик, чтобы вернуться к нему позже.
                      </p>
                    </div>
                  </li>
                </ol>
                <div className="adm-help-foot">
                  <AdminIcon name="lock" size={16} />
                  <p>
                    Черновики и снятые с публикации материалы видны только
                    редакции.
                  </p>
                </div>
              </aside>
            </div>
            {data.stats.unpublished > 0 && (
              <p className="adm-muted adm-bottom-note">
                Снято с публикации:{" "}
                <Link
                  className="adm-text-link"
                  href="/admin/posts?status=UNPUBLISHED"
                >
                  {data.stats.unpublished} — открыть список
                </Link>
                .
              </p>
            )}
          </>
        )
      )}
    </>
  );
}
