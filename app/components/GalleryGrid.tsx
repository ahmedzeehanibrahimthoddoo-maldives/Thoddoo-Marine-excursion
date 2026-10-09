"use client";

import { useState, useEffect, useCallback } from "react";
import { photos, TAG_LABELS } from "@/lib/photos";

interface GalleryImage {
  src: string;
  alt: string;
  orientation: "landscape" | "portrait";
  tag?: string | null;
}

const galleryImages: GalleryImage[] = photos.map((p) => ({
  src: p.src,
  alt: p.alt,
  orientation: p.orientation,
  tag: p.tag,
}));


export default function GalleryGrid({
  items = [],
}: {
  items?: GalleryImage[];
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [activeTag, setActiveTag] = useState<string>("all");
  const all = items.length > 0 ? items : galleryImages;

  const tags = Array.from(
    new Set(all.map((i) => i.tag).filter((t): t is string => !!t)),
  );
  const images = activeTag === "all" ? all : all.filter((i) => i.tag === activeTag);

  const close = useCallback(() => setLightbox(null), []);

  const prev = useCallback(() => {
    setLightbox((i) =>
      i !== null ? (i - 1 + images.length) % images.length : null,
    );
  }, [images.length]);

  const next = useCallback(() => {
    setLightbox((i) => (i !== null ? (i + 1) % images.length : null));
  }, [images.length]);

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightbox, close, prev, next]);

  return (
    <>
      {tags.length > 0 && (
        <div className="galleryFilters">
          <button
            className={`galleryFilter ${activeTag === "all" ? "on" : ""}`}
            onClick={() => setActiveTag("all")}
          >
            All {all.length}
          </button>
          {tags.map((t) => (
            <button
              key={t}
              className={`galleryFilter ${activeTag === t ? "on" : ""}`}
              onClick={() => setActiveTag(t)}
            >
              {TAG_LABELS[t] || t}
            </button>
          ))}
        </div>
      )}

      <div className="galleryGrid">
        {images.map((img, i) => (
          <button
            key={img.src}
            className={`galleryItem ${img.orientation}`}
            onClick={() => setLightbox(i)}
            aria-label={`View ${img.alt}`}
          >
            <img src={img.src} alt={img.alt} loading="lazy" />
            {img.tag && (
              <span className="galleryTag">{TAG_LABELS[img.tag] || img.tag}</span>
            )}
          </button>
        ))}
      </div>

      {lightbox !== null && (
        <div className="lightboxOverlay" onClick={close}>
          <button
            className="lightboxClose"
            onClick={close}
            aria-label="Close lightbox"
          >
            ✕
          </button>
          <button
            className="lightboxPrev"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            aria-label="Previous image"
          >
            ‹
          </button>
          <div className="lightboxContent" onClick={(e) => e.stopPropagation()}>
            <img src={images[lightbox].src} alt={images[lightbox].alt} />
            {images[lightbox].tag && (
              <p className="lightboxTag">
                {(TAG_LABELS[images[lightbox].tag as string] ||
                  images[lightbox].tag) as string}
              </p>
            )}
            <p className="lightboxCaption">{images[lightbox].alt}</p>
          </div>
          <button
            className="lightboxNext"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            aria-label="Next image"
          >
            ›
          </button>
        </div>
      )}
    </>
  );
}
