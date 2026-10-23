import { NextResponse } from "next/server";
import { db } from "@/lib/database/client";
import { storageReady } from "@/lib/services/storage";

export const dynamic = "force-dynamic";

/**
 * Liveness: the process answers. Readiness (?ready=1): the database answers too.
 * No details beyond ok/fail, so the endpoint reveals nothing about the environment.
 */
export async function GET(req: Request) {
  if (!new URL(req.url).searchParams.get("ready")) return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  try {
    await db.$queryRaw`SELECT 1`;
    if (!(await storageReady())) throw new Error("storage");
    return NextResponse.json({ status: "ready" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "not-ready" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
