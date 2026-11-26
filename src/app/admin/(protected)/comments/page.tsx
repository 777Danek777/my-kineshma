import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/guards";
import { CommentsManager } from "@/components/admin/comments-manager";
import type { AdminCommentStatus } from "@/components/admin/comments-types";

export const metadata: Metadata = { title: "Комментарии" };

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const initialStatus: AdminCommentStatus =
    status === "APPROVED" || status === "REJECTED" ? status : "PENDING";
  return <CommentsManager key={initialStatus} initialStatus={initialStatus} />;
}
