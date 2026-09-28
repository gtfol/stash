import assert from "node:assert/strict";
import { test } from "node:test";
import { readDetails } from "../src/lib/server/details";
import { createLocalLimiter } from "../src/lib/server/request-limit";
import { isPublicAddress, resolvePublicTarget, SafeFetchError, validatePublicUrl, type SafeFetchOptions, type SafeFetchResult } from "../src/lib/server/safe-fetch";

const page = (body: string, overrides: Partial<SafeFetchResult> = {}): SafeFetchResult => ({
  url: "https://example.com/story", status: 200, headers: {}, body: Buffer.from(body), contentType: "text/html; charset=utf-8", ...overrides,
});

test("reads a page's details from a bounded prefix, stopping after the head", async () => {
  let options: SafeFetchOptions = {};
  const result = await readDetails("https://example.com/story", async (_url, given) => {
    options = given ?? {};
    return page(`<head><title>Story</title><meta property="og:site_name" content="Example"></head>`);
  });
  assert.deepEqual(result, { metadata: { title: "Story", siteName: "Example" } });
  assert.equal(options.stopAfter, "</head>");
  assert.equal(options.maxBytes, 768 * 1024);
});

test("explains why details are missing", async () => {
  const cases: [SafeFetchResult | Error, unknown][] = [
    [page("", { status: 404 }), { failure: "notFound" }],
    [page("", { status: 403 }), { failure: "blocked" }],
    [page("", { status: 503 }), { failure: "serverError" }],
    [page("%PDF-1.7", { contentType: "application/pdf" }), { failure: "notWebPage" }],
    [page("<title>Just a moment...</title>"), { failure: "blocked" }],
    [new SafeFetchError("slow", "TIMEOUT"), { failure: "timedOut" }],
    [new SafeFetchError("private", "BLOCKED_URL"), { failure: "unreachable" }],
    [new Error("socket hang up"), { failure: "unreachable" }],
  ];
  for (const [outcome, expected] of cases) {
    const result = await readDetails("https://example.com/x", async () => { if (outcome instanceof Error) throw outcome; return outcome; });
    assert.deepEqual(result, expected);
  }
});

// From capsule's safe-fetch tests: the details endpoint must never reach this server's own network.
test("only public addresses and standard ports are fetched", async () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["1.1.1.1", "93.184.215.14", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
  for (const url of ["http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://localhost./", "http://metadata.google.internal/", "http://printer.local/"]) {
    assert.throws(() => validatePublicUrl(url), (error: unknown) => error instanceof SafeFetchError && error.code === "BLOCKED_URL", url);
  }
  for (const url of ["http://example.com:3000/", "https://user:pass@example.com/", "file:///etc/passwd"]) assert.throws(() => validatePublicUrl(url), SafeFetchError);
  await assert.rejects(resolvePublicTarget("https://mixed.example.com/", async () => [{ address: "1.1.1.1", family: 4 }, { address: "10.0.0.1", family: 4 }]),
    (error: unknown) => error instanceof SafeFetchError && error.code === "BLOCKED_URL");
});

test("request limits allow a burst, then ask the caller to wait", () => {
  let now = 0;
  const limit = createLocalLimiter(() => now);
  const policy = { count: 3, seconds: 60 };
  assert.deepEqual([1, 2, 3, 4].map(() => limit("a", policy).allowed), [true, true, true, false]);
  assert.equal(limit("b", policy).allowed, true, "counters are per address");
  now = 61_000;
  assert.equal(limit("a", policy).allowed, true);
});
