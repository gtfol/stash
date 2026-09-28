import { fallbackTitle, hostOfLink, tryWebLink, type WebLink } from "./link";
import { cleanText, isTransient, mergedMetadata, type LinkMetadata, type MetadataFailure } from "./metadata";

// Everything stash keeps about one saved link. It mirrors the iPhone app's SavedItemRecord, with
// dates as milliseconds since 1970 and three additions for sync: `titleUpdatedAt`, `deletedAt`,
// and `mergedInto`.
//
// Details are kept in layers so each has one owner: `customTitle` belongs to the user, `known` to
// whoever supplied the item (the first-launch article), and `page` to detail fetches. Fetches only
// ever write `page`, and `url` is never rewritten by anything.

export type Origin = "app" | "share" | "seed";
export type MetadataStatus = "pending" | "fetched" | "failed";

/** Attribution supplied with an item rather than fetched. Fetches never replace these values. */
export interface KnownDetails {
  title?: string;
  siteName?: string;
  author?: string;
  publishedDate?: string;
  /** The publisher's page, for attribution only. Opening the item still uses its saved `url`. */
  originalURL?: string;
}

export interface SavedItem {
  id: string;
  /** Opened exactly as saved. Empty once deleted. */
  url: string;
  dedupeKey: string;
  createdAt: number;
  lastSavedAt: number;
  updatedAt: number;
  origin: Origin;
  customTitle?: string;
  /** When the user last set or cleared their title, so the latest edit wins across devices. */
  titleUpdatedAt?: number;
  known?: KnownDetails;
  page: LinkMetadata;
  metadataStatus: MetadataStatus;
  metadataFailure?: MetadataFailure;
  /** Completed fetch attempts; offline attempts don't count. */
  metadataAttempts: number;
  metadataCheckedAt?: number;
  /** A deleted item keeps only its identity and dates, so the deletion can sync. */
  deletedAt?: number;
  /** The item this one became after the same page was saved separately on two devices. */
  mergedInto?: string;
}

export const AUTOMATIC_ATTEMPT_LIMIT = 3;

export function newItem(link: WebLink, savedAt: number, origin: Origin, id: string = crypto.randomUUID()): SavedItem {
  return {
    id, url: link.string, dedupeKey: link.dedupeKey, createdAt: savedAt, lastSavedAt: savedAt, updatedAt: savedAt,
    origin, page: {}, metadataStatus: "pending", metadataAttempts: 0,
  };
}

export const isDeleted = (item: SavedItem) => item.deletedAt !== undefined;

// MARK: Changes. Each returns the changed item, or null when nothing changed.

/**
 * Another save of the same page keeps the original link and details and moves the item to the
 * top. Applying the same save twice changes nothing.
 */
export function recordSave(item: SavedItem, savedAt: number, now: number): SavedItem | null {
  if (savedAt <= item.lastSavedAt) return null;
  return { ...item, lastSavedAt: savedAt, updatedAt: now };
}

/** A blank title returns to the automatic one. Typing the page's own title isn't an edit. */
export function renameItem(item: SavedItem, title: string, now: number): SavedItem | null {
  const cleaned = cleanText(title, 300);
  const value = cleaned === automaticTitle(item) && item.customTitle === undefined ? undefined : cleaned;
  if (value === item.customTitle) return null;
  const { customTitle: _previous, ...rest } = item;
  void _previous;
  return { ...rest, ...(value === undefined ? {} : { customTitle: value }), titleUpdatedAt: now, updatedAt: now };
}

export function applyMetadata(item: SavedItem, metadata: LinkMetadata, now: number): SavedItem {
  const { metadataFailure: _failure, ...rest } = item;
  void _failure;
  return {
    ...rest, page: mergedMetadata(item.page, metadata), metadataStatus: "fetched",
    metadataAttempts: item.metadataAttempts + 1, metadataCheckedAt: now, updatedAt: now,
  };
}

export function recordMetadataFailure(item: SavedItem, failure: MetadataFailure, now: number): SavedItem {
  return {
    ...item, metadataStatus: "failed", metadataFailure: failure,
    metadataAttempts: item.metadataAttempts + (failure === "offline" ? 0 : 1), metadataCheckedAt: now, updatedAt: now,
  };
}

/** Fetch without being asked: new items, and transient failures a few times. */
export function wantsAutomaticMetadata(item: SavedItem): boolean {
  if (isDeleted(item)) return false;
  switch (item.metadataStatus) {
    case "pending": return true;
    case "fetched": return false;
    case "failed": return (item.metadataFailure === undefined || isTransient(item.metadataFailure)) && item.metadataAttempts < AUTOMATIC_ATTEMPT_LIMIT;
  }
}

/** What remains of a deleted item. */
export function tombstone(item: SavedItem, deletedAt: number, mergedInto?: string): SavedItem {
  return {
    id: item.id, url: "", dedupeKey: "", createdAt: item.createdAt, lastSavedAt: item.lastSavedAt,
    updatedAt: Math.max(item.updatedAt, deletedAt), origin: item.origin, page: {}, metadataStatus: "pending", metadataAttempts: 0,
    deletedAt, ...(mergedInto ? { mergedInto } : {}),
  };
}

// MARK: Merging

