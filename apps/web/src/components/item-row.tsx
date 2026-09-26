"use client";

import { itemSource, itemTitle, itemHost, type SavedItem } from "@/lib/item";
import { caption, safeHref } from "./format";
import { LinkThumbnail } from "./link-image";

export function ItemRow({ item, fetching, onDetails }: { item: SavedItem; fetching: boolean; onDetails: () => void }) {
  const title = itemTitle(item);
  const href = safeHref(item.url);
  return (
    <li id={`item-${item.id}`} className="group flex scroll-my-4 items-center gap-3 border-t border-line first:border-t-0">
      <a
        href={href} target="_blank" rel="noopener noreferrer"
        className="flex min-w-0 flex-1 items-center gap-4 py-3 outline-offset-[-1px]"
        title={item.url}
      >
        <LinkThumbnail imageURL={item.page.imageURL} label={itemSource(item) ?? itemHost(item)} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words text-[16px] leading-snug text-ink group-hover:text-strong">{title}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">{caption(item, fetching)}</span>
        </span>
      </a>
      <button
        type="button" onClick={onDetails} aria-label={`details for ${title}`}
        className="grid h-11 w-11 shrink-0 place-items-center text-muted hover:text-strong"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <circle cx="9" cy="9" r="7.5" stroke="currentColor" />
          <path d="M9 8v5" stroke="currentColor" strokeLinecap="round" />
          <circle cx="9" cy="5.5" r="0.8" fill="currentColor" />
        </svg>
      </button>
    </li>
  );
}
