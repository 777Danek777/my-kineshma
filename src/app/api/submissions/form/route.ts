import { NextResponse } from "next/server";
import { serverConfig } from "@/server/config";
import { apiError, HttpError } from "@/server/http";
import { createChallenge, minDelayMs, visitorCookie } from "@/server/submissions/challenge";
import { consumeLimit } from "@/server/rate-limit";
import { getModerationSettings } from "@/server/settings/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== serverConfig().origin)) throw new HttpError(403, "Откройте форму на сайте «Моя Кинешма».");
    await consumeLimit("submission-form:global", 120, 60);
    const challenge = createChallenge(request);
    const settings = await getModerationSettings();
    const response = NextResponse.json({ token: challenge.token, minDelayMs, moderationEnabled: settings.postsModerationEnabled }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
    response.cookies.set(visitorCookie, challenge.cookie, { httpOnly: true, secure: serverConfig().secureCookies, sameSite: "strict", path: "/api/submissions", maxAge: 24 * 60 * 60 });
    return response;
  } catch (error) { return apiError(error); }
}
