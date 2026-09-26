import { cleanedMetadata, normalizedDate, type LinkMetadata } from "./metadata";

// Reads link details from the start of an HTML document, as the iPhone app does
// (HTMLMetadataParser.swift): `<title>`, Open Graph, Twitter, citation and Dublin Core meta tags,
// the canonical link, and JSON-LD articles. A small, tolerant scanner, not a browser: it runs no
// scripts and only sees what the server sent.

export interface ParsedPage {
  metadata: LinkMetadata;
  /** A bot check, consent wall, or error page rather than the article. */
  isInterstitial: boolean;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export function parseHTML(html: string, baseURL: string): ParsedPage {
  const scanner = new TagScanner(html);
  let documentTitle: string | undefined;
  const metas = new Map<string, string>();
  const citationAuthors: string[] = [];
  let canonical: string | undefined;
  let base = baseURL;
  const objects: JsonObject[] = [];
  let inHead = true;

  for (let tag = scanner.nextTag(); tag; tag = scanner.nextTag()) {
    switch (tag.name) {
      case "title": {
        const text = scanner.text("title");
        if (inHead && documentTitle === undefined) documentTitle = decodeEntities(text);
        break;
      }
      case "meta": {
        const content = tag.attributes.get("content");
        if (content === undefined) break;
        for (const key of ["property", "name", "itemprop"]) {
          const name = tag.attributes.get(key)?.toLowerCase();
          if (!name) continue;
          if (name === "citation_author") citationAuthors.push(content);
          if (!metas.has(name)) metas.set(name, content);
        }
        break;
      }
      case "link": {
        const rel = tag.attributes.get("rel")?.toLowerCase().split(/\s+/u) ?? [];
        if (rel.includes("canonical") && canonical === undefined) canonical = tag.attributes.get("href");
        break;
      }
      case "base": {
        const href = tag.attributes.get("href");
        const resolvedBase = href === undefined ? null : resolveURL(href, baseURL);
        if (resolvedBase) base = resolvedBase;
        break;
      }
      case "script": {
        const text = scanner.text("script");
        if (tag.attributes.get("type")?.toLowerCase().includes("ld+json")) objects.push(...jsonLDObjects(text));
        break;
      }
      case "style": case "template": case "textarea": case "noscript":
        scanner.text(tag.name);
        break;
      case "/head": case "body":
        inHead = false;
        break;
    }
  }

  const article = primaryArticle(objects);
  // Attribute values are already entity-decoded by the scanner; JSON-LD strings by `text`.
  const meta = (...keys: string[]) => {
    for (const key of keys) {
      const value = metas.get(key);
      if (value !== undefined && value.trim()) return value;
    }
    return undefined;
  };
  const resolved = (value: string | undefined) => value === undefined ? undefined : resolveURL(value.trim(), base) ?? undefined;
  const publisher = article?.publisher;

  const title = meta("og:title", "twitter:title") ?? (article && (text(article.headline) ?? text(article.name)))
    ?? meta("citation_title", "dc.title", "parsely-title") ?? documentTitle;
  const author = (article && authorNames(article.author))
    ?? nonURL(meta("author", "parsely-author", "sailthru.author", "dc.creator"))
    ?? nonURL(meta("article:author"))
    ?? (citationAuthors.length ? readableName(citationAuthors[0]) : undefined);
  const published = meta("article:published_time") ?? (article && (text(article.datePublished) ?? text(article.uploadDate)))
    ?? meta("citation_publication_date", "citation_date", "citation_online_date", "dc.date", "parsely-pub-date",
      "sailthru.date", "pubdate", "publish-date", "article.published", "date");
  const image = meta("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src")
    ?? (article && imageURL(article.image));
  const siteName = meta("og:site_name") ?? (isObject(publisher) ? text(publisher.name) : undefined)
    ?? meta("application-name", "citation_journal_title", "dc.publisher");
  const canonicalURL = canonical ?? meta("og:url") ?? (article && text(article.url));

  const metadata = cleanedMetadata({
    title,
    summary: meta("og:description", "twitter:description", "description") ?? (article && text(article.description)),
    imageURL: resolved(image),
    siteName,
    author,
    publishedDate: published === undefined ? undefined : normalizedDate(published) ?? undefined,
    canonicalURL: resolved(canonicalURL),
  });
  const titles = [metadata.title, documentTitle].filter((value): value is string => value !== undefined);
  return { metadata, isInterstitial: titles.some(isInterstitialTitle) };
}

function resolveURL(value: string, base: string): string | null {
  try { return new URL(value, base).href; } catch { return null; }
}

// MARK: Interstitials

const INTERSTITIAL_TITLES = new Set([
  "just a moment...", "just a moment…", "attention required! | cloudflare", "access denied", "access to this page has been denied",
  "please wait...", "please wait…", "security check", "one more step", "are you a robot?", "robot check", "captcha",
  "verify you are human", "verification required", "before you continue", "before you continue to youtube",
  "forbidden", "403 forbidden", "error", "ddos-guard", "request rejected", "you have been blocked",
]);
const INTERSTITIAL_PREFIXES = ["checking your browser", "attention required", "access denied", "please enable cookies", "enable javascript"];

export function isInterstitialTitle(value: string): boolean {
  const title = value.toLowerCase().trim();
  return INTERSTITIAL_TITLES.has(title) || ([...title].length < 60 && INTERSTITIAL_PREFIXES.some((prefix) => title.startsWith(prefix)));
}

// MARK: JSON-LD

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonLDObjects(source: string): JsonObject[] {
  let json: Json;
  try { json = JSON.parse(source) as Json; } catch { return []; }
  const objects: JsonObject[] = [];
  const visit = (value: Json, depth: number) => {
    if (depth >= 6) return;
    if (Array.isArray(value)) value.forEach((element) => visit(element, depth + 1));
    else if (isObject(value)) {
      objects.push(value);
      if (value["@graph"] !== undefined) visit(value["@graph"], depth + 1);
    }
  };
  visit(json, 0);
  return objects;
}

const ARTICLE_TYPES = new Set([
  "article", "newsarticle", "blogposting", "reportagenewsarticle", "analysisnewsarticle", "opinionnewsarticle",
  "scholarlyarticle", "techarticle", "report", "videoobject", "podcastepisode", "review",
]);

function primaryArticle(objects: JsonObject[]): JsonObject | undefined {
  const types = (object: JsonObject) => {
    const type = object["@type"];
    if (typeof type === "string") return [type.toLowerCase()];
    return Array.isArray(type) ? type.filter((value): value is string => typeof value === "string").map((value) => value.toLowerCase()) : [];
  };
  return objects.find((object) => types(object).some((type) => ARTICLE_TYPES.has(type)))
    ?? objects.find((object) => types(object).includes("webpage"));
}

function text(value: Json | undefined): string | undefined {
  if (typeof value === "string") return value ? decodeEntities(value) : undefined;
  if (Array.isArray(value)) {
    for (const element of value) { const found = text(element); if (found !== undefined) return found; }
    return undefined;
  }
  if (isObject(value)) return text(value["@value"]) ?? text(value.name) ?? text(value["@id"]);
  return undefined;
}

function imageURL(value: Json | undefined): string | undefined {
  if (typeof value === "string") return decodeEntities(value);
  if (Array.isArray(value)) {
    for (const element of value) { const found = imageURL(element); if (found !== undefined) return found; }
    return undefined;
  }
  if (isObject(value)) return text(value.url) ?? text(value.contentUrl);
  return undefined;
}

function authorNames(value: Json | undefined): string | undefined {
  const people = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const names = people.map((person) => {
    if (typeof person === "string") return nonURL(decodeEntities(person));
    return isObject(person) ? text(person.name) : undefined;
  }).filter((name): name is string => name !== undefined);
  return names.length ? names.slice(0, 3).join(", ") : undefined;
}

function nonURL(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return !trimmed || trimmed.includes("://") ? undefined : trimmed;
}

/** "Peeples, Lynne" → "Lynne Peeples", as citation tags list surnames first. */
function readableName(value: string): string {
  const parts = value.split(",").map((part) => part.trim());
  return parts.length === 2 && parts[1] ? `${parts[1]} ${parts[0]}` : value;
}

// MARK: Entities

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™", eacute: "é", egrave: "è", aacute: "á", agrave: "à", iacute: "í",
  oacute: "ó", uacute: "ú", ntilde: "ñ", ouml: "ö", uuml: "ü", auml: "ä", szlig: "ß", ccedil: "ç",
};

