import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { PERIODS } from "@/lib/klaviyo";
import { syncClientPeriod, syncPostmaster } from "@/lib/sync";

export const maxDuration = 300; // 5 minutes for Pro plan

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Fetch all clients
  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, name, api_key");

  if (clientsError) {
    return NextResponse.json({ error: clientsError.message }, { status: 500 });
  }

  if (!clients || clients.length === 0) {
    return NextResponse.json({ message: "No clients found", fetched: 0 });
  }

  const results: { name: string; status: string; error?: string }[] = [];

  // Clients run in parallel (each is its own Klaviyo account); periods run sequentially per client
  await Promise.all(
    clients.map(async (client) => {
      const failed: string[] = [];
      for (const days of PERIODS) {
        try {
          await syncClientPeriod(supabase, client, days);
        } catch (err) {
          failed.push(`${days}d: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }
      results.push(failed.length
        ? { name: client.name, status: "error", error: failed.join("; ") }
        : { name: client.name, status: "ok" });
    })
  );

  let postmaster: number | string;
  try {
    postmaster = await syncPostmaster(supabase);
  } catch (err) {
    postmaster = err instanceof Error ? err.message : "Unknown error";
  }

  return NextResponse.json({
    message: "Sync complete",
    fetched: results.length,
    results,
    postmaster,
  });
}
