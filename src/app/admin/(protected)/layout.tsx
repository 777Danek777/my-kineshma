import { requireAdmin } from "@/server/auth/guards";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  return <AdminShell user={user}>{children}</AdminShell>;
}
