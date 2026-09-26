import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeHTML, parseHTML } from "../src/lib/html-metadata";
import { displayDate, failureForStatus, normalizedDate } from "../src/lib/metadata";

// The same cases as MetadataParserTests in apps/ios/StashTests/MetadataTests.swift.
const articleURL = "https://www.nature.com/articles/d41586-026-02943-1";
const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((part) => typeof part === "string" ? [...new TextEncoder().encode(part)] : part));

test("reads Open Graph, JSON-LD, and canonical", () => {
  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<title>How to make a brain: new experiments challenge existing picture | Nature</title>
<meta property="og:title" content="How to make a brain: new experiments challenge existing picture">
<meta property="og:description" content="Scientists &amp; their &#8220;mini-brains&#8221;.">
<meta property="og:image" content="/images/brain.jpg">
<meta property="og:site_name" content="Nature">
<meta name="citation_author" content="Peeples, Lynne">
<meta name="citation_publication_date" content="2026/09/18">
<link rel="canonical" href="https://www.nature.com/articles/d41586-026-02943-1">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Nature"},
{"@type":"NewsArticle","headline":"JSON headline","author":[{"@type":"Person","name":"Lynne Peeples"}],
"datePublished":"2026-09-18T23:30:00-04:00","publisher":{"@type":"Organization","name":"Nature Publishing Group"}}]}</script>
</head><body><svg><title>icon</title></svg><p>body text is never read into details</p></body></html>`;
  const page = parseHTML(html, articleURL);
  assert.equal(page.isInterstitial, false);
  assert.deepEqual(page.metadata, {
    title: "How to make a brain: new experiments challenge existing picture",
    summary: "Scientists & their “mini-brains”.",
    imageURL: "https://www.nature.com/images/brain.jpg",
    siteName: "Nature",
    author: "Lynne Peeples",
    publishedDate: "2026-09-18",
    canonicalURL: "https://www.nature.com/articles/d41586-026-02943-1",
  });
});

test("tolerates messy markup", () => {
  const html = `<HTML><HEAD><Title>Plain &amp; simple</Title>
<!-- <meta property="og:title" content="commented out"> -->
<script>var s = "<meta property='og:title' content='inside a script'>";</script>
<META NAME=description CONTENT=unquoted>
<meta content='Single &quot;quoted&quot;' property='og:site_name'/>
<meta name="author" content="https://facebook.com/someone">
<meta name="citation_author" content="Doe, Jane">
<base href="https://cdn.example.com/assets/">
<meta property="og:image" content="img/cover.png">
</HEAD><body><meta property="og:title" content="late but fine"></body></HTML>`;
  const { metadata } = parseHTML(html, "https://example.com/post");
  assert.equal(metadata.title, "late but fine");
  assert.equal(metadata.summary, "unquoted");
  assert.equal(metadata.siteName, "Single \"quoted\"");
  assert.equal(metadata.author, "Jane Doe");
  assert.equal(metadata.imageURL, "https://cdn.example.com/assets/img/cover.png");
});

test("falls back to the document title and drops unusable values", () => {
  const html = `<head><title>
   Only   a title
</title><meta property="og:image" content="javascript:alert(1)"><meta property="og:title" content="   ">
<meta name="date" content="sometime"></head>`;
  assert.deepEqual(parseHTML(html, "https://example.com").metadata, { title: "Only a title" });
});

test("recognizes bot checks and error pages", () => {
  for (const title of ["Just a moment...", "Attention Required! | Cloudflare", "Access Denied", "Robot Check", "Checking your browser before accessing example.com"]) {
    assert.equal(parseHTML(`<title>${title}</title>`, articleURL).isInterstitial, true, title);
  }
  assert.equal(parseHTML("<title>Just a moment of silence for the old web</title>", articleURL).isInterstitial, false);
});

test("decodes declared and sniffed character sets", () => {
  assert.ok(decodeHTML(bytes("<head><meta charset=\"iso-8859-1\"><title>Caf", [0xe9], "</title>"), "text/html").includes("Café"));
  assert.ok(decodeHTML(bytes("<title>", [0x93, 0x71, 0x94]), "text/html; charset=\"windows-1252\"").includes("“q”"));
  const cut = bytes("<title>Café</title>é").slice(0, -1);
  assert.ok(decodeHTML(cut, "text/html; charset=utf-8").includes("<title>Café</title>"), "a character cut at the size limit keeps the page");
});

test("publication dates keep the written calendar date", () => {
  assert.equal(normalizedDate("2026-09-18T23:30:00-04:00"), "2026-09-18");
  assert.equal(normalizedDate("2026/09/18"), "2026-09-18");
  assert.equal(normalizedDate(" 2026-09-18 "), "2026-09-18");
  assert.equal(normalizedDate("2026-13-01"), null);
  assert.equal(normalizedDate("20260918"), null);
  assert.equal(normalizedDate("2026-09-180"), null);
  assert.equal(displayDate("2026-09-18", "en-US"), "Sep 18, 2026");
});

test("failure reasons from HTTP status", () => {
  assert.equal(failureForStatus(403), "blocked");
  assert.equal(failureForStatus(429), "blocked");
  assert.equal(failureForStatus(404), "notFound");
  assert.equal(failureForStatus(503), "serverError");
  assert.equal(failureForStatus(418), "other");
});
