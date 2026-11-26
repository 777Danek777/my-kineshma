import { prisma } from "@/server/db/client";
import { adminRequest, apiError, noStoreJson, readJson } from "@/server/http";
import { categoryName, slugFor } from "@/server/news/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await adminRequest(request);
    const rows = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { posts: true } } },
    });
    return noStoreJson({
      categories: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        postCount: row._count.posts,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    await adminRequest(request, true);
    const name = categoryName(await readJson(request));
    const duplicate = await prisma.category.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (duplicate)
      return noStoreJson({ error: "Такая категория уже существует." }, 409);
    const category = await prisma.category.create({
      data: { name, slug: slugFor(name) },
    });
    return noStoreJson({ category: { ...category, postCount: 0 } }, 201);
  } catch (error) {
    return apiError(error);
  }
}
