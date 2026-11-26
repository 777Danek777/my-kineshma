import "server-only";
import { prisma } from "@/server/db/client";
import { HttpError } from "@/server/http";
import type { Prisma } from "@/generated/prisma/client";

// Atomic, persisted counter: a restart or concurrent requests cannot reset/bypass it.
export async function consumeLimit(
  key: string,
  maximum: number,
  seconds: number,
  client: Prisma.TransactionClient = prisma,
) {
  const start = new Date(
    Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000,
  );
  const rows = await client.$queryRaw<{ count: number }[]>`
    INSERT INTO "ActionLimit" ("key", "windowStart", "count") VALUES (${key}, ${start}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "ActionLimit"."windowStart" = EXCLUDED."windowStart" THEN "ActionLimit"."count" + 1 ELSE 1 END,
      "windowStart" = EXCLUDED."windowStart"
    RETURNING "count"`;
  if (rows[0].count > maximum)
    throw new HttpError(
      429,
      "Слишком много попыток. Подождите несколько минут и попробуйте снова.",
    );
}
