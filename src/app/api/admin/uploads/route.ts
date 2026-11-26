import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { prepareImage } from "@/server/uploads/images";
import { prepareVideo } from "@/server/uploads/videos";
import { prisma } from "@/server/db/client";
import { serverConfig } from "@/server/config";
import {
  adminRequest,
  apiError,
  HttpError,
  noStoreJson,
  readLimitedBody,
} from "@/server/http";
import { imageDto } from "@/server/news/service";
import { consumeLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let savedPath: string | null = null;
  try {
    const admin = await adminRequest(request, true);
    await consumeLimit(`uploads:${admin.id}`, 60, 3600);
    const config = serverConfig();
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data;"))
      throw new HttpError(415, "Выберите фотографию для загрузки.");
    const bytes = await readLimitedBody(
      request,
      config.maxVideoBytes + 64 * 1024,
      90_000,
    );
    let form: FormData;
    try {
      form = await new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: new Uint8Array(bytes).buffer,
      }).formData();
    } catch {
      throw new HttpError(400, "Не удалось прочитать файл.");
    }
    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File))
      throw new HttpError(400, "Отправьте одну фотографию за раз.");
    const file = files[0];
    const isVideo = file.type.startsWith("video/");
    const video = isVideo ? await prepareVideo(file) : null;
    const imageOutput = !isVideo ? await prepareImage(file) : null;
    const output = video?.data ?? imageOutput!.data;
    const id = randomUUID();
    const filename = `${id}.${video?.extension ?? "webp"}`;
    await mkdir(config.uploadDirectory, { recursive: true });
    savedPath = path.join(/* turbopackIgnore: true */ config.uploadDirectory, filename);
    await writeFile(savedPath, output, { flag: "wx" });
    const image = await prisma.mediaAsset.create({
      data: {
        id,
        filename,
        width: video?.width ?? imageOutput!.info.width,
        height: video?.height ?? imageOutput!.info.height,
        byteSize: output.byteLength,
        alt: video ? "Видео к публикации" : "Фотография к публикации",
        kind: video ? "VIDEO" : "IMAGE",
        mimeType: video?.mimeType ?? "image/webp",
        duration: video?.duration ?? null,
        uploadedById: admin.id,
      },
    });
    savedPath = null;
    return noStoreJson({ image: imageDto(image), media: imageDto(image) }, 201);
  } catch (error) {
    if (savedPath) await unlink(savedPath).catch(() => {});
    return apiError(error);
  }
}
