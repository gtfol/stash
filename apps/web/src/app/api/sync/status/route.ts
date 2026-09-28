import { NextResponse } from "next/server";
import { authConfigured } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ enabled: authConfigured() }, { headers: { "Cache-Control": "no-store" } });
}
