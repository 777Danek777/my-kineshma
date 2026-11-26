import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/guards";
import { SettingsManager } from "@/components/admin/settings-manager";

export const metadata: Metadata = { title: "Настройки модерации" };

export default async function SettingsPage() {
  await requireAdmin();
  return <SettingsManager />;
}
