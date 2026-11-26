import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serverConfig } from "@/server/config";
import { HttpError } from "@/server/http";

export const visitorCookie = "submission_visitor";
export const minDelayMs = 3000;
const maxAgeMs = 2 * 60 * 60 * 1000;

function sign(value: string) { return createHmac("sha256", serverConfig().secret).update(value).digest("base64url"); }
function equal(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signedVisitor(request: Request) {
  const cookie = (request.headers.get("cookie") || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${visitorCookie}=`))?.slice(visitorCookie.length + 1);
  if (!cookie || cookie.length > 150) return null;
  const [id, signature] = cookie.split(".");
  if (!z.uuid().safeParse(id).success || !signature || !equal(signature, sign(`submission-browser:${id}`))) return null;
  return id;
}

export function createChallenge(request: Request) {
  const id = signedVisitor(request) ?? randomUUID();
  const payload = Buffer.from(JSON.stringify({ nonce: randomUUID(), visitor: id, issuedAt: Date.now() })).toString("base64url");
  return { token: `${payload}.${sign(`submission-form:${payload}`)}`, cookie: `${id}.${sign(`submission-browser:${id}`)}`, visitor: id };
}

export function verifyChallenge(token: unknown, visitor: string) {
  const invalid = () => new HttpError(403, "Проверка формы устарела. Обновите её и отправьте материал снова.", { token: "Обновите проверку формы." });
  if (typeof token !== "string" || token.length > 1024) throw invalid();
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !equal(signature, sign(`submission-form:${payload}`))) throw invalid();
  let data: unknown;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw invalid(); }
  const parsed = z.strictObject({ nonce: z.uuid(), visitor: z.uuid(), issuedAt: z.number().int().positive() }).safeParse(data);
  if (!parsed.success || parsed.data.visitor !== visitor) throw invalid();
  const age = Date.now() - parsed.data.issuedAt;
  if (age < 0 || age > maxAgeMs) throw invalid();
  if (age < minDelayMs) throw new HttpError(400, "Пожалуйста, подождите несколько секунд перед отправкой.");
  return parsed.data;
}

export function submissionFingerprint(value: unknown) { return sign(`submission-payload:${JSON.stringify(value)}`); }
