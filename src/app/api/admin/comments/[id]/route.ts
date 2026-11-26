import { adminRequest, apiError, noStoreJson } from "@/server/http";
import { validId } from "@/server/news/service";
import { readSocialJson } from "@/server/social/identity";
import { editComment, moderateComment } from "@/server/social/service";
export const runtime = "nodejs";
type Context = {params: Promise<{id: string}>};
export async function PUT(request: Request, { params }: Context) {
  try { await adminRequest(request, true); return noStoreJson(await editComment(validId((await params).id), await readSocialJson(request))); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try { await adminRequest(request, true); return noStoreJson(await moderateComment(validId((await params).id), await readSocialJson(request))); }
  catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try { await adminRequest(request, true); return noStoreJson(await moderateComment(validId((await params).id), await readSocialJson(request), true)); }
  catch (error) { return apiError(error); }
}
