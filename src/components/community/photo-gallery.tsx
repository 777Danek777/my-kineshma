"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui/icon";
import type { PublicMedia } from "@/lib/public-types";
import "./post-card.css";

export type PhotoGalleryProps = {
  images: readonly (PublicMedia | string)[];
  title: string;
  imageAlt?: string;
  demo?: boolean;
  eager?: boolean;
};

function sourceOf(image: PublicMedia | string) {
  return typeof image === "string" ? image : `/media/${image.id}`;
}

function ratioOf(image: PublicMedia | string) {
  if (typeof image === "string" || image.width <= 0 || image.height <= 0) return 16 / 10;
  // Keep the complete photo visible; extremes get a quiet letterbox, never a crop.
  return Math.max(0.8, Math.min(2.2, image.width / image.height));
}

export function PhotoGallery({
  images,
  title,
  imageAlt = "",
  demo = false,
  eager = false,
}: PhotoGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const headingId = useId();
  const count = images.length;
  const visibleImages = images.slice(0, 6);
  const ratios = visibleImages.map(ratioOf);
  const averageRatio = ratios.reduce((sum, ratio) => sum + ratio, 0) / Math.max(1, ratios.length);
  const gridRatio = ratios.length <= 3 ? ratios.reduce((sum, ratio) => sum + ratio, 0) : averageRatio * (ratios.length === 4 ? 1 : ratios.length === 5 ? 1.2 : 1.5);
  const activeImage = images[activeIndex] || images[0];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    const opener = openerRef.current;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  const openGallery = (index: number, button: HTMLButtonElement) => {
    setActiveIndex(index);
    openerRef.current = button;
    setOpen(true);
  };

  const closeGallery = () => dialogRef.current?.close();
  const previous = () => setActiveIndex((index) => (index - 1 + count) % count);
  const next = () => setActiveIndex((index) => (index + 1) % count);
  const altOf = (image: PublicMedia | string, index: number) =>
    (typeof image === "string" ? imageAlt : image.alt) ||
    `Фотография ${index + 1} к материалу «${title}»`;

  if (!count) return null;

  const singlePortrait =
    count === 1 &&
    typeof images[0] !== "string" &&
    images[0].height > images[0].width;

  return (
    <>
      <div
        className={`sp-gallery sp-gallery--${Math.min(count, 6)}${singlePortrait ? " sp-gallery--portrait" : ""}`}
        style={{ "--sp-gallery-columns": ratios.map((ratio) => `${ratio}fr`).join(" "), "--sp-gallery-ratio": String(gridRatio), ...(count === 1 ? { aspectRatio: String(ratioOf(images[0])) } : {}) } as CSSProperties}
        role="group"
        aria-label={`Фотографии к материалу: ${title}`}
      >
        {visibleImages.map((image, index) => (
          <button
            type="button"
            className="sp-photo"
            key={`${sourceOf(image)}-${index}`}
            onClick={(event) => openGallery(index, event.currentTarget)}
            aria-label={`Открыть фотографию ${index + 1} из ${count}: ${title}`}
          >
            <Image
              src={sourceOf(image)}
              alt={altOf(image, index)}
              fill
              sizes={
                count === 1
                  ? "(max-width: 700px) 100vw, 700px"
                  : "(max-width: 700px) 50vw, 350px"
              }
              loading={eager && index === 0 ? "eager" : "lazy"}
              unoptimized={typeof image !== "string"}
            />
            {count > 6 && index === 5 && (
              <span className="sp-photo-more" aria-hidden="true">
                +{count - 6}
                <span>фото</span>
              </span>
            )}
            {index === 0 && count > 1 && (
              <span className="sp-photo-count" aria-hidden="true">
                <Icon name="camera" size={15} />
                {count} фото
              </span>
            )}
          </button>
        ))}
      </div>
      <dialog
        ref={dialogRef}
        className="sp-lightbox"
        aria-labelledby={headingId}
        onClose={() => setOpen(false)}
        onCancel={(event) => {
          event.preventDefault();
          closeGallery();
        }}
        onClick={(event) => {
          if (event.currentTarget === event.target) closeGallery();
        }}
        onKeyDown={(event) => {
          if (count < 2) return;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            previous();
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            next();
          }
        }}
      >
        <div className="sp-lightbox-inner">
          <header className="sp-lightbox-heading">
            <div>
              <h2 id={headingId}>{title}</h2>
              {demo && <span>Фотографии демонстрационного материала</span>}
            </div>
            <button
              type="button"
              className="sp-lightbox-close"
              onClick={closeGallery}
              aria-label="Закрыть фотографии"
              autoFocus
            >
              <Icon name="close" size={23} />
            </button>
          </header>
          <div className="sp-lightbox-image">
            <Image
              src={sourceOf(activeImage)}
              alt={altOf(activeImage, activeIndex)}
              fill
              sizes="(max-width: 1200px) 95vw, 1150px"
              unoptimized={typeof activeImage !== "string"}
            />
          </div>
          <footer className="sp-lightbox-footer">
            {count > 1 && (
              <button
                type="button"
                className="sp-gallery-control"
                onClick={previous}
                aria-label="Предыдущая фотография"
              >
                <Icon name="chevron" className="sp-chevron-back" size={20} />
                <span>Назад</span>
              </button>
            )}
            <p role="status" aria-live="polite" aria-atomic="true">
              Фото {activeIndex + 1} из {count}
            </p>
            {count > 1 && (
              <button
                type="button"
                className="sp-gallery-control"
                onClick={next}
                aria-label="Следующая фотография"
              >
                <span>Далее</span>
                <Icon name="chevron" size={20} />
              </button>
            )}
          </footer>
        </div>
      </dialog>
    </>
  );
}
