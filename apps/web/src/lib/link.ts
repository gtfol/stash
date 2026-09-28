// Link rules shared with the iPhone app (apps/ios/Stash/Core/WebLink.swift). The saved string is
// exactly what was entered and is what opening an item uses; the dedupe key only decides whether
// two saves are the same page. Keep both implementations and their test vectors in step.

export type LinkErrorKind = "empty" | "invalid" | "tooLong" | "noLink" | "multipleLinks" | "unsupportedScheme";

export class LinkError extends Error {
  constructor(readonly kind: LinkErrorKind, readonly scheme?: string) {
    super(linkErrorMessage(kind, scheme));
    this.name = "LinkError";
  }
}

function linkErrorMessage(kind: LinkErrorKind, scheme?: string): string {
  switch (kind) {
    case "empty": return "paste or type a link.";
    case "invalid": return "that isn’t a web link. nothing was saved.";
    case "tooLong": return "that link is too long. nothing was saved.";
    case "noLink": return "no link found. nothing was saved.";
    case "multipleLinks": return "more than one link found. nothing was saved. share one link at a time.";
    case "unsupportedScheme": return `stash saves http and https links, not ${scheme} links. nothing was saved.`;
  }
}

export interface WebLink {
  /** Opened exactly as saved. */
  string: string;
  dedupeKey: string;
}

export const MAX_LINK_LENGTH = 8_192;
const WHITESPACE = /\s/u;

/** Exactly one explicit http(s) URL, such as a shared URL or a synced record. */
export function webLink(text: string): WebLink {
  const candidate = unwrapped(text);
  if (!candidate) throw new LinkError("empty");
  if ([...candidate].length > MAX_LINK_LENGTH) throw new LinkError("tooLong");
  const scheme = schemeOf(candidate);
  if (WHITESPACE.test(candidate) || !scheme) throw new LinkError("invalid");
  if (scheme !== "http" && scheme !== "https") throw new LinkError("unsupportedScheme", scheme);
  if (!candidate.toLowerCase().startsWith(`${scheme}://`)) throw new LinkError("invalid");
  const parts = components(candidate, scheme.length + 3);
  if (!parts) throw new LinkError("invalid");
  return { string: candidate, dedupeKey: keyFor(parts) };
}

/** Whether `text` is a link stash can save, without throwing. */
export function tryWebLink(text: string): WebLink | null {
  try { return webLink(text); } catch { return null; }
}

/**
 * What someone typed or pasted into the add field. A bare domain such as `example.com/a` becomes
 * `https://example.com/a`; text with spaces must hold exactly one explicit link.
 */
export function typedLink(text: string): WebLink {
  const candidate = unwrapped(text);
  if (!candidate) throw new LinkError("empty");
  if (WHITESPACE.test(candidate)) return linkInText(candidate);
  if (schemeOf(candidate) !== null) return webLink(candidate);
  if (!looksLikeHost(candidate)) throw new LinkError("invalid");
  return webLink(`https://${candidate}`);
}

/** The single explicit http(s) link in free text. Bare domains and two different links are not guessed. */
export function linkInText(text: string): WebLink {
  const scan = scanText(text);
  if (scan.links.length === 1) return scan.links[0];
  if (scan.links.length > 1) throw new LinkError("multipleLinks");
  if (scan.otherSchemes.length) throw new LinkError("unsupportedScheme", scan.otherSchemes[0]);
  throw new LinkError("noLink");
}

/** Shared or pasted content: URL items win over text, and text must hold exactly one web link. */
export function sharedLink(contents: { urls?: string[]; texts?: string[] }): WebLink {
  const links: WebLink[] = [];
  const otherSchemes: string[] = [];
  const add = (link: WebLink) => { if (!links.some((existing) => existing.dedupeKey === link.dedupeKey)) links.push(link); };
  for (const text of contents.urls ?? []) {
    try { add(webLink(text)); } catch (error) {
      if (error instanceof LinkError && error.kind === "unsupportedScheme" && error.scheme) otherSchemes.push(error.scheme);
    }
  }
  if (links.length === 1) return links[0];
  if (links.length > 1) throw new LinkError("multipleLinks");
  for (const text of contents.texts ?? []) {
    const scan = scanText(text);
    scan.links.forEach(add);
    otherSchemes.push(...scan.otherSchemes);
  }
  if (links.length === 1) return links[0];
  if (links.length > 1) throw new LinkError("multipleLinks");
  if (otherSchemes.length) throw new LinkError("unsupportedScheme", otherSchemes[0]);
  throw new LinkError("noLink");
}

