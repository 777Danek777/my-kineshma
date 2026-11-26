import { adminRequest, apiError, noStoreJson, readJson } from "@/server/http";
import { validId } from "@/server/news/service";
import { approveSubmission } from "@/server/submissions/moderation";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const admin = await adminRequest(request, true); const id = validId((await params).id); return noStoreJson(await approveSubmission(id, await readJson(request), admin.id)); }
  catch (error) { return apiError(error); }
}
