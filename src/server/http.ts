import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getAdminSession } from "@/server/auth/guards";
import { serverConfig } from "@/server/config";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export function noStoreJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function assertSameOrigin(request: Request) {
  if (
    request.headers.get("origin") !== serverConfig().origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HttpError(
      403,
      "Запрос отклонён. Откройте сайт по основному адресу и повторите действие.",
    );
}

export async function adminRequest(request: Request, mutation = false) {
  const user = await getAdminSession(request.headers);
  if (!user) throw new HttpError(401, "Войдите в аккаунт администратора.");
  if (mutation) assertSameOrigin(request);
  return user;
}

export async function readLimitedBody(
  request: Request,
  limit: number,
  timeoutMs = 30_000,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new HttpError(
      413,
      "Размер отправленных данных превышает допустимый.",
    );
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new HttpError(408, "Отправка заняла слишком много времени. Проверьте подключение и попробуйте снова."));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(
          413,
          "Размер отправленных данных превышает допустимый.",
        );
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readJson(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "Ожидается JSON-запрос.");
  const bytes = await readLimitedBody(request, 240_000);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new HttpError(400, "Не удалось прочитать отправленные данные.");
  }
}

export function apiError(error: unknown) {
  if (error instanceof HttpError)
    return noStoreJson(
      {
        error: error.message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      },
      error.status,
    );
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return noStoreJson(
        { error: "Такое название уже используется. Выберите другое." },
        409,
      );
    if (error.code === "P2003")
      return noStoreJson(
        {
          error:
            "Запись используется в публикациях или была изменена. Обновите страницу.",
        },
        409,
      );
    if (error.code === "P2025")
      return noStoreJson(
        { error: "Запись не найдена. Возможно, она уже удалена." },
        404,
      );
  }
  console.error(
    "Admin operation failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return noStoreJson(
    { error: "Не удалось выполнить действие. Повторите попытку позже." },
    500,
  );
}
