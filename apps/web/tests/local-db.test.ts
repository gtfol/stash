import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { itemTitle, renameItem } from "../src/lib/item";
import { webLink } from "../src/lib/link";
import {
  accountSpace, applySyncResponse, deleteItem, GUEST_SPACE, importGuestOnce, listStored, pendingChanges, readLibrary, saveLink,
  seedGuestOnce, syncCursor, updateItem,
} from "../src/lib/local-db";

let now = 1_790_000_000_000;
const tick = () => (now += 1_000);

test("a guest gets the first-launch article once, and never again after deleting it", async () => {
  assert.equal(await seedGuestOnce(tick()), true);
  assert.equal(await seedGuestOnce(tick()), false);
  const [article] = await readLibrary(GUEST_SPACE);
  assert.equal(article.url, "https://archive.ph/GDsbC");
  await deleteItem(GUEST_SPACE, article.id, tick());
  assert.equal(await seedGuestOnce(tick()), false);
  assert.deepEqual(await readLibrary(GUEST_SPACE), []);
  assert.deepEqual(await listStored(GUEST_SPACE), [], "guest deletions leave nothing behind");
});

test("saving the same page again moves it to the top and keeps the first link", async () => {
  const first = await saveLink(GUEST_SPACE, webLink("https://example.com/a?utm_source=x"), "app", tick());
  await saveLink(GUEST_SPACE, webLink("https://example.com/b"), "app", tick());
  const again = await saveLink(GUEST_SPACE, webLink("https://www.example.com/a/"), "share", tick());
  assert.equal(first.result, "added");
  assert.equal(again.result, "alreadySaved");
  const library = await readLibrary(GUEST_SPACE);
  assert.deepEqual(library.map((item) => item.url), ["https://example.com/a?utm_source=x", "https://example.com/b"]);
  await assert.rejects(updateItem(GUEST_SPACE, first.item.id, (item) => ({ ...item, url: "https://evil.example/" })), /can’t change/);
  assert.deepEqual(await pendingChanges(GUEST_SPACE), [], "guest changes never queue for sync");
});

test("the first sign-in copies the guest library once, without the article", async () => {
  await seedGuestOnce(tick());
  const copied = await importGuestOnce("user-1");
  assert.equal(copied, 2);
  assert.equal(await importGuestOnce("user-1"), 0);
  assert.equal(await importGuestOnce("user-2"), 0, "only the first account in this browser gets the guest library");
  const space = accountSpace("user-1");
  const pending = await pendingChanges(space);
  assert.equal(pending.length, 2);
  assert.ok(pending.every((change) => change.baseRevision === 0 && change.item.origin !== "seed"));
  assert.equal((await readLibrary(GUEST_SPACE)).length, 2, "the guest library stays for signing out");
});

test("sync replies clear acknowledged edits and keep newer ones", async () => {
  const space = accountSpace("user-3");
  const { item } = await saveLink(space, webLink("https://example.com/c"), "app", tick());
  const [sent] = await pendingChanges(space);
  // An edit made while the request is out.
  await updateItem(space, item.id, (current) => renameItem(current, "Renamed meanwhile", tick()));
  await applySyncResponse(space, [sent], { userId: "user-3", results: [{ id: item.id, status: "ok", revision: 7 }], rows: [], cursor: 7, hasMore: false });
  const [still] = await pendingChanges(space);
  assert.equal(still.baseRevision, 7);
  assert.equal(itemTitle(still.item), "Renamed meanwhile");
  // Another device's refresh arrives for the same item: merged in, still pending.
  const remote = { ...sent.item, page: { title: "From the page", summary: "Details" }, metadataStatus: "fetched" as const, metadataCheckedAt: tick(), updatedAt: now };
  await applySyncResponse(space, [], { userId: "user-3", results: [], rows: [{ item: remote, revision: 9 }], cursor: 9, hasMore: false });
  const [rebased] = await pendingChanges(space);
  assert.equal(rebased.baseRevision, 9);
  assert.equal(itemTitle(rebased.item), "Renamed meanwhile");
  assert.equal(rebased.item.page.summary, "Details");
  assert.equal(await syncCursor(space), 9);
  await applySyncResponse(space, [rebased], { userId: "user-3", results: [{ id: item.id, status: "ok", revision: 10 }], rows: [], cursor: 10, hasMore: false });
  assert.deepEqual(await pendingChanges(space), []);
  await assert.rejects(applySyncResponse(space, [], { userId: "someone-else", results: [], rows: [], cursor: 11, hasMore: false }), /account changed/);
});

test("account deletions become tombstones that sync", async () => {
  const space = accountSpace("user-4");
  const { item } = await saveLink(space, webLink("https://example.com/d"), "app", tick());
  await deleteItem(space, item.id, tick());
  assert.deepEqual(await readLibrary(space), []);
  const [change] = await pendingChanges(space);
  assert.equal(change.item.url, "");
  assert.ok(change.item.deletedAt);
  const again = await saveLink(space, webLink("https://example.com/d"), "app", tick());
  assert.equal(again.result, "added", "saving a deleted page again makes a new item");
});
