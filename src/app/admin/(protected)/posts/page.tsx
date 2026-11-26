import { requireAdmin } from "@/server/auth/guards";
import { PostsList } from "@/components/admin/posts-list";

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const initialStatus =
    status && ["DRAFT", "PUBLISHED", "UNPUBLISHED"].includes(status)
      ? status
      : "";
  return <PostsList key={initialStatus} initialStatus={initialStatus} />;
}
