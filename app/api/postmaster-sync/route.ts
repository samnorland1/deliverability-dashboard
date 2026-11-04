import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { syncPostmaster } from "@/lib/sync";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("auth_token")?.value;
  const authHeader = req.headers.get("authorization");
  const secret = process.env.AUTH_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isBrowser = cookie && cookie === secret;

  if (!isCron && !isBrowser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const upserted = await syncPostmaster(createServiceClient());
    return NextResponse.json({ message: "Postmaster sync complete", upserted });
  } catch (err) {
    console.error("Postmaster sync error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
