import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { adminRequest, apiError, HttpError, noStoreJson } from "@/server/http";
import { submissionDto, submissionInclude } from "@/server/submissions/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await adminRequest(request);
    const params = new URL(request.url).searchParams;
    const status = params.get("status") || "PENDING";
    if (!["ALL", "PENDING", "APPROVED", "REJECTED"].includes(status)) throw new HttpError(400, "Неизвестный статус заявки.");
    const q = (params.get("q") || "").trim().slice(0, 180);
    const page = Math.max(1, Math.min(100000, Number.parseInt(params.get("page") || "1", 10) || 1));
    const where: Prisma.SubmissionWhereInput = { ...(status === "ALL" ? {} : { status: status as "PENDING" | "APPROVED" | "REJECTED" }), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }] } : {}) };
    const [total, submissions, pendingCount] = await Promise.all([prisma.submission.count({ where }), prisma.submission.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12, skip: (page - 1) * 12, include: submissionInclude }), prisma.submission.count({ where: { status: "PENDING" } })]);
    return noStoreJson({ submissions: submissions.map(submissionDto), total, page, pageSize: 12, totalPages: Math.max(1, Math.ceil(total / 12)), pendingCount });
  } catch (error) { return apiError(error); }
}
