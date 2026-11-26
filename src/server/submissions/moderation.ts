import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { HttpError } from "@/server/http";
import { imageDto, slugFor } from "@/server/news/service";
import { removeImageFile } from "@/server/uploads/images";

export const submissionInclude = {
  category: true,
  post: { select: { id: true, slug: true, status: true } },
  images: { orderBy: { order: "asc" as const }, include: { media: true } },
} satisfies Prisma.SubmissionInclude;
type SubmissionRecord = Prisma.SubmissionGetPayload<{
  include: typeof submissionInclude;
}>;
const versionSchema = z.strictObject({ version: z.number().int().positive() });
const editSchema = z.strictObject({
  version: z.number().int().positive(),
  title: z
    .string()
    .trim()
    .max(180, "Заголовок — не более 180 символов."),
  content: z
    .string()
    .trim()
    .max(20_000, "Текст — не более 20 000 символов."),
  categoryId: z.uuid("Выберите категорию.").nullable(),
  imageIds: z
    .array(z.uuid())
    .max(4)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Фотографии не должны повторяться.",
    ),
  videoIds: z.array(z.uuid()).max(1, "Можно прикрепить одно видео.").optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues)
      fields[String(issue.path[0] ?? "form")] ??= issue.message;
    throw new HttpError(400, "Проверьте поля материала.", fields);
  }
  return result.data;
}

export function submissionDto(item: SubmissionRecord) {
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    status: item.status,
    version: item.version,
    anonymous: item.anonymous,
    senderName: item.senderName,
    publicAuthorName: item.publicAuthorName,
    contact: item.contact,
    categoryId: item.categoryId,
    category: item.category
      ? {
          id: item.category.id,
          name: item.category.name,
          slug: item.category.slug,
        }
      : null,
    post: item.post,
    images: item.images.filter(({media})=>media.kind === "IMAGE").map(({ media }) => imageDto(media)),
    videos: item.images.filter(({media})=>media.kind === "VIDEO").map(({ media }) => imageDto(media)),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    reviewedAt: item.reviewedAt?.toISOString() ?? null,
  };
}

