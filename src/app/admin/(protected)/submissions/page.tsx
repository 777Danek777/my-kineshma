import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/guards";
import { SubmissionsList } from "@/components/admin/submissions-list";

export const metadata: Metadata = { title: "Входящие заявки" };

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const initialStatus = typeof status === "string" && ["PENDING", "APPROVED", "REJECTED", "ALL"].includes(status)
    ? status
    : "PENDING";
  return <SubmissionsList initialStatus={initialStatus} />;
}
