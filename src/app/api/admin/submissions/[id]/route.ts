import { prisma } from "@/server/db/client";
import { adminRequest, apiError, HttpError, noStoreJson, readJson } from "@/server/http";
import { validId } from "@/server/news/service";
import { deleteSubmission, saveSubmission, submissionDto, submissionInclude } from "@/server/submissions/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { await adminRequest(request); const id = validId((await context.params).id); const submission = await prisma.submission.findUnique({ where: { id }, include: submissionInclude }); if (!submission) throw new HttpError(404, "Заявка не найдена."); return noStoreJson({ submission: submissionDto(submission) }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { await adminRequest(request, true); const id = validId((await context.params).id); return noStoreJson(await saveSubmission(id, await readJson(request))); }
  catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try { await adminRequest(request, true); const id = validId((await context.params).id); return noStoreJson(await deleteSubmission(id, await readJson(request))); }
  catch (error) { return apiError(error); }
}