export function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  let result = "";
  let index = 0;
  for (;;) {
    const ampersand = value.indexOf("&", index);
    if (ampersand === -1) break;
    result += value.slice(index, ampersand);
    const window = value.slice(ampersand + 1, ampersand + 11);
    const semicolon = window.indexOf(";");
    const decoded = semicolon === -1 ? null : entity(window.slice(0, semicolon));
    if (decoded !== null) {
      result += decoded;
      index = ampersand + 1 + semicolon + 1;
    } else {
      result += "&";
      index = ampersand + 1;
    }
  }
  return result + value.slice(index);
}

function entity(name: string): string | null {
  const codePoint = /^#[xX][0-9A-Fa-f]+$/u.test(name) ? parseInt(name.slice(2), 16)
    : /^#[0-9]+$/u.test(name) ? parseInt(name.slice(1), 10) : null;
  if (codePoint !== null) {
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
    return String.fromCodePoint(codePoint);
  }
  return NAMED_ENTITIES[name] ?? null;
}

// MARK: Character sets

/**
 * Decodes a (possibly truncated) response using the HTTP charset, a byte-order mark, or a
 * `<meta charset>` near the start, falling back from UTF-8 to Windows-1252.
 */
export function decodeHTML(bytes: Uint8Array, contentType: string | null): string {
  const declared = charsetInContentType(contentType) ?? sniffedCharset(bytes);
  const label = declared ? supportedLabel(declared) : null;
  if (label && label !== "utf-8") {
    for (let trim = 0; trim <= 3 && trim < bytes.length; trim++) {
      const text = strictDecode(bytes.subarray(0, bytes.length - trim), label);
      if (text !== null) return text;
    }
  }
  for (let trim = 0; trim <= 3 && trim < bytes.length; trim++) {
    const text = strictDecode(bytes.subarray(0, bytes.length - trim), "utf-8");
    if (text !== null) return text;
  }
  if (!declared) return new TextDecoder("windows-1252").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

function strictDecode(bytes: Uint8Array, label: string): string | null {
  try { return new TextDecoder(label, { fatal: true }).decode(bytes); } catch { return null; }
}

function supportedLabel(name: string): string | null {
  try { return new TextDecoder(name).encoding; } catch { return null; }
}

export function charsetInContentType(contentType: string | null): string | null {
  const lower = contentType?.toLowerCase();
  const start = lower?.indexOf("charset=") ?? -1;
  if (!lower || start === -1) return null;
  const value = lower.slice(start + 8).split(";", 1)[0].replace(/^["' ]+|["' ]+$/gu, "");
  return value || null;
}

function sniffedCharset(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe)) return "utf-16";
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 4_096));
  const match = /<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9_\-:.]+)/iu.exec(head);
  return match ? match[1].toLowerCase() : null;
}

