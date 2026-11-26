import { apiError } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";
import { assertSocialRead, commentChallenge, minimumWaitMs, requireSocialVisitor } from "@/server/social/identity";
import { publishedPost, socialJson } from "@/server/social/service";
import { getModerationSettings } from "@/server/settings/moderation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{slug: string}> }) {
  try {
    assertSocialRead(request);
    const visitor = requireSocialVisitor(request);
    const { slug } = await params;
    await publishedPost(slug);
    await consumeLimit(`social:forms:${visitor}`, 30, 900);
    await consumeLimit("social:forms:global", 600, 60);
    const settings = await getModerationSettings();
    return socialJson({ token: commentChallenge(visitor, slug), minimumWaitMs, moderationEnabled: settings.commentsModerationEnabled });
  } catch (error) { return apiError(error); }
}
