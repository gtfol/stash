import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMetadata, AUTOMATIC_ATTEMPT_LIMIT, hasTitle, itemAuthor, itemHost, itemPublishedDate, itemSource, itemTitle, matchesQuery,
  mergeItems, newItem, originalURL, recordMetadataFailure, recordSave, renameItem, seedItem, SEED_DEDUPE_KEYS, tombstone,
  wantsAutomaticMetadata, type SavedItem,
} from "../src/lib/item";
import { webLink } from "../src/lib/link";

// SavedItemRecordTests from the iPhone app, then the merge rules sync relies on.
const savedAt = 1_790_000_000_000;
const item = (url: string, at = savedAt, id?: string) => newItem(webLink(url), at, "app", id);

test("a refresh only fills fields the user hasn't edited", () => {
  let record = item("https://example.com/a");
  assert.equal(itemTitle(record), "example.com/a");
  assert.equal(hasTitle(record), false);
  record = applyMetadata(record, { title: "Page title", summary: "About the page" }, savedAt);
  assert.equal(itemTitle(record), "Page title");
  record = renameItem(record, "My title", savedAt)!;
  record = applyMetadata(record, { title: "Changed page title", siteName: "Example" }, savedAt);
  assert.equal(itemTitle(record), "My title");
  assert.equal(record.page.title, "Changed page title");
  assert.equal(record.page.summary, "About the page", "a blank field in a refresh erases nothing");
  assert.equal(itemSource(record), "Example");
  assert.equal(record.url, "https://example.com/a");
  record = renameItem(record, "   ", savedAt)!;
  assert.equal(itemTitle(record), "Changed page title");
  assert.equal(renameItem(record, "Changed page title", savedAt), null, "typing the page's own title isn't an edit");
});

test("the first-launch article keeps its archive link and known details through refreshes", () => {
  let record = seedItem(savedAt);
  assert.equal(record.url, "https://archive.ph/GDsbC");
  assert.equal(record.origin, "seed");
  record = applyMetadata(record, { title: "archive.ph", summary: "Archived copy", imageURL: "https://archive.ph/GDsbC/scr.png",
    siteName: "archive.ph", author: " ", publishedDate: "2020-01-01", canonicalURL: "https://archive.ph/GDsbC" }, savedAt);
  record = applyMetadata(record, {}, savedAt);
  assert.equal(record.url, "https://archive.ph/GDsbC");
  assert.equal(itemTitle(record), "How to make a brain: new experiments challenge existing picture");
  assert.equal(itemSource(record), "Nature");
  assert.equal(itemAuthor(record), "Lynne Peeples");
  assert.equal(itemPublishedDate(record), "2026-09-18");
  assert.equal(originalURL(record), "https://www.nature.com/articles/d41586-026-02943-1");
  assert.equal(record.page.summary, "Archived copy");
  assert.equal(itemHost(record), "archive.ph");
  assert.deepEqual(SEED_DEDUPE_KEYS, ["https://archive.ph/GDsbC", "https://nature.com/articles/d41586-026-02943-1"]);
});

test("repeat saves only move forward", () => {
  const record = item("https://example.com/a");
  assert.equal(recordSave(record, savedAt, savedAt), null);
  assert.equal(recordSave(record, savedAt - 60_000, savedAt), null);
  const moved = recordSave(record, savedAt + 60_000, savedAt + 60_000)!;
  assert.equal(moved.lastSavedAt, savedAt + 60_000);
  assert.equal(moved.createdAt, savedAt);
});

test("automatic retries are limited to transient failures", () => {
  let record = item("https://example.com/a");
  assert.equal(wantsAutomaticMetadata(record), true);
  for (let i = 0; i < 5; i++) record = recordMetadataFailure(record, "offline", savedAt);
  assert.equal(record.metadataAttempts, 0, "offline attempts don't use up retries");
  assert.equal(wantsAutomaticMetadata(record), true);
  for (let i = 0; i < AUTOMATIC_ATTEMPT_LIMIT; i++) record = recordMetadataFailure(record, "timedOut", savedAt);
  assert.equal(wantsAutomaticMetadata(record), false);
  let blocked = recordMetadataFailure(item("https://example.com/b"), "blocked", savedAt);
  assert.equal(wantsAutomaticMetadata(blocked), false);
  assert.equal(itemTitle(blocked), "example.com/b", "a failed fetch still leaves a readable title");
  blocked = applyMetadata(blocked, {}, savedAt);
  assert.equal(wantsAutomaticMetadata(blocked), false);
  assert.equal(blocked.metadataFailure, undefined);
});

