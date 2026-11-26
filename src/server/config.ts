import "server-only";
import path from "node:path";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing server setting: ${name}`);
  return value;
}

export function serverConfig() {
  const origin = new URL(required("APP_URL"));
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error("APP_URL must contain only an origin");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !(local && origin.protocol === "http:"))
    throw new Error("HTTPS is required outside localhost");
  const secret = required("BETTER_AUTH_SECRET");
  if (secret.length < 32)
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  return {
    origin: origin.origin,
    secret,
    secureCookies: origin.protocol === "https:",
    databaseUrl: required("DATABASE_URL"),
    // Runtime volume; never trace private files into a deployment bundle.
    uploadDirectory: path.resolve(
      /* turbopackIgnore: true */ process.env.UPLOAD_DIR || "./storage/uploads",
    ),
    maxUploadBytes: 5 * 1024 * 1024,
    maxVideoBytes: 50 * 1024 * 1024,
  };
}
