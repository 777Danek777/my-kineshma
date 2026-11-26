import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serverConfig } from "@/server/config";
import { HttpError, readLimitedBody } from "@/server/http";

export const socialCookie = "mk_social_visitor";
export const visitorMaxAge = 180 * 86400;
export const minimumWaitMs = 3000;
const tokenMaxAge = 2 * 3600 * 1000;
const invalid = () => new HttpError(403, "Проверка формы устарела. Обновите её и повторите действие.", { token: "Обновите проверку формы." });
function sign(value: string) { return createHmac("sha256", serverConfig().secret).update(value).digest("base64url"); }
function equal(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function encode(purpose: string, value: object) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(`${purpose}:${payload}`)}`;
}
function decode(purpose: string, value: unknown): unknown {
  if (typeof value !== "string" || value.length > 1600) throw invalid();
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !equal(signature, sign(`${purpose}:${payload}`))) throw invalid();
  try { return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw invalid(); }
}
const visitorSchema = z.strictObject({ id: z.uuid(), issuedAt: z.number().int().positive() });
export function readSocialVisitor(request: Request) {
  const values = (request.headers.get("cookie") || "").split(";").map(v => v.trim()).filter(v => v.startsWith(`${socialCookie}=`));
  if (values.length !== 1) return null;
  try {
    const visitor = visitorSchema.parse(decode("social-browser", values[0].slice(socialCookie.length + 1)));
    const age = Date.now() - visitor.issuedAt;
    if (age < 0 || age > visitorMaxAge * 1000) return null;
    // The database never receives the cookie's random raw identifier.
    return createHmac("sha256", serverConfig().secret).update(`social-visitor-hash:${visitor.id}`).digest("hex");
  } catch { return null; }
}
export function requireSocialVisitor(request: Request) {
  const visitor = readSocialVisitor(request);
  if (!visitor) throw new HttpError(403, "Разрешите cookie для этого сайта и повторите действие.");
  return visitor;
}
export function newSocialCookie() {
  return encode("social-browser", { id: randomUUID(), issuedAt: Date.now() });
}
export function csrfToken(visitor: string) {
  return encode("social-csrf", { visitor, issuedAt: Date.now() });
}
export function verifyCsrf(value: unknown, visitor: string) {
  const parsed = z.strictObject({ visitor: z.string(), issuedAt: z.number().int().positive() }).safeParse(decode("social-csrf", value));
  if (!parsed.success || parsed.data.visitor !== visitor || Date.now() - parsed.data.issuedAt < 0 || Date.now() - parsed.data.issuedAt > tokenMaxAge) throw invalid();
}
export function commentChallenge(visitor: string, slug: string) {
  return encode("social-comment", { visitor, slug, nonce: randomUUID(), issuedAt: Date.now() });
}
export function verifyCommentChallenge(value: unknown, visitor: string, slug: string) {
  const parsed = z.strictObject({ visitor: z.string(), slug: z.string(), nonce: z.uuid(), issuedAt: z.number().int().positive() }).safeParse(decode("social-comment", value));
  if (!parsed.success || parsed.data.visitor !== visitor || parsed.data.slug !== slug) throw invalid();
  const age = Date.now() - parsed.data.issuedAt;
  if (age < 0 || age > tokenMaxAge) throw invalid();
  if (age < minimumWaitMs) throw new HttpError(400, "Подождите несколько секунд перед отправкой комментария.");
  return parsed.data;
}
export function commentFingerprint(value: object) { return sign(`social-comment-payload:${JSON.stringify(value)}`); }
export function assertSocialRead(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Откройте публикацию на сайте.");
}
export async function readSocialJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Ожидается JSON-запрос.");
  const bytes = await readLimitedBody(request, 16_384, 10_000);
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new HttpError(400, "Не удалось прочитать данные формы."); }
}
