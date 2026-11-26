export type PublicMedia = {
  id: string;
  width: number;
  height: number;
  alt: string;
  kind?: "IMAGE" | "VIDEO";
  mimeType?: string;
  duration?: number | null;
};

export type PublicationSourceType =
  "COMMUNITY" | "RESIDENT" | "OFFICIAL" | "EXTERNAL";

export const sourceLabels: Record<PublicationSourceType, string> = {
  COMMUNITY: "Публикация сообщества",
  RESIDENT: "От жителя",
  OFFICIAL: "Официальное сообщение",
  EXTERNAL: "Сторонний источник",
};

// String image paths and sample body paragraphs are used only on /demo.
export type HomeArticle = {
  slug: string;
  title: string;
  excerpt: string;
  content?: string;
  publicAuthorName?: string | null;
  videos?: PublicMedia[];
  category: string;
  image: PublicMedia | string | null;
  images?: (PublicMedia | string)[];
  imageAlt?: string;
  sourceType?: PublicationSourceType;
  sourceName?: string | null;
  sourceUrl?: string | null;
  videoUrl?: string | null;
  readingMinutes: number;
  publishedAt?: string;
  body?: readonly string[];
  social?: { likeCount: number; commentCount: number };
};

export type PublicNewsSummary = Omit<
  HomeArticle,
  | "image"
  | "images"
  | "body"
  | "publishedAt"
  | "sourceType"
  | "sourceName"
  | "sourceUrl"
  | "videoUrl"
> & {
  image: PublicMedia | null;
  images: PublicMedia[];
  sourceType: PublicationSourceType;
  sourceName: string | null;
  sourceUrl: string | null;
  videoUrl: string | null;
  publishedAt: string;
};

export type PublicNewsPost = PublicNewsSummary & {
  content: string;
  images: PublicMedia[];
};

export function formatPublicationDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

export function formatPublicationTime(value: string) {
  return `${new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value))} МСК`;
}
