import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { serverConfig } from "@/server/config";
import { apiError, assertSameOrigin, HttpError, noStoreJson, readLimitedBody } from "@/server/http";
import { signedVisitor, submissionFingerprint, verifyChallenge } from "@/server/submissions/challenge";
import { consumeLimit } from "@/server/rate-limit";
import { prepareImage, removeImageFile } from "@/server/uploads/images";
import { prepareVideo } from "@/server/uploads/videos";
import { getModerationSettings } from "@/server/settings/moderation";
import { slugFor } from "@/server/news/service";
import { validateDisplayName } from "@/lib/display-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maxRequestBytes = 72 * 1024 * 1024;
async function accepted(receipt: { acceptedStatus: "PENDING" | "APPROVED" | "REJECTED"; publishedSlug: string | null }) {
  const post = receipt.publishedSlug ? await prisma.post.findFirst({ where: { slug: receipt.publishedSlug, status: "PUBLISHED" }, select: { slug: true } }) : null;
  return { success: true, status: receipt.acceptedStatus, message: receipt.acceptedStatus === "PENDING" ? "Публикация отправлена на проверку." : post ? "Публикация появилась в ленте." : "Публикация принята.", ...(post ? {post} : {}) };
}
// Bound concurrent multipart decoding/image work within this process.
const slots = globalThis as unknown as { activeSubmissions?: number };
const inputSchema = z.strictObject({
  title: z.string().trim().max(180, "Заголовок — не более 180 символов."),
  content: z.string().trim().max(20_000, "Текст — не более 20 000 символов."),
  senderName: z.string().trim().max(80, "Имя — не более 80 символов."),
  contact: z.string().trim().max(200, "Контакт — не более 200 символов."),
  anonymous: z.enum(["true", "false"]),
  displayName: z.string().max(60, "Имя — не более 60 символов."),
  contactConsent: z.enum(["true", "false"]),
}).superRefine((data, ctx) => {
  for (const [key, value] of Object.entries(data)) {
    if (Array.from(value).some(character => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)))) ctx.addIssue({code:"custom",path:[key],message:"Уберите управляющие символы."});
  }
  if (data.anonymous === "false") {
    const error = validateDisplayName(data.displayName);
    if (error) ctx.addIssue({ code: "custom", path: ["displayName"], message: error });
  }
});

function textField(form: FormData, name: string) {
  const entries = form.getAll(name);
  if (entries.length > 1 || (entries.length && typeof entries[0] !== "string")) throw new HttpError(400, "Некорректные поля формы.");
  return typeof entries[0] === "string" ? entries[0] : "";
}

