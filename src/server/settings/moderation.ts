import "server-only";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/server/http";

export async function getModerationSettings(tx: Prisma.TransactionClient = prisma, lock = false) {
  if (lock) await tx.$queryRaw`SELECT "id" FROM "SiteSettings" WHERE "id"='main' FOR SHARE`;
  const settings = await tx.siteSettings.findUnique({ where: { id: "main" } });
  if (!settings) throw new HttpError(503, "Настройки сайта ещё не подготовлены. Повторите позже.");
  return settings;
}
export async function adminSettings() {
  const [settings, categories] = await Promise.all([
    getModerationSettings(),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { settings, categories };
}
export async function updateModerationSettings(input: unknown) {
  const parsed = z.strictObject({
    commentsModerationEnabled: z.boolean(), postsModerationEnabled: z.boolean(),
    defaultCategoryId: z.uuid().nullable(), version: z.number().int().positive(),
  }).safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Проверьте настройки модерации.");
  const { version, ...data } = parsed.data;
  await prisma.$transaction(async tx => {
    if (!data.postsModerationEnabled && !data.defaultCategoryId) throw new HttpError(400, "Для публикаций без проверки выберите категорию по умолчанию.", { defaultCategoryId: "Выберите категорию." });
    if (data.defaultCategoryId && !(await tx.category.findUnique({ where: { id: data.defaultCategoryId }, select: { id: true } }))) throw new HttpError(400, "Категория больше не существует.");
    const updated = await tx.siteSettings.updateMany({ where: { id: "main", version }, data: { ...data, version: { increment: 1 } } });
    if (!updated.count) throw new HttpError(409, "Настройки уже изменены. Обновите страницу и повторите действие.");
  });
  return adminSettings();
}
