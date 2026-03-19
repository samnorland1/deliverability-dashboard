import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchAllPostmasterStats } from "@/lib/postmaster";

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

  if (!process.env.POSTMASTER_CLIENT_ID || !process.env.POSTMASTER_CLIENT_SECRET || !process.env.POSTMASTER_REFRESH_TOKEN) {
    return NextResponse.json({ error: "Postmaster credentials not configured" }, { status: 500 });
  }

  try {
    const supabase = createServiceClient();

    // Only fetch stats for domains that are actually linked to clients
    const { data: clientDomains } = await supabase
      .from("clients")
      .select("sending_domain")
      .not("sending_domain", "is", null);

    const domains = [...new Set((clientDomains ?? []).map(c => c.sending_domain).filter(Boolean))] as string[];

    if (domains.length === 0) {
      return NextResponse.json({ message: "No domains configured on clients yet", upserted: 0 });
    }

    const stats = await fetchAllPostmasterStats(domains);

    if (stats.length === 0) {
      return NextResponse.json({ message: "No postmaster data available", upserted: 0 });
    }

    const { error } = await supabase
      .from("postmaster_snapshots")
      .upsert(stats, { onConflict: "domain,snapshot_date" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: "Postmaster sync complete", upserted: stats.length, domains: stats.map(s => s.domain) });
  } catch (err) {
    console.error("Postmaster sync error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
