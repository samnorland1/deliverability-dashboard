import { NextResponse } from "next/server";
import { createServiceClient, ClientWithMetrics, PostmasterSnapshot } from "@/lib/supabase";

function snap(id: string, clientId: string, date: string, o: number, c: number, b: number, u: number, s: number, fo: number, fc: number, fb: number, fu: number, fs: number) {
  return { id, client_id: clientId, snapshot_date: date, campaign_open_rate: o, campaign_click_rate: c, campaign_bounce_rate: b, campaign_unsub_rate: u, campaign_spam_rate: s, flow_open_rate: fo, flow_click_rate: fc, flow_bounce_rate: fb, flow_unsub_rate: fu, flow_spam_rate: fs, created_at: date };
}

const DEMO_DATA: ClientWithMetrics[] = [
  { id: "demo-1", name: "Acme Sportswear", api_key: "", sending_domain: null, created_at: "2024-01-01",
    current:  snap("s1a", "demo-1", "2024-03-13", 0.284, 0.041, 0.006, 0.002, 0.0001, 0.312, 0.038, 0.004, 0.001, 0.00008),
    previous: snap("s1b", "demo-1", "2024-02-12", 0.261, 0.037, 0.009, 0.003, 0.0002, 0.290, 0.033, 0.006, 0.002, 0.00012),
    postmaster: null },
];

export async function GET() {
  const supabase = createServiceClient();

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, name, api_key, sending_domain, created_at")
    .order("name");

  if (clientsError) {
    return NextResponse.json({ error: clientsError.message }, { status: 500 });
  }

  if (!clients || clients.length === 0) {
    return NextResponse.json(DEMO_DATA);
  }

  const clientIds = clients.map((c) => c.id);

  // Fetch the 2 most recent snapshots for each client
  const { data: snapshots, error: snapshotsError } = await supabase
    .from("metrics_snapshots")
    .select("*")
    .in("client_id", clientIds)
    .order("snapshot_date", { ascending: false });

  if (snapshotsError) {
    return NextResponse.json({ error: snapshotsError.message }, { status: 500 });
  }

  // Fetch latest postmaster snapshot per domain
  const domains = clients.map(c => c.sending_domain).filter(Boolean) as string[];
  let postmasterByDomain: Record<string, PostmasterSnapshot> = {};

  if (domains.length > 0) {
    const { data: pmData } = await supabase
      .from("postmaster_snapshots")
      .select("*")
      .in("domain", domains)
      .order("snapshot_date", { ascending: false });

    // Keep only the most recent per domain
    for (const row of pmData ?? []) {
      if (!postmasterByDomain[row.domain]) {
        postmasterByDomain[row.domain] = row as PostmasterSnapshot;
      }
    }
  }

  // Group snapshots by client_id, take first 2
  const snapshotsByClient: Record<string, typeof snapshots> = {};
  for (const snap of snapshots ?? []) {
    if (!snapshotsByClient[snap.client_id]) {
      snapshotsByClient[snap.client_id] = [];
    }
    if (snapshotsByClient[snap.client_id].length < 2) {
      snapshotsByClient[snap.client_id].push(snap);
    }
  }

  const result: ClientWithMetrics[] = clients.map((client) => {
    const clientSnapshots = snapshotsByClient[client.id] ?? [];
    return {
      ...client,
      current: clientSnapshots[0] ?? null,
      previous: clientSnapshots[1] ?? null,
      postmaster: client.sending_domain ? (postmasterByDomain[client.sending_domain] ?? null) : null,
    };
  });

  return NextResponse.json(result);
}
