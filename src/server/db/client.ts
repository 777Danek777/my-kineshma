import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { serverConfig } from "@/server/config";

const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalDb.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: serverConfig().databaseUrl,
      max: 10,
    }),
  });
if (process.env.NODE_ENV !== "production") globalDb.prisma = prisma;
