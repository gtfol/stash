"use client";

import { create } from "zustand";
import { applyMetadata, recordMetadataFailure, renameItem, wantsAutomaticMetadata, type Origin, type SavedItem } from "./item";
import { LinkError, typedLink, type WebLink } from "./link";
import { activateSpace, currentSpace, deleteItem, GUEST_SPACE, readLibrary, saveLink, seedGuestOnce, subscribeToChanges, updateItem } from "./local-db";
import type { LinkMetadata, MetadataFailure } from "./metadata";

// The library shown on screen: the active space's items, what's being fetched, and the one
// status line under the add field. Every change goes through local storage first.

export type NoticeKind = "saved" | "alreadySaved" | "info" | "problem";
export interface Notice { kind: NoticeKind; text: string; id: number }

interface LibraryState {
  space: string;
  items: SavedItem[];
  ready: boolean;
  error: string | null;
  fetching: string[];
  notice: Notice | null;
  /** The item a save just added or moved, so the list can bring it into view. */
  focus: { id: string; token: number } | null;
  /** The add field and search field, kept here so saves and shares can set them. */
  draft: string;
  query: string;
  setDraft: (draft: string, typed?: boolean) => void;
  setQuery: (query: string) => void;
  initialize: () => Promise<void>;
  reload: () => Promise<void>;
  switchSpace: (space: string) => Promise<void>;
  save: (text: string | WebLink, origin?: Origin) => Promise<boolean>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refreshDetails: (id: string) => void;
  show: (kind: NoticeKind, text: string) => void;
}

let initialization: Promise<void> | null = null;
let generation = 0;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let pausedUntil = 0;
// Items tried automatically since this page opened. A failed fetch is retried on the next visit
// or when the connection returns, not in a loop.
const attempted = new Set<string>();
const MAX_FETCHES = 3;
const message = (error: unknown, fallback: string) => error instanceof Error && !(error instanceof DOMException) ? error.message : fallback;

