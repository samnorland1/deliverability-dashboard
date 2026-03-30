import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchAllMetricsBothWindows } from "@/lib/klaviyo";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("auth_token")?.value;
  const secret = process.env.AUTH_SECRET;
  if (!cookie || cookie !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, name, api_key");

  if (clientsError) {
    return NextResponse.json({ error: clientsError.message }, { status: 500 });
  }

  if (!clients || clients.length === 0) {
    return NextResponse.json({ message: "No clients found", results: [] });
  }

  const results: { name: string; status: string; error?: string }[] = [];

  // Process clients sequentially to avoid Klaviyo rate limits
  for (const client of clients) {
    try {
      const { current, previous, currentDate, previousDate } =
        await fetchAllMetricsBothWindows(client.api_key);

      // Strip fields not in the metrics_snapshots schema (e.g. emails_sent)
      const toRow = ({ campaign_emails_sent: _ce, flow_emails_sent: _fe, ...rest }: typeof current) => rest;

      const { error: e1 } = await supabase
        .from("metrics_snapshots")
        .upsert(
          { client_id: client.id, snapshot_date: currentDate, ...toRow(current) },
          { onConflict: "client_id,snapshot_date" }
        );
      if (e1) throw new Error(e1.message);

      const { error: e2 } = await supabase
        .from("metrics_snapshots")
        .upsert(
          { client_id: client.id, snapshot_date: previousDate, ...toRow(previous) },
          { onConflict: "client_id,snapshot_date" }
        );
      if (e2) throw new Error(e2.message);

      // Delete any stale snapshots that don't match the current windows
      await supabase
        .from("metrics_snapshots")
        .delete()
        .eq("client_id", client.id)
        .not("snapshot_date", "in", `(${currentDate},${previousDate})`);

      results.push({ name: client.name, status: "ok" });
    } catch (err) {
      results.push({
        name: client.name,
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ message: "Sync complete", fetched: results.length, results });
}
