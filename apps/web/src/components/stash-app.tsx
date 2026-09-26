"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isDeleted, matchesQuery } from "@/lib/item";
import { LinkError, sharedLink, typedLink, unwrapped } from "@/lib/link";
import { useLibrary } from "@/lib/library";
import { useSync } from "@/lib/sync-store";
import { AccountMenu } from "./account-menu";
import { ItemDetails } from "./item-details";
import { ItemRow } from "./item-row";

// The one screen: save a link, find it again. Everything is stored in this browser first.

/** What the add field will actually save, when that differs from what was typed. */
function savesAs(text: string): string | null {
  try {
    const link = typedLink(text);
    return link.string === unwrapped(text) ? null : link.string;
  } catch {
    return null;
  }
}

/** A link handed over by the share sheet (installed app) or a bookmarklet: `/?url=…&text=…&title=…`. */
function sharedFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const urls = params.getAll("url").filter(Boolean);
  const texts = [...params.getAll("text"), ...params.getAll("title")].filter(Boolean);
  if (!urls.length && !texts.length) return null;
  window.history.replaceState(null, "", window.location.pathname);
  try { return sharedLink({ urls, texts }).string; } catch (error) {
    useLibrary.getState().show("problem", error instanceof LinkError ? error.message : "no link found. nothing was saved.");
    return null;
  }
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function subscribeToConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => { window.removeEventListener("online", onChange); window.removeEventListener("offline", onChange); };
}

export function StashApp() {
  const { items, ready, error, fetching, notice, focus, save, draft: text, setDraft: setText, query, setQuery } = useLibrary();
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const online = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);
  const input = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void useSync.getState().initialize();
    const shared = sharedFromLocation();
    if (shared) { useLibrary.getState().setDraft(shared); requestAnimationFrame(() => saveButton.current?.focus()); }
  }, []);

  // Pasting anywhere outside a text field saves the link on the clipboard.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;
      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      if (!pasted.trim()) return;
      event.preventDefault();
      void useLibrary.getState().save(pasted);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, []);

  useEffect(() => {
    if (focus) requestAnimationFrame(() => document.getElementById(`item-${focus.id}`)?.scrollIntoView({ block: "nearest" }));
  }, [focus]);

  const visible = useMemo(() => {
    const trimmed = query.trim();
    return trimmed ? items.filter((item) => matchesQuery(item, trimmed)) : items;
  }, [items, query]);
  const details = detailsId ? items.find((item) => item.id === detailsId && !isDeleted(item)) : undefined;
  const preview = savesAs(text);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (await save(text)) setText("");
    input.current?.focus();
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-5 sm:px-8">
      <header className="flex h-14 items-center justify-between">
        <h1 className="text-[16px]">stash</h1>
        <AccountMenu />
      </header>

      <form onSubmit={submit} className="pt-4" aria-label="save a link">
        <div className="flex items-end gap-4 border-b border-line focus-within:border-strong">
          <label htmlFor="link-field" className="sr-only">link</label>
          <input
            id="link-field" ref={input} value={text} onChange={(event) => setText(event.target.value, true)}
            placeholder="paste or type a link" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            inputMode="url" enterKeyHint="go"
            className="min-w-0 flex-1 bg-transparent py-3 text-[18px] outline-none"
          />
          <button ref={saveButton} type="submit" className="h-11 shrink-0 px-1 text-[15px] hover:text-strong disabled:text-muted" disabled={!text.trim()}>
            save
          </button>
        </div>
        <div className="min-h-6 pt-2 text-[13px]" aria-live="polite">
          {notice ? (
            <p className={notice.kind === "problem" ? "text-error" : "text-muted"}>{notice.text}</p>
          ) : preview ? (
            <p className="truncate text-muted">saves as {preview}</p>
          ) : !online ? (
            <p className="text-muted">you’re offline. links still save; details load later.</p>
          ) : null}
        </div>
      </form>

      <main className="flex flex-1 flex-col pb-16">
        {!ready ? (
          <p className="opening py-16 text-center text-[13px] text-muted">opening your links…</p>
        ) : error ? (
          <Empty title="your links couldn’t be opened" message={error} />
        ) : items.length === 0 ? (
          <Empty title="nothing saved yet" message="paste a link above, or share one to stash." />
        ) : (
          <>
            <div className="mt-4 flex items-center gap-2 border-b border-line text-muted focus-within:border-strong">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" /><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeLinecap="round" /></svg>
              <label htmlFor="search-field" className="sr-only">search</label>
              <input
                id="search-field" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="search"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-ink outline-none"
                onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
              />
              {query ? (
                <button type="button" className="-mr-2 h-10 px-2 text-[13px] hover:text-strong" onClick={() => setQuery("")}>clear</button>
              ) : null}
            </div>
            {visible.length === 0 ? (
              <Empty title="no matches" message="search looks at titles, sites, and links." />
            ) : (
              <ul className="mt-1" aria-label="saved links">
                {visible.map((item) => (
                  <ItemRow key={item.id} item={item} fetching={fetching.includes(item.id)} onDetails={() => setDetailsId(item.id)} />
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      {details ? <ItemDetails key={details.id} item={details} fetching={fetching.includes(details.id)} onClose={() => setDetailsId(null)} /> : null}
    </div>
  );
}

function Empty({ title, message }: { title: string; message: string }) {
  return (
    <div className="py-16 text-center">
      <p className="text-[16px]">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-[13px] text-muted">{message}</p>
    </div>
  );
}
