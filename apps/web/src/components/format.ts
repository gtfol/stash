import { hasTitle, itemHost, itemSource, type SavedItem } from "@/lib/item";
import { schemeOf } from "@/lib/link";
import { failureShortMessage } from "@/lib/metadata";

/** "Sep 26", or "Sep 26, 2025" outside the current year. */
export function savedDate(time: number, now = Date.now()): string {
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function savedDateTime(time: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(time));
}

/** Source, domain, and date, or the details state while the title is only the link. */
export function caption(item: SavedItem, fetching: boolean): string {
  const parts: string[] = [];
  const source = itemSource(item);
  const host = itemHost(item);
  if (source && source.toLowerCase() !== host) parts.push(source);
  parts.push(host);
  if (fetching && !hasTitle(item)) parts.push("fetching details…");
  else if (item.metadataFailure && !hasTitle(item)) parts.push(failureShortMessage(item.metadataFailure));
  else parts.push(savedDate(item.lastSavedAt));
  return parts.join(" · ");
}

/** Only web links become hrefs, whatever is in storage. */
export function safeHref(url: string): string | undefined {
  const scheme = schemeOf(url);
  return scheme === "http" || scheme === "https" ? url : undefined;
}
