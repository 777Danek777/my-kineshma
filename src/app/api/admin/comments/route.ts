import { adminRequest, apiError, noStoreJson } from "@/server/http";
import { adminComments } from "@/server/social/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { await adminRequest(request); return noStoreJson(await adminComments(request)); }
  catch (error) { return apiError(error); }
}
