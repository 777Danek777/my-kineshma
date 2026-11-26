import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { HttpError } from "@/server/http";

const statusSchema = z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]);
const sourceTypeSchema = z.enum([
  "COMMUNITY",
  "RESIDENT",
  "OFFICIAL",
  "EXTERNAL",
]);

const optionalHttpsUrl = z
  .string()
  .trim()
  .max(2048, "Ссылка — не более 2048 символов.")
  .refine((value) => {
    if (!value) return true;
    if (
      !/^https:\/\//i.test(value) ||
      Array.from(value).some(
        (character) =>
          character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
      )
    )
      return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Укажите полную ссылку https:// без логина, пароля и пробелов.")
  .transform((value) => value || null)
  .nullable()
  .optional();

const sourceFields = {
  sourceType: sourceTypeSchema.optional(),
  sourceName: z
    .string()
    .trim()
    .max(100, "Название источника — не более 100 символов.")
    .transform((value) => value || null)
    .nullable()
    .optional(),
  sourceUrl: optionalHttpsUrl,
  videoUrl: optionalHttpsUrl,
};
const fields = {
  title: z
    .string()
    .trim()
    .max(180, "Заголовок — не более 180 символов."),
  content: z.string().trim().max(50_000, "Текст — не более 50 000 символов."),
  categoryId: z.uuid("Выберите категорию."),
  imageIds: z
    .array(z.uuid())
    .max(6, "Можно прикрепить до 6 фотографий.")
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Фотографии не должны повторяться.",
    ),
  videoIds: z.array(z.uuid()).max(1, "Можно прикрепить одно видео."),
  status: statusSchema,
};
const createSchema = z.strictObject({ ...fields, videoIds: fields.videoIds.default([]), ...sourceFields });
const updateSchema = z.strictObject({
  ...(Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value.optional()]),
  ) as { [K in keyof typeof fields]: z.ZodOptional<(typeof fields)[K]> }),
  ...sourceFields,
  version: z.number().int().positive(),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? "form");
      errors[field] ??= issue.message;
    }
    throw new HttpError(400, "Проверьте поля публикации.", errors);
  }
  return result.data;
}

export function slugFor(title: string) {
  const source = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
  const target = [
    "a",
    "b",
    "v",
    "g",
    "d",
    "e",
    "e",
    "zh",
    "z",
    "i",
    "y",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "r",
    "s",
    "t",
    "u",
    "f",
    "kh",
    "ts",
    "ch",
    "sh",
    "sch",
    "",
    "y",
    "",
    "e",
    "yu",
    "ya",
  ];
  const normalized = title
    .toLowerCase()
    .split("")
    .map((letter) => {
      const index = source.indexOf(letter);
      return index < 0 ? letter : target[index];
    })
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90)
    .replace(/-$/g, "");
  return `${normalized || "novost"}-${randomUUID().slice(0, 8)}`;
}

export const postInclude = {
  category: true,
  images: { orderBy: { order: "asc" as const }, include: { media: true } },
} satisfies Prisma.PostInclude;
type PostRecord = Prisma.PostGetPayload<{ include: typeof postInclude }>;

export function imageDto(image: {
  id: string;
  width: number;
  height: number;
  alt: string;
  kind?: "IMAGE" | "VIDEO";
  mimeType?: string;
  duration?: number | null;
}) {
  return {
    id: image.id,
    url: `/media/${image.id}`,
    width: image.width,
    height: image.height,
    alt: image.alt,
    kind: image.kind ?? "IMAGE",
    mimeType: image.mimeType ?? "image/webp",
    duration: image.duration ?? null,
  };
}

export function postDto(post: PostRecord) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    content: post.content,
    excerpt: post.excerpt,
    status: post.status,
    sourceType: post.sourceType,
    sourceName: post.sourceName,
    sourceUrl: post.sourceUrl,
    videoUrl: post.videoUrl,
    publicAuthorName: post.publicAuthorName,
    version: post.version,
    categoryId: post.categoryId,
    category: {
      id: post.category.id,
      name: post.category.name,
      slug: post.category.slug,
    },
    images: post.images.filter(image => image.media.kind === "IMAGE").map((image) => imageDto(image.media)),
    videos: post.images.filter(image => image.media.kind === "VIDEO").map((image) => imageDto(image.media)),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    publishedAt: post.publishedAt?.toISOString() ?? null,
  };
}

async function validateRelations(
  tx: Prisma.TransactionClient,
  data: z.infer<typeof createSchema>,
) {
  if (
    !(await tx.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    }))
  )
    throw new HttpError(400, "Выбранная категория больше не существует.", {
      categoryId: "Выберите другую категорию.",
    });
  if (
    (await tx.mediaAsset.count({ where: { id: { in: data.imageIds }, kind: "IMAGE" } })) !==
    data.imageIds.length
  )
    throw new HttpError(
      400,
      "Одна из фотографий не найдена. Загрузите её заново.",
    );
  if ((await tx.mediaAsset.count({ where: { id: { in: data.videoIds }, kind: "VIDEO" } })) !== data.videoIds.length) throw new HttpError(400, "Видео не найдено. Загрузите его заново.");
  if (data.status === "PUBLISHED" && !data.title && !data.content && !data.imageIds.length && !data.videoIds.length && !data.videoUrl)
    throw new HttpError(400, "Добавьте текст, фотографию или видео перед публикацией.");
}

