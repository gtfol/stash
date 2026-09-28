"use client";

import { useState } from "react";

// Previews load straight from the page's image host, without a referrer. Anything too small or
// oddly shaped to be a real preview (tracking pixels, banners) is treated as no image.

function reliable(image: HTMLImageElement): boolean {
  const { naturalWidth: width, naturalHeight: height } = image;
  return Math.min(width, height) >= 64 && Math.max(width, height) / Math.min(width, height) <= 4;
}

export function LinkThumbnail({ imageURL, label, size = 48 }: { imageURL?: string; label: string; size?: number }) {
  const [shown, setShown] = useState<string | null>(null);
  const letter = [...label.trim()][0]?.toLowerCase() ?? "·";
  return (
    <span className="tile relative grid shrink-0 place-items-center overflow-hidden text-muted" style={{ width: size, height: size }} aria-hidden>
      <span className="text-[17px]">{letter}</span>
      {imageURL ? (
        // Arbitrary third-party hosts: next/image would need every domain allowed and would proxy them.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageURL} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: shown === imageURL ? 1 : 0 }}
          onLoad={(event) => { if (reliable(event.currentTarget)) setShown(imageURL); }}
          onError={() => setShown(null)}
        />
      ) : null}
    </span>
  );
}

export function PreviewImage({ imageURL }: { imageURL?: string }) {
  const [shown, setShown] = useState<string | null>(null);
  if (!imageURL) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageURL} alt="" referrerPolicy="no-referrer" decoding="async"
      className={shown === imageURL ? "block max-h-64 w-full object-cover" : "hidden"}
      onLoad={(event) => { if (reliable(event.currentTarget)) setShown(imageURL); }}
      onError={() => setShown(null)}
    />
  );
}
