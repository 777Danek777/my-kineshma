import { apiError, assertSameOrigin } from "@/server/http";
import { validId } from "@/server/news/service";
import { consumeLimit } from "@/server/rate-limit";
import { readSocialJson, requireSocialVisitor } from "@/server/social/identity";
import { setCommentLike, socialJson } from "@/server/social/service";

export const runtime = "nodejs";
export async function PUT(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    assertSameOrigin(request);
    const visitor = requireSocialVisitor(request);
    await consumeLimit("social:comment-likes:global", 600, 60);
    await consumeLimit(`social:comment-likes:${visitor}`, 60, 60);
    const { slug, id } = await params;
    return socialJson(await setCommentLike(slug, validId(id), visitor, await readSocialJson(request)));
  } catch (error) {
    return apiError(error);
  }
}