/** The item that keeps its identity when two copies of a page meet: the first saved. */
export function compareIdentity(a: SavedItem, b: SavedItem): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Combines two versions of one item, or two items for the same page, without losing either side's
 * intent: the first saved link and identity, the latest save time, the latest title edit, and the
 * newest details. A deletion stands unless the page was saved again after it. The result doesn't
 * depend on argument order.
 */
export function mergeItems(a: SavedItem, b: SavedItem): SavedItem {
  const [first, second] = compareIdentity(a, b) <= 0 ? [a, b] : [b, a];
  const createdAt = Math.min(a.createdAt, b.createdAt);
  const lastSavedAt = Math.max(a.lastSavedAt, b.lastSavedAt);
  const updatedAt = Math.max(a.updatedAt, b.updatedAt);
  const deletions = [a, b].filter(isDeleted).sort((x, y) => y.deletedAt! - x.deletedAt!);
  const alive = [first, second].filter((item) => item.url !== "");
  if ((deletions.length && deletions[0].deletedAt! >= lastSavedAt) || !alive.length) {
    const latest = deletions[0] ?? first;
    return tombstone({ ...first, createdAt, lastSavedAt, updatedAt }, latest.deletedAt ?? updatedAt, latest.mergedInto);
  }
  const content = alive[0];
  // Ties compare code units, never locale rules, so the server and every browser agree.
  const titled = [...alive].sort((x, y) => (y.titleUpdatedAt ?? 0) - (x.titleUpdatedAt ?? 0)
    || ((y.customTitle ?? "") > (x.customTitle ?? "") ? 1 : (y.customTitle ?? "") < (x.customTitle ?? "") ? -1 : 0))[0];
  const byCheck = [...alive].sort((x, y) => (x.metadataCheckedAt ?? -1) - (y.metadataCheckedAt ?? -1));
  const newest = byCheck.at(-1)!;
  const page = byCheck.reduce<LinkMetadata>((merged, item) => mergedMetadata(merged, item.page), {});
  const known = alive.find((item) => item.known)?.known;
  const merged: SavedItem = {
    id: first.id, url: content.url, dedupeKey: content.dedupeKey, createdAt, lastSavedAt, updatedAt, origin: content.origin,
    page, metadataStatus: newest.metadataStatus, metadataAttempts: Math.max(...alive.map((item) => item.metadataAttempts)),
  };
  if (titled.customTitle !== undefined) merged.customTitle = titled.customTitle;
  if (titled.titleUpdatedAt !== undefined) merged.titleUpdatedAt = titled.titleUpdatedAt;
  if (known) merged.known = known;
  if (newest.metadataFailure !== undefined) merged.metadataFailure = newest.metadataFailure;
  if (newest.metadataCheckedAt !== undefined) merged.metadataCheckedAt = newest.metadataCheckedAt;
  return merged;
}

// MARK: Display

export const automaticTitle = (item: SavedItem) => item.known?.title ?? item.page.title ?? fallbackTitle(item.url);
export const itemTitle = (item: SavedItem) => item.customTitle ?? automaticTitle(item);
/** False while the title is only the link itself. */
export const hasTitle = (item: SavedItem) => item.customTitle !== undefined || item.known?.title !== undefined || item.page.title !== undefined;
export const itemHost = (item: SavedItem) => hostOfLink(item.url) ?? item.url;
export const itemSource = (item: SavedItem) => item.known?.siteName ?? item.page.siteName;
export const itemAuthor = (item: SavedItem) => item.known?.author ?? item.page.author;
export const itemPublishedDate = (item: SavedItem) => item.known?.publishedDate ?? item.page.publishedDate;

/** The publisher's page when it is a different page from the saved link, for attribution. */
export function originalURL(item: SavedItem): string | undefined {
  if (item.known?.originalURL) return item.known.originalURL;
  const canonical = item.page.canonicalURL;
  const link = canonical ? tryWebLink(canonical) : null;
  return link && link.dedupeKey !== item.dedupeKey ? canonical : undefined;
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Every word must appear in the title, source, domain, or link. Case and accents are ignored. */
export function matchesQuery(item: SavedItem, query: string): boolean {
  const words = query.split(/\s+/u).filter(Boolean);
  if (!words.length) return true;
  const text = fold([itemTitle(item), automaticTitle(item), itemSource(item) ?? "", itemHost(item), item.url].join("\n"));
  return words.every((word) => text.includes(fold(word)));
}

// MARK: First-launch article

/** The article stash opens with, offered once per browser and once per account. */
export const SEED = {
  url: "https://archive.ph/GDsbC",
  originalURL: "https://www.nature.com/articles/d41586-026-02943-1",
  known: {
    title: "How to make a brain: new experiments challenge existing picture", siteName: "Nature",
    author: "Lynne Peeples", publishedDate: "2026-09-18", originalURL: "https://www.nature.com/articles/d41586-026-02943-1",
  } satisfies KnownDetails,
};

export function seedItem(savedAt: number, id?: string): SavedItem {
  const link = tryWebLink(SEED.url)!;
  return { ...newItem(link, savedAt, "seed", id), known: { ...SEED.known } };
}

/** Keys that mean a library already has this article: the archive or the publisher's page. */
export const SEED_DEDUPE_KEYS = [SEED.url, SEED.originalURL].map((url) => tryWebLink(url)!.dedupeKey);