export async function POST(request: Request) {
  const savedFiles: string[] = [];
  let occupied = false;
  let receiptKey = "";
  let payloadHash = "";
  let legacyPayloadHash = "";
  try {
    assertSameOrigin(request);
    const visitor = signedVisitor(request);
    if (!visitor) throw new HttpError(403, "Обновите проверку формы перед отправкой.", { token: "Обновите проверку формы." });
    await consumeLimit("submissions:attempts:global", 60, 60);
    await consumeLimit(`submissions:attempts:${visitor}`, 20, 900);
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data;")) throw new HttpError(415, "Отправьте материал через форму на сайте.");
    if ((slots.activeSubmissions ?? 0) >= 2) throw new HttpError(503, "Сейчас принимаются другие материалы. Повторите отправку через несколько секунд.");
    slots.activeSubmissions = (slots.activeSubmissions ?? 0) + 1;
    occupied = true;
    const bytes = await readLimitedBody(request, maxRequestBytes, 90_000);
    let form: FormData;
    try { form = await new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body: new Uint8Array(bytes).buffer }).formData(); }
    catch { throw new HttpError(400, "Не удалось прочитать форму. Попробуйте отправить её ещё раз."); }
    const allowed = new Set(["token", "title", "content", "senderName", "displayName", "contact", "contactConsent", "anonymous", "website", "photos", "video"]);
    if ([...form.keys()].some((key) => !allowed.has(key))) throw new HttpError(400, "Форма содержит неизвестные поля.");
    const challenge = verifyChallenge(textField(form, "token"), visitor);
    receiptKey = challenge.nonce;
    if (textField(form, "website").trim()) throw new HttpError(400, "Не удалось принять форму. Проверьте поля и повторите отправку.");
    const parsed = inputSchema.safeParse({ title: textField(form, "title"), content: textField(form, "content"), senderName: textField(form, "senderName"), contact: textField(form, "contact"), anonymous: textField(form, "anonymous") || "true", displayName: textField(form, "displayName"), contactConsent: textField(form, "contactConsent") || "false" });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
      throw new HttpError(400, "Проверьте заполнение формы.", fieldErrors);
    }
    const data = { title: parsed.data.title, content: parsed.data.content, anonymous: parsed.data.anonymous === "true", senderName: parsed.data.anonymous === "true" ? null : parsed.data.senderName || null, contact: parsed.data.anonymous === "true" && parsed.data.contactConsent !== "true" ? null : parsed.data.contact || null };
    const publicAuthorName = data.anonymous ? null : parsed.data.displayName.normalize("NFKC").trim() || null;
    const photos = form.getAll("photos");
    if (photos.length > 4) throw new HttpError(400, "Можно отправить до 4 фотографий.", { photos: "Выберите не более 4 фотографий." });
    const videos = form.getAll("video");
    if (videos.length > 1 || (videos.length === 1 && !(videos[0] instanceof File))) throw new HttpError(400, "Можно прикрепить одно видео.");
    const video = videos[0] as File | undefined;
    if (video && (!video.size || video.size > serverConfig().maxVideoBytes)) throw new HttpError(413, "Видео должно быть не больше 50 МБ.", {video:"Выберите видео до 50 МБ."});
    if (!data.title && !data.content && !photos.length && !video) throw new HttpError(400, "Добавьте текст, фотографию или видео.", { content: "Публикация пока пустая." });
    const files: File[] = [];
    const fileHashes: string[] = [];
    for (const item of photos) {
      if (!(item instanceof File)) throw new HttpError(400, "Некорректное вложение.");
      if (!item.size || item.size > serverConfig().maxUploadBytes) throw new HttpError(413, "Каждая фотография должна быть не больше 5 МБ.", { photos: "Проверьте размеры файлов." });
      if (!["image/jpeg", "image/png", "image/webp"].includes(item.type)) throw new HttpError(415, "Поддерживаются только JPEG, PNG и WebP.", { photos: "Выберите JPEG, PNG или WebP." });
      files.push(item);
      fileHashes.push(`${item.type}:${createHash("sha256").update(Buffer.from(await item.arrayBuffer())).digest("hex")}`);
    }
    const fingerprintData = { ...data, ...(form.has("displayName") ? {publicAuthorName} : {}), photos: fileHashes, ...(video ? {video: `${video.type}:${createHash("sha256").update(Buffer.from(await video.arrayBuffer())).digest("hex")}`} : {}) };
    payloadHash = submissionFingerprint(fingerprintData);
    // Read-only compatibility with accepted submissions from before NFKC names.
    legacyPayloadHash = submissionFingerprint({ ...fingerprintData, ...(form.has("displayName") ? { publicAuthorName: data.anonymous ? null : parsed.data.displayName.trim() || null } : {}) });
    const existing = await prisma.submissionReceipt.findUnique({ where: { key: receiptKey } });
    if (existing) {
      if (existing.payloadHash !== payloadHash && existing.payloadHash !== legacyPayloadHash) throw new HttpError(409, "Эта форма уже отправлена. Для нового материала обновите проверку формы.", { token: "Получите новую проверку формы для другого материала." });
      return noStoreJson(await accepted(existing));
    }
    await mkdir(serverConfig().uploadDirectory, { recursive: true });
    const media: { id: string; filename: string; width: number; height: number; byteSize: number; alt: string; kind: "IMAGE" | "VIDEO"; mimeType: string; duration: number | null }[] = [];
    for (const file of files) {
      const output = await prepareImage(file);
      const id = randomUUID(); const filename = `${id}.webp`;
      await writeFile(path.join(serverConfig().uploadDirectory, filename), output.data, { flag: "wx" });
      savedFiles.push(filename);
      media.push({ id, filename, width: output.info.width, height: output.info.height, byteSize: output.data.byteLength, alt: "Фотография, присланная читателем", kind: "IMAGE", mimeType: "image/webp", duration: null });
    }
    if (video) {
      const output = await prepareVideo(video);
      const id = randomUUID(); const filename = `${id}.${output.extension}`;
      await writeFile(path.join(/* turbopackIgnore: true */ serverConfig().uploadDirectory, filename), output.data, {flag:"wx"}); savedFiles.push(filename);
      media.push({ id, filename, width:output.width, height:output.height, byteSize:output.data.length, alt:"Видео, присланное читателем", kind:"VIDEO", mimeType:output.mimeType, duration:output.duration });
    }
    const receipt = await prisma.$transaction(async (tx) => {
      // Serialize retries on the unique receipt before checking the remaining quota.
      await tx.submissionReceipt.create({ data: { key: receiptKey, payloadHash } });
      // Quotas apply to accepted submissions atomically, not to a lost response/retry.
      await consumeLimit(`submissions:accepted:${visitor}`, 3, 900, tx);
      await consumeLimit("submissions:accepted:global-hour", 30, 3600, tx);
      await consumeLimit("submissions:accepted:global-day", 100, 86400, tx);
      const settings = await getModerationSettings(tx, true);
      const immediate = !settings.postsModerationEnabled;
      if (immediate && !settings.defaultCategoryId) throw new HttpError(503, "Редакции нужно выбрать категорию по умолчанию. Попробуйте отправить материал позже.");
      const submission = await tx.submission.create({ data: { ...data, publicAuthorName, receiptKey, status: immediate ? "APPROVED" : "PENDING", categoryId: immediate ? settings.defaultCategoryId : null } });
      for (const [order, asset] of media.entries()) {
        await tx.mediaAsset.create({ data: { ...asset, uploadedById: null } });
        await tx.submissionImage.create({ data: { submissionId: submission.id, mediaId: asset.id, order } });
      }
      let publishedSlug: string | null = null;
      if (immediate) {
        const post = await tx.post.create({ data: { title:data.title, content:data.content, excerpt:data.content.replace(/\s+/g," ").slice(0,220), slug:slugFor(data.title || data.content.slice(0,80) || "Публикация"), categoryId:settings.defaultCategoryId!, authorId:null, publicAuthorName, sourceType:"RESIDENT", status:"PUBLISHED", publishedAt:new Date(), images:{create:media.map((asset,order)=>({mediaId:asset.id,order}))} } });
        publishedSlug = post.slug;
        await tx.submission.update({ where:{id:submission.id}, data:{postId:post.id} });
      }
      return tx.submissionReceipt.update({where:{key:receiptKey},data:{acceptedStatus:immediate?"APPROVED":"PENDING",publishedSlug}});
    });
    savedFiles.length = 0;
    return noStoreJson(await accepted(receipt), 201);
  } catch (error) {
    for (const filename of savedFiles) await removeImageFile(filename);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && receiptKey) {
      const receipt = await prisma.submissionReceipt.findUnique({ where: { key: receiptKey } });
      if (receipt && (receipt.payloadHash === payloadHash || receipt.payloadHash === legacyPayloadHash)) return noStoreJson(await accepted(receipt));
      if (receipt) return noStoreJson({ error: "Эта форма уже отправлена с другим содержимым. Обновите проверку формы.", fieldErrors: { token: "Обновите проверку формы." } }, 409);
    }
    return apiError(error);
  } finally { if (occupied) slots.activeSubmissions = Math.max(0, (slots.activeSubmissions ?? 1) - 1); }
}
