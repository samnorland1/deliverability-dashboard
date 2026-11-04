import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { parsePeriod } from "@/lib/klaviyo";
import { syncClientPeriod, syncPostmaster } from "@/lib/sync";

export const maxDuration = 300;

// Syncs the selected period only (?days=7|30|90) so a manual sync stays inside the time limit
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("auth_token")?.value;
  const secret = process.env.AUTH_SECRET;
  if (!cookie || cookie !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = parsePeriod(req.nextUrl.searchParams.get("days"));
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
      await syncClientPeriod(supabase, client, days);
      results.push({ name: client.name, status: "ok" });
    } catch (err) {
      results.push({
        name: client.name,
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  let postmaster: number | string;
  try {
    postmaster = await syncPostmaster(supabase);
  } catch (err) {
    postmaster = err instanceof Error ? err.message : "Unknown error";
  }

  return NextResponse.json({ message: "Sync complete", days, fetched: results.length, results, postmaster });
}
