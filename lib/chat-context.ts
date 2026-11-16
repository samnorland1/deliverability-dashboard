import { SupabaseClient } from "@supabase/supabase-js";
import { MetricsSnapshot, PostmasterSnapshot } from "./supabase";
import { PERIODS } from "./klaviyo";

// Builds a plain-text snapshot of every account's data for the chat assistant.
// Sorted and deterministic so the prompt cache stays warm between questions.

const METRICS: { key: keyof MetricsSnapshot; label: string }[] = [
  { key: "campaign_open_rate", label: "C.open" },
  { key: "campaign_click_rate", label: "C.click" },
  { key: "campaign_bounce_rate", label: "C.bounce" },
  { key: "campaign_unsub_rate", label: "C.unsub" },
  { key: "campaign_spam_rate", label: "C.spam" },
  { key: "flow_open_rate", label: "F.open" },
  { key: "flow_click_rate", label: "F.click" },
  { key: "flow_bounce_rate", label: "F.bounce" },
  { key: "flow_unsub_rate", label: "F.unsub" },
  { key: "flow_spam_rate", label: "F.spam" },
];

function pct(v: unknown, digits = 2): string {
  return typeof v === "number" ? (v * 100).toFixed(digits) + "%" : "—";
}

function avg(vals: (number | null | undefined)[]): number | null {
  const valid = vals.filter((v): v is number => v != null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

// Same formula as the dashboard card score
function score(s: MetricsSnapshot): number {
  const open = avg([s.campaign_open_rate, s.flow_open_rate]) ?? 0;
  const click = avg([s.campaign_click_rate, s.flow_click_rate]) ?? 0;
  const bounce = avg([s.campaign_bounce_rate, s.flow_bounce_rate]) ?? 0;
  const spam = avg([s.campaign_spam_rate, s.flow_spam_rate]) ?? 0;
  const unsub = avg([s.campaign_unsub_rate, s.flow_unsub_rate]) ?? 0;
  if (open === 0 && bounce === 0) return 0;
  return Math.round(
    Math.min(open / 0.35, 1) * 100 * 0.30 +
    Math.min(click / 0.01, 1) * 100 * 0.15 +
    Math.max(1 - bounce / 0.02, 0) * 100 * 0.20 +
    Math.max(1 - spam / 0.001, 0) * 100 * 0.25 +
    Math.max(1 - unsub / 0.005, 0) * 100 * 0.10
  );
}

export async function buildDataContext(supabase: SupabaseClient): Promise<string> {
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, sending_domain, last_audit_at")
    .order("name");
  if (error) throw new Error(error.message);
  if (!clients?.length) return "No accounts are set up yet.";

  const { data: snaps } = await supabase
    .from("metrics_snapshots")
    .select("*")
    .in("client_id", clients.map(c => c.id))
    .order("snapshot_date", { ascending: false });

  // client -> period -> [current, previous]
  const byClient: Record<string, Record<number, MetricsSnapshot[]>> = {};
  for (const s of (snaps ?? []) as MetricsSnapshot[]) {
    const p = ((byClient[s.client_id] ??= {})[s.period_days] ??= []);
    if (p.length < 2) p.push(s);
  }

  const domains = clients.map(c => c.sending_domain).filter(Boolean) as string[];
  const pmByDomain: Record<string, PostmasterSnapshot[]> = {};
  if (domains.length) {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data: pm } = await supabase
      .from("postmaster_snapshots")
      .select("*")
      .in("domain", domains)
      .gte("snapshot_date", since.toISOString().split("T")[0])
      .order("snapshot_date", { ascending: false });
    for (const r of (pm ?? []) as PostmasterSnapshot[]) (pmByDomain[r.domain] ??= []).push(r);
  }

  const header = ["period", "window", "score", ...METRICS.map(m => m.label)].join(" | ");
  const blocks: string[] = [];

  for (const c of clients) {
    const lines: string[] = [`### ${c.name}`];
    lines.push(`Sending domain: ${c.sending_domain ?? "not set"} · Last audit: ${c.last_audit_at ? String(c.last_audit_at).split("T")[0] : "never"}`);

    const periods = byClient[c.id] ?? {};
    if (!Object.keys(periods).length) {
      lines.push("No synced metrics yet.");
    } else {
      lines.push(header);
      for (const days of PERIODS) {
        const [cur, prev] = periods[days] ?? [];
        for (const [label, s] of [["current", cur], ["previous", prev]] as const) {
          if (!s) continue;
          const empty = METRICS.every(m => s[m.key] == null);
          lines.push([`${days}d ${label}`, `to ${s.snapshot_date}`, empty ? "—" : score(s), ...METRICS.map(m => pct(s[m.key]))].join(" | "));
        }
      }
    }

    const pm = c.sending_domain ? pmByDomain[c.sending_domain] : undefined;
    if (pm?.length) {
      const latest = pm[0];
      const mean = (k: keyof PostmasterSnapshot) => avg(pm.map(r => r[k] as number | null));
      lines.push(
        `Google Postmaster (last 30d, latest ${latest.snapshot_date}): domain rep ${pm.find(r => r.domain_reputation)?.domain_reputation ?? "—"}, ` +
        `IP rep ${pm.find(r => r.ip_reputation)?.ip_reputation ?? "—"}, avg spam ${pct(mean("spam_rate"), 3)}, ` +
        `DKIM ${pct(mean("dkim_success_rate"), 1)}, SPF ${pct(mean("spf_success_rate"), 1)}, DMARC ${pct(mean("dmarc_success_rate"), 1)}`
      );
    }
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}

export const SYSTEM_PROMPT = `You are the strategy assistant inside Email Evolution's deliverability dashboard. Email Evolution is an email marketing agency that runs Klaviyo for e-commerce clients. The person chatting with you is the agency owner or a strategist on the team, looking across all client accounts.

Help them query the data and decide what to do: spot problems, compare accounts, explain likely causes, and propose concrete fixes (segmentation, sunsetting, list hygiene, send cadence, subject lines, flow tweaks, authentication). Ground every claim in the numbers below and cite them (account, metric, period). If the data can't answer something (revenue, individual campaigns, list size), say so plainly and suggest how they could find out. Be concise and practical; use short bullet lists and tables where they help.

## How the data works
- Metrics come from Klaviyo's reporting API, synced daily. Each period (7, 30, 90 days) has a "current" window and the "previous" window of the same length just before it. Windows end 4 days ago so recent sends can settle.
- C.* = campaigns, F.* = flows. All rates are percentages of delivered/sent emails.
- "—" means no data (e.g. no flows or campaigns sent in that window).
- Open rates are inflated by Apple Mail Privacy Protection, so treat click rate as the stronger engagement signal.
- Score (0–100) = open 30% (full marks at 35%), click 15% (full at 1%), bounce 20% (zero at 2%), spam 25% (zero at 0.1%), unsub 10% (zero at 0.5%), averaged across campaigns and flows.
- Google Postmaster data only covers Gmail recipients and only for domains with a sending_domain set.

## Benchmarks the dashboard uses
Campaigns: open poor <35%, good 35–40%, great 40%+. Click poor <0.5%, good 0.5–1%, great 1%+.
Flows: open poor <35%, good 35–45%, great 45%+. Click poor <1%, good 1–1.5%, great 1.5%+.
Both: bounce great <0.5%, unsub great <0.3%, spam great <0.02% (anything above is a problem; Gmail's hard ceiling is 0.3%).
Audits are due every 14 days.`;
