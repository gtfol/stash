import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { dbConfigured, getPool } from "./db";

// Per-address request counters for the page-details endpoint, shared by every server instance
// through Postgres, as in capsule. Only a keyed hash of the address is stored.

export const REQUEST_LIMITS = {
  details: { count: 60, seconds: 600 },
} as const;
type Scope = keyof typeof REQUEST_LIMITS;
type Result = { allowed: boolean; retryAfter: number };
type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export function requestLimitKey(request: Request, scope: Scope, secret: string, vercel: boolean): string {
  // On Vercel this header comes from the platform. A caller's own x-forwarded-for never chooses a bucket.
  const candidate = vercel ? request.headers.get("x-vercel-forwarded-for")?.trim() ?? "" : "";
  const version = isIP(candidate);
  const address = version === 6 ? new URL(`http://[${candidate}]/`).hostname : version === 4 ? candidate : "unavailable";
  return createHmac("sha256", secret).update(`stash:request-limit:v1:${scope}:${address}`).digest("hex");
}

export function createDatabaseLimiter(query: Query) {
  let nextCleanup = 0;
  return async (key: string, policy: { count: number; seconds: number }): Promise<Result> => {
    // One atomic upsert serializes concurrent requests across instances. Saturate at limit + 1.
    const result = await query(`insert into public.stash_request_limits (key, window_start, requests)
      values ($1, statement_timestamp(), 1)
      on conflict (key) do update set
        window_start = case when stash_request_limits.window_start <= statement_timestamp() - make_interval(secs => $2) then statement_timestamp() else stash_request_limits.window_start end,
        requests = case when stash_request_limits.window_start <= statement_timestamp() - make_interval(secs => $2) then 1 else least(stash_request_limits.requests + 1, $3 + 1) end
      returning requests <= $3 as allowed,
        greatest(1, ceil(extract(epoch from window_start + make_interval(secs => $2) - clock_timestamp())))::integer as retry_after`, [key, policy.seconds, policy.count]);
    const row = result.rows[0];
    if (typeof row?.allowed !== "boolean" || !Number.isInteger(row.retry_after)) throw new Error("Invalid rate-limit result");
    if (Date.now() >= nextCleanup) {
      nextCleanup = Date.now() + 60_000;
      await query(`with expired as (
        select key from public.stash_request_limits where window_start < statement_timestamp() - interval '2 hours'
        order by window_start limit 100 for update skip locked
      ) delete from public.stash_request_limits where key in (select key from expired)`).catch(() => {});
    }
    return { allowed: row.allowed, retryAfter: Number(row.retry_after) };
  };
}

export function createLocalLimiter(clock = Date.now) {
  const buckets = new Map<string, { count: number; until: number }>();
  return (key: string, policy: { count: number; seconds: number }): Result => {
    const now = clock();
    for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 10_000) return { allowed: false, retryAfter: policy.seconds };
      bucket = { count: 0, until: now + policy.seconds * 1000 };
      buckets.set(key, bucket);
    }
    bucket.count = Math.min(bucket.count + 1, policy.count + 1);
    return { allowed: bucket.count <= policy.count, retryAfter: Math.max(1, Math.ceil((bucket.until - now) / 1000)) };
  };
}

const databaseLimit = createDatabaseLimiter((sql, values) => getPool().query(sql, values));
const localLimit = createLocalLimiter();
const localSecret = randomBytes(32).toString("hex");

export async function checkRequestLimit(request: Request, scope: Scope): Promise<Response | null> {
  const policy = REQUEST_LIMITS[scope];
  const noStore = { "Cache-Control": "no-store" };
  try {
    const database = dbConfigured();
    // Cloud instances must share counters, and a database outage must not switch protection off.
    if (!database && process.env.VERCEL === "1") throw new Error("Shared rate limiter unavailable");
    const key = requestLimitKey(request, scope, process.env.BETTER_AUTH_SECRET || process.env.DATABASE_URL || localSecret, process.env.VERCEL === "1");
    const result = await (database ? databaseLimit(key, policy) : localLimit(key, policy));
    if (result.allowed) return null;
    return Response.json({ error: "Too many requests. Details will load a little later.", code: "RATE_LIMITED" }, {
      status: 429, headers: { ...noStore, "Retry-After": String(result.retryAfter) },
    });
  } catch {
    return Response.json({ error: "Details are unavailable right now.", code: "RATE_LIMIT_UNAVAILABLE" }, {
      status: 503, headers: { ...noStore, "Retry-After": "30" },
    });
  }
}
