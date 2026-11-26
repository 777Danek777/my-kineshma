import { apiError } from "@/server/http";
import { assertSocialRead, readSocialVisitor } from "@/server/social/identity";
import { socialJson, socialStats } from "@/server/social/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{slug: string}> }) {
  try { assertSocialRead(request); return socialJson(await socialStats((await params).slug, readSocialVisitor(request))); }
  catch (error) { return apiError(error); }
}
