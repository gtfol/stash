import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

// Fetches a page someone saved without letting the link reach this server's own network: only
// public addresses, checked at connection time with no second DNS lookup, and every redirect
// checked again. Adapted from capsule's safe fetch, reading a bounded prefix of the page.

export type SafeFetchCode = "INVALID_URL" | "BLOCKED_URL" | "TIMEOUT" | "FETCH_FAILED" | "TOO_MANY_REDIRECTS";

export class SafeFetchError extends Error {
  constructor(message: string, readonly code: SafeFetchCode) {
    super(message);
    this.name = "SafeFetchError";
  }
}

type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;

function ipv6Number(address: string): bigint {
  const [left, right] = address.toLowerCase().split("::");
  const start = left ? left.split(":") : [];
  const end = right ? right.split(":") : [];
  const groups = right !== undefined ? [...start, ...Array(8 - start.length - end.length).fill("0"), ...end] : start;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

/** Deliberately accepts only globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6 || address.includes(".")) return false;
  const value = ipv6Number(address);
  const prefix = (base: string, bits: number) => value >> BigInt(128 - bits) === ipv6Number(base) >> BigInt(128 - bits);
  // This also excludes loopback, link-local, ULA, mapped IPv4, NAT64, and multicast.
  return prefix("2000::", 3) && !prefix("2001::", 23) && !prefix("2001:db8::", 32) && !prefix("2002::", 16) && !prefix("3fff::", 20);
}

export function validatePublicUrl(input: string | URL): URL {
  let url: URL;
  try {
    if (String(input).length > 8192) throw new Error("URL length");
    url = new URL(input);
  } catch {
    throw new SafeFetchError("That isn’t a web link.", "INVALID_URL");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new SafeFetchError("Only public web links on standard ports can be read.", "INVALID_URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "").toLowerCase();
  if (!hostname || hostname === "localhost" || (!hostname.includes(".") && !isIP(hostname)) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/u.test(hostname) ||
    (isIP(hostname) && !isPublicAddress(hostname))) {
    throw new SafeFetchError("This link doesn’t point to a public website.", "BLOCKED_URL");
  }
  url.hash = "";
  return url;
}

/** All answers must be public; the chosen address is then used directly by the socket. */
export async function resolvePublicTarget(input: string | URL, resolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true })) {
  const url = validatePublicUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  let addresses: Address[];
  try {
    addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname);
  } catch {
    throw new SafeFetchError("This website couldn’t be reached.", "FETCH_FAILED");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new SafeFetchError("This link doesn’t point to a public website.", "BLOCKED_URL");
  }
  // Prefer IPv4 for runtimes without an IPv6 route. There is no second DNS lookup.
  const address = addresses.find((entry) => entry.family === 4) ?? addresses[0];
  return { url, hostname, ...address };
}

export interface SafeFetchOptions {
  /** Bytes of (decompressed) body to read; the rest of the response is ignored, not an error. */
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  /** Stops reading after this ASCII marker (any case), such as `</head>`. */
  stopAfter?: string;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  contentType: string | null;
}

const USER_AGENT = "Mozilla/5.0 (compatible; stash/1.0; +https://stash.gtfol.dev)";

function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SafeFetchError("The site took too long to answer.", "TIMEOUT")), Math.max(1, milliseconds));
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

type Config = Required<Omit<SafeFetchOptions, "stopAfter">> & Pick<SafeFetchOptions, "stopAfter">;

