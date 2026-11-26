import { prisma } from "@/server/db/client";
import {
  adminRequest,
  apiError,
  HttpError,
  noStoreJson,
  readJson,
} from "@/server/http";
import { categoryName, validId } from "@/server/news/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    await adminRequest(request, true);
    const id = validId((await context.params).id);
    const name = categoryName(await readJson(request));
    if (
      await prisma.category.findFirst({
        where: { id: { not: id }, name: { equals: name, mode: "insensitive" } },
      })
    )
      throw new HttpError(409, "Такая категория уже существует.");
    const category = await prisma.category.update({
      where: { id },
      data: { name },
      include: { _count: { select: { posts: true } } },
    });
    return noStoreJson({
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        postCount: category._count.posts,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    await adminRequest(request, true);
    const id = validId((await context.params).id);
    if (await prisma.siteSettings.count({where:{defaultCategoryId:id}})) throw new HttpError(409, "Сначала выберите другую категорию по умолчанию в настройках модерации.");
    if (await prisma.post.count({ where: { categoryId: id } }))
      throw new HttpError(
        409,
        "Сначала перенесите публикации из этой категории в другую. Затем категорию можно удалить.",
      );
    await prisma.category.delete({ where: { id } });
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
