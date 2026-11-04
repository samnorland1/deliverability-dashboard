const POSTMASTER_API = "https://gmailpostmastertools.googleapis.com/v1";

export type DomainReputation = "HIGH" | "MEDIUM" | "LOW" | "BAD" | "REPUTATION_CATEGORY_UNSPECIFIED";

export type PostmasterStats = {
  domain: string;
  snapshot_date: string; // YYYY-MM-DD
  domain_reputation: DomainReputation | null;
  ip_reputation: DomainReputation | null;
  spam_rate: number | null;
  dkim_success_rate: number | null;
  spf_success_rate: number | null;
  dmarc_success_rate: number | null;
};

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.POSTMASTER_CLIENT_ID!,
      client_secret: process.env.POSTMASTER_CLIENT_SECRET!,
      refresh_token: process.env.POSTMASTER_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function listDomains(accessToken: string): Promise<string[]> {
  const res = await fetch(`${POSTMASTER_API}/domains`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Postmaster domains list failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // Each domain entry has a "name" like "domains/example.com"
  return (data.domains ?? []).map((d: { name: string }) =>
    d.name.replace("domains/", "")
  );
}

type TrafficStat = {
  name: string;
  domainReputation?: DomainReputation;
  ipReputations?: { reputation?: DomainReputation; numIps?: number }[];
  userReportedSpamRatio?: number;
  dkimSuccessRatio?: number;
  spfSuccessRatio?: number;
  dmarcSuccessRatio?: number;
};

function toStats(domain: string, stat: TrafficStat): PostmasterStats {
  // Extract date from name like "domains/example.com/trafficStats/20240315"
  const nameParts = stat.name.split("/");
  const dateStr = nameParts[nameParts.length - 1]; // "20240315"
  const snapshot_date = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

  // IP reputation: take the dominant one (highest numIps count)
  let ip_reputation: DomainReputation | null = null;
  if (stat.ipReputations && stat.ipReputations.length > 0) {
    const sorted = [...stat.ipReputations].sort((a, b) => (b.numIps ?? 0) - (a.numIps ?? 0));
    ip_reputation = sorted[0].reputation ?? null;
  }

  return {
    domain,
    snapshot_date,
    domain_reputation: stat.domainReputation ?? null,
    ip_reputation,
    spam_rate: stat.userReportedSpamRatio ?? null,
    dkim_success_rate: stat.dkimSuccessRatio ?? null,
    spf_success_rate: stat.spfSuccessRatio ?? null,
    dmarc_success_rate: stat.dmarcSuccessRatio ?? null,
  };
}

// Fetches every daily traffic stats entry for a domain over the last 95 days
// (enough to cover the 90-day view plus Postmaster's reporting lag)
async function fetchDailyStats(accessToken: string, domain: string): Promise<PostmasterStats[]> {
  const start = new Date();
  start.setDate(start.getDate() - 95);

  const all: PostmasterStats[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      pageSize: "100",
      "startDate.year":  start.getFullYear().toString(),
      "startDate.month": (start.getMonth() + 1).toString(),
      "startDate.day":   start.getDate().toString(),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(
      `${POSTMASTER_API}/domains/${encodeURIComponent(domain)}/trafficStats?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      console.error(`Postmaster trafficStats failed for ${domain}: ${res.status}`);
      break;
    }

    const data = await res.json();
    for (const stat of (data.trafficStats ?? []) as TrafficStat[]) all.push(toStats(domain, stat));
    pageToken = data.nextPageToken;
  } while (pageToken);

  if (all.length === 0) console.log(`Postmaster: no traffic stats for ${domain} (insufficient volume?)`);
  return all;
}

// Fetches daily stats only for the specified domains (those linked to clients)
export async function fetchAllPostmasterStats(domainsToFetch: string[]): Promise<PostmasterStats[]> {
  if (domainsToFetch.length === 0) return [];

  const accessToken = await getAccessToken();

  console.log(`Postmaster: fetching stats for ${domainsToFetch.length} domain(s): ${domainsToFetch.join(", ")}`);

  // Fetch in parallel — small set so no rate limit concern
  const settled = await Promise.allSettled(
    domainsToFetch.map(domain => fetchDailyStats(accessToken, domain))
  );

  const results: PostmasterStats[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") results.push(...result.value);
  }

  return results;
}
