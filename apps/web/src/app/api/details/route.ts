import { NextResponse } from "next/server";
import { tryWebLink } from "@/lib/link";
import { sameOrigin } from "@/lib/server/auth";
import { readDetails } from "@/lib/server/details";
import { checkRequestLimit } from "@/lib/server/request-limit";

// Reads one saved page's details for this app's own pages. It isn't a general fetch service:
// same-origin only, rate limited per address, public websites only, and a bounded read.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!sameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "A JSON request is required." }, { status: 415, headers });
  }
  const limited = await checkRequestLimit(request, "details");
  if (limited) return limited;
  let url: unknown;
  try {
    const text = await request.text();
    if (text.length > 16_384) throw new Error();
    url = (JSON.parse(text) as { url?: unknown }).url;
  } catch {
    return NextResponse.json({ error: "A link is required." }, { status: 400, headers });
  }
  const link = typeof url === "string" ? tryWebLink(url) : null;
  if (!link || link.string !== url) return NextResponse.json({ error: "That isn’t a web link." }, { status: 400, headers });
  return NextResponse.json(await readDetails(link.string), { headers });
}