function requestTarget(target: Awaited<ReturnType<typeof resolvePublicTarget>>, options: Config): Promise<SafeFetchResult> {
  return new Promise((resolve, reject) => {
    const { url, address, family, hostname } = target;
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request({
      protocol: url.protocol, hostname: address, family,
      port: url.protocol === "https:" ? 443 : 80,
      path: url.pathname + url.search,
      method: "GET",
      agent: false,
      servername: isIP(hostname) ? undefined : hostname,
      maxHeaderSize: 32 * 1024,
      headers: { Host: url.host, Accept: options.accept, "Accept-Encoding": "gzip, deflate, br", "User-Agent": USER_AGENT },
    });
    let settled = false;
    const timer = setTimeout(() => fail(new SafeFetchError("The site took too long to answer.", "TIMEOUT")), options.timeoutMs);
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(error instanceof SafeFetchError ? error : new SafeFetchError("This website couldn’t be reached.", "FETCH_FAILED"));
    }
    req.on("error", fail);
    req.on("response", (response) => {
      const status = response.statusCode ?? 502;
      const contentType = typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : null;
      const finish = (body: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ url: url.href, status, headers: response.headers, body, contentType });
        response.destroy();
      };
      if ([301, 302, 303, 307, 308].includes(status) || status < 200 || status >= 300) { finish(Buffer.alloc(0)); return; }
      const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase();
      const decoder = encoding === "gzip" || encoding === "x-gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
      if (encoding !== "identity" && !decoder) { fail(new SafeFetchError("This website sent an unsupported response.", "FETCH_FAILED")); return; }
      const stream = decoder ? response.pipe(decoder) : response;
      const chunks: Buffer[] = [];
      const marker = options.stopAfter?.toLowerCase();
      let tail = "";
      let bytes = 0;
      let wireBytes = 0;
      response.on("data", (chunk: Buffer) => {
        // Compressed input can't be larger than a generous multiple of what's kept.
        wireBytes += chunk.length;
        if (wireBytes > options.maxBytes * 4) finish(Buffer.concat(chunks));
      });
      response.on("error", fail);
      stream.on("error", (error) => bytes ? finish(Buffer.concat(chunks)) : fail(error));
      stream.on("data", (chunk: Buffer) => {
        const room = options.maxBytes - bytes;
        chunks.push(Buffer.from(chunk.subarray(0, Math.max(0, room))));
        bytes += Math.min(chunk.length, Math.max(0, room));
        if (bytes >= options.maxBytes) { finish(Buffer.concat(chunks)); return; }
        if (marker) {
          // Only the new bytes and a marker's length before them need searching.
          const window = tail + chunk.toString("latin1").toLowerCase();
          if (window.includes(marker)) { finish(Buffer.concat(chunks)); return; }
          tail = window.slice(-marker.length);
        }
      });
      stream.on("end", () => finish(Buffer.concat(chunks)));
    });
    req.end();
  });
}

export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const config: Config = {
    maxBytes: Math.min(Math.max(options.maxBytes ?? 768 * 1024, 1), 4 * 1024 * 1024),
    timeoutMs: Math.min(Math.max(options.timeoutMs ?? 15_000, 1), 30_000),
    maxRedirects: Math.min(Math.max(options.maxRedirects ?? 5, 0), 8),
    accept: options.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    stopAfter: options.stopAfter,
  };
  let url = validatePublicUrl(input);
  const expiresAt = Date.now() + config.timeoutMs;
  for (let redirects = 0; redirects <= config.maxRedirects; redirects++) {
    if (Date.now() >= expiresAt) throw new SafeFetchError("The site took too long to answer.", "TIMEOUT");
    const target = await deadline(resolvePublicTarget(url), expiresAt - Date.now());
    const result = await requestTarget(target, { ...config, timeoutMs: Math.max(1, expiresAt - Date.now()) });
    if (![301, 302, 303, 307, 308].includes(result.status)) return result;
    const location = result.headers.location;
    if (!location) throw new SafeFetchError("This website sent an invalid redirect.", "FETCH_FAILED");
    try {
      url = validatePublicUrl(new URL(location, url));
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      throw new SafeFetchError("This website sent an invalid redirect.", "FETCH_FAILED");
    }
  }
  throw new SafeFetchError("This website redirected too many times.", "TOO_MANY_REDIRECTS");
}