// Schemes that are links even without `//`, so text mentioning them is refused by name rather
// than ignored. Anything written as `scheme://` counts too.
const OPAQUE_SCHEMES = new Set(["mailto", "tel", "sms", "facetime", "data", "javascript", "file", "about", "blob"]);
const CANDIDATE = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"“”‘’«»]+/gu;
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "'", "’", "”", "\"", "…"]);
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };

/** Explicit links in text, in order, one per page. */
export function scanText(text: string): { links: WebLink[]; otherSchemes: string[] } {
  const links: WebLink[] = [];
  const otherSchemes: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(CANDIDATE)) {
    const written = trimTrailing(match[0]);
    const scheme = schemeOf(written);
    if (!scheme) continue;
    const hierarchical = written.slice(scheme.length + 1).startsWith("//");
    if (!hierarchical && !OPAQUE_SCHEMES.has(scheme)) continue;
    const link = tryWebLink(written);
    if (link) {
      if (!seen.has(link.dedupeKey)) { seen.add(link.dedupeKey); links.push(link); }
    } else if (scheme !== "http" && scheme !== "https") {
      otherSchemes.push(scheme);
    }
  }
  return { links, otherSchemes };
}

function trimTrailing(value: string): string {
  let result = value;
  for (;;) {
    const last = result.at(-1);
    if (!last) return result;
    if (TRAILING.has(last)) { result = result.slice(0, -1); continue; }
    const opener = CLOSERS[last];
    if (opener) {
      const opens = [...result].filter((character) => character === opener).length;
      const closes = [...result].filter((character) => character === last).length;
      if (closes > opens) { result = result.slice(0, -1); continue; }
    }
    return result;
  }
}

/** The URL scheme the text starts with, lowercased. `example.com:8080/a` is a host and port. */
export function schemeOf(text: string): string | null {
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  const name = text.slice(0, colon);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(name)) return null;
  if (/^[0-9]/.test(text.slice(colon + 1))) return null;
  return name.toLowerCase();
}

const WRAPPERS: [string, string][] = [["<", ">"], ["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"], ["(", ")"], ["[", "]"]];

/** Removes surrounding whitespace and one pair of wrapping brackets or quotes (`<https://…>`). */
export function unwrapped(text: string): string {
  let value = text.trim();
  for (const [open, close] of WRAPPERS) {
    if ([...value].length >= 2 && value.startsWith(open) && value.endsWith(close)) {
      value = value.slice(open.length, value.length - close.length).trim();
      break;
    }
  }
  return value;
}

