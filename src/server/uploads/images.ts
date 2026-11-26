import "server-only";
import sharp from "sharp";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { serverConfig } from "@/server/config";
import { HttpError } from "@/server/http";

const formats: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

export async function prepareImage(file: File) {
  const maximum = serverConfig().maxUploadBytes;
  if (!formats[file.type]) throw new HttpError(415, "Поддерживаются только фотографии JPEG, PNG и WebP.", { photos: "Выберите JPEG, PNG или WebP." });
  if (!file.size || file.size > maximum) throw new HttpError(413, "Каждая фотография должна быть не больше 5 МБ.", { photos: "Проверьте размер фотографий." });
  try {
    const decoder = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 20_000_000, failOn: "error", animated: false });
    const metadata = await decoder.metadata();
    if (metadata.format !== formats[file.type] || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error("Unsupported image");
    const output = await decoder.rotate().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
    if (output.data.length > maximum) throw new Error("Oversized processed image");
    return output;
  } catch {
    throw new HttpError(415, "Не удалось обработать фотографию. Используйте обычный JPEG, PNG или WebP до 20 мегапикселей, без анимации.", { photos: "Фотография повреждена или не соответствует ограничениям." });
  }
}

export async function removeImageFile(filename: string) {
  if (!/^[a-f0-9-]{36}\.(webp|mp4|webm)$/.test(filename)) throw new Error("Unexpected media filename");
  const root = serverConfig().uploadDirectory;
  const fullPath = path.join(root, filename);
  if (path.dirname(fullPath) !== root) throw new Error("Unsafe media path");
  await unlink(fullPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") console.error("Unable to remove unused media file", error.code); });
}
