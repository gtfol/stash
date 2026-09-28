import type { Pool, PoolClient } from "pg";
import { isDeleted, mergeItems, seedItem, SEED_DEDUPE_KEYS, tombstone, type SavedItem } from "../item";
import { MAX_SYNC_CHANGES, MAX_SYNC_ROWS, type SyncChange, type SyncOutcome, type SyncResponse, type SyncRow } from "../sync-types";
import { canonicalItem, InvalidItemError, stableJSON } from "./item-validation";

// One account's sync exchange, in one transaction. Pushes never conflict: an edit made on an older
// revision is merged with what's stored, and a page saved separately on two devices becomes one
// item under the first save's identity. Every write takes a new revision from one sequence, so a
// browser's cursor finds everything that changed since it last looked.

type StoredRow = { record: SavedItem; revision: string };

export class SyncRequestError extends Error {}

export interface ValidSyncRequest {
  expectedUserId: string;
  cursor: number;
  changes: { item: SavedItem; sent: unknown; baseRevision: number; token: string }[];
}

export function validateSyncRequest(body: unknown): ValidSyncRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new SyncRequestError("A sync request is required.");
  const { expectedUserId, cursor, changes } = body as Record<string, unknown>;
  if (typeof expectedUserId !== "string" || !expectedUserId || expectedUserId.length > 200) throw new SyncRequestError("The account is missing.");
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) throw new SyncRequestError("The sync position is invalid.");
  if (!Array.isArray(changes) || changes.length > MAX_SYNC_CHANGES) throw new SyncRequestError("Too many changes in one request.");
  const seen = new Set<string>();
  return {
    expectedUserId, cursor,
    changes: changes.map((change) => {
      if (typeof change !== "object" || change === null) throw new SyncRequestError("A change is invalid.");
      const { item, baseRevision, token } = change as Partial<SyncChange>;
      if (typeof baseRevision !== "number" || !Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new SyncRequestError("A change has an invalid revision.");
      if (typeof token !== "string" || !token || token.length > 100) throw new SyncRequestError("A change has an invalid token.");
      let canonical: SavedItem;
      try { canonical = canonicalItem(item); } catch (error) {
        throw new SyncRequestError(error instanceof InvalidItemError ? error.message : "A change is invalid.");
      }
      if (seen.has(canonical.id)) throw new SyncRequestError("An item appears twice in one request.");
      seen.add(canonical.id);
      return { item: canonical, sent: item, baseRevision, token };
    }),
  };
}

async function write(client: PoolClient, userId: string, item: SavedItem): Promise<SyncRow> {
  const result = await client.query<{ revision: string }>(
    `insert into public.stash_items (user_id, id, record, dedupe_key, revision)
     values ($1, $2, $3::jsonb, $4, nextval('public.stash_sync_revision'))
     on conflict (user_id, id) do update set record = excluded.record, dedupe_key = excluded.dedupe_key, revision = excluded.revision
     returning revision`,
    [userId, item.id, JSON.stringify(item), isDeleted(item) ? null : item.dedupeKey],
  );
  return { item, revision: Number(result.rows[0].revision) };
}

async function stored(client: PoolClient, userId: string, id: string): Promise<{ item: SavedItem; revision: number } | null> {
  const result = await client.query<StoredRow>("select record, revision from public.stash_items where user_id = $1 and id = $2 for update", [userId, id]);
  const row = result.rows[0];
  return row ? { item: row.record, revision: Number(row.revision) } : null;
}

async function samePage(client: PoolClient, userId: string, item: SavedItem): Promise<SavedItem | null> {
  const result = await client.query<StoredRow>(
    "select record, revision from public.stash_items where user_id = $1 and dedupe_key = $2 and id <> $3 for update",
    [userId, item.dedupeKey, item.id],
  );
  return result.rows[0]?.record ?? null;
}

async function push(client: PoolClient, userId: string, change: ValidSyncRequest["changes"][number], now: number): Promise<SyncOutcome> {
  const incoming = change.item;
  const existing = await stored(client, userId, incoming.id);
  const sentExactly = stableJSON(change.sent) === stableJSON(incoming);
  // An exact retry after a lost response changes nothing.
  if (existing && stableJSON(existing.item) === stableJSON(incoming)) {
    return sentExactly ? { id: incoming.id, status: "ok", revision: existing.revision } : { id: incoming.id, status: "merged", rows: [existing] };
  }
  const candidate = existing && existing.revision !== change.baseRevision ? mergeItems(existing.item, incoming) : incoming;
  if (!isDeleted(candidate)) {
    const other = await samePage(client, userId, candidate);
    if (other) {
      const combined = mergeItems(other, candidate);
      const loser = combined.id === candidate.id ? other : candidate;
      // Free the page's key before the survivor takes it.
      const removed = await write(client, userId, tombstone(loser, Math.max(now, loser.lastSavedAt, loser.updatedAt), combined.id));
      const kept = await write(client, userId, combined);
      return { id: incoming.id, status: "merged", rows: [removed, kept] };
    }
  }
  const row = await write(client, userId, candidate);
  return candidate === incoming && sentExactly ? { id: incoming.id, status: "ok", revision: row.revision } : { id: incoming.id, status: "merged", rows: [row] };
}

/** The first-launch article, added once per account and never again, even after it's deleted. */
async function seedOnce(client: PoolClient, userId: string, now: number): Promise<void> {
  const first = await client.query("insert into public.stash_accounts (user_id) values ($1) on conflict do nothing returning user_id", [userId]);
  if (!first.rowCount) return;
  const existing = await client.query("select 1 from public.stash_items where user_id = $1 and dedupe_key = any($2::text[]) limit 1", [userId, SEED_DEDUPE_KEYS]);
  if (!existing.rowCount) await write(client, userId, seedItem(now));
}

export async function runSync(pool: Pool, userId: string, request: ValidSyncRequest, now = Date.now()): Promise<SyncResponse> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Serialize one account's requests, so a cursor never passes a revision that was allocated
    // by a same-account request that hasn't committed yet.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`stash:${userId}`]);
    const results: SyncOutcome[] = [];
    for (const change of request.changes) results.push(await push(client, userId, change, now));
    // After this browser's first changes, so links it brings along count as already having it.
    await seedOnce(client, userId, now);
    const selected = await client.query<StoredRow>(
      "select record, revision from public.stash_items where user_id = $1 and revision > $2 order by revision asc limit $3",
      [userId, request.cursor, MAX_SYNC_ROWS + 1],
    );
    const rows = selected.rows.slice(0, MAX_SYNC_ROWS).map((row) => ({ item: row.record, revision: Number(row.revision) }));
    await client.query("commit");
    return { userId, results, rows, cursor: rows.at(-1)?.revision ?? request.cursor, hasMore: selected.rows.length > MAX_SYNC_ROWS };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