async function lockedSubmission(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${id} FOR UPDATE`;
  const current = await tx.submission.findUnique({
    where: { id },
    include: submissionInclude,
  });
  if (!current)
    throw new HttpError(404, "Заявка не найдена. Возможно, она уже удалена.");
  return current;
}

function checkVersion(current: SubmissionRecord, version: number) {
  if (current.version !== version)
    throw new HttpError(
      409,
      "Заявка уже изменена в другой вкладке. Обновите страницу перед сохранением.",
    );
}

async function validateEdit(
  tx: Prisma.TransactionClient,
  current: SubmissionRecord,
  data: z.infer<typeof editSchema>,
  publish: boolean,
) {
  if (publish && !data.categoryId)
    throw new HttpError(400, "Перед публикацией выберите категорию.", {
      categoryId: "Выберите категорию.",
    });
  if (
    data.categoryId &&
    !(await tx.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    }))
  )
    throw new HttpError(400, "Категория больше не существует.", {
      categoryId: "Выберите другую категорию.",
    });
  const available = new Set(current.images.filter(image=>image.media.kind==="IMAGE").map((image) => image.mediaId));
  if (data.imageIds.some((id) => !available.has(id)))
    throw new HttpError(
      400,
      "Можно использовать только фотографии этой заявки.",
    );
  const videos = data.videoIds ?? current.images.filter(image=>image.media.kind==="VIDEO").map(image=>image.mediaId);
  const availableVideos = new Set(current.images.filter(image=>image.media.kind==="VIDEO").map(image=>image.mediaId));
  if (videos.some(id=>!availableVideos.has(id))) throw new HttpError(400,"Можно использовать только видео этой заявки.");
  if (!data.title && !data.content && !data.imageIds.length && !videos.length) throw new HttpError(400,"Добавьте текст или оставьте хотя бы одно вложение.");
}

function selectedMedia(current: SubmissionRecord, data: z.infer<typeof editSchema>) {
  return [...data.imageIds, ...(data.videoIds ?? current.images.filter(image=>image.media.kind==="VIDEO").map(image=>image.mediaId))];
}

async function replaceImages(
  tx: Prisma.TransactionClient,
  current: SubmissionRecord,
  imageIds: string[],
) {
  await tx.submissionImage.deleteMany({ where: { submissionId: current.id } });
  if (imageIds.length)
    await tx.submissionImage.createMany({
      data: imageIds.map((mediaId, order) => ({
        submissionId: current.id,
        mediaId,
        order,
      })),
    });
  return current.images
    .filter((image) => !imageIds.includes(image.mediaId))
    .map((image) => image.mediaId);
}

// Never unlink a photograph that is still attached to a publication or application.
async function purgeDetached(ids: string[]) {
  for (const id of ids) {
    try {
      const image = await prisma.mediaAsset.findUnique({
        where: { id },
        select: { filename: true },
      });
      if (!image) continue;
      const deleted = await prisma.mediaAsset.deleteMany({
        where: {
          id,
          uploadedById: null,
          posts: { none: {} },
          submissions: { none: {} },
        },
      });
      if (deleted.count) await removeImageFile(image.filename);
    } catch {
      console.error("Unable to clean a detached submission photograph");
    }
  }
}

export async function saveSubmission(id: string, input: unknown) {
  const data = parse(editSchema, input);
  const result = await prisma.$transaction(async (tx) => {
    const current = await lockedSubmission(tx, id);
    checkVersion(current, data.version);
    if (current.status === "APPROVED")
      throw new HttpError(
        409,
        "Заявка уже опубликована. Редактируйте связанную публикацию.",
      );
    await validateEdit(tx, current, data, false);
    const removed = await replaceImages(tx, current, selectedMedia(current, data));
    const updated = await tx.submission.update({
      where: { id },
      data: {
        title: data.title,
        content: data.content,
        categoryId: data.categoryId,
        version: { increment: 1 },
      },
      include: submissionInclude,
    });
    return { submission: submissionDto(updated), removed };
  });
  await purgeDetached(result.removed);
  return { submission: result.submission };
}

export async function approveSubmission(
  id: string,
  input: unknown,
  reviewerId: string,
) {
  const data = parse(editSchema, input);
  const result = await prisma.$transaction(async (tx) => {
    const current = await lockedSubmission(tx, id);
    if (current.status === "APPROVED") {
      if (!current.post)
        throw new HttpError(
          409,
          "Связанная публикация удалена. Повторная публикация этой заявки недоступна.",
        );
      return {
        submission: submissionDto(current),
        post: current.post,
        removed: [] as string[],
      };
    }
    checkVersion(current, data.version);
    await validateEdit(tx, current, data, true);
    const removed = await replaceImages(tx, current, selectedMedia(current, data));
    const post = await tx.post.create({
      data: {
        title: data.title,
        content: data.content,
        excerpt: data.content.replace(/\s+/g, " ").slice(0, 220),
        categoryId: data.categoryId!,
        authorId: reviewerId,
        status: "PUBLISHED",
        sourceType: "RESIDENT",
        publicAuthorName: current.publicAuthorName,
        slug: slugFor(data.title || data.content.slice(0,80) || "Публикация"),
        publishedAt: new Date(),
        images: {
          create: selectedMedia(current, data).map((mediaId, order) => ({ mediaId, order })),
        },
      },
      select: { id: true, slug: true, status: true },
    });
    const updated = await tx.submission.update({
      where: { id },
      data: {
        title: data.title,
        content: data.content,
        categoryId: data.categoryId,
        status: "APPROVED",
        postId: post.id,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        version: { increment: 1 },
      },
      include: submissionInclude,
    });
    return { submission: submissionDto(updated), post, removed };
  });
  await purgeDetached(result.removed);
  return { submission: result.submission, post: result.post };
}

export async function rejectSubmission(
  id: string,
  input: unknown,
  reviewerId: string,
) {
  const { version } = parse(versionSchema, input);
  return prisma.$transaction(async (tx) => {
    const current = await lockedSubmission(tx, id);
    checkVersion(current, version);
    if (current.status === "APPROVED")
      throw new HttpError(
        409,
        "Заявка уже опубликована. Снять новость с публикации можно в разделе «Публикации».",
      );
    const updated =
      current.status === "REJECTED"
        ? current
        : await tx.submission.update({
            where: { id },
            data: {
              status: "REJECTED",
              reviewedById: reviewerId,
              reviewedAt: new Date(),
              version: { increment: 1 },
            },
            include: submissionInclude,
          });
    return { submission: submissionDto(updated) };
  });
}

export async function deleteSubmission(id: string, input: unknown) {
  const { version } = parse(versionSchema, input);
  const ids = await prisma.$transaction(async (tx) => {
    const current = await lockedSubmission(tx, id);
    checkVersion(current, version);
    await tx.submission.delete({ where: { id } });
    return current.images.map((image) => image.mediaId);
  });
  await purgeDetached(ids);
  return { success: true };
}
