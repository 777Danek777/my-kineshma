import { createHash } from "node:crypto";
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";
import {
  apiError,
  assertSameOrigin,
  HttpError,
  noStoreJson,
  readLimitedBody,
} from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = toNextJsHandler(auth);

export async function GET(request: Request) {
  if (new URL(request.url).pathname !== "/api/auth/get-session")
    return noStoreJson({ error: "Страница не найдена." }, 404);
  const response = await handlers.GET(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (!["/api/auth/sign-in/email", "/api/auth/sign-out"].includes(pathname))
    return noStoreJson(
      { error: "Регистрация и управление аккаунтами через сайт недоступны." },
      404,
    );
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new HttpError(415, "Некорректный формат запроса.");
    const bytes = await readLimitedBody(request, 8192);
    let body: { email?: unknown; password?: unknown };
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new HttpError(400, "Некорректный запрос.");
    }
    if (!body || typeof body !== "object")
      throw new HttpError(400, "Некорректный запрос.");
    if (pathname.endsWith("sign-in/email")) {
      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      await consumeLimit("login:global", 30, 60);
      if (
        !email ||
        email.length > 254 ||
        typeof body.password !== "string" ||
        body.password.length > 128
      )
        throw new HttpError(400, "Проверьте почту и пароль.");
      await consumeLimit(
        `login:${createHash("sha256").update(email).digest("hex")}`,
        8,
        900,
      );
      body.email = email;
    }
    const normalized = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(body),
    });
    const response = await handlers.POST(normalized);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
