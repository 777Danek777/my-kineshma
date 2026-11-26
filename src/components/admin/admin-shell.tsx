"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { adminFetch, errorMessage } from "./api";
import { AdminIcon, type IconName } from "./ui";
import { ThemeToggle } from "@/components/theme-toggle";

const navigation: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin", label: "Обзор", icon: "dashboard" },
  { href: "/admin/posts", label: "Публикации", icon: "posts" },
  { href: "/admin/submissions", label: "Входящие заявки", icon: "edit" },
  { href: "/admin/comments", label: "Комментарии", icon: "posts" },
  { href: "/admin/categories", label: "Категории", icon: "categories" },
  { href: "/admin/settings", label: "Настройки", icon: "dashboard" },
];

export function AdminShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      await adminFetch("/api/auth/sign-out", { method: "POST", body: "{}" });
      window.location.replace("/admin/login");
    } catch (error) {
      setError(errorMessage(error));
      setLoggingOut(false);
    }
  }
  const section = pathname.startsWith("/admin/categories")
    ? "Категории"
    : pathname.startsWith("/admin/settings")
      ? "Настройки"
    : pathname.startsWith("/admin/submissions")
      ? "Входящие заявки"
      : pathname.startsWith("/admin/comments")
        ? "Комментарии"
        : pathname.startsWith("/admin/posts")
          ? "Публикации"
          : "Обзор";
  return (
    <div className="adm-root">
      <a className="adm-skip" href="#admin-content">
        Перейти к содержимому
      </a>
      <aside className={`adm-sidebar${mobileOpen ? " adm-sidebar-open" : ""}`}>
        <Link
          className="adm-brand"
          href="/admin"
          onClick={() => setMobileOpen(false)}
        >
          <span className="adm-brand-mark">
            м<span>к</span>
          </span>
          <span>
            моя кинешма
            <span className="adm-brand-caption">Кабинет редакции</span>
          </span>
        </Link>
        <div className="adm-nav-caption">УПРАВЛЕНИЕ САЙТОМ</div>
        <nav aria-label="Разделы админки" className="adm-nav">
          {navigation.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === item.href
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={active ? "is-active" : ""}
                onClick={() => setMobileOpen(false)}
              >
                <AdminIcon name={item.icon} />
                {item.label}
                {active && <span className="adm-nav-dot" />}
              </Link>
            );
          })}
        </nav>
        <div className="adm-sidebar-note">
          <span className="adm-sidebar-note-icon">
            <AdminIcon name="edit" />
          </span>
          <strong>Истории вашего города</strong>
          <p>
            Создавайте материалы, сохраняйте идеи и делитесь новостями с
            читателями.
          </p>
          <Link href="/admin/posts/new" onClick={() => setMobileOpen(false)}>
            Написать новость
          </Link>
        </div>
        <div className="adm-sidebar-bottom">
          <Link href="/" className="adm-site-link">
            <AdminIcon name="external" size={18} />
            Открыть сайт
          </Link>
          <div className="adm-user">
            <span className="adm-avatar">
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{user.name || "Администратор"}</strong>
              <small title={user.email}>{user.email}</small>
            </span>
          </div>
          <button
            type="button"
            className="adm-logout"
            onClick={logout}
            disabled={loggingOut}
          >
            <AdminIcon name="logout" size={18} />
            {loggingOut ? "Выходим…" : "Выйти из аккаунта"}
          </button>
          {error && (
            <p role="alert" className="adm-sidebar-error">
              {error}
            </p>
          )}
        </div>
      </aside>
      {mobileOpen && (
        <button
          type="button"
          className="adm-overlay"
          aria-label="Закрыть меню"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className="adm-workspace">
        <header className="adm-topbar">
          <div className="adm-topbar-left">
            <button
              type="button"
              className="adm-menu-button"
              aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <AdminIcon name="menu" />
            </button>
            <span className="adm-breadcrumb">
              Редакция <span aria-hidden="true">/</span> <span>{section}</span>
            </span>
          </div>
          <div className="adm-topbar-actions"><span className="adm-protected">
            <AdminIcon name="lock" size={14} />
            Защищённый кабинет
          </span><ThemeToggle /></div>
        </header>
        <main id="admin-content" className="adm-main">
          {children}
        </main>
        <footer className="adm-footer">
          Моя Кинешма <span>Кабинет редакции</span>
        </footer>
      </div>
    </div>
  );
}
