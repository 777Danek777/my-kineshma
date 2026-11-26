import { requireAdmin } from "@/server/auth/guards";
import { PostEditorLoader } from "@/components/admin/post-editor";

export default async function NewPostPage() {
  await requireAdmin();
  return <PostEditorLoader />;
}
