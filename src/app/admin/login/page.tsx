import { redirect } from "next/navigation";
import { getAdminSession } from "@/server/auth/guards";
import { LoginForm } from "@/components/admin/login-form";

export default async function LoginPage() {
  if (await getAdminSession()) redirect("/admin");
  return <LoginForm />;
}
