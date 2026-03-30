import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchAllMetrics, getDateWindows } from "@/lib/klaviyo";

export const maxDuration = 300; // 5 minutes for Pro plan

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { current, previous } = getDateWindows();

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

  // Fetch all clients in parallel
  await Promise.all(
    clients.map(async (client) => {
      try {
        const [currentMetrics, previousMetrics] = await Promise.all([
          fetchAllMetrics(client.api_key, current),
          fetchAllMetrics(client.api_key, previous),
        ]);

        const toRow = ({ campaign_emails_sent: _ce, flow_emails_sent: _fe, ...rest }: typeof currentMetrics) => rest;

        // Upsert current snapshot
        const { error: currentError } = await supabase
          .from("metrics_snapshots")
          .upsert(
            {
              client_id: client.id,
              snapshot_date: current.end,
              ...toRow(currentMetrics),
            },
            { onConflict: "client_id,snapshot_date" }
          );

        if (currentError) throw new Error(currentError.message);

        // Upsert previous snapshot
        const { error: previousError } = await supabase
          .from("metrics_snapshots")
          .upsert(
            {
              client_id: client.id,
              snapshot_date: previous.end,
              ...toRow(previousMetrics),
            },
            { onConflict: "client_id,snapshot_date" }
          );

        if (previousError) throw new Error(previousError.message);

        // Delete stale snapshots outside the current windows
        await supabase
          .from("metrics_snapshots")
          .delete()
          .eq("client_id", client.id)
          .not("snapshot_date", "in", `(${current.end},${previous.end})`);

        results.push({ name: client.name, status: "ok" });
      } catch (err) {
        results.push({
          name: client.name,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })
  );

  return NextResponse.json({
    message: "Sync complete",
    fetched: results.length,
    results,
  });
}
