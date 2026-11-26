import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "@/server/db/client";
import { serverConfig } from "@/server/config";

const config = serverConfig();
export const auth = betterAuth({
  appName: "Моя Кинешма",
  baseURL: config.origin,
  basePath: "/api/auth",
  secret: config.secret,
  trustedOrigins: [config.origin],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true,
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 14,
    maxPasswordLength: 128,
    requireEmailVerification: false,
  },
  disabledPaths: [
    "/sign-up/email",
    "/request-password-reset",
    "/reset-password",
    "/change-email",
    "/change-password",
    "/update-user",
    "/delete-user",
  ],
  user: {
    additionalFields: {
      role: {
        type: ["user", "admin"],
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 30,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 120,
    customRules: { "/sign-in/email": { window: 60, max: 20 } },
  },
  advanced: {
    cookiePrefix: "my-kineshma",
    useSecureCookies: config.secureCookies,
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    ipAddress: { ipAddressHeaders: [] },
  },
});
