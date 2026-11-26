"use client";

import Link from "next/link";
import { AdminIcon } from "@/components/admin/ui";

export default function AdminError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main className="adm-login">
      <section className="adm-login-card">
        <span className="adm-login-lock">
          <AdminIcon name="posts" size={25} />
        </span>
        <p className="adm-eyebrow">КАБИНЕТ РЕДАКЦИИ</p>
        <h1>Не удалось открыть страницу</h1>
        <p className="adm-description">
          Сервер временно недоступен. Попробуйте снова. Если ошибка повторяется,
          обратитесь к владельцу сайта.
        </p>
        <div className="adm-button-row" style={{ marginTop: 25 }}>
          <button
            type="button"
            className="adm-button adm-button-primary"
            onClick={retry}
          >
            Попробовать снова
          </button>
          <Link href="/" className="adm-button">
            На сайт
          </Link>
        </div>
      </section>
    </main>
  );
}
