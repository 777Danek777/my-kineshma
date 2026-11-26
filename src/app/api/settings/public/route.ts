import { apiError, noStoreJson } from "@/server/http";
import { getModerationSettings } from "@/server/settings/moderation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const settings = await getModerationSettings();
    return noStoreJson({ commentsModerationEnabled: settings.commentsModerationEnabled, postsModerationEnabled: settings.postsModerationEnabled });
  } catch (error) { return apiError(error); }
}
