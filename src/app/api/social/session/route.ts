import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, assertSameOrigin, HttpError } from "@/server/http";
import { serverConfig } from "@/server/config";
import { consumeLimit } from "@/server/rate-limit";
import { csrfToken, newSocialCookie, readSocialJson, readSocialVisitor, socialCookie, visitorMaxAge } from "@/server/social/identity";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await consumeLimit("social:session:global", 600, 60);
    if (!z.strictObject({}).safeParse(await readSocialJson(request)).success) throw new HttpError(400, "Некорректный запрос.");
    let visitor = readSocialVisitor(request);
    let cookie: string | undefined;
    if (!visitor) {
      await consumeLimit("social:session:new-global", 300, 3600);
      cookie = newSocialCookie();
      visitor = readSocialVisitor(new Request(request.url, { headers: { cookie: `${socialCookie}=${cookie}` } }))!;
    }
    const response = NextResponse.json({ csrfToken: csrfToken(visitor) }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
    if (cookie) response.cookies.set(socialCookie, cookie, { httpOnly: true, secure: serverConfig().secureCookies, sameSite: "lax", path: "/", maxAge: visitorMaxAge });
    return response;
  } catch (error) { return apiError(error); }
}
