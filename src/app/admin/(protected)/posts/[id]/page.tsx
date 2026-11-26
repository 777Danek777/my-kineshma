import { requireAdmin } from "@/server/auth/guards";
import { PostEditorLoader } from "@/components/admin/post-editor";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  return <PostEditorLoader id={id} />;
}
