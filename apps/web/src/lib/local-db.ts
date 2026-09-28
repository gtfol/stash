import { compareIdentity, isDeleted, mergeItems, newItem, recordSave, seedItem, tombstone, type Origin, type SavedItem } from "./item";
import type { WebLink } from "./link";
import type { SyncChange, SyncResponse, SyncRow } from "./sync-types";

// The library in this browser, in IndexedDB. Guests have one space; each signed-in account has
// its own. Every change is one transaction, and in an account space its pending token is written
// in that same transaction, so an interrupted write can't lose its place in the sync queue.
// Modeled on capsule's browser storage.

const DATABASE = "stash-v1";
export const GUEST_SPACE = "guest";
export const accountSpace = (userId: string) => `account:${userId}`;

export interface StoredItem {
  key: string;
  space: string;
  id: string;
  /** Copied from the item for the page index; empty once deleted. */
  dedupeKey: string;
  item: SavedItem;
  revision: number;
  pendingToken: string | null;
}

interface Meta { key: string; value: unknown }
type ChangeSource = "local" | "remote";
type Listener = (space: string, source: ChangeSource) => void;

let databasePromise: Promise<IDBDatabase> | null = null;
let channel: BroadcastChannel | null = null;
const listeners = new Set<Listener>();
const keyFor = (space: string, id: string) => `${space}|${id}`;
const metaKey = (space: string, name: string) => `${space}|${name}`;
const isAccount = (space: string) => space.startsWith("account:");

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Browser storage failed."));
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Browser storage failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Browser storage was interrupted."));
  });
}

/** Runs `body` in one read-write transaction and aborts it if `body` throws. */
async function write<T>(stores: string[], body: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(stores, "readwrite");
  const done = completed(tx);
  try {
    const result = await body(tx);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* Already finished. */ }
    await done.catch(() => undefined);
    throw error;
  }
}

export function subscribeToChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(space: string, source: ChangeSource = "local") {
  listeners.forEach((listener) => listener(space, source));
  channel?.postMessage({ space, source });
}

export function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser can’t store links. Try another browser."));
    const req = indexedDB.open(DATABASE, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const items = db.createObjectStore("items", { keyPath: "key" });
      items.createIndex("space", "space");
      items.createIndex("page", ["space", "dedupeKey"]);
      db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); databasePromise = null; };
      if (typeof BroadcastChannel !== "undefined" && !channel) {
        channel = new BroadcastChannel("stash-changes");
        // Node (tests) would otherwise stay alive for the channel; browsers have no unref.
        (channel as BroadcastChannel & { unref?: () => void }).unref?.();
        channel.onmessage = ({ data }) => {
          if (typeof data?.space === "string" && (data.source === "local" || data.source === "remote")) {
            listeners.forEach((listener) => listener(data.space, data.source));
          }
        };
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("This browser couldn’t open stash’s storage."));
    req.onblocked = () => reject(new Error("Close other stash tabs, then reload."));
  });
  databasePromise.catch(() => { databasePromise = null; });
  return databasePromise;
}

function stored(space: string, item: SavedItem, revision: number, pendingToken: string | null): StoredItem {
  return { key: keyFor(space, item.id), space, id: item.id, dedupeKey: isDeleted(item) ? "" : item.dedupeKey, item, revision, pendingToken };
}

// Guests never sync, so only account spaces queue changes.
const pendingFor = (space: string) => isAccount(space) ? crypto.randomUUID() : null;

async function metaValue<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  const value = await request(db.transaction("meta", "readonly").objectStore("meta").get(key)) as Meta | undefined;
  return value?.value as T | undefined;
}

export async function currentSpace(): Promise<string> {
  return (await metaValue<string>("active-space")) ?? GUEST_SPACE;
}

export async function activateSpace(space: string): Promise<void> {
  await write(["meta"], async (tx) => { tx.objectStore("meta").put({ key: "active-space", value: space }); });
}

export async function listStored(space: string): Promise<StoredItem[]> {
  const db = await openDatabase();
  return request(db.transaction("items", "readonly").objectStore("items").index("space").getAll(space)) as Promise<StoredItem[]>;
}

/** Live items, most recently saved first. */
export async function readLibrary(space: string): Promise<SavedItem[]> {
  return (await listStored(space)).map((row) => row.item).filter((item) => !isDeleted(item))
    .sort((a, b) => b.lastSavedAt - a.lastSavedAt || -compareIdentity(a, b));
}

/** The first-launch article, once per browser. Deleting it or clearing the library never brings it back. */
export async function seedGuestOnce(now: number): Promise<boolean> {
  const added = await write(["items", "meta"], async (tx) => {
    const meta = tx.objectStore("meta");
    if (await request(meta.get(metaKey(GUEST_SPACE, "seeded")))) return false;
    tx.objectStore("items").put(stored(GUEST_SPACE, seedItem(now), 0, null));
    meta.put({ key: metaKey(GUEST_SPACE, "seeded"), value: now });
    return true;
  });
  if (added) notify(GUEST_SPACE);
  return added;
}

export type SaveResult = { result: "added" | "alreadySaved"; item: SavedItem };

