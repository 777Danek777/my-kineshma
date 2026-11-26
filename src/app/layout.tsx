import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope";
import "./globals.css";
import "./theme.css";
import { themeBootstrap } from "@/lib/theme-bootstrap";

export const metadata: Metadata = {
  title: "Моя Кинешма — Город. Люди. События",
  description:
    "Моя Кинешма — городское интернет-сообщество. Истории жителей, фотографии, события, объявления и всё, чем живёт город.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#191b1f",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body>{children}</body>
    </html>
  );
}
