import { requireAdmin } from "@/server/auth/guards";
import { Dashboard } from "@/components/admin/dashboard";

export default async function DashboardPage() {
  await requireAdmin();
  return <Dashboard />;
}
