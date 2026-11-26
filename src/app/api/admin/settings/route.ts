import { adminRequest, apiError, noStoreJson, readJson } from "@/server/http";
import { adminSettings, updateModerationSettings } from "@/server/settings/moderation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { await adminRequest(request); return noStoreJson(await adminSettings()); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try { await adminRequest(request, true); return noStoreJson(await updateModerationSettings(await readJson(request))); }
  catch (error) { return apiError(error); }
}
