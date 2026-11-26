import { parentPort, workerData } from "node:worker_threads";
import mediaInfoFactory from "mediainfo.js";

let parser;
try {
  const bytes = new Uint8Array(workerData.bytes);
  parser = await mediaInfoFactory({ format: "object", full: false });
  const result = await parser.analyzeData(bytes.byteLength, (size, offset) => bytes.subarray(offset, Math.min(offset + size, bytes.byteLength)));
  // Return only technical playback information, never embedded author/contact/location tags.
  const tracks = result.media?.track ?? [];
  const general = tracks.find(track => track["@type"] === "General");
  const video = tracks.filter(track => track["@type"] === "Video");
  const audio = tracks.filter(track => track["@type"] === "Audio");
  parentPort.postMessage({ format: general?.Format, duration: Number(general?.Duration ?? video[0]?.Duration), width: Number(video[0]?.Width), height: Number(video[0]?.Height), videoCount: video.length, videoCodec: video[0]?.Format, audioCodecs: audio.map(track => track.Format), truncated: general?.IsTruncated === "Yes" });
} catch {
  parentPort.postMessage({ error: true });
} finally { parser?.close(); }
