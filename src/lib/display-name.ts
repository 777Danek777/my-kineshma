/** Public signatures, not account identities. Shared by the UI and server. */
export const ANONYMOUS_DISPLAY_NAME = "Житель Кинешмы";

export function normalizeDisplayName(value: string): string {
  return value.normalize("NFKC").trim() || ANONYMOUS_DISPLAY_NAME;
}

const transliteration: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
const substitutions: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "ch", "6": "b", "9": "ya", "@": "a", "$": "s" };
const lookalikes: Readonly<Record<string, string>> = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };

// Deliberately bounded word families: a substring such as «страх» or «сук»
// alone must not block real names. This is a basic filter, not a language model.
const prohibitedNames = [
  /^(?:(?:na|po|za|o|do|v|raz|ot|pere|vy)?eb(?:at|al|an|anut|nut|uch|ash|osh|la|lo|loy|liv|uch))[a-z0-9]*$/,
  /^(?:(?:na|po|za|o|do|v|raz|ot|pere|vy)?[hx](?:u|y)(?:i|y|j))(?:nya|ni|ne|nyu|lo|li|ev|ov|et|em|ey|ya|yu|i|a|u|e|o)?[a-z0-9]*$/,
  /^(?:za|na|vy|o|po|pro)?pizd[a-z0-9]*$/,
  /^bl(?:ya|ia)(?:(?:d|t)[a-z0-9]*)?$/,
  /^(?:s|c)uk(?:a|i|u|e|oi|oy|ami|in|ina|iny|ino|inyy)[0-9]*$/,
  /^(?:s|c)uch(?:ka|ki|ku|ke|ara|ary)[0-9]*$/,
  /^(?:mud(?:ak|aki|aka|ila|ilo)|dolboeb|pid[oa]r|pederast|g[ao]ndon|zalup)[a-z0-9]*$/,
  /^(?:fuck|motherfuck|bullshit|bitch|asshole|cunt|nigg(?:er|a)|faggot)[a-z0-9]*$/,
  /^shit(?:s|ty|ting|head|face|show|bag)?[0-9]*$/,
];

function containsProhibitedName(value: string): boolean {
  const lower = value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  // Check ordinary transliteration and visually substituted Latin letters.
  const variants = [lower, lower.replace(/[abcehkmoptxy]/g, char => lookalikes[char])];
  return variants.some(variant => [variant, variant.replace(/[013469@$]/g, char => substitutions[char])].some(spelling => {
    const canonical = spelling
      .replace(/[а-яё]/g, char => transliteration[char]);
    const words = canonical.match(/[a-z0-9]+/g) ?? [];
    // Also catches letters separated with spaces, dots, underscores or dashes.
    return [...words, words.join("")].some(word => prohibitedNames.some(pattern => pattern.test(word)));
  }));
}

export function validateDisplayName(value: string): string | null {
  // Reject invisible formatting/bidi controls rather than displaying a spoofed
  // signature. Validate before trim so a trailing line break is not swallowed.
  if (Array.from(value).some(char => /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(char))) {
    return "Имя должно быть в одну строку без невидимых и управляющих символов.";
  }
  const name = value.normalize("NFKC").trim();
  if (!name) return null;
  if (name.length < 2) return "Имя — от 2 символов, или оставьте поле пустым.";
  if (name.length > 60) return "Имя — не более 60 символов.";
  if (!/[\p{L}\p{N}]/u.test(name)) return "Добавьте буквы или цифры в имя либо оставьте поле пустым.";
  if (containsProhibitedName(name)) return "Выберите имя без мата и оскорбительных слов или отправьте без имени.";
  return null;
}
