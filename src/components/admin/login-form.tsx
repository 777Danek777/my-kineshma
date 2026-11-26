"use client";

import Link from "next/link";
import { useState } from "react";
import { AdminIcon, AdminNotice } from "./ui";
import { ThemeToggle } from "@/components/theme-toggle";

export function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email")).trim(),
          password: form.get("password"),
          rememberMe: false,
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Слишком много попыток входа. Подождите несколько минут и попробуйте снова."
            : "Не удалось войти. Проверьте почту и пароль и попробуйте снова.",
        );
        setBusy(false);
        return;
      }
      // A full request prevents a previously cached anonymous route from surviving sign-in.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/admin");
    } catch {
      setError(
        "Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="adm-login">
      <div className="adm-login-theme"><ThemeToggle /></div>
      <div className="adm-login-brand">
        <span className="adm-brand-mark">
          м<span>к</span>
        </span>
        <span>моя кинешма</span>
      </div>
      <div className="adm-login-card">
        <span className="adm-login-lock">
          <AdminIcon name="lock" size={26} />
        </span>
        <p className="adm-eyebrow">КАБИНЕТ РЕДАКЦИИ</p>
        <h1>С возвращением</h1>
        <p className="adm-description">
          Войдите, чтобы управлять публикациями сайта.
        </p>
        <form onSubmit={submit} className="adm-login-form">
          {error && <AdminNotice>{error}</AdminNotice>}
          <label className="adm-field">
            Электронная почта
            <input
              type="email"
              name="email"
              autoComplete="username"
              placeholder="name@example.ru"
              required
              disabled={busy}
            />
          </label>
          <label className="adm-field">
            Пароль
            <span className="adm-password-wrap">
              <input
                type={visible ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                required
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
              >
                {visible ? "Скрыть" : "Показать"}
              </button>
            </span>
          </label>
          <button
            type="submit"
            className="adm-button adm-button-primary adm-login-submit"
            disabled={busy}
          >
            {busy ? "Входим…" : "Войти в кабинет"}
          </button>
        </form>
        <p className="adm-login-help">
          Доступ только для редакции.
          <br />
          Если вы забыли пароль, обратитесь к владельцу сайта.
        </p>
      </div>
      <Link href="/" className="adm-login-back">
        Вернуться на сайт
      </Link>
    </main>
  );
}
