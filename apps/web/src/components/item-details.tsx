"use client";

import { useEffect, useRef, useState } from "react";
import {
  automaticTitle, hasTitle, itemAuthor, itemHost, itemPublishedDate, itemSource, itemTitle, originalURL, type SavedItem,
} from "@/lib/item";
import { useLibrary } from "@/lib/library";
import { displayDate, failureMessage, isEmptyMetadata } from "@/lib/metadata";
import { safeHref, savedDateTime } from "./format";
import { PreviewImage } from "./link-image";

// Everything known about one saved link. "open link" always opens the saved link itself; an
// original publisher link, when known, is shown for reference only.

export function ItemDetails({ item, fetching, onClose }: { item: SavedItem; fetching: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const { rename, remove, refreshDetails } = useLibrary.getState();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const title = itemTitle(item);
  const href = safeHref(item.url);
  const original = originalURL(item);
  const byline = [itemAuthor(item), itemPublishedDate(item) ? displayDate(itemPublishedDate(item)!) : null].filter(Boolean).join(" · ");

  async function saveTitle(value: string) {
    await rename(item.id, value.replace(/\n/gu, " "));
    setEditing(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      useLibrary.getState().show("problem", "couldn’t copy. select the link to copy it.");
    }
  }

  async function confirmDelete() {
    confirm.current?.close();
    dialog.current?.close();
    await remove(item.id);
  }

  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="details-title" onClose={onClose}>
      <div className="flex h-full flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-[16px]">details</h2>
          <button type="button" className="-mr-3 h-11 px-3 text-[15px] hover:text-strong" onClick={() => dialog.current?.close()}>done</button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
          <PreviewImage imageURL={item.page.imageURL} />
          <section className="space-y-2">
            <p className="text-[13px] text-muted">{itemSource(item) ?? itemHost(item)}</p>
            {editing ? (
              <form onSubmit={(event) => { event.preventDefault(); void saveTitle(draft); }} className="space-y-2">
                <label htmlFor="title-field" className="sr-only">title</label>
                <input
                  id="title-field" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={automaticTitle(item)}
                  className="w-full border-b border-line bg-transparent py-1 text-[22px] leading-snug outline-none focus:border-strong"
                  onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditing(false); } }}
                />
                <p className="text-[13px] text-muted">leave it empty to use the page’s own title.</p>
                <div className="flex gap-6">
                  <button type="submit" className="h-11 text-[15px] hover:text-strong">save title</button>
                  <button type="button" className="h-11 text-[15px] text-muted hover:text-strong" onClick={() => setEditing(false)}>cancel</button>
                </div>
              </form>
            ) : (
              <>
                <h3 id="details-title" className="break-words text-[22px] leading-snug">{title}</h3>
                <button type="button" className="h-11 text-[13px] text-muted hover:text-strong" onClick={() => { setDraft(item.customTitle ?? title); setEditing(true); }}>
                  edit title
                </button>
              </>
            )}
            {byline ? <p className="text-[13px] text-muted">{byline}</p> : null}
          </section>
          {item.page.summary ? <p className="text-muted">{item.page.summary}</p> : null}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center justify-center bg-ink text-canvas hover:bg-strong">
              open link
            </a>
          ) : null}
          <section className="space-y-4">
            <div>
              <p className="text-[13px] text-muted">link</p>
              <p className="break-all select-all">{item.url}</p>
              <button type="button" className="h-11 text-[13px] text-muted hover:text-strong" onClick={() => void copyLink()} aria-live="polite">
                {copied ? "copied" : "copy link"}
              </button>
            </div>
            {original ? (
              <div>
                <p className="text-[13px] text-muted">original</p>
                <p className="break-all text-muted">{original}</p>
                <p className="text-[13px] text-muted">for reference. open link uses the saved link above.</p>
              </div>
            ) : null}
            <div>
              <p className="text-[13px] text-muted">saved</p>
              <p>{savedDateTime(item.createdAt)}</p>
              {item.lastSavedAt - item.createdAt > 60_000 ? <p className="text-[13px] text-muted">saved again {savedDateTime(item.lastSavedAt)}</p> : null}
            </div>
          </section>
          <section className="space-y-1" aria-live="polite">
            <p className="text-[13px] text-muted">details</p>
            {fetching ? <p>fetching details…</p>
              : item.metadataFailure ? (
                <>
                  <p>{failureMessage(item.metadataFailure)}</p>
                  {!hasTitle(item) ? <p className="text-[13px] text-muted">use edit title to give it a name.</p> : null}
                </>
              ) : item.metadataStatus === "fetched" ? <p>{isEmptyMetadata(item.page) ? "the page didn’t describe itself." : "read from the page."}</p>
                : <p>not fetched yet.</p>}
            {item.known ? <p className="text-[13px] text-muted">the title, source, author, and date came with this link. refreshing doesn’t change them.</p> : null}
            {!fetching ? (
              <button type="button" className="h-11 text-[13px] text-muted hover:text-strong" onClick={() => refreshDetails(item.id)}>
                {item.metadataStatus === "failed" ? "try again" : "refresh details"}
              </button>
            ) : null}
          </section>
          <button type="button" className="h-11 text-error hover:underline" onClick={() => confirm.current?.showModal()}>delete link</button>
        </div>
      </div>
      <dialog ref={confirm} className="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-item">
        <h3 id="confirm-title" className="text-[16px]">delete this link?</h3>
        <p id="confirm-item" className="mt-2 break-words text-[13px] text-muted">{title}</p>
        <div className="mt-6 flex justify-end gap-6">
          <button type="button" autoFocus className="h-11 hover:text-strong" onClick={() => confirm.current?.close()}>cancel</button>
          <button type="button" className="h-11 text-error" onClick={() => void confirmDelete()}>delete</button>
        </div>
      </dialog>
    </dialog>
  );
}
