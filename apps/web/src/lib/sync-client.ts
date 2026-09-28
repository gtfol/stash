import { accountSpace, applySyncResponse, pendingChanges, syncCursor } from "./local-db";
import { MAX_SYNC_CHANGES, type SyncChange, type SyncRequest, type SyncResponse } from "./sync-types";

// One full exchange for an account: push every pending change in batches and pull until the
// cursor is current. The transport is passed in, so tests can run it against the real server code.

export type SyncTransport = (request: SyncRequest) => Promise<
  { ok: true; response: SyncResponse } | { ok: false; status: number; message: string }
>;

export class SignedOutError extends Error {}

const encoder = new TextEncoder();

/** Changes that fit one request, oldest first. */
export function selectBatch(changes: SyncChange[]): SyncChange[] {
  const selected: SyncChange[] = [];
  let bytes = 1_000;
  for (const change of [...changes].sort((a, b) => a.item.updatedAt - b.item.updatedAt)) {
    const size = encoder.encode(JSON.stringify(change)).length + 1;
    if (selected.length >= MAX_SYNC_CHANGES || bytes + size > 900_000) break;
    bytes += size;
    selected.push(change);
  }
  return selected;
}

export async function syncAccount(userId: string, transport: SyncTransport, stillCurrent: () => boolean = () => true): Promise<void> {
  const space = accountSpace(userId);
  for (let round = 0; round < 100; round++) {
    if (!stillCurrent()) return;
    const changes = selectBatch(await pendingChanges(space));
    const cursor = await syncCursor(space);
    const result = await transport({ expectedUserId: userId, cursor, changes });
    if (!result.ok) {
      if (result.status === 401 || result.status === 409) throw new SignedOutError(result.message);
      throw new Error(result.message);
    }
    if (result.response.userId !== userId) throw new SignedOutError("The signed-in account changed. Sign in again.");
    // Applies to the account this exchange started with, even if the shown account changed meanwhile.
    await applySyncResponse(space, changes, result.response);
    if (!result.response.hasMore && (await pendingChanges(space)).length === 0) return;
  }
  throw new Error("Some changes are still waiting. They’ll sync next time.");
}

/** The browser's transport: same-origin JSON to /api/sync with the session cookie. */
export const fetchTransport: SyncTransport = async (body) => {
  const response = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (response.ok) return { ok: true, response: await response.json() as SyncResponse };
  const problem = await response.json().catch(() => null) as { error?: string } | null;
  return { ok: false, status: response.status, message: problem?.error ?? `Sync couldn’t finish (${response.status}).` };
};