function looksLikeHost(text: string): boolean {
  const authority = text.split(/[/?#]/u, 1)[0];
  const name = authority.split(":", 1)[0];
  const labels = name.split(".");
  const tld = labels.at(-1) ?? "";
  if (labels.length < 2 || [...tld].length < 2 || !/^\p{L}+$/u.test(tld)) return false;
  return labels.every((label) => label.length > 0 && /^[\p{L}\p{N}-]+$/u.test(label));
}

// MARK: Components and dedupe key

interface Components {
  host: string;
  port: number | null;
  path: string;
  query: string | null;
  fragment: string | null;
}

/**
 * Splits `scheme://authority/path?query#fragment` like Foundation's URLComponents, keeping each
 * part as written (percent-encoded) rather than normalizing it the way a browser would.
 */
function components(link: string, authorityStart: number): Components | null {
  const rest = link.slice(authorityStart);
  const authorityEnd = rest.search(/[/?#]/u);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  let tail = authorityEnd === -1 ? "" : rest.slice(authorityEnd);
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  let host: string;
  let portText = "";
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close === -1) return null;
    host = hostPort.slice(1, close);
    const after = hostPort.slice(close + 1);
    if (after && !after.startsWith(":")) return null;
    portText = after.slice(1);
  } else {
    const colon = hostPort.lastIndexOf(":");
    host = colon === -1 ? hostPort : hostPort.slice(0, colon);
    portText = colon === -1 ? "" : hostPort.slice(colon + 1);
  }
  if (!host || /[\s<>"{}|\\^`%]/u.test(host)) return null;
  if (portText && (!/^[0-9]{1,5}$/.test(portText) || Number(portText) > 65_535)) return null;
  // Hosts a browser couldn't open are not links, even if they split cleanly.
  try { new URL(`https://${hostPort}/`); } catch { return null; }
  let fragment: string | null = null;
  const hash = tail.indexOf("#");
  if (hash !== -1) { fragment = tail.slice(hash + 1); tail = tail.slice(0, hash); }
  let query: string | null = null;
  const question = tail.indexOf("?");
  if (question !== -1) { query = tail.slice(question + 1); tail = tail.slice(0, question); }
  return { host, port: portText ? Number(portText) : null, path: tail, query, fragment };
}

/**
 * One key per page: https, lowercase host without `www.`, no default port, no trailing slash, no
 * tracking parameters, no fragment. Meaningful parameters (`?v=`, `?id=`, `?p=`) and route-like
 * fragments (`#/inbox`, `#!/page`) are kept, so different pages never collapse.
 */
function keyFor(parts: Components): string {
  const host = displayHost(asciiHost(parts.host));
  const port = parts.port !== null && parts.port !== 80 && parts.port !== 443 ? `:${parts.port}` : "";
  let path = encodeInvalid(parts.path, "/:@");
  if (!path) path = "/";
  else if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const items = parts.query === null || parts.query === "" ? [] : parts.query.split("&").map((item) => {
    const equals = item.indexOf("=");
    return equals === -1 ? { name: item, value: null } : { name: item.slice(0, equals), value: item.slice(equals + 1) };
  });
  const kept = items.filter((item) => !isTracking(item.name, host));
  const query = kept.map((item) => encodeInvalid(item.value === null ? item.name : `${item.name}=${item.value}`, "/:@?=")).join("&");
  const fragment = parts.fragment !== null && (parts.fragment.startsWith("/") || parts.fragment.startsWith("!"))
    ? `#${encodeInvalid(parts.fragment, "/:@?")}` : "";
  const bracketed = host.includes(":") ? `[${host}]` : host;
  return `https://${bracketed}${port}${path}${kept.length ? `?${query}` : ""}${fragment}`;
}

function asciiHost(host: string): string {
  if (/^[\x00-\x7f]*$/u.test(host) || host.includes(":")) return host;
  try { return new URL(`https://${host}/`).hostname; } catch { return host; }
}

const UNRESERVED_OR_SUBDELIM = /[A-Za-z0-9\-._~!$&'()*+,;=]/u;

// Characters a URL can't hold unescaped are percent-encoded as UTF-8, as Foundation does when it
// reads such a link, so the same page gets the same key on every platform.
function encodeInvalid(value: string, allowed: string): string {
  let result = "";
  const characters = [...value];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (character === "%" && /^%[0-9A-Fa-f]{2}/u.test(characters.slice(index, index + 3).join(""))) {
      result += character;
    } else if (UNRESERVED_OR_SUBDELIM.test(character) || allowed.includes(character)) {
      result += character;
    } else {
      for (const byte of new TextEncoder().encode(character)) result += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return result;
}

const TRACKING_PREFIXES = ["utm_", "pk_", "mtm_"];
const TRACKING_NAMES = new Set([
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
  "li_fat_id", "igshid", "igsh", "mc_cid", "mc_eid", "_hsenc", "_hsmi", "__hstc", "__hssc", "__hsfp",
  "hsctatracking", "mkt_tok", "oly_anon_id", "oly_enc_id", "rb_clickid", "s_cid", "vero_conv", "vero_id",
  "wickedid", "ref_src", "ref_url", "_ga", "_gl", "srsltid", "smid", "ocid", "xtor", "at_medium", "at_campaign",
]);
// Share and campaign parameters that only mean "how this link was passed around" on these sites.
const SITE_TRACKING_NAMES: Record<string, Set<string>> = {
  "youtube.com": new Set(["si", "feature", "pp"]), "youtu.be": new Set(["si", "feature"]), "open.spotify.com": new Set(["si"]),
  "x.com": new Set(["s", "t"]), "twitter.com": new Set(["s", "t"]), "linkedin.com": new Set(["trk", "trackingid", "lipi"]),
  "reddit.com": new Set(["share_id"]),
};

export function isTracking(rawName: string, host: string): boolean {
  const name = rawName.toLowerCase();
  if (TRACKING_NAMES.has(name) || TRACKING_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return Object.entries(SITE_TRACKING_NAMES).some(([site, names]) => (host === site || host.endsWith(`.${site}`)) && names.has(name));
}

// MARK: Display

/** Lowercased host without a leading `www.`. */
export function displayHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

/** Host of a stored link, for captions ("archive.ph"). */
export function hostOfLink(link: string): string | null {
  const scheme = schemeOf(link);
  if (!scheme || !link.toLowerCase().startsWith(`${scheme}://`)) return null;
  const parts = components(link, scheme.length + 3);
  return parts ? displayHost(parts.host) : null;
}

/** A readable stand-in title when a page provides none: host and path without the scheme. */
export function fallbackTitle(link: string): string {
  const scheme = schemeOf(link);
  if (!scheme || !link.toLowerCase().startsWith(`${scheme}://`)) return link;
  const parts = components(link, scheme.length + 3);
  if (!parts) return link;
  const path = parts.path === "/" ? "" : decodePath(parts.path);
  return [...(displayHost(parts.host) + path)].slice(0, 200).join("");
}

function decodePath(path: string): string {
  try { return decodeURIComponent(path); } catch { return path; }
}
