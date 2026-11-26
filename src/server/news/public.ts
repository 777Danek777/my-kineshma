import "server-only";
import { cache } from "react";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import type { PublicNewsPost, PublicNewsSummary } from "@/lib/public-types";

const mediaSelect = { id: true, width: true, height: true, alt: true, kind: true, mimeType: true, duration: true } as const;
const publicationSelect = {
  slug: true,
  title: true,
  excerpt: true,
  content: true,
  publishedAt: true,
  sourceType: true,
  sourceName: true,
  sourceUrl: true,
  videoUrl: true,
  publicAuthorName: true,
  category: { select: { name: true } },
  _count: { select: { likes: true, comments: { where: { status: "APPROVED" as const, OR: [{parentId:null}, {parent:{status:"APPROVED" as const,parentId:null}}] } } } },
} satisfies Prisma.PostSelect;

function readingMinutes(content: string) {
  return Math.max(1, Math.ceil(content.trim().split(/\s+/u).length / 180));
}

export async function getPublishedNews(): Promise<PublicNewsSummary[]> {
  const posts = await prisma.post.findMany({
    where: { status: "PUBLISHED", publishedAt: { not: null } },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      ...publicationSelect,
      images: {
        orderBy: { order: "asc" },
        select: { media: { select: mediaSelect } },
      },
    },
  });

  return posts.map((post) => ({
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    publicAuthorName: post.publicAuthorName,
    category: post.category.name,
    image: post.images.find(({media}) => media.kind === "IMAGE")?.media ?? null,
    images: post.images.filter(({media}) => media.kind === "IMAGE").map(({ media }) => media),
    videos: post.images.filter(({media}) => media.kind === "VIDEO").map(({ media }) => media),
    sourceType: post.sourceType,
    sourceName: post.sourceName,
    sourceUrl: post.sourceUrl,
    videoUrl: post.videoUrl,
    readingMinutes: readingMinutes(post.content),
    publishedAt: post.publishedAt!.toISOString(),
    social: { likeCount: post._count.likes, commentCount: post._count.comments },
  }));
}

export async function getPublicCategories(): Promise<string[]> {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { name: true },
  });
  return categories.map((category) => category.name);
}

// React cache deduplicates metadata/page reads within one render only.
// No persistent cache: an unpublished article must stop being public at once.
export const getPublishedArticle = cache(
  async (slug: string): Promise<PublicNewsPost | null> => {
    const post = await prisma.post.findFirst({
      where: { slug, status: "PUBLISHED", publishedAt: { not: null } },
      select: {
        ...publicationSelect,
        images: {
          orderBy: { order: "asc" },
          select: { media: { select: mediaSelect } },
        },
      },
    });
    if (!post) return null;

    const images = post.images.filter(({media}) => media.kind === "IMAGE").map(({ media }) => media);
    return {
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      category: post.category.name,
      image: images[0] ?? null,
      images,
      content: post.content,
      publicAuthorName: post.publicAuthorName,
      videos: post.images.filter(({media}) => media.kind === "VIDEO").map(({ media }) => media),
      sourceType: post.sourceType,
      sourceName: post.sourceName,
      sourceUrl: post.sourceUrl,
      videoUrl: post.videoUrl,
      readingMinutes: readingMinutes(post.content),
      publishedAt: post.publishedAt!.toISOString(),
      social: { likeCount: post._count.likes, commentCount: post._count.comments },
    };
  },
);
