import type { SavedItem } from "./item";

// The sync exchange between a browser and /api/sync. Each request pushes this browser's pending
// items and pulls everything newer than its cursor. The server merges concurrent edits instead of
// rejecting them, so a push always lands; "merged" hands back what was actually stored.

export interface SyncChange {
  item: SavedItem;
  /** The server revision this edit was made on; 0 for an item the server hasn't seen. */
  baseRevision: number;
  /** Identifies this exact edit, so a newer local edit isn't mistaken for it on reply. */
  token: string;
}

export interface SyncRow {
  item: SavedItem;
  revision: number;
}

export type SyncOutcome =
  | { id: string; status: "ok"; revision: number }
  | { id: string; status: "merged"; rows: SyncRow[] };

export interface SyncRequest {
  expectedUserId: string;
  cursor: number;
  changes: SyncChange[];
}

export interface SyncResponse {
  userId: string;
  results: SyncOutcome[];
  rows: SyncRow[];
  cursor: number;
  hasMore: boolean;
}

export const MAX_SYNC_CHANGES = 100;
export const MAX_SYNC_ROWS = 200;
