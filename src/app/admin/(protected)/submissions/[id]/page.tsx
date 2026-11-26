import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/guards";
import { SubmissionEditorLoader } from "@/components/admin/submissions-editor";

export const metadata: Metadata = { title: "Просмотр заявки" };

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  return <SubmissionEditorLoader id={id} />;
}
