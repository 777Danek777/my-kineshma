import { requireAdmin } from "@/server/auth/guards";
import { CategoriesManager } from "@/components/admin/categories-manager";

export default async function CategoriesPage() {
  await requireAdmin();
  return <CategoriesManager />;
}
