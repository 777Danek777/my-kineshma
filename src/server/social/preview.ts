import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { serverConfig } from "@/server/config";
import { HttpError } from "@/server/http";

// Media filenames are immutable. This private, bounded LRU stores only encoded JPEGs.
// The route must still check published access before asking for any cached result.
const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
const maxEntries = 20;
const maxBytes = 12 * 1024 * 1024;
let cacheBytes = 0;

export async function publicationPreview(filename?: string) {
  const key = filename ?? "city-panorama";
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  if (pending.size >= 2) throw new HttpError(503, "Превью готовится. Повторите запрос позже.");
  const task = (async () => {
    const file = filename
      ? path.join(serverConfig().uploadDirectory, filename)
      : path.join(process.cwd(), "public", "images", "city-panorama.jpg");
    const output = await sharp(await readFile(file), { limitInputPixels: 20_000_000 })
      .rotate().resize(1200, 630, { fit: "cover" }).jpeg({ quality: 84 }).toBuffer();
    while (cache.size && (cache.size >= maxEntries || cacheBytes + output.length > maxBytes)) {
      const oldest = cache.keys().next().value!;
      cacheBytes -= cache.get(oldest)!.length;
      cache.delete(oldest);
    }
    if (output.length <= maxBytes) { cache.set(key, output); cacheBytes += output.length; }
    return output;
  })();
  pending.set(key, task);
  try { return await task; }
  finally { pending.delete(key); }
}
