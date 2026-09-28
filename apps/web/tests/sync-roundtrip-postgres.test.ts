import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import { itemTitle, newItem, renameItem, type SavedItem } from "../src/lib/item";
import { webLink } from "../src/lib/link";
import { accountSpace, importGuestOnce, pendingChanges, readLibrary, saveLink, seedGuestOnce, updateItem, deleteItem } from "../src/lib/local-db";
import { runSync, validateSyncRequest } from "../src/lib/server/sync";
import { syncAccount, type SyncTransport } from "../src/lib/sync-client";
import type { SyncChange } from "../src/lib/sync-types";
import { createUser, freshDatabase, skipDatabase } from "./postgres";

// This browser's storage and sync loop against the real server code and Postgres, with a second
// device played by direct requests.

let pool: Pool;
let drop: () => Promise<void>;
let now = 1_790_000_000_000;
const tick = () => (now += 1_000);
const transport = (userId: string): SyncTransport => async (request) => ({
  ok: true, response: await runSync(pool, userId, validateSyncRequest(JSON.parse(JSON.stringify(request))), tick()),
});
const otherDevice = (userId: string, changes: SyncChange[] = [], cursor = 0) =>
  runSync(pool, userId, validateSyncRequest({ expectedUserId: userId, cursor, changes: JSON.parse(JSON.stringify(changes)) }), tick());

before(async () => {
  if (skipDatabase) return;
  ({ pool, drop } = await freshDatabase("roundtrip"));
});
after(async () => { if (!skipDatabase) await drop(); });

test("a guest library signs in, syncs, and meets another device's edits", { skip: skipDatabase }, async () => {
  await createUser(pool, "allen");
  await seedGuestOnce(tick());
  await saveLink("guest", webLink("https://example.com/guest-find"), "app", tick());
  await importGuestOnce("allen");
  const space = accountSpace("allen");
  await syncAccount("allen", transport("allen"));
  assert.deepEqual(await pendingChanges(space), []);
  const library = await readLibrary(space);
  assert.deepEqual(library.map((item) => item.url).sort(), ["https://archive.ph/GDsbC", "https://example.com/guest-find"]);

  // The other device saves the same page separately, renames the article, and deletes nothing.
  const pulled = await otherDevice("allen");
  const article = pulled.rows.find((row) => row.item.origin === "seed")!;
  const phoneCopy: SavedItem = renameItem(newItem(webLink("https://www.example.com/guest-find/"), tick(), "share"), "From my phone", tick())!;
  await otherDevice("allen", [
    { item: renameItem(article.item, "Brain article", tick())!, baseRevision: article.revision, token: "t1" },
    { item: phoneCopy, baseRevision: 0, token: "t2" },
  ]);

  // Meanwhile this browser deletes nothing but refreshes the guest find's title locally.
  const find = library.find((item) => item.url.includes("guest-find"))!;
  await updateItem(space, find.id, (item) => ({ ...item, page: { title: "Guest find" }, metadataStatus: "fetched", metadataCheckedAt: tick(), updatedAt: now }));
  await syncAccount("allen", transport("allen"));

  const after = await readLibrary(space);
  assert.equal(after.length, 2, "one item per page");
  const merged = after.find((item) => item.dedupeKey === "https://example.com/guest-find")!;
  assert.equal(merged.id, find.id, "the first save keeps its identity");
  assert.equal(merged.url, "https://example.com/guest-find");
  assert.equal(itemTitle(merged), "From my phone");
  assert.equal(merged.page.title, "Guest find");
  assert.equal(itemTitle(after.find((item) => item.origin === "seed")!), "Brain article");

  // A deletion here reaches the other device.
  await deleteItem(space, merged.id, tick());
  await syncAccount("allen", transport("allen"));
  const final = await otherDevice("allen");
  assert.ok(final.rows.find((row) => row.item.id === merged.id)!.item.deletedAt);
});
