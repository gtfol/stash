import { decodeHTML, parseHTML } from "../html-metadata";
import { failureForStatus, type LinkMetadata, type MetadataFailure } from "../metadata";
import { safeFetch, SafeFetchError, type SafeFetchResult } from "./safe-fetch";

// Reads a saved page's details on the server, as the iPhone app does on the phone: at most the
// first 768 KB, stopping after `</head>`, with no cookies and no scripts. Never article bodies.

export type DetailsResult = { metadata: LinkMetadata } | { failure: MetadataFailure };
type Fetcher = (url: string, options: Parameters<typeof safeFetch>[1]) => Promise<SafeFetchResult>;

export function isHTML(contentType: string | null): boolean {
  const type = contentType?.toLowerCase().split(";")[0].trim();
  return !type || type === "text/html" || type === "application/xhtml+xml";
}

export async function readDetails(url: string, fetcher: Fetcher = safeFetch): Promise<DetailsResult> {
  let response: SafeFetchResult;
  try {
    response = await fetcher(url, { maxBytes: 768 * 1024, timeoutMs: 15_000, stopAfter: "</head>" });
  } catch (error) {
    if (error instanceof SafeFetchError && error.code === "TIMEOUT") return { failure: "timedOut" };
    return { failure: "unreachable" };
  }
  if (response.status < 200 || response.status >= 300) return { failure: failureForStatus(response.status) };
  if (!isHTML(response.contentType)) return { failure: "notWebPage" };
  const page = parseHTML(decodeHTML(new Uint8Array(response.body), response.contentType), response.url);
  if (page.isInterstitial) return { failure: "blocked" };
  return { metadata: page.metadata };
}