export const useLibrary = create<LibraryState>((set, get) => {
  /** Fetches details for items that want them, a few at a time. */
  function scheduleDetails(only?: string[]) {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (Date.now() < pausedUntil) return;
    const { items, fetching, space } = get();
    const candidates = items.filter((item) => (only ? only.includes(item.id) : wantsAutomaticMetadata(item) && !attempted.has(item.id)) && !fetching.includes(item.id));
    for (const item of candidates.slice(0, Math.max(0, MAX_FETCHES - fetching.length))) void fetchDetails(space, item);
  }

  async function fetchDetails(space: string, item: SavedItem) {
    attempted.add(item.id);
    set({ fetching: [...get().fetching, item.id] });
    const run = async () => {
      const outcome = await requestDetails(item.url);
      const now = Date.now();
      if (outcome.kind === "paused") { pausedUntil = now + outcome.seconds * 1000; return; }
      await updateItem(space, item.id, (current) => outcome.kind === "metadata"
        ? applyMetadata(current, outcome.metadata, now)
        : current.metadataStatus === "failed" && current.metadataFailure === "offline" && outcome.failure === "offline" ? null : recordMetadataFailure(current, outcome.failure, now));
    };
    try {
      // Another tab fetching the same item is enough.
      if (navigator.locks) await navigator.locks.request(`stash-details:${space}:${item.id}`, { ifAvailable: true }, (lock) => lock ? run() : undefined);
      else await run();
    } catch {
      // Storage errors surface through the next reload; the item stays saved either way.
    } finally {
      set({ fetching: get().fetching.filter((id) => id !== item.id) });
      if (get().space === space) scheduleDetails();
    }
  }

  return {
    space: GUEST_SPACE, items: [], ready: false, error: null, fetching: [], notice: null, focus: null, draft: "", query: "",
    // Typing starts over, so an earlier message doesn't hide what the new text will save as.
    setDraft: (draft, typed = false) => set(typed ? { draft, notice: null } : { draft }),
    setQuery: (query) => set({ query }),

    initialize: () => {
      if (initialization) return initialization;
      initialization = (async () => {
        try {
          const space = await currentSpace();
          if (space === GUEST_SPACE) await seedGuestOnce(Date.now());
          set({ space });
          subscribeToChanges((changed, source) => {
            if (changed !== get().space) return;
            void get().reload().then(() => { if (source === "remote") scheduleDetails(); });
          });
          await get().reload();
          scheduleDetails();
          window.addEventListener("online", () => { attempted.clear(); scheduleDetails(); });
          document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleDetails(); });
        } catch (error) {
          set({ ready: true, error: message(error, "This browser couldn’t open your links.") });
          initialization = null;
        }
      })();
      return initialization;
    },

    reload: async () => {
      const space = get().space;
      const token = ++generation;
      try {
        const items = await readLibrary(space);
        if (space === get().space && token === generation) set({ items, ready: true, error: null });
      } catch (error) {
        if (space === get().space && token === generation) set({ ready: true, error: message(error, "This browser couldn’t read your links.") });
      }
    },

    switchSpace: async (space) => {
      if (space === get().space) return;
      generation++;
      set({ space, items: [], ready: false, error: null, fetching: [], focus: null });
      await activateSpace(space);
      if (space === GUEST_SPACE) await seedGuestOnce(Date.now());
      await get().reload();
      scheduleDetails();
    },

    save: async (input, origin = "app") => {
      let link: WebLink;
      try {
        link = typeof input === "string" ? typedLink(input) : input;
      } catch (error) {
        get().show("problem", error instanceof LinkError ? error.message : "that isn’t a web link. nothing was saved.");
        return false;
      }
      if (!get().ready) await get().initialize();
      const space = get().space;
      try {
        const { result, item } = await saveLink(space, link, origin, Date.now());
        await get().reload();
        // A new save should be visible even if a search was hiding it.
        set({ focus: { id: item.id, token: Date.now() }, query: "" });
        const online = typeof navigator === "undefined" || navigator.onLine;
        if (result === "added") get().show("saved", online ? "saved." : "saved. details will load when you’re back online.");
        else get().show("alreadySaved", "already saved. moved to the top.");
        if (result === "added") scheduleDetails([item.id]);
        return true;
      } catch {
        get().show("problem", "couldn’t save this link. try again.");
        return false;
      }
    },

    rename: async (id, title) => {
      try { await updateItem(get().space, id, (item) => renameItem(item, title, Date.now())); }
      catch { get().show("problem", "couldn’t rename this link. try again."); }
    },

    remove: async (id) => {
      try { await deleteItem(get().space, id, Date.now()); get().show("info", "deleted."); }
      catch { get().show("problem", "couldn’t delete this link. try again."); }
    },

    refreshDetails: (id) => {
      pausedUntil = 0;
      if (!navigator.onLine) {
        const space = get().space;
        void updateItem(space, id, (item) => recordMetadataFailure(item, "offline", Date.now()));
        return;
      }
      scheduleDetails([id]);
    },

    show: (kind, text) => {
      if (noticeTimer) clearTimeout(noticeTimer);
      const notice = { kind, text, id: Date.now() };
      set({ notice });
      noticeTimer = setTimeout(() => { if (get().notice?.id === notice.id) set({ notice: null }); }, kind === "problem" ? 6_000 : 3_000);
    },
  };
});

type DetailsOutcome =
  | { kind: "metadata"; metadata: LinkMetadata }
  | { kind: "failure"; failure: MetadataFailure }
  | { kind: "paused"; seconds: number };

async function requestDetails(url: string): Promise<DetailsOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/details", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  } catch {
    // This app's own server couldn't be reached: treated as offline, so it doesn't use up retries.
    return { kind: "failure", failure: "offline" };
  }
  if (response.status === 429 || response.status === 503) {
    return { kind: "paused", seconds: Math.min(Math.max(Number(response.headers.get("retry-after")) || 60, 5), 900) };
  }
  if (!response.ok) return { kind: "failure", failure: "other" };
  const body = await response.json().catch(() => null) as { metadata?: LinkMetadata; failure?: MetadataFailure } | null;
  if (body?.metadata) return { kind: "metadata", metadata: body.metadata };
  return { kind: "failure", failure: body?.failure ?? "other" };
}
