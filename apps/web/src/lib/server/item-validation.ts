import { tombstone, type KnownDetails, type MetadataStatus, type Origin, type SavedItem } from "../item";
import { tryWebLink } from "../link";
import { cleanedMetadata, cleanText, METADATA_FAILURES, normalizedDate, type LinkMetadata, type MetadataFailure } from "../metadata";

// Every item a browser sends is rebuilt from known fields with the same limits the app applies,
// and its dedupe key is recomputed here. What's stored never depends on a client's version of the
// link rules.

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ORIGINS: readonly Origin[] = ["app", "share", "seed"];
const STATUSES: readonly MetadataStatus[] = ["pending", "fetched", "failed"];

export class InvalidItemError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function fail(message: string): never {
  throw new InvalidItemError(message);
}

function stamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) fail("An item has an invalid date.");
  return value;
}

function optionalStamp(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : stamp(value);
}

export function uuid(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) fail("An item has an invalid ID.");
  return value.toLowerCase();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], message: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(message);
  return value as T;
}

function known(value: unknown): KnownDetails | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) fail("An item has invalid details.");
  const result: KnownDetails = {};
  const title = cleanText(value.title, 300);
  const siteName = cleanText(value.siteName, 100);
  const author = cleanText(value.author, 200);
  const publishedDate = typeof value.publishedDate === "string" ? normalizedDate(value.publishedDate) ?? undefined : undefined;
  const originalURL = typeof value.originalURL === "string" ? tryWebLink(value.originalURL)?.string : undefined;
  if (title) result.title = title;
  if (siteName) result.siteName = siteName;
  if (author) result.author = author;
  if (publishedDate) result.publishedDate = publishedDate;
  if (originalURL) result.originalURL = originalURL;
  return Object.keys(result).length ? result : undefined;
}

function page(value: unknown): LinkMetadata {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) fail("An item has invalid details.");
  const text = (field: string) => typeof value[field] === "string" ? value[field] as string : undefined;
  return cleanedMetadata({
    title: text("title"), summary: text("summary"), imageURL: text("imageURL"), siteName: text("siteName"),
    author: text("author"), publishedDate: text("publishedDate"), canonicalURL: text("canonicalURL"),
  });
}

/** The item as stash would store it, or an error for anything that isn't a valid item. */
export function canonicalItem(value: unknown): SavedItem {
  if (!isObject(value)) fail("An item is invalid.");
  const id = uuid(value.id);
  const createdAt = stamp(value.createdAt);
  const lastSavedAt = stamp(value.lastSavedAt);
  const updatedAt = stamp(value.updatedAt);
  const origin = oneOf(value.origin, ORIGINS, "An item has an invalid origin.");
  const deletedAt = optionalStamp(value.deletedAt);
  if (deletedAt !== undefined) {
    const mergedInto = value.mergedInto === undefined || value.mergedInto === null ? undefined : uuid(value.mergedInto);
    const shell: SavedItem = { id, url: "", dedupeKey: "", createdAt, lastSavedAt, updatedAt, origin, page: {}, metadataStatus: "pending", metadataAttempts: 0 };
    return tombstone(shell, deletedAt, mergedInto);
  }
  if (typeof value.url !== "string") fail("An item has no link.");
  const link = tryWebLink(value.url);
  if (!link || link.string !== value.url) fail("An item contains an invalid link.");
  const attempts = value.metadataAttempts ?? 0;
  if (typeof attempts !== "number" || !Number.isSafeInteger(attempts) || attempts < 0 || attempts > 10_000) fail("An item has an invalid attempt count.");
  const item: SavedItem = {
    id, url: link.string, dedupeKey: link.dedupeKey, createdAt, lastSavedAt, updatedAt, origin, page: page(value.page),
    metadataStatus: oneOf(value.metadataStatus ?? "pending", STATUSES, "An item has an invalid details status."),
    metadataAttempts: attempts,
  };
  const customTitle = cleanText(value.customTitle, 300);
  const titleUpdatedAt = optionalStamp(value.titleUpdatedAt);
  const details = known(value.known);
  const failure = value.metadataFailure === undefined || value.metadataFailure === null
    ? undefined : oneOf<MetadataFailure>(value.metadataFailure, METADATA_FAILURES, "An item has an invalid details failure.");
  const checkedAt = optionalStamp(value.metadataCheckedAt);
  if (customTitle !== undefined) item.customTitle = customTitle;
  if (titleUpdatedAt !== undefined) item.titleUpdatedAt = titleUpdatedAt;
  if (details) item.known = details;
  if (failure !== undefined) item.metadataFailure = failure;
  if (checkedAt !== undefined) item.metadataCheckedAt = checkedAt;
  return item;
}

/** JSON with sorted keys, so two items compare equal regardless of how they were built. */
export function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
