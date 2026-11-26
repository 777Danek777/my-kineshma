import { prisma } from "@/server/db/client";
import {
  adminRequest,
  apiError,
  HttpError,
  noStoreJson,
  readJson,
} from "@/server/http";
import { createPost, postDto, postInclude } from "@/server/news/service";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await adminRequest(request);
    const query = new URL(request.url).searchParams;
    const q = (query.get("q") || "").trim().slice(0, 180);
    const status = query.get("status");
    if (
      status &&
      !["DRAFT", "PUBLISHED", "UNPUBLISHED", "ALL"].includes(status)
    )
      throw new HttpError(400, "Неизвестный статус публикации.");
    const page = Math.max(
      1,
      Math.min(100000, Number.parseInt(query.get("page") || "1", 10) || 1),
    );
    const where: Prisma.PostWhereInput = {
      ...(status && status !== "ALL"
        ? { status: status as "DRAFT" | "PUBLISHED" | "UNPUBLISHED" }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { content: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * 12,
        take: 12,
        include: postInclude,
      }),
    ]);
    return noStoreJson({
      posts: posts.map(postDto),
      total,
      page,
      pageSize: 12,
      totalPages: Math.max(1, Math.ceil(total / 12)),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await adminRequest(request, true);
    return noStoreJson(
      { post: await createPost(await readJson(request), user.id) },
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
