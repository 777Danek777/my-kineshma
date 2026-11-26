import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { HttpError, noStoreJson } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";
import { getModerationSettings } from "@/server/settings/moderation";
import { normalizeDisplayName, validateDisplayName } from "@/lib/display-name";
import { commentFingerprint, verifyCommentChallenge, verifyCsrf } from "./identity";

export function socialJson(data: unknown, status = 200) {
  const response = noStoreJson(data, status);
  response.headers.set("Vary", "Cookie");
  return response;
}
export function validSlug(value: string) {
  if (!/^[a-z0-9-]{1,140}$/.test(value)) throw new HttpError(404, "Публикация не найдена.");
  return value;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
    throw new HttpError(400, "Проверьте заполнение формы.", errors);
  }
  return result.data;
}
export async function publishedPost(slug: string, tx: Prisma.TransactionClient = prisma, lock = false) {
  validSlug(slug);
  const rows = lock
    ? await tx.$queryRaw<{id: string}[]>`SELECT "id" FROM "Post" WHERE "slug" = ${slug} AND "status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL FOR UPDATE`
    : await tx.$queryRaw<{id: string}[]>`SELECT "id" FROM "Post" WHERE "slug" = ${slug} AND "status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL`;
  if (!rows.length) throw new HttpError(404, "Публикация не найдена.");
  return rows[0];
}
export async function socialStats(slug: string, visitor: string | null, tx: Prisma.TransactionClient = prisma) {
  validSlug(slug);
  // One statement gives counts/own state from a single database snapshot.
  const [row] = await tx.$queryRaw<{likeCount: bigint;commentCount: bigint;liked: boolean}[]>`
    SELECT (SELECT COUNT(*) FROM "Like" l WHERE l."postId" = p."id") AS "likeCount",
      (SELECT COUNT(*) FROM "Comment" c WHERE c."postId" = p."id" AND c."status" = 'APPROVED'
        AND (c."parentId" IS NULL OR EXISTS(SELECT 1 FROM "Comment" parent WHERE parent."id" = c."parentId" AND parent."postId" = p."id" AND parent."parentId" IS NULL AND parent."status" = 'APPROVED'))) AS "commentCount",
      EXISTS(SELECT 1 FROM "Like" l WHERE l."postId" = p."id" AND l."anonymousVisitorIdHash" = ${visitor}) AS "liked"
    FROM "Post" p WHERE p."slug" = ${slug} AND p."status" = 'PUBLISHED' AND p."publishedAt" IS NOT NULL`;
  if (!row) throw new HttpError(404, "Публикация не найдена.");
  return { likeCount: Number(row.likeCount), commentCount: Number(row.commentCount), liked: row.liked };
}
export async function setLike(slug: string, visitor: string, input: unknown) {
  const data = parse(z.strictObject({ liked: z.boolean(), csrfToken: z.string().max(1600) }), input);
  verifyCsrf(data.csrfToken, visitor);
  return prisma.$transaction(async tx => {
    // Serialize desired-state writes for this post, also against unpublishing/deletion.
    const post = await publishedPost(slug, tx, true);
    if (data.liked) {
      await tx.$executeRaw`INSERT INTO "Like" ("id", "postId", "anonymousVisitorIdHash") VALUES (${randomUUID()}, ${post.id}, ${visitor}) ON CONFLICT ("postId", "anonymousVisitorIdHash") DO NOTHING`;
    } else {
      await tx.like.deleteMany({ where: { postId: post.id, anonymousVisitorIdHash: visitor } });
    }
    return socialStats(slug, visitor, tx);
  });
}
const pageSize = 20;
export function requestedPage(request: Request) {
  const page = new URL(request.url).searchParams.get("page") || "1";
  if (!/^[1-9]\d{0,5}$/.test(page)) throw new HttpError(400, "Некорректный номер страницы.");
  return Number(page);
}
const publicCommentSelect = { id: true, displayName: true, content: true, createdAt: true, parentId: true } as const;
function visibleComments(postId: string): Prisma.CommentWhereInput {
  return { postId, status: "APPROVED", OR: [{ parentId: null }, { parent: { is: { postId, parentId: null, status: "APPROVED" } } }] };
}
function selectComment(visitor: string | null) {
  return {
    ...publicCommentSelect,
    likes: { where: { anonymousVisitorIdHash: visitor || "" }, select: { id: true }, take: 1 },
    _count: { select: { likes: true, replies: { where: { status: "APPROVED" as const } } } },
  } as const;
}
type SelectedComment = Prisma.CommentGetPayload<{ select: ReturnType<typeof selectComment> }>;
function exposeComment(comment: SelectedComment) {
  return {
    id: comment.id, displayName: comment.displayName, content: comment.content,
    createdAt: comment.createdAt, parentId: comment.parentId,
    likeCount: comment._count.likes, liked: comment.likes.length > 0,
    replyCount: comment._count.replies,
  };
}
export async function publicComments(slug: string, wantedPage: number, visitor: string | null = null, preview = false, parentId: string | null = null) {
  return prisma.$transaction(async tx => {
    const post = await publishedPost(slug, tx);
    const rootWhere = { postId: post.id, status: "APPROVED" as const, parentId: null };
    if (parentId) {
      if (!await tx.comment.findFirst({ where: { ...rootWhere, id: parentId }, select: { id: true } })) throw new HttpError(404, "Обсуждение недоступно. Обновите комментарии.");
      const where = { postId: post.id, parentId, status: "APPROVED" as const };
      const total = await tx.comment.count({ where });
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(wantedPage, totalPages);
      const items = await tx.comment.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: selectComment(visitor) });
      return { items: items.map(item => ({ ...exposeComment(item), replies: [] })), page, pageSize, total, rootTotal: total, totalPages, preview: false, parentId };
    }
    const total = await tx.comment.count({ where: visibleComments(post.id) });
    const rootTotal = await tx.comment.count({ where: rootWhere });
    const totalPages = Math.max(1, Math.ceil(rootTotal / pageSize));
    const page = Math.min(wantedPage, totalPages);
    const selected = await tx.comment.findMany({
      where: rootWhere,
      orderBy: [{ createdAt: preview ? "desc" : "asc" }, { id: preview ? "desc" : "asc" }],
      skip: preview ? 0 : (page - 1) * pageSize, take: preview ? 3 : pageSize,
      select: { ...selectComment(visitor), replies: { where: { status: "APPROVED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: preview ? 1 : 3, select: selectComment(visitor) } },
    });
    const ordered = preview ? selected.reverse() : selected;
    const items = ordered.map(item => ({ ...exposeComment(item), replies: item.replies.map(reply => ({ ...exposeComment(reply), replies: [] })) }));
    return { items, page: preview ? 1 : page, pageSize: preview ? 3 : pageSize, total, rootTotal, totalPages, preview, parentId: null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
function acceptedComment(status: "PENDING" | "APPROVED" | "REJECTED") {
  return { success: true, status, message: status === "APPROVED" ? "Комментарий опубликован." : "Комментарий отправлен на модерацию. Он появится после одобрения." };
}
const rawDisplayNameSchema = z.string().superRefine((value, ctx) => {
  const error = validateDisplayName(value);
  if (error) ctx.addIssue({ code: "custom", message: error });
});
const displayNameSchema = rawDisplayNameSchema.transform(normalizeDisplayName);
const contentSchema = z.string().trim().min(3, "Комментарий — от 3 символов.").max(2000, "Комментарий — не более 2000 символов.").refine(v => !Array.from(v).some(c => (c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0))) || c.charCodeAt(0) === 127), "Уберите управляющие символы из комментария.");
const commentSchema = z.strictObject({
  displayName: rawDisplayNameSchema.optional().default(""),
  content: contentSchema,
  parentId: z.uuid().nullable().optional(),
  token: z.string().max(1600),
  csrfToken: z.string().max(1600),
  website: z.string().max(200).default(""),
});
export async function createComment(slug: string, visitor: string, input: unknown) {
  const data = parse(commentSchema, input);
  verifyCsrf(data.csrfToken, visitor);
  const challenge = verifyCommentChallenge(data.token, visitor, slug);
  if (data.website.trim()) throw new HttpError(400, "Не удалось принять комментарий. Проверьте форму.");
  const displayName = normalizeDisplayName(data.displayName);
  const fingerprintData = { visitor, slug, displayName, content: data.content, ...(data.parentId ? { parentId: data.parentId } : {}) };
  const payloadHash = commentFingerprint(fingerprintData);
  // Preserve exact retries accepted before NFKC normalization was introduced.
  // The alternative is used only to read an existing receipt, never to insert.
  const legacyPayloadHash = data.displayName.trim()
    ? commentFingerprint({ ...fingerprintData, displayName: data.displayName.trim() }) : payloadHash;
  const result = await prisma.$transaction(async tx => {
    const post = await publishedPost(slug, tx, true);
    const receipt = await tx.commentReceipt.findUnique({ where: { key: challenge.nonce } });
    if (receipt) {
      if (receipt.postId !== post.id || (receipt.payloadHash !== payloadHash && receipt.payloadHash !== legacyPayloadHash)) throw new HttpError(409, "Эта форма уже отправлена с другим текстом. Обновите проверку формы.", { token: "Обновите проверку формы." });
      return { created: false, status: receipt.acceptedStatus };
    }
    if (data.parentId) {
      const parent = await tx.comment.findFirst({ where: { id: data.parentId, postId: post.id, status: "APPROVED" }, select: { parentId: true } });
      if (!parent) throw new HttpError(400, "Комментарий, на который вы отвечаете, недоступен. Обновите обсуждение.", { parentId: "Выберите доступный комментарий." });
      if (parent.parentId) throw new HttpError(400, "Ответы объединяются под основным комментарием. Выберите его для ответа.", { parentId: "Выберите основной комментарий." });
    }
    const settings = await getModerationSettings(tx, true);
    const status = settings.commentsModerationEnabled ? "PENDING" : "APPROVED";
    // Locking the post makes receipt creation/retries serial. Accepted limits roll back on failure.
    await tx.commentReceipt.create({ data: { key: challenge.nonce, postId: post.id, payloadHash, acceptedStatus: status } });
    await consumeLimit(`social:comments:accepted:${visitor}`, 3, 900, tx);
    await consumeLimit(`social:comments:daily:${visitor}`, 20, 86400, tx);
    await consumeLimit("social:comments:accepted:global-hour", 60, 3600, tx);
    await consumeLimit("social:comments:accepted:global-day", 300, 86400, tx);
    await tx.comment.create({ data: { postId: post.id, displayName, content: data.content, parentId: data.parentId || null, status, receiptKey: challenge.nonce } });
    return { created: true, status } as const;
  });
  return { body: acceptedComment(result.status), status: result.created ? 201 : 200 };
}
export async function setCommentLike(slug: string, id: string, visitor: string, input: unknown) {
  const data = parse(z.strictObject({ liked: z.boolean(), csrfToken: z.string().max(1600) }), input);
  verifyCsrf(data.csrfToken, visitor);
  return prisma.$transaction(async tx => {
    const post = await publishedPost(slug, tx, true);
    const comment = await tx.comment.findFirst({ where: { ...visibleComments(post.id), id }, select: { id: true } });
    if (!comment) throw new HttpError(404, "Комментарий недоступен.");
    if (data.liked) await tx.$executeRaw`INSERT INTO "CommentLike" ("id", "commentId", "anonymousVisitorIdHash") VALUES (${randomUUID()}, ${id}, ${visitor}) ON CONFLICT ("commentId", "anonymousVisitorIdHash") DO NOTHING`;
    else await tx.commentLike.deleteMany({ where: { commentId: id, anonymousVisitorIdHash: visitor } });
    const likeCount = await tx.commentLike.count({ where: { commentId: id } });
    const liked = await tx.commentLike.count({ where: { commentId: id, anonymousVisitorIdHash: visitor } }) > 0;
    return { id, likeCount, liked };
  });
}
const adminCommentSelect = { ...publicCommentSelect, status: true, updatedAt: true, version: true, parent: { select: { id: true, displayName: true, content: true, status: true } }, _count: { select: { replies: true } }, post: { select: { id: true, slug: true, title: true, status: true } } } as const;
export async function adminComments(request: Request) {
  const wantedPage = requestedPage(request);
  const status = parse(z.enum(["PENDING", "APPROVED", "REJECTED"]), new URL(request.url).searchParams.get("status") || "PENDING");
  return prisma.$transaction(async tx => {
    const total = await tx.comment.count({ where: { status } });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(wantedPage, totalPages);
    const items = await tx.comment.findMany({ where: { status }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: adminCommentSelect });
    return { items, page, pageSize, total, totalPages };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function moderateComment(id: string, input: unknown, remove = false) {
  const versionSchema = z.number().int().positive();
  const data: { version: number; status?: "PENDING" | "APPROVED" | "REJECTED" } = remove ? parse(z.strictObject({ version: versionSchema }), input) : parse(z.strictObject({ version: versionSchema, status: z.enum(["PENDING", "APPROVED", "REJECTED"]) }), input);
  return prisma.$transaction(async tx => {
    await lockCommentPost(tx, id);
    const where = { id, version: data.version };
    if (remove) {
      const result = await tx.comment.deleteMany({ where });
      if (!result.count) throw new HttpError(409, "Комментарий уже изменён. Обновите список.");
      return { success: true };
    }
    if (!data.status) throw new HttpError(400, "Выберите действие.");
    const result = await tx.comment.updateMany({ where, data: { status: data.status, version: { increment: 1 } } });
    if (!result.count) throw new HttpError(409, "Комментарий уже изменён. Обновите список.");
    return { comment: await tx.comment.findUniqueOrThrow({ where: { id }, select: adminCommentSelect }) };
  });
}

async function lockCommentPost(tx: Prisma.TransactionClient, id: string) {
  const current = await tx.comment.findUnique({ where: { id }, select: { postId: true } });
  if (!current) throw new HttpError(404, "Комментарий уже удалён.");
  await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id" = ${current.postId} FOR UPDATE`;
  if (!await tx.comment.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(404, "Комментарий уже удалён.");
}

export async function editComment(id: string, input: unknown) {
  const data = parse(z.strictObject({ version: z.number().int().positive(), displayName: displayNameSchema, content: contentSchema }), input);
  return prisma.$transaction(async tx => {
    await lockCommentPost(tx, id);
    const changed = await tx.comment.updateMany({ where: { id, version: data.version }, data: { displayName: data.displayName, content: data.content, version: { increment: 1 } } });
    if (!changed.count) throw new HttpError(409, "Комментарий уже изменён. Обновите список.");
    return { comment: await tx.comment.findUniqueOrThrow({ where: { id }, select: adminCommentSelect }) };
  });
}
