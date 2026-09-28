import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import { applyMetadata, itemTitle, newItem, recordSave, renameItem, tombstone, type SavedItem } from "../src/lib/item";
import { webLink } from "../src/lib/link";
import { runSync, SyncRequestError, validateSyncRequest } from "../src/lib/server/sync";
import type { SyncChange, SyncResponse } from "../src/lib/sync-types";
import { createUser, freshDatabase, skipDatabase } from "./postgres";

let pool: Pool;
let drop: () => Promise<void>;
let now = 1_790_000_000_000;
const tick = () => (now += 1_000);

before(async () => {
  if (skipDatabase) return;
  ({ pool, drop } = await freshDatabase("sync"));
});
after(async () => { if (!skipDatabase) await drop(); });

const change = (item: SavedItem, baseRevision = 0): SyncChange => ({ item, baseRevision, token: crypto.randomUUID() });
const sync = (userId: string, changes: SyncChange[] = [], cursor = 0): Promise<SyncResponse> =>
  runSync(pool, userId, validateSyncRequest({ expectedUserId: userId, cursor, changes: JSON.parse(JSON.stringify(changes)) }), tick());
const live = (response: SyncResponse) => response.rows.map((row) => row.item).filter((item) => !item.deletedAt);
const saved = (url: string, id?: string) => newItem(webLink(url), tick(), "app", id);

test("the first-launch article is added once per account and stays deleted", { skip: skipDatabase }, async () => {
  await createUser(pool, "seed-user");
  const first = await sync("seed-user");
  const seeds = live(first).filter((item) => item.origin === "seed");
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].url, "https://archive.ph/GDsbC");
  assert.equal(itemTitle(seeds[0]), "How to make a brain: new experiments challenge existing picture");
  const revision = first.rows.find((row) => row.item.id === seeds[0].id)!.revision;
  const removed = await sync("seed-user", [change(tombstone(seeds[0], tick()), revision)], first.cursor);
  assert.equal(removed.results[0].status, "ok");
  const later = await sync("seed-user");
  assert.equal(live(later).length, 0, "no copy comes back on later syncs or from a new browser");
});

test("an account that already saved the article isn't given a second copy", { skip: skipDatabase }, async () => {
  await createUser(pool, "has-article");
  const own = saved("https://www.nature.com/articles/d41586-026-02943-1");
  const response = await sync("has-article", [change(own)]);
  assert.deepEqual(live(response).map((item) => item.url), ["https://www.nature.com/articles/d41586-026-02943-1"]);
});

test("pushes are acknowledged, retries are harmless, and other devices pull them", { skip: skipDatabase }, async () => {
  await createUser(pool, "pusher");
  const seeded = await sync("pusher");
  const item = saved("https://example.com/one");
  const sent = change(item);
  const first = await sync("pusher", [sent], seeded.cursor);
  assert.deepEqual(first.results, [{ id: item.id, status: "ok", revision: first.results[0].status === "ok" ? first.results[0].revision : -1 }]);
  const retry = await sync("pusher", [sent], seeded.cursor);
  assert.equal(retry.results[0].status, "ok");
  assert.equal(retry.results[0].status === "ok" && retry.results[0].revision, first.results[0].status === "ok" && first.results[0].revision);
  const otherDevice = await sync("pusher");
  assert.deepEqual(live(otherDevice).map((row) => row.url).sort(), ["https://archive.ph/GDsbC", "https://example.com/one"]);
});

test("edits made on the same revision in two places are merged, not rejected", { skip: skipDatabase }, async () => {
  await createUser(pool, "editor");
  const item = saved("https://example.com/story");
  const created = await sync("editor", [change(item)]);
  const base = created.results[0].status === "ok" ? created.results[0].revision : 0;
  const renamed = renameItem(item, "My name for it", tick())!;
  const refreshed = applyMetadata(item, { title: "The Story", summary: "What happened" }, tick());
  assert.equal((await sync("editor", [change(renamed, base)])).results[0].status, "ok");
  const second = await sync("editor", [change(refreshed, base)]);
  assert.equal(second.results[0].status, "merged");
  const stored = second.results[0].status === "merged" ? second.results[0].rows[0].item : refreshed;
  assert.equal(itemTitle(stored), "My name for it");
  assert.equal(stored.page.summary, "What happened");
  assert.equal(stored.url, "https://example.com/story");
});

