import { apiError, assertSameOrigin } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";
import { readSocialJson, requireSocialVisitor } from "@/server/social/identity";
import { setLike, socialJson } from "@/server/social/service";
export const runtime = "nodejs";
export async function PUT(request: Request, { params }: { params: Promise<{slug: string}> }) {
  try {
    assertSameOrigin(request);
    const visitor = requireSocialVisitor(request);
    await consumeLimit("social:likes:global", 600, 60);
    await consumeLimit(`social:likes:${visitor}`, 30, 60);
    return socialJson(await setLike((await params).slug, visitor, await readSocialJson(request)));
  } catch (error) { return apiError(error); }
}
