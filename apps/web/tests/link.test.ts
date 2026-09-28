import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackTitle, hostOfLink, LinkError, linkInText, sharedLink, typedLink, webLink } from "../src/lib/link";

// The same cases as apps/ios/StashTests/WebLinkTests.swift and SharedPayloadTests.swift, so a page
// gets the same dedupe key on the web and on the iPhone.

function throwsKind(action: () => unknown, kind: LinkError["kind"], scheme?: string) {
  assert.throws(action, (error: unknown) => error instanceof LinkError && error.kind === kind && (scheme === undefined || error.scheme === scheme));
}

test("keeps the entered link verbatim", () => {
  assert.equal(webLink("  https://Example.com/Path?b=2&a=1#Section \n").string, "https://Example.com/Path?b=2&a=1#Section");
  assert.equal(webLink("<https://example.com/a>").string, "https://example.com/a");
  assert.equal(webLink("“https://example.com/a”").string, "https://example.com/a");
  assert.equal(webLink("HTTP://example.com/a").string, "HTTP://example.com/a");
});

test("rejects other schemes by name", () => {
  const cases: [string, string][] = [["ftp://files.example.com/a", "ftp"], ["mailto:someone@example.com", "mailto"], ["javascript:alert(1)", "javascript"],
    ["file:///etc/hosts", "file"], ["data:text/html,hi", "data"], ["stash://item/1", "stash"]];
  for (const [text, scheme] of cases) throwsKind(() => webLink(text), "unsupportedScheme", scheme);
});

test("rejects malformed links", () => {
  for (const text of ["https://", "https:example.com", "http:///path", "https://exa mple.com", "example", "not a link", "//example.com/a"]) {
    throwsKind(() => webLink(text), "invalid");
  }
  throwsKind(() => webLink("  "), "empty");
  throwsKind(() => webLink(`https://example.com/${"a".repeat(9_000)}`), "tooLong");
});

test("typed bare domains get https", () => {
  assert.equal(typedLink("example.com/article?id=3").string, "https://example.com/article?id=3");
  assert.equal(typedLink("www.example.co.uk").string, "https://www.example.co.uk");
  assert.equal(typedLink("example.com:8080/a").string, "https://example.com:8080/a");
  assert.equal(typedLink("http://example.com").string, "http://example.com");
  assert.equal(typedLink("read this https://example.com/a later").string, "https://example.com/a");
  throwsKind(() => typedLink("example"), "invalid");
  throwsKind(() => typedLink("ftp://example.com"), "unsupportedScheme", "ftp");
  throwsKind(() => typedLink("   "), "empty");
});

test("finds exactly one explicit link in text", () => {
  assert.equal(linkInText("Check this out: https://example.com/story.").string, "https://example.com/story");
  assert.equal(linkInText("https://example.com/a and again https://example.com/a?utm_source=x").string, "https://example.com/a");
  assert.equal(linkInText("(see https://en.wikipedia.org/wiki/Swift_(programming_language))").string, "https://en.wikipedia.org/wiki/Swift_(programming_language)");
  throwsKind(() => linkInText("https://news.com/1 or https://blog.org/2"), "multipleLinks");
  throwsKind(() => linkInText("just words, and example.com without a scheme"), "noLink");
  throwsKind(() => linkInText("note: remember re:this at 10:30"), "noLink");
});

test("dedupe key strips tracking and fragments but keeps meaningful parameters", () => {
  const cases: [string, string][] = [
    ["https://Example.COM/a?utm_source=x&id=5&fbclid=abc#section", "https://example.com/a?id=5"],
    ["http://www.example.com:80/", "https://example.com/"],
    ["https://example.com", "https://example.com/"],
    ["https://example.com/a/", "https://example.com/a"],
    ["https://example.com:8443/a", "https://example.com:8443/a"],
    ["https://www.youtube.com/watch?v=abc123&si=share&feature=youtu.be", "https://youtube.com/watch?v=abc123"],
    ["https://x.com/user/status/1?s=20&t=abc", "https://x.com/user/status/1"],
    ["https://example.com/?p=42&page=2&q=swift", "https://example.com/?p=42&page=2&q=swift"],
    ["https://news.example.com/story?si=keep", "https://news.example.com/story?si=keep"],
    ["https://app.example.com/#/inbox/3", "https://app.example.com/#/inbox/3"],
    ["https://archive.ph/GDsbC", "https://archive.ph/GDsbC"],
  ];
  for (const [input, key] of cases) assert.equal(webLink(input).dedupeKey, key, input);
  assert.equal(webLink("http://example.com/a").dedupeKey, webLink("https://www.example.com/a/").dedupeKey);
  assert.notEqual(webLink("https://example.com/a?id=1").dedupeKey, webLink("https://example.com/a?id=2").dedupeKey);
  assert.notEqual(webLink("https://example.com/A").dedupeKey, webLink("https://example.com/a").dedupeKey);
  // Written differently, encoded the same way Foundation reads them.
  assert.equal(webLink("https://ja.wikipedia.org/wiki/日本").dedupeKey, "https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC");
  assert.equal(webLink("https://user:secret@example.com/a").dedupeKey, "https://example.com/a");
});

test("fallback title is the readable link", () => {
  assert.equal(fallbackTitle("https://www.example.com/articles/one?id=2"), "example.com/articles/one");
  assert.equal(fallbackTitle("https://archive.ph/GDsbC"), "archive.ph/GDsbC");
  assert.equal(fallbackTitle("https://example.com/"), "example.com");
  assert.equal(hostOfLink("https://WWW.Nature.com/articles/x"), "nature.com");
});

test("shared content: URL items win, text must hold one link", () => {
  assert.equal(sharedLink({ urls: ["https://example.com/story"], texts: ["great read https://other.com/x"] }).string, "https://example.com/story");
  assert.equal(sharedLink({ texts: ["Look at this 👀 https://example.com/a?id=1 — so good"] }).string, "https://example.com/a?id=1");
  assert.equal(sharedLink({ urls: ["https://example.com/a", "https://example.com/a?utm_medium=social"] }).string, "https://example.com/a");
  throwsKind(() => sharedLink({ texts: ["no link here"] }), "noLink");
  throwsKind(() => sharedLink({}), "noLink");
  throwsKind(() => sharedLink({ texts: ["https://news.com/1 https://blog.org/2"] }), "multipleLinks");
  throwsKind(() => sharedLink({ urls: ["https://news.com/1", "https://blog.org/2"] }), "multipleLinks");
  throwsKind(() => sharedLink({ urls: ["file:///private/var/mobile/report.pdf"] }), "unsupportedScheme", "file");
  throwsKind(() => sharedLink({ urls: ["mailto:someone@example.com"], texts: ["write to me"] }), "unsupportedScheme", "mailto");
});