test("the same page saved separately on two devices becomes one item", { skip: skipDatabase }, async () => {
  await createUser(pool, "two-devices");
  const phone = saved("https://example.com/page?utm_source=app");
  const laptop = renameItem(saved("https://www.example.com/page/"), "Laptop title", tick())!;
  await sync("two-devices", [change(phone)]);
  const response = await sync("two-devices", [change(laptop)]);
  assert.equal(response.results[0].status, "merged");
  const items = live(response);
  const pages = items.filter((item) => item.dedupeKey === "https://example.com/page");
  assert.equal(pages.length, 1);
  assert.equal(pages[0].id, phone.id, "the first save keeps its identity and link");
  assert.equal(pages[0].url, "https://example.com/page?utm_source=app");
  assert.equal(itemTitle(pages[0]), "Laptop title");
  const removed = response.rows.find((row) => row.item.id === laptop.id)!.item;
  assert.equal(removed.mergedInto, phone.id);
  const count = await pool.query("select count(*)::int as n from stash_items where user_id = $1 and dedupe_key = $2", ["two-devices", "https://example.com/page"]);
  assert.equal(count.rows[0].n, 1);
});

test("a deletion wins over an older edit but not over saving the page again", { skip: skipDatabase }, async () => {
  await createUser(pool, "deleter");
  const item = saved("https://example.com/kept");
  const created = await sync("deleter", [change(item)]);
  const base = created.results[0].status === "ok" ? created.results[0].revision : 0;
  await sync("deleter", [change(tombstone(item, tick()), base)]);
  const staleRename = await sync("deleter", [change(renameItem(item, "renamed on a stale device", tick())!, base)]);
  assert.ok(staleRename.results[0].status === "merged" && staleRename.results[0].rows[0].item.deletedAt);
  const resaved = await sync("deleter", [change(recordSave(item, tick(), now)!, base)]);
  const revived = resaved.results[0].status === "merged" ? resaved.results[0].rows[0].item : null;
  assert.ok(revived && !revived.deletedAt);
  assert.equal(revived.url, "https://example.com/kept");
});

test("the server recomputes dedupe keys and refuses items that aren't valid", { skip: skipDatabase }, async () => {
  await createUser(pool, "validator");
  const item = { ...saved("https://Example.com/x?fbclid=1"), dedupeKey: "https://wrong.example/" };
  const response = await sync("validator", [change(item)]);
  assert.equal(response.results[0].status, "merged");
  assert.equal(response.results[0].status === "merged" && response.results[0].rows[0].item.dedupeKey, "https://example.com/x");
  const bad = [
    { ...saved("https://example.com/a"), url: "javascript:alert(1)" },
    { ...saved("https://example.com/b"), id: "not-an-id" },
    { ...saved("https://example.com/c"), createdAt: -1 },
  ];
  for (const item of bad) {
    assert.throws(() => validateSyncRequest({ expectedUserId: "validator", cursor: 0, changes: [change(item)] }), SyncRequestError);
  }
});

test("accounts are isolated and Supabase's API roles can't read anything", { skip: skipDatabase }, async () => {
  await createUser(pool, "alice");
  await createUser(pool, "bob");
  await sync("alice", [change(saved("https://example.com/alice-only"))]);
  const bob = await sync("bob");
  assert.ok(!live(bob).some((item) => item.url.includes("alice")));
  for (const role of ["anon", "authenticated"]) {
    const client = await pool.connect();
    try {
      await client.query(`set role ${role}`);
      await assert.rejects(client.query("select * from public.stash_items"), /permission denied/);
      await assert.rejects(client.query(`select * from public."session"`), /permission denied/);
    } finally {
      await client.query("reset role");
      client.release();
    }
  }
});

test("pulls page through large libraries with a cursor", { skip: skipDatabase }, async () => {
  await createUser(pool, "collector");
  const items = Array.from({ length: 250 }, (_, index) => saved(`https://example.com/p/${index}`));
  for (let start = 0; start < items.length; start += 100) await sync("collector", items.slice(start, start + 100).map((item) => change(item)));
  let cursor = 0;
  const seen = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const response = await sync("collector", [], cursor);
    response.rows.forEach((row) => seen.add(row.item.id));
    cursor = response.cursor;
    if (!response.hasMore) break;
  }
  assert.equal(seen.size, 251, "every item and the article, each once");
});
