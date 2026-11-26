"use client";

import { useSyncExternalStore } from "react";
import { themeStorageKey } from "@/lib/theme-bootstrap";

type Theme = "light" | "dark";
const changeEvent = "my-kineshma:theme-change";
let temporaryChoice: Theme | null = null;

function preference(): Theme | null {
  if (temporaryChoice) return temporaryChoice;
  try {
    const value = localStorage.getItem(themeStorageKey);
    return value === "light" || value === "dark" ? value : null;
  } catch { return null; }
}
function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => {
    meta.content = theme === "dark" ? "#191b1f" : "#eef2f5";
  });
  window.dispatchEvent(new Event(changeEvent));
}
function subscribe(listener: () => void) {
  const syncPreference = () => applyTheme(preference() ?? "dark");
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== themeStorageKey && event.key !== null) return;
    temporaryChoice = null;
    syncPreference();
  };
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", storageChanged);
  syncPreference();
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", storageChanged);
  };
}
function serverTheme(): Theme { return "dark"; }

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, currentTheme, serverTheme);
  function toggle() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    temporaryChoice = next;
    try { localStorage.setItem(themeStorageKey, next); temporaryChoice = null; } catch { /* A blocked store must not prevent switching this page. */ }
    applyTheme(next);
  }
  return (
    <button type="button" className="theme-toggle" role="switch" aria-checked={theme === "dark"}
      aria-label="Тёмная тема" title={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"} onClick={toggle}>
      <span className="theme-toggle-thumb" aria-hidden="true" />
      <svg className="theme-toggle-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </svg>
      <svg className="theme-toggle-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5a8.5 8.5 0 1 0 10.9 10.9Z" />
      </svg>
    </button>
  );
}
