import { tryWebLink } from "./link";

// Page details read from the network, shared with the iPhone app (LinkMetadata.swift). Every
// field is optional: a saved link is valid with just its URL.
export interface LinkMetadata {
  title?: string;
  summary?: string;
  imageURL?: string;
  siteName?: string;
  author?: string;
  /** `yyyy-MM-dd` as the publisher wrote it, so the date never shifts across time zones. */
  publishedDate?: string;
  canonicalURL?: string;
}

const FIELDS = ["title", "summary", "imageURL", "siteName", "author", "publishedDate", "canonicalURL"] as const;

export function isEmptyMetadata(metadata: LinkMetadata): boolean {
  return FIELDS.every((field) => metadata[field] === undefined);
}

/** Trimmed, length-limited values; blanks and non-web URLs are dropped. */
export function cleanedMetadata(metadata: LinkMetadata): LinkMetadata {
  return compact({
    title: cleanText(metadata.title, 300),
    summary: cleanText(metadata.summary, 600),
    imageURL: cleanWebURL(metadata.imageURL),
    siteName: cleanText(metadata.siteName, 100),
    author: cleanText(metadata.author, 200),
    publishedDate: metadata.publishedDate === undefined ? undefined : normalizedDate(metadata.publishedDate) ?? undefined,
    canonicalURL: cleanWebURL(metadata.canonicalURL),
  });
}

/**
 * A newer fetch replaces older values field by field. A blank never erases a value that is already
 * there, so a partial or failed refresh can't wipe details.
 */
export function mergedMetadata(older: LinkMetadata, newer: LinkMetadata): LinkMetadata {
  const clean = cleanedMetadata(newer);
  const result: LinkMetadata = {};
  for (const field of FIELDS) {
    const value = clean[field] ?? older[field];
    if (value !== undefined) result[field] = value;
  }
  return result;
}

export function cleanText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.split(/\s+/u).filter(Boolean).join(" ");
  if (!collapsed) return undefined;
  const characters = [...collapsed];
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : collapsed;
}

function cleanWebURL(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 2_048) return undefined;
  return tryWebLink(trimmed)?.string;
}

function compact(metadata: LinkMetadata): LinkMetadata {
  const result: LinkMetadata = {};
  for (const field of FIELDS) if (metadata[field] !== undefined) result[field] = metadata[field];
  return result;
}

// MARK: Failures

/** Why details couldn't be read. Saving never depends on this. */
export type MetadataFailure = "offline" | "timedOut" | "unreachable" | "blocked" | "notFound" | "serverError" | "notWebPage" | "other";
export const METADATA_FAILURES: readonly MetadataFailure[] = ["offline", "timedOut", "unreachable", "blocked", "notFound", "serverError", "notWebPage", "other"];

/** Worth retrying automatically later or when the connection returns. */
export function isTransient(failure: MetadataFailure): boolean {
  return failure !== "blocked" && failure !== "notFound" && failure !== "notWebPage";
}

export function failureMessage(failure: MetadataFailure): string {
  switch (failure) {
    case "offline": return "you’re offline. details will load when you’re back online.";
    case "timedOut": return "the site took too long to answer.";
    case "unreachable": return "the site couldn’t be reached.";
    case "blocked": return "this site doesn’t allow previews.";
    case "notFound": return "the site says this page wasn’t found. the link is still saved.";
    case "serverError": return "the site had a problem. try again later.";
    case "notWebPage": return "this link isn’t a web page, so there are no details.";
    case "other": return "details couldn’t be loaded.";
  }
}

/** A few words for a list caption. */
export function failureShortMessage(failure: MetadataFailure): string {
  switch (failure) {
    case "offline": return "offline";
    case "timedOut": case "serverError": case "other": return "no details yet";
    case "unreachable": return "site unreachable";
    case "blocked": return "site blocks previews";
    case "notFound": return "page not found";
    case "notWebPage": return "not a web page";
  }
}

export function failureForStatus(status: number): MetadataFailure {
  if (status === 404 || status === 410) return "notFound";
  if ([401, 402, 403, 407, 429, 451].includes(status)) return "blocked";
  if (status >= 500 && status <= 599) return "serverError";
  return "other";
}

// MARK: Publication dates

/**
 * Accepts ISO 8601 dates and date-times (`2026-09-18`, `2026-09-18T10:00:00+02:00`) and citation
 * dates (`2026/09/18`). The date is taken as written.
 */
export function normalizedDate(value: string): string | null {
  const text = value.trim();
  const head = text.slice(0, 10);
  const match = /^(\d{4})([-/])(\d{2})\2(\d{2})$/u.exec(head);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[3]), Number(match[4])];
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (text.length > 10 && /[0-9]/u.test(text[10])) return null;
  return `${match[1]}-${match[3]}-${match[4]}`;
}

/** "Sep 18, 2026" in the reader's locale, for the calendar date as written. */
export function displayDate(value: string, locale?: string): string | null {
  const normalized = normalizedDate(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
