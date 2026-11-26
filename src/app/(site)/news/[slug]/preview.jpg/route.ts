import { prisma } from "@/server/db/client";
import { HttpError } from "@/server/http";
import { validSlug } from "@/server/social/service";
import { publicationPreview } from "@/server/social/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
export async function GET(_request: Request, { params }: { params: Promise<{slug: string}> }) {
  try {
    const slug = validSlug((await params).slug);
    const post = await prisma.post.findFirst({
      where: { slug, status: "PUBLISHED", publishedAt: { not: null } },
      select: { images: { where: { media: { kind: "IMAGE" } }, orderBy: { order: "asc" }, take: 1, select: { media: { select: { filename: true } } } } },
    });
    if (!post) return new Response(null, { status: 404, headers });
    const filename = post.images[0]?.media.filename;
    if (filename && !/^[a-f0-9-]{36}\.webp$/.test(filename)) return new Response(null, { status: 404, headers });
    // JPEG gives social crawlers a predictable 1200x630 cover, including posts without photos.
    // The published state is checked on every request; private originals are never cached here.
    const output = await publicationPreview(filename);
    return new Response(new Uint8Array(output), { headers: { ...headers, "Content-Type": "image/jpeg", "Content-Length": String(output.length) } });
  } catch (error) {
    if (error instanceof HttpError && error.status === 503) return new Response(null, { status: 503, headers: { ...headers, "Retry-After": "3" } });
    return new Response(null, { status: 404, headers });
  }
}
