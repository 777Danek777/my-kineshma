import { prisma } from "@/server/db/client";
import { adminRequest, apiError, noStoreJson } from "@/server/http";
import { postDto, postInclude } from "@/server/news/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await adminRequest(request);
    const [total, published, drafts, unpublished, categories, posts, pendingSubmissions, commentGroups] =
      await Promise.all([
        prisma.post.count(),
        prisma.post.count({ where: { status: "PUBLISHED" } }),
        prisma.post.count({ where: { status: "DRAFT" } }),
        prisma.post.count({ where: { status: "UNPUBLISHED" } }),
        prisma.category.count(),
        prisma.post.findMany({
          take: 5,
          orderBy: { updatedAt: "desc" },
          include: postInclude,
        }),
        prisma.submission.count({ where: { status: "PENDING" } }),
        prisma.comment.groupBy({ by: ["status"], _count: true }),
      ]);
    return noStoreJson({
      stats: { total, published, drafts, unpublished, categories, pendingSubmissions },
      recentPosts: posts.map(postDto),
      comments: {
        pending: commentGroups.find(group => group.status === "PENDING")?._count ?? 0,
        approved: commentGroups.find(group => group.status === "APPROVED")?._count ?? 0,
        rejected: commentGroups.find(group => group.status === "REJECTED")?._count ?? 0,
        total: commentGroups.reduce((sum, group) => sum + group._count, 0),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
