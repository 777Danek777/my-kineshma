import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { themeBootstrap, themeStorageKey } from "../src/lib/theme-bootstrap";

function bootstrap(saved: string | null, blocked = false, systemDark = false) {
  const attrs: Record<string, string> = {};
  const meta: Record<string, string> = {};
  const style = { colorScheme: "" };
  runInNewContext(themeBootstrap, {
    localStorage: { getItem(key: string) { assert.equal(key, themeStorageKey); if (blocked) throw new Error("Storage unavailable"); return saved; } },
    window: { matchMedia() { return { matches: systemDark }; } },
    document: {
      documentElement: { style, setAttribute(key: string, value: string) { attrs[key] = value; } },
      querySelector(selector: string) { assert.equal(selector, 'meta[name="theme-color"]'); return { setAttribute(key: string, value: string) { meta[key] = value; } }; },
    },
  });
  return { theme: attrs["data-theme"], scheme: style.colorScheme, color: meta.content };
}

test("first visit is dark even with a light system preference", () => {
  assert.deepEqual(bootstrap(null), { theme: "dark", scheme: "dark", color: "#191b1f" });
  assert.equal(bootstrap(null, false, true).theme, "dark");
});
test("explicit saved light and dark preferences are preserved", () => {
  assert.deepEqual(bootstrap("light", false, true), { theme: "light", scheme: "light", color: "#eef2f5" });
  assert.equal(bootstrap("dark").theme, "dark");
});
test("invalid values and unavailable storage fall back to dark", () => {
  assert.equal(bootstrap("invalid").theme, "dark");
  assert.equal(bootstrap("light", true).theme, "dark");
});
test("bootstrap works without matchMedia, meta or storage globals", () => {
  let theme = "";
  runInNewContext(themeBootstrap, { document: { documentElement: { style: {}, setAttribute(_key: string, value: string) { theme = value; } }, querySelector() { return null; } } });
  assert.equal(theme, "dark");
});
