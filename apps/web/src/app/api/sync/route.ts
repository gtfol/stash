import { NextResponse } from "next/server";
import { getAuth, sameOrigin } from "@/lib/server/auth";
import { getPool } from "@/lib/server/db";
import { runSync, SyncRequestError, validateSyncRequest } from "@/lib/server/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 1_000_000;
const headers = { "Cache-Control": "no-store" };
const problem = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function POST(request: Request) {
  const auth = getAuth();
  if (!auth) return problem("Sync isn’t set up on this deployment.", 503);
  if (!sameOrigin(request)) return problem("Request origin is not allowed.", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return problem("A JSON request is required.", 415);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return problem("Sign in to sync.", 401);
  let body: ReturnType<typeof validateSyncRequest>;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return problem("Too many changes in one request.", 413);
    body = validateSyncRequest(JSON.parse(text));
  } catch (error) {
    return problem(error instanceof SyncRequestError ? error.message : "Invalid sync request.", 400);
  }
  if (body.expectedUserId !== session.user.id) return problem("The signed-in account changed.", 409);
  try {
    return NextResponse.json(await runSync(getPool(), session.user.id, body), { headers });
  } catch (error) {
    console.error("stash sync failed", error instanceof Error ? error.message : "unknown database error");
    return problem("Sync couldn’t finish. Your links are saved in this browser.", 500);
  }
}