export async function createPost(input: unknown, authorId: string) {
  const data = parse(createSchema, input);
  return prisma.$transaction(async (tx) => {
    await validateRelations(tx, data);
    const post = await tx.post.create({
      data: {
        title: data.title,
        content: data.content,
        excerpt: data.content.replace(/\s+/g, " ").slice(0, 220),
        categoryId: data.categoryId,
        status: data.status,
        sourceType: data.sourceType ?? "COMMUNITY",
        sourceName: data.sourceName ?? null,
        sourceUrl: data.sourceUrl ?? null,
        videoUrl: data.videoUrl ?? null,
        slug: slugFor(data.title || data.content.slice(0, 80) || "Публикация"),
        authorId,
        publishedAt: data.status === "PUBLISHED" ? new Date() : null,
        images: {
          create: [...data.imageIds, ...data.videoIds].map((mediaId, order) => ({ mediaId, order })),
        },
      },
      include: postInclude,
    });
    return postDto(post);
  });
}

export async function updatePost(id: string, input: unknown) {
  const patch = parse(updateSchema, input);
  return prisma.$transaction(async (tx) => {
    const current = await tx.post.findUnique({
      where: { id },
      include: postInclude,
    });
    if (!current) throw new HttpError(404, "Публикация не найдена.");
    if (current.version !== patch.version)
      throw new HttpError(
        409,
        "Новость уже изменена в другой вкладке. Обновите страницу перед сохранением.",
      );
    const data = parse(createSchema, {
      title: patch.title ?? current.title,
      content: patch.content ?? current.content,
      categoryId: patch.categoryId ?? current.categoryId,
      imageIds: patch.imageIds ?? current.images.filter(image => image.media.kind === "IMAGE").map((image) => image.mediaId),
      videoIds: patch.videoIds ?? current.images.filter(image => image.media.kind === "VIDEO").map((image) => image.mediaId),
      status: patch.status ?? current.status,
      sourceType: patch.sourceType ?? current.sourceType,
      sourceName:
        patch.sourceName === undefined ? current.sourceName : patch.sourceName,
      sourceUrl:
        patch.sourceUrl === undefined ? current.sourceUrl : patch.sourceUrl,
      videoUrl:
        patch.videoUrl === undefined ? current.videoUrl : patch.videoUrl,
    });
    await validateRelations(tx, data);
    const updated = await tx.post.updateMany({
      where: { id, version: patch.version },
      data: {
        title: data.title,
        content: data.content,
        excerpt: data.content.replace(/\s+/g, " ").slice(0, 220),
        categoryId: data.categoryId,
        status: data.status,
        sourceType: data.sourceType,
        sourceName: data.sourceName,
        sourceUrl: data.sourceUrl,
        videoUrl: data.videoUrl,
        version: { increment: 1 },
        publishedAt:
          data.status === "PUBLISHED"
            ? (current.publishedAt ?? new Date())
            : current.publishedAt,
      },
    });
    if (!updated.count)
      throw new HttpError(409, "Новость уже изменена. Обновите страницу.");
    await tx.postImage.deleteMany({ where: { postId: id } });
    if (data.imageIds.length || data.videoIds.length)
      await tx.postImage.createMany({
        data: [...data.imageIds, ...data.videoIds].map((mediaId, order) => ({
          postId: id,
          mediaId,
          order,
        })),
      });
    return postDto(
      await tx.post.findUniqueOrThrow({ where: { id }, include: postInclude }),
    );
  });
}

export async function deletePost(id: string, input: unknown) {
  const { version } = parse(
    z.strictObject({ version: z.number().int().positive() }),
    input,
  );
  const result = await prisma.post.deleteMany({ where: { id, version } });
  if (!result.count) {
    const exists = await prisma.post.findUnique({
      where: { id },
      select: { id: true },
    });
    throw new HttpError(
      exists ? 409 : 404,
      exists
        ? "Новость уже изменена. Обновите страницу перед удалением."
        : "Публикация не найдена.",
    );
  }
}

export function categoryName(input: unknown) {
  return parse(
    z.strictObject({
      name: z
        .string()
        .trim()
        .min(2, "Название — от 2 символов.")
        .max(60, "Название — не более 60 символов."),
    }),
    input,
  ).name.replace(/\s+/g, " ");
}

export function validId(value: string) {
  if (!z.uuid().safeParse(value).success)
    throw new HttpError(404, "Запись не найдена.");
  return value;
}
