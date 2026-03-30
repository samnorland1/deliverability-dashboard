const KLAVIYO_API_VERSION = "2024-10-15";

export type KlaviyoMetrics = {
  campaign_open_rate: number | null;
  campaign_click_rate: number | null;
  campaign_bounce_rate: number | null;
  campaign_unsub_rate: number | null;
  campaign_spam_rate: number | null;
  campaign_emails_sent: number | null;
  flow_open_rate: number | null;
  flow_click_rate: number | null;
  flow_bounce_rate: number | null;
  flow_unsub_rate: number | null;
  flow_spam_rate: number | null;
  flow_emails_sent: number | null;
};

type DateWindow = { start: string; end: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function getDateWindows(): { current: DateWindow; previous: DateWindow } {
  const now = new Date();

  const currentEnd = new Date(now);
  currentEnd.setDate(currentEnd.getDate() - 4); // 3-day buffer so recent campaigns don't skew figures

  const currentStart = new Date(currentEnd);
  currentStart.setDate(currentStart.getDate() - 29);

  const previousEnd = new Date(currentStart);
  previousEnd.setDate(previousEnd.getDate() - 1);

  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - 29);

  return {
    current: { start: formatDate(currentStart), end: formatDate(currentEnd) },
    previous: { start: formatDate(previousStart), end: formatDate(previousEnd) },
  };
}

// Fetch the Placed Order metric ID (required by Klaviyo reporting API)
async function getConversionMetricId(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch("https://a.klaviyo.com/api/metrics/", {
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        Accept: "application/json",
        revision: KLAVIYO_API_VERSION,
      },
    });
    if (!res.ok) {
      console.error("Klaviyo metrics list error:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const metrics: { id: string; attributes: { name: string } }[] = data?.data ?? [];

    const preferred = ["Placed Order", "Ordered Product", "Order Completed", "Active on Site", "Viewed Product"];
    for (const name of preferred) {
      const found = metrics.find(m => m.attributes?.name === name);
      if (found) {
        console.log(`Using conversion metric: ${found.id}:${name}`);
        return found.id;
      }
    }
    const first = metrics[0];
    if (first) {
      console.log(`Using first metric: ${first.id}:${first.attributes?.name}`);
      return first.id;
    }
    return null;
  } catch (err) {
    console.error("Klaviyo metrics fetch error:", err);
    return null;
  }
}

const STATISTICS = [
  "open_rate",
  "click_rate",
  "bounce_rate",
  "unsubscribe_rate",
  "spam_complaint_rate",
  "delivered",
  "opens_unique",
  "clicks_unique",
  "bounced",
  "unsubscribe_uniques",
  "spam_complaints",
];

// Fetch with automatic retry on 429
async function klaviyoFetch(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const waitMs = (i + 1) * 3000; // 3s, 6s, 9s
      console.log(`Klaviyo 429 — waiting ${waitMs}ms before retry ${i + 1}/${retries}`);
      await sleep(waitMs);
      continue;
    }
    return res;
  }
  // Final attempt
  return fetch(url, options);
}

async function fetchKlaviyoReport(
  apiKey: string,
  conversionMetricId: string,
  type: "campaign" | "flow",
  dateWindow: DateWindow
): Promise<Record<string, number | null> | null> {
  const endpoint =
    type === "campaign"
      ? "https://a.klaviyo.com/api/campaign-values-reports/"
      : "https://a.klaviyo.com/api/flow-values-reports/";

  const body = {
    data: {
      type: type === "campaign" ? "campaign-values-report" : "flow-values-report",
      attributes: {
        statistics: STATISTICS,
        timeframe: {
          start: `${dateWindow.start}T00:00:00+00:00`,
          end: `${dateWindow.end}T23:59:59+00:00`,
        },
        conversion_metric_id: conversionMetricId,
      },
    },
  };

  const options: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      revision: KLAVIYO_API_VERSION,
    },
    body: JSON.stringify(body),
  };

  try {
    const res = await klaviyoFetch(endpoint, options);

    if (!res.ok) {
      const text = await res.text();
      console.error(`Klaviyo ${type} report error:`, res.status, text);
      return null;
    }

    const data = await res.json();
    const results = data?.data?.attributes?.results;

    if (!results || results.length === 0) {
      console.log(`Klaviyo ${type}: no results for ${dateWindow.start}–${dateWindow.end}`);
      return null;
    }

    let totalDelivered = 0;
    let totalOpens = 0;
    let totalClicks = 0;
    let totalBounced = 0;
    let totalUnsubs = 0;
    let totalSpam = 0;
    let sumOpenRate = 0;
    let sumClickRate = 0;
    let sumBounceRate = 0;
    let sumUnsubRate = 0;
    let sumSpamRate = 0;
    let rateCount = 0;

    for (const result of results) {
      // Skip SMS campaigns — open tracking doesn't apply and skews email metrics
      if (result.groupings?.send_channel && result.groupings.send_channel !== "email") continue;

      const s = result.statistics || {};
      const delivered = s.delivered ?? 0;
      totalDelivered += delivered;
      totalOpens    += s.opens_unique        ?? 0;
      totalClicks   += s.clicks_unique       ?? 0;
      totalBounced  += s.bounced             ?? 0;
      totalUnsubs   += s.unsubscribe_uniques ?? 0;
      totalSpam     += s.spam_complaints     ?? 0;

      if (s.open_rate != null) { sumOpenRate += s.open_rate; rateCount++; }
      if (s.click_rate != null) sumClickRate += s.click_rate;
      if (s.bounce_rate != null) sumBounceRate += s.bounce_rate;
      if (s.unsubscribe_rate != null) sumUnsubRate += s.unsubscribe_rate;
      if (s.spam_complaint_rate != null) sumSpamRate += s.spam_complaint_rate;
    }

    if (totalDelivered > 0) {
      console.log(`Klaviyo ${type}: delivered=${totalDelivered}, opens=${totalOpens}, spam=${totalSpam}`);
      return {
        open_rate:    totalOpens   / totalDelivered,
        click_rate:   totalClicks  / totalDelivered,
        bounce_rate:  totalBounced / totalDelivered,
        unsub_rate:   totalUnsubs  / totalDelivered,
        spam_rate:    totalSpam    / totalDelivered,
        emails_sent:  totalDelivered,
      };
    } else if (rateCount > 0) {
      return {
        open_rate:    sumOpenRate   / rateCount,
        click_rate:   sumClickRate  / rateCount,
        bounce_rate:  sumBounceRate / rateCount,
        unsub_rate:   sumUnsubRate  / rateCount,
        spam_rate:    sumSpamRate   / rateCount,
        emails_sent:  null,
      };
    }

    return null;
  } catch (err) {
    console.error(`Klaviyo ${type} fetch error:`, err);
    return null;
  }
}

