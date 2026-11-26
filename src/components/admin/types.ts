import type { PublicationSourceType } from "@/lib/public-types";
export { sourceLabels, type PublicationSourceType } from "@/lib/public-types";

export type PostStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";

export type AdminImage = {
  id: string;
  url: string;
  width: number;
  height: number;
  alt: string;
  kind?: "IMAGE" | "VIDEO";
  mimeType?: string;
  duration?: number | null;
};

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  postCount: number;
};

export type AdminPost = {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  status: PostStatus;
  sourceType: PublicationSourceType;
  sourceName: string | null;
  sourceUrl: string | null;
  videoUrl: string | null;
  categoryId: string;
  category: Pick<AdminCategory, "id" | "name" | "slug">;
  images: AdminImage[];
  videos: AdminImage[];
  publicAuthorName?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export const statusLabels: Record<PostStatus, string> = {
  DRAFT: "Черновик",
  PUBLISHED: "Опубликовано",
  UNPUBLISHED: "Снято с публикации",
};

export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(date));
}
