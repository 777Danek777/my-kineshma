"use client";

import Link from "next/link";
import { useState } from "react";
import { useAdminData } from "./api";
import { AdminIcon, AdminLoading, AdminNotice, PageHeading } from "./ui";
import { dateLabel } from "./types";
import { type AdminSubmission, SubmissionBadge } from "./submissions-types";

type SubmissionsResult = {
  submissions: AdminSubmission[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  pendingCount: number;
};

export function SubmissionsList({ initialStatus = "PENDING" }: { initialStatus?: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const result = useAdminData<SubmissionsResult>(`/api/admin/submissions?${new URLSearchParams({ status, q: query, page: String(page) })}`);

  function resetFilters() {
    setStatus("ALL");
    setQuery("");
    setSearch("");
    setPage(1);
  }

  return (
    <>
      <PageHeading
        eyebrow="НОВОСТИ ОТ ЧИТАТЕЛЕЙ"
        title="Входящие заявки"
        description="Проверьте материал, выберите категорию и решите, стоит ли публиковать новость."
        action={<Link className="adm-button" href="/suggest-news" target="_blank" rel="noreferrer"><AdminIcon name="external" size={18} />Открыть форму на сайте</Link>}
      />
      <div className="adm-submission-info">
        <span className="adm-submission-info-icon"><AdminIcon name="lock" size={22} /></span>
        <div><strong>Материалы от жителей</strong><p>Проверяйте ожидающие заявки и управляйте присланными материалами. Правила предварительной проверки можно изменить в <Link className="adm-text-link" href="/admin/settings">настройках</Link>.</p></div>
        {result.data && !result.loading && <span className="adm-submission-counter"><strong>{result.data.pendingCount}</strong><span>на модерации</span></span>}
      </div>
      <section className="adm-panel">
        <div className="adm-list-toolbar">
          <div className="adm-tabs" role="group" aria-label="Статус заявок">
            {[
              { value: "PENDING", label: "На модерации" },
              { value: "APPROVED", label: "Опубликованные" },
              { value: "REJECTED", label: "Отклонённые" },
              { value: "ALL", label: "Все" },
            ].map((tab) => <button key={tab.value} type="button" aria-pressed={status === tab.value} className={status === tab.value ? "is-active" : ""} onClick={() => { setStatus(tab.value); setPage(1); }}>{tab.label}</button>)}
          </div>
          <form className="adm-search" role="search" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}>
            <AdminIcon name="search" size={18} />
            <input type="search" aria-label="Поиск заявок" placeholder="Найти заявку…" maxLength={160} value={search} onChange={(event) => setSearch(event.target.value)} />
            <button type="submit" className="adm-search-submit">Найти</button>
          </form>
        </div>
        {result.loading ? <AdminLoading /> : result.error ? <div className="adm-panel-pad"><AdminNotice>{result.error} <button className="adm-inline-button" onClick={result.reload}>Повторить</button></AdminNotice></div> : result.data && (
          result.data.submissions.length ? <>
            <div className="adm-submission-list">
              {result.data.submissions.map((submission) => <Link className="adm-submission-row" href={`/admin/submissions/${submission.id}`} key={submission.id}>
                <span className="adm-submission-thumb">
                  {submission.images[0] ? (
                    // This authenticated image endpoint must not use public image optimization.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={submission.images[0].url} width={96} height={80} alt="" />
                  ) : <AdminIcon name="posts" size={28} />}
                  {submission.images.length > 0 && <span>{submission.images.length} фото</span>}
                </span>
                <span className="adm-submission-copy">
                  <span className="adm-submission-row-meta"><SubmissionBadge status={submission.status} /><time dateTime={submission.createdAt}>{dateLabel(submission.createdAt)} МСК</time></span>
                  <strong>{submission.title || "Без заголовка"}</strong>
                  <span className="adm-submission-excerpt">{submission.content.slice(0, 240)}</span>
                  <span className="adm-submission-author">{submission.anonymous ? "Анонимный отправитель" : submission.publicAuthorName || "Имя не указано"}{submission.category ? ` · ${submission.category.name}` : " · Категория не выбрана"}</span>
                </span>
                <span className="adm-submission-open">Открыть<AdminIcon name="arrow" size={16} /></span>
              </Link>)}
            </div>
            <div className="adm-pagination">
              <span>Всего: {result.data.total}</span>
              <div><button className="adm-button adm-button-small" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Назад</button><span>{page} / {Math.max(1, result.data.totalPages)}</span><button className="adm-button adm-button-small" type="button" disabled={page >= result.data.totalPages} onClick={() => setPage(page + 1)}>Далее</button></div>
            </div>
          </> : <div className="adm-empty">
            <span className="adm-empty-icon"><AdminIcon name="check" size={30} /></span>
            <h3>{query ? "Ничего не найдено" : status === "PENDING" ? "Все заявки разобраны" : "Заявок пока нет"}</h3>
            <p>{query ? "Попробуйте другой запрос или сбросьте фильтры." : status === "PENDING" ? "Когда читатель предложит новость, она появится здесь. Автоматической публикации нет." : "В этом разделе появятся заявки читателей с выбранным статусом."}</p>
            {(query || status !== "ALL") && <button type="button" className="adm-button" onClick={resetFilters}>Показать все заявки</button>}
          </div>
        )}
      </section>
    </>
  );
}