/** Saves a link, or moves the existing item for the same page to the top. */
export async function saveLink(space: string, link: WebLink, origin: Origin, now: number): Promise<SaveResult> {
  const saved = await write(["items"], async (tx) => {
    const items = tx.objectStore("items");
    const existing = await request(items.index("page").get([space, link.dedupeKey])) as StoredItem | undefined;
    if (existing) {
      const moved = recordSave(existing.item, Math.max(now, existing.item.lastSavedAt + 1), now) ?? existing.item;
      items.put({ ...stored(space, moved, existing.revision, pendingFor(space) ?? existing.pendingToken) });
      return { result: "alreadySaved" as const, item: moved };
    }
    const item = newItem(link, now, origin);
    items.put(stored(space, item, 0, pendingFor(space)));
    return { result: "added" as const, item };
  });
  notify(space);
  return saved;
}

/** Applies `transform` to the latest stored copy. Deleted and missing items are left alone. */
export async function updateItem(space: string, id: string, transform: (item: SavedItem) => SavedItem | null): Promise<SavedItem | null> {
  const updated = await write(["items"], async (tx) => {
    const items = tx.objectStore("items");
    const previous = await request(items.get(keyFor(space, id))) as StoredItem | undefined;
    if (!previous || isDeleted(previous.item)) return null;
    const next = transform(previous.item);
    if (!next) return null;
    if (next.id !== id || next.url !== previous.item.url) throw new Error("An item’s identity or link can’t change.");
    items.put(stored(space, next, previous.revision, pendingFor(space) ?? previous.pendingToken));
    return next;
  });
  if (updated) notify(space);
  return updated;
}

export async function deleteItem(space: string, id: string, now: number): Promise<void> {
  await write(["items"], async (tx) => {
    const items = tx.objectStore("items");
    const previous = await request(items.get(keyFor(space, id))) as StoredItem | undefined;
    if (!previous || isDeleted(previous.item)) return;
    if (!isAccount(space)) { items.delete(previous.key); return; }
    items.put(stored(space, tombstone(previous.item, Math.max(now, previous.item.lastSavedAt, previous.item.updatedAt)), previous.revision, crypto.randomUUID()));
  });
  notify(space);
}

/**
 * On the first sign-in in this browser, the guest library is copied into that account once.
 * The first-launch article isn't copied; the account has its own, offered once.
 */
export async function importGuestOnce(userId: string): Promise<number> {
  const copied = await write(["items", "meta"], async (tx) => {
    const meta = tx.objectStore("meta");
    if (await request(meta.get("guest-import-owner"))) return 0;
    const items = tx.objectStore("items");
    const space = accountSpace(userId);
    const guest = await request(items.index("space").getAll(GUEST_SPACE)) as StoredItem[];
    let count = 0;
    for (const row of guest) {
      if (isDeleted(row.item) || row.item.origin === "seed") continue;
      if (await request(items.get(keyFor(space, row.id)))) continue;
      items.put(stored(space, row.item, 0, crypto.randomUUID()));
      count++;
    }
    meta.put({ key: "guest-import-owner", value: userId });
    return count;
  });
  if (copied) notify(accountSpace(userId));
  return copied;
}

// MARK: Sync

export async function pendingChanges(space: string): Promise<SyncChange[]> {
  return (await listStored(space)).filter((row) => row.pendingToken)
    .map((row) => ({ item: row.item, baseRevision: row.revision, token: row.pendingToken! }));
}

export async function syncCursor(space: string): Promise<number> {
  return (await metaValue<number>(metaKey(space, "sync-cursor"))) ?? 0;
}

/**
 * Acknowledgements, merged results, pulled items, and the cursor advance are one transaction. An
 * edit made while the request was out keeps its pending token and is rebased onto what the server
 * stored, so it's sent again without losing either side.
 */
export async function applySyncResponse(space: string, sent: SyncChange[], response: SyncResponse): Promise<void> {
  if (space !== accountSpace(response.userId)) throw new Error("The signed-in account changed. Try syncing again.");
  const tokens = new Map(sent.map((change) => [change.item.id, change.token]));
  await write(["items", "meta"], async (tx) => {
    const items = tx.objectStore("items");
    const apply = async (row: SyncRow) => {
      const local = await request(items.get(keyFor(space, row.item.id))) as StoredItem | undefined;
      if (!local) { items.put(stored(space, row.item, row.revision, null)); return; }
      if (row.revision < local.revision) return;
      if (local.pendingToken === null || local.pendingToken === tokens.get(row.item.id)) {
        items.put(stored(space, row.item, row.revision, null));
      } else if (row.revision > local.revision) {
        items.put(stored(space, mergeItems(row.item, local.item), row.revision, local.pendingToken));
      }
    };
    for (const outcome of response.results) {
      if (outcome.status === "merged") { for (const row of outcome.rows) await apply(row); continue; }
      const local = await request(items.get(keyFor(space, outcome.id))) as StoredItem | undefined;
      if (!local || outcome.revision < local.revision) continue;
      items.put({ ...local, revision: outcome.revision, pendingToken: local.pendingToken === tokens.get(outcome.id) ? null : local.pendingToken });
    }
    for (const row of response.rows) await apply(row);
    const meta = tx.objectStore("meta");
    const previous = await request(meta.get(metaKey(space, "sync-cursor"))) as Meta | undefined;
    meta.put({ key: metaKey(space, "sync-cursor"), value: Math.max(Number(previous?.value) || 0, response.cursor) });
  });
  notify(space, "remote");
}
