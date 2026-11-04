import { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllMetricsBothWindows, PeriodDays } from "./klaviyo";
import { fetchAllPostmasterStats } from "./postmaster";

type SyncClient = { id: string; name: string; api_key: string };

// Fetches current + previous windows for one client and period, replacing that period's snapshots
export async function syncClientPeriod(supabase: SupabaseClient, client: SyncClient, days: PeriodDays) {
  const { current, previous, currentDate, previousDate } =
    await fetchAllMetricsBothWindows(client.api_key, days);

  // Strip fields not in the metrics_snapshots schema (e.g. emails_sent)
  const toRow = ({ campaign_emails_sent: _ce, flow_emails_sent: _fe, ...rest }: typeof current) => rest;

  const { error } = await supabase
    .from("metrics_snapshots")
    .upsert(
      [
        { client_id: client.id, period_days: days, snapshot_date: currentDate, ...toRow(current) },
        { client_id: client.id, period_days: days, snapshot_date: previousDate, ...toRow(previous) },
      ],
      { onConflict: "client_id,period_days,snapshot_date" }
    );
  if (error) throw new Error(error.message);

  // Delete any stale snapshots for this period that don't match the current windows
  await supabase
    .from("metrics_snapshots")
    .delete()
    .eq("client_id", client.id)
    .eq("period_days", days)
    .not("snapshot_date", "in", `(${currentDate},${previousDate})`);
}

// Stores daily Postmaster stats for every domain linked to a client
export async function syncPostmaster(supabase: SupabaseClient): Promise<number> {
  if (!process.env.POSTMASTER_CLIENT_ID || !process.env.POSTMASTER_CLIENT_SECRET || !process.env.POSTMASTER_REFRESH_TOKEN) {
    throw new Error("Postmaster credentials not configured");
  }

  const { data: clientDomains } = await supabase
    .from("clients")
    .select("sending_domain")
    .not("sending_domain", "is", null);

  const domains = [...new Set((clientDomains ?? []).map(c => c.sending_domain).filter(Boolean))] as string[];
  if (domains.length === 0) return 0;

  const stats = await fetchAllPostmasterStats(domains);
  if (stats.length === 0) return 0;

  const { error } = await supabase
    .from("postmaster_snapshots")
    .upsert(stats, { onConflict: "domain,snapshot_date" });
  if (error) throw new Error(error.message);

  return stats.length;
}