// Fetches metrics for one date window — calls are sequential to avoid rate limits
async function fetchWindowMetrics(
  apiKey: string,
  conversionMetricId: string,
  dateWindow: DateWindow
): Promise<KlaviyoMetrics> {
  // Sequential: campaign first, then flow (with small gap to avoid rate limiting)
  const campaignStats = await fetchKlaviyoReport(apiKey, conversionMetricId, "campaign", dateWindow);
  await sleep(1500);
  const flowStats = await fetchKlaviyoReport(apiKey, conversionMetricId, "flow", dateWindow);

  return {
    campaign_open_rate:   (campaignStats?.open_rate   ?? null) as number | null,
    campaign_click_rate:  (campaignStats?.click_rate  ?? null) as number | null,
    campaign_bounce_rate: (campaignStats?.bounce_rate ?? null) as number | null,
    campaign_unsub_rate:  (campaignStats?.unsub_rate  ?? null) as number | null,
    campaign_spam_rate:   (campaignStats?.spam_rate   ?? null) as number | null,
    campaign_emails_sent: (campaignStats?.emails_sent ?? null) as number | null,
    flow_open_rate:       (flowStats?.open_rate       ?? null) as number | null,
    flow_click_rate:      (flowStats?.click_rate      ?? null) as number | null,
    flow_bounce_rate:     (flowStats?.bounce_rate     ?? null) as number | null,
    flow_unsub_rate:      (flowStats?.unsub_rate      ?? null) as number | null,
    flow_spam_rate:       (flowStats?.spam_rate       ?? null) as number | null,
    flow_emails_sent:     (flowStats?.emails_sent     ?? null) as number | null,
  };
}

export async function fetchAllMetrics(
  apiKey: string,
  dateWindow: DateWindow
): Promise<KlaviyoMetrics> {
  // conversionMetricId is passed in from outside (fetched once per sync, not per call)
  // This function signature kept for compatibility — but we re-fetch here for simplicity
  const conversionMetricId = await getConversionMetricId(apiKey);
  if (!conversionMetricId) {
    console.error("Could not fetch Klaviyo conversion metric ID");
    return {
      campaign_open_rate: null, campaign_click_rate: null,
      campaign_bounce_rate: null, campaign_unsub_rate: null, campaign_spam_rate: null,
      campaign_emails_sent: null,
      flow_open_rate: null, flow_click_rate: null,
      flow_bounce_rate: null, flow_unsub_rate: null, flow_spam_rate: null,
      flow_emails_sent: null,
    };
  }
  return fetchWindowMetrics(apiKey, conversionMetricId, dateWindow);
}

// Optimised entry point: fetches conversion metric ID once, then runs current + previous sequentially
export async function fetchAllMetricsBothWindows(apiKey: string): Promise<{
  current: KlaviyoMetrics;
  previous: KlaviyoMetrics;
  currentDate: string;
  previousDate: string;
}> {
  const { current, previous } = getDateWindows();

  const conversionMetricId = await getConversionMetricId(apiKey);
  if (!conversionMetricId) {
    console.error("Could not fetch Klaviyo conversion metric ID for", apiKey.slice(0, 8));
    const empty: KlaviyoMetrics = {
      campaign_open_rate: null, campaign_click_rate: null,
      campaign_bounce_rate: null, campaign_unsub_rate: null, campaign_spam_rate: null,
      campaign_emails_sent: null,
      flow_open_rate: null, flow_click_rate: null,
      flow_bounce_rate: null, flow_unsub_rate: null, flow_spam_rate: null,
      flow_emails_sent: null,
    };
    return { current: empty, previous: empty, currentDate: current.end, previousDate: previous.end };
  }

  console.log(`Fetching current window: ${current.start} – ${current.end}`);
  const currentMetrics = await fetchWindowMetrics(apiKey, conversionMetricId, current);
  await sleep(2000); // gap between windows
  console.log(`Fetching previous window: ${previous.start} – ${previous.end}`);
  const previousMetrics = await fetchWindowMetrics(apiKey, conversionMetricId, previous);

  return {
    current: currentMetrics,
    previous: previousMetrics,
    currentDate: current.end,
    previousDate: previous.end,
  };
}
