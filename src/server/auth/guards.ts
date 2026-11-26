import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function getAdminSession(requestHeaders?: Headers) {
  const session = await auth.api.getSession({
    headers: requestHeaders ?? (await headers()),
  });
  if (!session || session.user.role !== "admin") return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
}

export async function requireAdmin() {
  const user = await getAdminSession();
  if (!user) redirect("/admin/login");
  return user;
}