// MARK: Tag scanner

interface Tag {
  name: string;
  attributes: Map<string, string>;
}

/**
 * Finds tags and their attributes. Comments, doctypes, and stray `<` are skipped; raw text inside
 * `<script>`/`<style>` is read with `text(until)` so it can't look like tags.
 */
class TagScanner {
  private index = 0;

  constructor(private readonly source: string) {}

  nextTag(): Tag | null {
    const { source } = this;
    while (this.index < source.length) {
      const open = source.indexOf("<", this.index);
      if (open === -1) { this.index = source.length; return null; }
      this.index = open + 1;
      if (source.startsWith("!--", this.index)) {
        const end = source.indexOf("-->", this.index + 3);
        this.index = end === -1 ? source.length : end + 3;
        continue;
      }
      const closing = source[this.index] === "/";
      if (closing) this.index++;
      const start = this.index;
      while (this.index < source.length && isNameCharacter(source[this.index])) this.index++;
      if (this.index === start) {
        if (source[this.index] === "!" || source[this.index] === "?") this.skipPastTagEnd();
        continue;
      }
      const name = source.slice(start, this.index).toLowerCase();
      if (closing) { this.skipPastTagEnd(); return { name: `/${name}`, attributes: new Map() }; }
      return { name, attributes: this.attributes() };
    }
    return null;
  }

  /** Raw text up to the closing tag, leaving the scanner at that closing tag. */
  text(name: string): string {
    const start = this.index;
    // Case-insensitive without lowercasing the page, which can change string length and offsets.
    const closing = new RegExp(`</${name}`, "giu");
    closing.lastIndex = this.index;
    const end = closing.exec(this.source)?.index ?? -1;
    this.index = end === -1 ? this.source.length : end;
    return this.source.slice(start, this.index);
  }

  private attributes(): Map<string, string> {
    const { source } = this;
    const result = new Map<string, string>();
    while (this.index < source.length) {
      while (this.index < source.length && (isSpace(source[this.index]) || source[this.index] === "/")) this.index++;
      if (this.index >= source.length) break;
      if (source[this.index] === ">") { this.index++; break; }
      const nameStart = this.index;
      while (this.index < source.length && !isSpace(source[this.index]) && !"=>/".includes(source[this.index])) this.index++;
      const name = source.slice(nameStart, this.index).toLowerCase();
      while (this.index < source.length && isSpace(source[this.index])) this.index++;
      let value = "";
      if (source[this.index] === "=") {
        this.index++;
        while (this.index < source.length && isSpace(source[this.index])) this.index++;
        const quote = source[this.index];
        if (quote === "\"" || quote === "'") {
          const valueEnd = source.indexOf(quote, this.index + 1);
          const end = valueEnd === -1 ? source.length : valueEnd;
          value = source.slice(this.index + 1, end);
          this.index = Math.min(end + 1, source.length);
        } else {
          const valueStart = this.index;
          while (this.index < source.length && !isSpace(source[this.index]) && source[this.index] !== ">") this.index++;
          value = source.slice(valueStart, this.index);
        }
      }
      if (name && !result.has(name)) result.set(name, decodeEntities(value));
    }
    return result;
  }

  private skipPastTagEnd() {
    const end = this.source.indexOf(">", this.index);
    this.index = end === -1 ? this.source.length : end + 1;
  }
}

function isNameCharacter(character: string): boolean {
  return /[A-Za-z0-9:-]/u.test(character);
}

function isSpace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f";
}
