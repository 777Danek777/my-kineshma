import type { Metadata } from "next";
import "./admin.css";
import "./admin-theme.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "Кабинет редакции — Моя Кинешма",
    template: "%s — Кабинет редакции",
  },
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
