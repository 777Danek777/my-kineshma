import { prisma } from "@/server/db/client";
import {
  adminRequest,
  apiError,
  HttpError,
  noStoreJson,
  readJson,
} from "@/server/http";
import {
  deletePost,
  postDto,
  postInclude,
  updatePost,
  validId,
} from "@/server/news/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    await adminRequest(request);
    const id = validId((await context.params).id);
    const post = await prisma.post.findUnique({
      where: { id },
      include: postInclude,
    });
    if (!post) throw new HttpError(404, "Публикация не найдена.");
    return noStoreJson({ post: postDto(post) });
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    await adminRequest(request, true);
    const id = validId((await context.params).id);
    return noStoreJson({ post: await updatePost(id, await readJson(request)) });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    await adminRequest(request, true);
    const id = validId((await context.params).id);
    await deletePost(id, await readJson(request));
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
