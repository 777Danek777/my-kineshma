"use client";

import { useState } from "react";
import type { PublicMedia } from "@/lib/public-types";
import { Icon } from "@/components/ui/icon";
import "./post-card.css";

export function NativeVideo({ media, title }: { media: PublicMedia; title: string }) {
  const [failed, setFailed] = useState(false);
  const mime = ["video/mp4", "video/webm"].includes(media.mimeType || "") ? media.mimeType! : undefined;
  const ratio = media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9;
  return <figure className={`sp-native-video${ratio < 1 ? " sp-native-video--portrait" : ""}`}>
    {/* Reader-uploaded videos have no caption track; native controls preserve accessible playback without autoplay. */}
    <video controls playsInline preload="metadata" style={{ aspectRatio: String(ratio) }} aria-label={`Видео: ${title}`} onError={() => setFailed(true)}>
      <source src={`/media/${media.id}`} type={mime} />
      Ваш браузер не поддерживает воспроизведение видео.
    </video>
    <figcaption><span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 4 12 8-12 8V4Z" strokeLinejoin="round" /></svg>Видео публикации</span>{failed && <a href={`/media/${media.id}`} target="_blank" rel="noopener noreferrer">Открыть видео отдельно<Icon name="external" size={14} /></a>}</figcaption>
  </figure>;
}
