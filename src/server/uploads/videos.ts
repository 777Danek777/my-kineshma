import "server-only";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { HttpError } from "@/server/http";
import { serverConfig } from "@/server/config";

type Probe = { format: string; duration: number; width: number; height: number; videoCount: number; videoCodec: string; audioCodecs: string[]; truncated: boolean; error?: boolean };
const workers = globalThis as unknown as { activeVideoProbes?: number };
function invalidVideo() { return new HttpError(415, "Не удалось прочитать видео. Выберите MP4 с H.264/AAC или WebM с VP8/VP9 до 50 МБ.", { video: "Видео повреждено или использует неподдерживаемый формат." }); }
async function probeVideo(data: Buffer): Promise<Probe> {
  if ((workers.activeVideoProbes ?? 0) >= 2) throw new HttpError(503, "Сейчас проверяются другие видео. Повторите отправку через несколько секунд.");
  workers.activeVideoProbes = (workers.activeVideoProbes ?? 0) + 1;
  try {
    return await new Promise((resolve, reject) => {
      const bytes = Uint8Array.from(data).buffer;
      const worker = new Worker(path.join(/* turbopackIgnore: true */ process.cwd(), "scripts", "media-probe-worker.mjs"), {
        workerData: { bytes }, transferList: [bytes], resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
      });
      const timeout = setTimeout(() => { void worker.terminate(); reject(invalidVideo()); }, 10_000);
      worker.once("message", (result: Probe) => { clearTimeout(timeout); void worker.terminate(); if (result.error) reject(invalidVideo()); else resolve(result); });
      worker.once("error", () => { clearTimeout(timeout); reject(invalidVideo()); });
      worker.once("exit", () => { clearTimeout(timeout); reject(invalidVideo()); });
    });
  } finally { workers.activeVideoProbes = Math.max(0, (workers.activeVideoProbes ?? 1) - 1); }
}
export async function prepareVideo(file: File) {
  if (!["video/mp4", "video/webm"].includes(file.type)) throw invalidVideo();
  if (!file.size || file.size > serverConfig().maxVideoBytes) throw new HttpError(413, "Видео должно быть не больше 50 МБ.", { video: "Выберите видео до 50 МБ." });
  const data = Buffer.from(await file.arrayBuffer());
  const info = await probeVideo(data);
  const mp4 = file.type === "video/mp4";
  if (Number.isFinite(info.duration) && info.duration > 600) throw new HttpError(413, "Видео должно быть не длиннее 10 минут.", {video:"Выберите короткий фрагмент до 10 минут."});
  if (info.width > 3840 || info.height > 3840) throw new HttpError(413, "Разрешение видео — до 3840 пикселей по каждой стороне.", {video:"Сохраните видео с разрешением 4K или ниже."});
  if (info.truncated || info.videoCount !== 1 || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 600 || !Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1 || info.width > 3840 || info.height > 3840 || (mp4 ? info.format !== "MPEG-4" || info.videoCodec !== "AVC" || info.audioCodecs.some(codec => codec !== "AAC") : info.format !== "WebM" || !["VP8", "VP9"].includes(info.videoCodec) || info.audioCodecs.some(codec => !["Opus", "Vorbis"].includes(codec)))) throw invalidVideo();
  return { data, width: info.width, height: info.height, duration: info.duration, mimeType: file.type, extension: mp4 ? "mp4" : "webm" };
}
