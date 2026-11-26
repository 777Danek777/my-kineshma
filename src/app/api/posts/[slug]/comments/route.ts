import { apiError, assertSameOrigin } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";
import { assertSocialRead, readSocialJson, readSocialVisitor, requireSocialVisitor } from "@/server/social/identity";
import { validId } from "@/server/news/service";
import { createComment, publicComments, requestedPage, socialJson } from "@/server/social/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{slug: string}> }) {
  try {
    assertSocialRead(request);
    const query = new URL(request.url).searchParams;
    const parentId = query.get("parentId");
    return socialJson(await publicComments((await params).slug, requestedPage(request), readSocialVisitor(request), query.get("preview") === "1", parentId ? validId(parentId) : null));
  }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{slug: string}> }) {
  try {
    assertSameOrigin(request);
    const visitor = requireSocialVisitor(request);
    await consumeLimit("social:comments:attempts:global", 120, 60);
    await consumeLimit(`social:comments:attempts:${visitor}`, 20, 900);
    const result = await createComment((await params).slug, visitor, await readSocialJson(request));
    return socialJson(result.body, result.status);
  } catch (error) { return apiError(error); }
}
