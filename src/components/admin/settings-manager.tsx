"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ThemeSelect } from "@/components/ui/theme-select";
import { AdminApiError, adminFetch, errorMessage } from "./api";
import { AdminIcon, AdminLoading, AdminNotice, PageHeading } from "./ui";

type Settings = { commentsModerationEnabled: boolean; postsModerationEnabled: boolean; defaultCategoryId: string | null; version: number };
type SettingsData = { settings: Settings; categories: { id: string; name: string }[] };

export function SettingsManager() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loadedRevision, setLoadedRevision] = useState(-1);
  useEffect(() => {
    const controller = new AbortController();
    adminFetch<SettingsData>("/api/admin/settings", { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setData(result); setLoadedRevision(revision); setError(""); } }).catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, [revision]);
  if (error) return <><PageHeading eyebrow="ПРАВИЛА СООБЩЕСТВА" title="Настройки" description="Управляйте проверкой публикаций и комментариев." /><AdminNotice>{error} <button type="button" className="adm-inline-button" onClick={() => setRevision(value => value + 1)}>Повторить</button></AdminNotice></>;
  if (!data || loadedRevision !== revision) return <AdminLoading />;
  return <SettingsForm key={revision} initial={data} reload={() => setRevision(value => value + 1)} />;
}

function SettingsForm({ initial, reload }: { initial: SettingsData; reload: () => void }) {
  const [settings, setSettings] = useState(initial.settings);
  const [saved, setSaved] = useState(initial.settings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings(current => ({ ...current, [key]: value })); setSuccess(""); setError(""); }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    if (!settings.postsModerationEnabled && !settings.defaultCategoryId) { setError("Выберите категорию, в которую будут попадать публикации без проверки."); return; }
    setPending(true); setError(""); setSuccess(""); setConflict(false);
    try {
      const result = await adminFetch<SettingsData>("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ commentsModerationEnabled: settings.commentsModerationEnabled, postsModerationEnabled: settings.postsModerationEnabled, defaultCategoryId: settings.defaultCategoryId, version: settings.version }) });
      setSettings(result.settings); setSaved(result.settings); setSuccess("Настройки сохранены. Они применяются к новым отправкам.");
    } catch (reason) { setError(errorMessage(reason)); if (reason instanceof AdminApiError) setConflict(reason.status === 409); }
    finally { setPending(false); }
  }
  return <><PageHeading eyebrow="ПРАВИЛА СООБЩЕСТВА" title="Настройки модерации" description="Выберите, какие материалы нужно проверять перед появлением на сайте." />{error && <AdminNotice>{error}{conflict && <> <button type="button" className="adm-inline-button" onClick={() => { if (!dirty || window.confirm("Загрузить текущие настройки и отменить ваши несохранённые изменения?")) reload(); }}>Загрузить актуальные настройки</button></>}</AdminNotice>}{success && <AdminNotice kind="success">{success}</AdminNotice>}<form onSubmit={save} className="adm-settings-form"><div className="adm-settings-grid">
    <section className="adm-panel adm-panel-pad adm-setting-card"><span className="adm-setting-icon"><AdminIcon name="posts" size={24} /></span><h2>Публикации жителей</h2><p>Тексты, фотографии и видео, которые присылают через «Предложить публикацию».</p><label className="adm-setting-switch"><input type="checkbox" checked={settings.postsModerationEnabled} disabled={pending} onChange={event => change("postsModerationEnabled", event.target.checked)} /><span aria-hidden="true" /><strong>Проверять перед публикацией</strong></label><div className="adm-setting-state">{settings.postsModerationEnabled ? "Новые материалы попадут во «Входящие заявки». Их нужно будет одобрить вручную." : "Новые материалы сразу появятся в ленте. Редакция сможет отредактировать или скрыть их позже."}</div><div className="adm-field"><label htmlFor="settings-default-category">Категория для прямых публикаций</label><ThemeSelect id="settings-default-category" aria-label="Категория для прямых публикаций" value={settings.defaultCategoryId ?? ""} required={!settings.postsModerationEnabled} disabled={pending} onValueChange={value => change("defaultCategoryId", value || null)} aria-describedby="settings-default-category-hint" options={[{ value: "", label: "Выберите категорию" }, ...initial.categories.map(category => ({ value: category.id, label: category.name }))]} /><span className="adm-field-hint" id="settings-default-category-hint">Нужна, если проверка публикаций выключена.</span></div>{!initial.categories.length && <p><Link className="adm-text-link" href="/admin/categories">Создайте категорию</Link>, затем обновите эту страницу.</p>}<Link className="adm-text-link" href="/admin/submissions">Открыть входящие заявки →</Link></section>
    <section className="adm-panel adm-panel-pad adm-setting-card"><span className="adm-setting-icon"><AdminIcon name="edit" size={24} /></span><h2>Комментарии</h2><p>Комментарии и ответы читателей под публикациями сообщества.</p><label className="adm-setting-switch"><input type="checkbox" checked={settings.commentsModerationEnabled} disabled={pending} onChange={event => change("commentsModerationEnabled", event.target.checked)} /><span aria-hidden="true" /><strong>Проверять перед публикацией</strong></label><div className="adm-setting-state">{settings.commentsModerationEnabled ? "Новые комментарии и ответы будут ждать одобрения в кабинете." : "Новые комментарии и ответы сразу доступны читателям. Нежелательные сообщения можно скрыть или удалить."}</div><Link className="adm-text-link" href="/admin/comments">Открыть комментарии →</Link></section>
    </div><div className="adm-settings-footer"><p><AdminIcon name="lock" size={17} />Настройки независимы. Уже ожидающие материалы и комментарии не публикуются автоматически при выключении проверки.</p><div><span className="adm-save-indicator">{dirty ? "Есть несохранённые изменения" : "Настройки сохранены"}</span><button type="submit" className="adm-button adm-button-primary" disabled={pending || !dirty}>{pending ? "Сохраняем…" : "Сохранить настройки"}</button></div></div></form></>;
}
