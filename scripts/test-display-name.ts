import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANONYMOUS_DISPLAY_NAME,
  normalizeDisplayName,
  validateDisplayName,
} from "../src/lib/display-name";

function rejected(value: string) {
  const problem = validateDisplayName(value);
  assert.equal(typeof problem, "string", "An invalid nickname needs a validation error.");
  assert.ok(problem?.trim(), "A validation error must explain the rejection.");
}

test("blank optional names use the public anonymous signature", () => {
  assert.equal(ANONYMOUS_DISPLAY_NAME, "Житель Кинешмы");
  for (const value of ["", "   ", "\u00a0\u2002 "]) {
    assert.equal(validateDisplayName(value), null);
    assert.equal(normalizeDisplayName(value), "Житель Кинешмы");
  }
});

test("normalization trims and applies NFKC without transliterating a valid name", () => {
  assert.equal(normalizeDisplayName("  Ａｎｎａ  "), "Anna");
  assert.equal(normalizeDisplayName(" Е\u0308лка "), "Ёлка");
  assert.equal(normalizeDisplayName(" Пётр Ильин "), "Пётр Ильин");
  assert.equal(normalizeDisplayName("Сосед_42"), "Сосед_42");
});

test("ordinary names and innocent word fragments remain permitted", () => {
  for (const name of ["Оксана", "Хуго", "Худяков", "Суконников", "Бляхер", "Шитов", "Шитова", "Shitov", "Евгений", "Anna", "Иван-Петров", "Сосед_42", "42"]) {
    assert.equal(validateDisplayName(name), null, `An ordinary nickname was rejected: ${name}`);
  }
});

test("nonempty nicknames enforce the two-to-sixty character boundary", () => {
  assert.equal(validateDisplayName("Ян"), null);
  assert.equal(validateDisplayName("А".repeat(60)), null);
  rejected("Я");
  rejected("А".repeat(61));
  rejected(" Ａ ");
});

test("explicit profanity and insulting nicknames are rejected regardless of case", () => {
  for (const name of ["хуй", "ДОЛБОЁБ", "Мудак", "СУКА", "сука123", "БЛЯТЬ"]) rejected(name);
});

test("obvious separator, mixed-script and compatibility-character bypasses are rejected", () => {
  for (const name of ["х.у.й", "х_у_й", "xуй", "ｆｕｃｋ", "хўй", "хӱй", "ху\u0308й"]) rejected(name);
});

test("invisible controls cannot spoof a visible nickname", () => {
  for (const name of ["Анна\n", "Ан\u0000на", "\u202eИван", "Ан\u200bна"]) rejected(name);
});