test("search covers title, source, domain, and link", () => {
  let record = seedItem(savedAt);
  assert.ok(matchesQuery(record, ""));
  assert.ok(matchesQuery(record, "brain NATURE"));
  assert.ok(matchesQuery(record, "archive.ph"));
  assert.ok(matchesQuery(record, "GDsbC"));
  assert.ok(!matchesQuery(record, "brain cafe"));
  record = renameItem(record, "Café notes", savedAt)!;
  assert.ok(matchesQuery(record, "cafe"));
  assert.ok(matchesQuery(record, "experiments"), "the automatic title stays searchable after a rename");
});

// MARK: Merging

test("two edits of one item keep the latest title, latest save, and newest details", () => {
  const base = item("https://example.com/a", savedAt, "00000000-0000-4000-8000-000000000001");
  const renamed = renameItem(base, "Mine", savedAt + 10)!;
  const refreshed = applyMetadata(base, { title: "Page", summary: "Summary" }, savedAt + 20);
  const resaved = recordSave(base, savedAt + 30, savedAt + 30)!;
  const merged = mergeItems(mergeItems(renamed, refreshed), resaved);
  assert.equal(itemTitle(merged), "Mine");
  assert.equal(merged.page.summary, "Summary");
  assert.equal(merged.metadataStatus, "fetched");
  assert.equal(merged.lastSavedAt, savedAt + 30);
  assert.deepEqual(mergeItems(refreshed, renamed), mergeItems(renamed, refreshed), "order doesn't matter");
  const cleared = renameItem(renamed, "", savedAt + 40)!;
  assert.equal(mergeItems(renamed, cleared).customTitle, undefined, "clearing a title is an edit too");
  assert.equal(itemTitle(mergeItems(cleared, renamed)), "example.com/a");
});

test("the same page saved on two devices keeps the first link and identity", () => {
  const first = item("https://example.com/a?utm_source=mail", savedAt, "00000000-0000-4000-8000-00000000000b");
  const second = renameItem(item("https://www.example.com/a/", savedAt + 1_000, "00000000-0000-4000-8000-00000000000a"), "Named", savedAt + 1_000)!;
  const merged = mergeItems(second, first);
  assert.equal(merged.id, first.id);
  assert.equal(merged.url, "https://example.com/a?utm_source=mail");
  assert.equal(merged.createdAt, savedAt);
  assert.equal(merged.lastSavedAt, savedAt + 1_000);
  assert.equal(itemTitle(merged), "Named");
});

test("a deletion stands unless the page was saved again afterwards", () => {
  const base = seedItem(savedAt, "00000000-0000-4000-8000-000000000001");
  const deleted = tombstone(base, savedAt + 100);
  assert.equal(deleted.url, "");
  assert.equal(deleted.known, undefined, "a deleted item keeps nothing about the page");
  const renamedLater = renameItem(base, "Edited elsewhere", savedAt + 200)!;
  assert.ok(mergeItems(renamedLater, deleted).deletedAt, "an edit doesn't undo a deletion");
  const savedLater = recordSave(base, savedAt + 200, savedAt + 200)!;
  const revived = mergeItems(deleted, savedLater);
  assert.equal(revived.deletedAt, undefined);
  assert.equal(revived.url, "https://archive.ph/GDsbC");
  assert.equal(itemTitle(revived), "How to make a brain: new experiments challenge existing picture");
});

test("merging is stable when repeated", () => {
  const a: SavedItem = applyMetadata(item("https://example.com/a", savedAt, "00000000-0000-4000-8000-000000000001"), { title: "A" }, savedAt + 5);
  const b: SavedItem = renameItem(a, "B", savedAt + 6)!;
  const once = mergeItems(a, b);
  assert.deepEqual(mergeItems(once, b), once);
  assert.deepEqual(mergeItems(once, once), once);
});
