"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { ClientWithMetrics, MetricsSnapshot, PostmasterSnapshot } from "@/lib/supabase";
import { DomainReputation } from "@/lib/postmaster";

// ─── Types ────────────────────────────────────────────────────────────────────

type Theme = "dark" | "light";
type Zoom = "compact" | "normal" | "large";
type MetricDef = { key: keyof MetricsSnapshot; label: string; higherIsBetter: boolean };

// ─── Theme tokens ─────────────────────────────────────────────────────────────

const THEMES: Record<Theme, Record<string, string>> = {
  dark: {
    "--bg": "#060608", "--surface": "#0f0f12", "--card": "#15151a",
    "--card-border": "#252530", "--accent": "#3b82f6", "--accent-dim": "rgba(59,130,246,0.1)",
    "--positive": "#22c55e", "--positive-dim": "rgba(34,197,94,0.1)",
    "--warning": "#f59e0b", "--warning-dim": "rgba(245,158,11,0.1)",
    "--negative": "#ef4444", "--negative-dim": "rgba(239,68,68,0.1)",
    "--neutral": "#525252", "--text-primary": "#f0f0f5",
    "--text-secondary": "#b0b0c8", "--text-dim": "#6e6e82",
    "--header-bg": "rgba(6,6,8,0.97)",
    "--card-shadow": "0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
  },
  light: {
    "--bg": "#eceef2", "--surface": "#ffffff", "--card": "#ffffff",
    "--card-border": "#d8dae0", "--accent": "#2563eb", "--accent-dim": "rgba(37,99,235,0.08)",
    "--positive": "#16a34a", "--positive-dim": "rgba(22,163,74,0.08)",
    "--warning": "#d97706", "--warning-dim": "rgba(217,119,6,0.08)",
    "--negative": "#dc2626", "--negative-dim": "rgba(220,38,38,0.08)",
    "--neutral": "#9ca3af", "--text-primary": "#0a0a0a",
    "--text-secondary": "#525252", "--text-dim": "#9ca3af",
    "--header-bg": "rgba(236,238,242,0.97)",
    "--card-shadow": "0 1px 4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)",
  },
};

// ─── Zoom config ──────────────────────────────────────────────────────────────

const ZOOM_CONFIG: Record<Zoom, { minCard: number; labelSize: number; valueSize: number; nameSize: number; scoreSize: number; padding: string }> = {
  compact: { minCard: 240, labelSize: 12, valueSize: 12, nameSize: 13, scoreSize: 20, padding: "10px 12px" },
  normal:  { minCard: 320, labelSize: 14, valueSize: 14, nameSize: 16, scoreSize: 26, padding: "16px" },
  large:   { minCard: 420, labelSize: 15, valueSize: 15, nameSize: 18, scoreSize: 32, padding: "20px" },
};

// ─── Metrics ──────────────────────────────────────────────────────────────────

const CAMPAIGN_METRICS: MetricDef[] = [
  { key: "campaign_open_rate",   label: "Open Rate",  higherIsBetter: true  },
  { key: "campaign_click_rate",  label: "Click Rate", higherIsBetter: true  },
  { key: "campaign_bounce_rate", label: "Bounce",     higherIsBetter: false },
  { key: "campaign_unsub_rate",  label: "Unsub",      higherIsBetter: false },
  { key: "campaign_spam_rate",   label: "Spam",       higherIsBetter: false },
];

const FLOW_METRICS: MetricDef[] = [
  { key: "flow_open_rate",   label: "Open Rate",  higherIsBetter: true  },
  { key: "flow_click_rate",  label: "Click Rate", higherIsBetter: true  },
  { key: "flow_bounce_rate", label: "Bounce",     higherIsBetter: false },
  { key: "flow_unsub_rate",  label: "Unsub",      higherIsBetter: false },
  { key: "flow_spam_rate",   label: "Spam",       higherIsBetter: false },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function avg(vals: (number | null | undefined)[]): number | null {
  const valid = vals.filter(v => v != null) as number[];
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function trendStyle(curr: number | null | undefined, prev: number | null | undefined, higherIsBetter: boolean) {
  if (curr == null || prev == null) return null;
  const d = curr - prev;
  if (Math.abs(d * 100) < 0.05) return { same: true, color: "var(--text-dim)", bg: "transparent", text: "=" };
  const good = higherIsBetter ? d > 0 : d < 0;
  return {
    same: false,
    color: good ? "var(--positive)" : "var(--negative)",
    bg: good ? "var(--positive-dim)" : "var(--negative-dim)",
    text: `${d > 0 ? "↑" : "↓"} ${Math.abs(d * 100).toFixed(1)}pp`,
  };
}

type Rating = "great" | "good" | "poor";

function rateMetric(key: keyof MetricsSnapshot, value: number | null | undefined): Rating | null {
  if (value == null) return null;
  const isCampaign = String(key).startsWith("campaign_");

  if (key.includes("open_rate")) {
    const goodThreshold = isCampaign ? 0.35 : 0.35;
    const greatThreshold = isCampaign ? 0.40 : 0.45;
    if (value >= greatThreshold) return "great";
    if (value >= goodThreshold) return "good";
    return "poor";
  }
  if (key.includes("click_rate")) {
    const goodThreshold = isCampaign ? 0.005 : 0.01;
    const greatThreshold = isCampaign ? 0.01 : 0.015;
    if (value >= greatThreshold) return "great";
    if (value >= goodThreshold) return "good";
    return "poor";
  }
  if (key.includes("bounce_rate")) return value < 0.005 ? "great" : "poor";
  if (key.includes("unsub_rate"))  return value < 0.003 ? "great" : "poor";
  if (key.includes("spam_rate"))   return value < 0.0002 ? "great" : "poor";
  return null;
}

function ratingColor(r: Rating | null): string {
  if (r === "great") return "var(--positive)";
  if (r === "good")  return "var(--warning)";
  if (r === "poor")  return "var(--negative)";
  return "var(--text-primary)";
}

function calcScore(snap: MetricsSnapshot): number {
  const openRate   = avg([snap.campaign_open_rate,   snap.flow_open_rate])   ?? 0;
  const clickRate  = avg([snap.campaign_click_rate,  snap.flow_click_rate])  ?? 0;
  const bounceRate = avg([snap.campaign_bounce_rate, snap.flow_bounce_rate]) ?? 0;
  const spamRate   = avg([snap.campaign_spam_rate,   snap.flow_spam_rate])   ?? 0;
  const unsubRate  = avg([snap.campaign_unsub_rate,  snap.flow_unsub_rate])  ?? 0;
  if (openRate === 0 && bounceRate === 0) return 0;

  const openScore   = Math.min(openRate / 0.35, 1) * 100;
  const clickScore  = Math.min(clickRate / 0.01, 1) * 100;
  const bounceScore = Math.max(1 - bounceRate / 0.02, 0) * 100;
  const spamScore   = Math.max(1 - spamRate / 0.001, 0) * 100;
  const unsubScore  = Math.max(1 - unsubRate / 0.005, 0) * 100;

  return Math.round(openScore * 0.30 + clickScore * 0.15 + bounceScore * 0.20 + spamScore * 0.25 + unsubScore * 0.10);
}

function scoreColor(s: number) {
  if (s >= 75) return "var(--positive)";
  if (s >= 50) return "var(--accent)";
  return "var(--negative)";
}

// ─── Postmaster Reputation ────────────────────────────────────────────────────

function repColor(rep: DomainReputation | null): string {
  if (rep === "HIGH")   return "var(--positive)";
  if (rep === "MEDIUM") return "var(--warning)";
  if (rep === "LOW")    return "#f97316";
  if (rep === "BAD")    return "var(--negative)";
  return "var(--text-dim)";
}

function repLabel(rep: DomainReputation | null): string {
  if (!rep || rep === "REPUTATION_CATEGORY_UNSPECIFIED") return "—";
  return rep.charAt(0) + rep.slice(1).toLowerCase();
}

// Google "G" icon (official brand colours)
function GoogleIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function PostmasterSection({ postmaster, labelSize }: { postmaster: PostmasterSnapshot; labelSize: number }) {
  const domRep = postmaster.domain_reputation;
  const domColor = repColor(domRep);
  const domEmpty = !domRep || domRep === "REPUTATION_CATEGORY_UNSPECIFIED";

  const dmarc = postmaster.dmarc_success_rate;
  const spam  = postmaster.spam_rate;

  return (
    <div style={{ marginTop: "14px", borderTop: "1px solid var(--card-border)" }}>
      {/* Section header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: "10px", marginBottom: "6px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <GoogleIcon />
          <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Postmaster
          </span>
        </div>
        <span style={{ fontSize: "10px", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>30 days</span>
      </div>

      {/* Domain Reputation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--card-border)" }}>
        <span style={{ fontSize: `${labelSize}px`, color: "var(--text-secondary)", minWidth: "76px" }}>Domain Rep</span>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: `${labelSize}px`, fontWeight: 600,
          color: domEmpty ? "var(--text-dim)" : domColor,
          background: domEmpty ? "transparent" : `${domColor}18`,
          padding: "2px 8px", borderRadius: "4px",
          border: domEmpty ? "none" : `1px solid ${domColor}40`,
        }}>
          {repLabel(domRep)}
        </span>
      </div>

      {/* DMARC Success */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--card-border)" }}>
        <span style={{ fontSize: `${labelSize}px`, color: "var(--text-secondary)", minWidth: "76px" }}>DMARC</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: `${labelSize}px`, fontWeight: 600, color: dmarc == null ? "var(--text-dim)" : dmarc >= 0.95 ? "var(--positive)" : dmarc >= 0.85 ? "var(--warning)" : "var(--negative)" }}>
          {dmarc == null ? "—" : (dmarc * 100).toFixed(1) + "%"}
        </span>
      </div>

      {/* Spam Rate */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0" }}>
        <span style={{ fontSize: `${labelSize}px`, color: "var(--text-secondary)", minWidth: "76px" }}>Spam Rate</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: `${labelSize}px`, fontWeight: 600, color: (spam ?? 0) < 0.001 ? "var(--positive)" : (spam ?? 0) < 0.003 ? "var(--warning)" : "var(--negative)" }}>
          {((spam ?? 0) * 100).toFixed(3) + "%"}
        </span>
      </div>
    </div>
  );
}

// ─── Fix Recommendations ──────────────────────────────────────────────────────

const FIXES: Partial<Record<keyof MetricsSnapshot, { poor: string[]; good?: string[] }>> = {
  campaign_open_rate: { poor: [
    "Audit subject lines — test curiosity gaps vs. direct benefit copy",
    "Review send times — try Tue–Thu, 9–11am or 6–8pm for this audience",
    "Suppress contacts with no opens in 90+ days",
    "Ensure preview text extends (not repeats) the subject line",
  ]},
  flow_open_rate: { poor: [
    "Review trigger timing — fire flows when engagement is highest",
    "Check email frequency in the flow — fatigue causes ignore",
    "A/B test subject lines on the entry email",
    "Tighten entry conditions to keep only engaged contacts",
  ]},
  campaign_click_rate: { poor: [
    "Move your primary CTA above the fold — don't make readers scroll",
    "Use a button, not a text link — buttons get 2–3× more clicks",
    "Limit to one clear CTA per email — multiple links split attention",
    "Make the value exchange obvious: what happens when they click?",
  ], good: [
    "Test personalised CTA copy (e.g. 'Shop your size' vs 'Shop now')",
    "Consider adding a secondary CTA for browsers not ready to buy",
  ]},
  flow_click_rate: { poor: [
    "Ensure flow emails are personalised to the specific trigger action",
    "Test plain-text format — high opens + low clicks often means HTML layout is hurting",
    "Add urgency or scarcity where relevant (expiring cart, low stock)",
    "Check mobile rendering — majority of opens happen on mobile",
  ]},
  campaign_bounce_rate: { poor: [
    "Run your list through ZeroBounce or NeverBounce before next send",
    "Add email confirmation (double entry) to your sign-up form",
    "Suppress CSV imports older than 6 months with no engagement",
    "Ensure Klaviyo is auto-suppressing bounced addresses",
  ]},
  flow_bounce_rate: { poor: [
    "Audit how contacts enter this flow — stale sources cause bounces",
    "Run a re-validation on the segment feeding this flow",
    "Check for imported lists used as flow triggers",
  ]},
  campaign_unsub_rate: { poor: [
    "Reduce send frequency — dropping from 3/week to 2/week often cuts unsubs significantly",
    "Segment by engagement and throttle cold segments",
    "Add a preference centre so subscribers can self-select frequency",
    "Review unsubscribe reasons in Klaviyo — they tell you exactly why",
  ]},
  flow_unsub_rate: { poor: [
    "Check total email volume — this flow may push subscribers over their tolerance",
    "Review the value proposition of each email — are they all earning their place?",
    "Add an easy preference option instead of full unsubscribe",
  ]},
  campaign_spam_rate: { poor: [
    "Send only to contacts who opened in the last 60 days immediately",
    "Audit opt-in consent — ensure no pre-ticked boxes in your sign-up",
    "Add an unsubscribe link prominently above the fold, not just footer",
    "Review recent subject lines for misleading or clickbait copy",
  ]},
  flow_spam_rate: { poor: [
    "Reduce flow frequency and remove emails with low engagement",
    "Review the trigger source — poor-quality entry contacts drive spam complaints",
    "Ensure all flow emails have clear unsubscribe options",
  ]},
};

// ─── MetricRow ────────────────────────────────────────────────────────────────

function MetricRow({ def, current, previous, labelSize, valueSize }: {
  def: MetricDef; current: MetricsSnapshot | null; previous: MetricsSnapshot | null;
  labelSize: number; valueSize: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const curr = current?.[def.key] as number | null;
  const prev = previous?.[def.key] as number | null;
  const trend = trendStyle(curr, prev, def.higherIsBetter);
  const rating = rateMetric(def.key, curr);
  const valueColor = curr == null ? "var(--text-dim)" : ratingColor(rating);

  const fixes = FIXES[def.key];
  const tips = rating === "poor" ? fixes?.poor : rating === "good" ? fixes?.good : undefined;
  const hasFixes = tips && tips.length > 0;

  return (
    <div style={{ borderBottom: "1px solid var(--card-border)" }}>
      <div
        onClick={() => hasFixes && setExpanded(e => !e)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", cursor: hasFixes ? "pointer" : "default" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          {hasFixes && (
            <span style={{ fontSize: "9px", color: rating === "poor" ? "var(--negative)" : "var(--warning)", lineHeight: 1, transition: "transform 0.15s", display: "inline-block", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
          )}
          <span style={{ fontSize: `${labelSize}px`, color: "var(--text-secondary)", minWidth: hasFixes ? "70px" : "76px" }}>{def.label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: `${valueSize}px`, fontWeight: 600, color: valueColor, minWidth: "50px", textAlign: "right" }}>
            {fmt(curr)}
          </span>
          {trend ? (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: `${Math.max(valueSize - 2, 10)}px`, color: trend.color, background: trend.bg, padding: "2px 6px", borderRadius: "4px", minWidth: "62px", textAlign: "center", fontWeight: 500 }}>
              {trend.text}
            </span>
          ) : <span style={{ minWidth: "62px" }} />}
        </div>
      </div>
      {expanded && tips && (
        <div style={{ padding: "8px 10px 10px", background: rating === "poor" ? "rgba(239,68,68,0.04)" : "rgba(245,158,11,0.04)", borderRadius: "6px", marginBottom: "4px" }}>
          <div style={{ fontSize: "10px", fontWeight: 600, color: rating === "poor" ? "var(--negative)" : "var(--warning)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            How to fix
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 14px" }}>
            {tips.map((tip, i) => (
              <li key={i} style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: "1.5", marginBottom: "3px" }}>{tip}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Priorities Panel ─────────────────────────────────────────────────────────

type Priority = { clientName: string; label: string; value: string; severity: number; color: string };

const SEVERITY: Partial<Record<keyof MetricsSnapshot, number>> = {
  campaign_spam_rate: 1, flow_spam_rate: 1,
  campaign_bounce_rate: 2, flow_bounce_rate: 2,
  campaign_unsub_rate: 3, flow_unsub_rate: 3,
  flow_open_rate: 4, campaign_open_rate: 5,
  flow_click_rate: 6, campaign_click_rate: 7,
};

const METRIC_LABEL: Partial<Record<keyof MetricsSnapshot, string>> = {
  campaign_spam_rate: "Campaign Spam", flow_spam_rate: "Flow Spam",
  campaign_bounce_rate: "Campaign Bounce", flow_bounce_rate: "Flow Bounce",
  campaign_unsub_rate: "Campaign Unsub", flow_unsub_rate: "Flow Unsub",
  campaign_open_rate: "Campaign Open Rate", flow_open_rate: "Flow Open Rate",
  campaign_click_rate: "Campaign Click Rate", flow_click_rate: "Flow Click Rate",
};

function buildPriorities(clients: ClientWithMetrics[]): Priority[] {
  const items: Priority[] = [];
  const allMetrics = [...CAMPAIGN_METRICS, ...FLOW_METRICS];

  for (const client of clients) {
    if (!client.current || client.id.startsWith("demo-")) continue;
    for (const def of allMetrics) {
      const val = client.current[def.key] as number | null;
      const rating = rateMetric(def.key, val);
      if (rating !== "poor") continue;
      const sev = SEVERITY[def.key] ?? 9;
      items.push({
        clientName: client.name,
        label: METRIC_LABEL[def.key] ?? def.label,
        value: fmt(val),
        severity: sev,
        color: sev <= 1 ? "var(--negative)" : sev <= 3 ? "#f97316" : "var(--warning)",
      });
    }
    // Postmaster domain rep
    if (client.postmaster?.domain_reputation === "BAD" || client.postmaster?.domain_reputation === "LOW") {
      items.push({ clientName: client.name, label: "Domain Reputation", value: repLabel(client.postmaster.domain_reputation), severity: 0, color: "var(--negative)" });
    }
  }

  return items.sort((a, b) => a.severity - b.severity);
}

function PrioritiesPanel({ clients, tok }: { clients: ClientWithMetrics[]; tok: Record<string, string> }) {
  const [open, setOpen] = useState(true);
  const priorities = buildPriorities(clients);
  if (priorities.length === 0) return null;

  return (
    <div style={{ maxWidth: "1600px", margin: "0 auto", padding: "12px 20px 0" }}>
      <div style={{ background: tok["--surface"], border: `1px solid ${tok["--card-border"]}`, borderRadius: "10px", overflow: "hidden" }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", background: "none", border: "none", cursor: "pointer",
            color: tok["--text-primary"],
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--negative)" }}>⚠</span>
            <span style={{ fontSize: "12px", fontWeight: 600, color: tok["--text-primary"] }}>
              Priorities to fix
            </span>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "white", background: "var(--negative)", borderRadius: "10px", padding: "1px 7px", lineHeight: "1.5" }}>
              {priorities.length}
            </span>
          </div>
          <span style={{ fontSize: "11px", color: tok["--text-dim"], transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>▼</span>
        </button>

        {open && (
          <div style={{ borderTop: `1px solid ${tok["--card-border"]}`, padding: "8px 14px 12px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {priorities.map((p, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "5px 10px", borderRadius: "6px",
                background: `${p.color}10`, border: `1px solid ${p.color}30`,
              }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: tok["--text-primary"] }}>{p.clientName}</span>
                <span style={{ fontSize: "11px", color: tok["--text-secondary"] }}>—</span>
                <span style={{ fontSize: "11px", color: p.color, fontWeight: 500 }}>{p.label}</span>
                <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: p.color, fontWeight: 700 }}>{p.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ClientLogo ───────────────────────────────────────────────────────────────

function ClientLogo({ domain, size }: { domain: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(null);
    setFailed(false);
    fetch(`/api/logo?domain=${encodeURIComponent(domain)}`)
      .then(r => r.json())
      .then(d => { if (d.url) setSrc(d.url); else setFailed(true); })
      .catch(() => setFailed(true));
  }, [domain]);

  if (failed || src === null) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        objectFit: "contain",
        flexShrink: 0,
        filter: "grayscale(1)",
        opacity: 0.65,
      }}
    />
  );
}

// ─── ClientCard ───────────────────────────────────────────────────────────────

function ClientCard({ client, index, zoom, isDemo, isDragging, isOver, onDragStart, onDragEnter, onDragEnd }: {
  client: ClientWithMetrics; index: number; zoom: Zoom; isDemo: boolean;
  isDragging: boolean; isOver: boolean;
  onDragStart: () => void; onDragEnter: () => void; onDragEnd: () => void;
}) {
  const z = ZOOM_CONFIG[zoom];
  const score = client.current ? calcScore(client.current) : null;
  const prevScore = client.previous ? calcScore(client.previous) : null;
  const scoreDelta = score != null && prevScore != null ? score - prevScore : null;
  const isCompact = zoom === "compact";
  const [scoreOpen, setScoreOpen] = useState(false);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDragOver={e => e.preventDefault()}
      style={{
        background: "var(--card)",
        border: `1px solid ${isOver ? "var(--accent)" : "var(--card-border)"}`,
        borderTop: `3px solid ${score == null ? "var(--card-border)" : scoreColor(score)}`,
        borderRadius: "12px",
        opacity: isDragging ? 0.4 : 1,
        cursor: "grab",
        boxShadow: "var(--card-shadow)",
        transition: "transform 0.15s, opacity 0.15s, border-color 0.15s, box-shadow 0.15s",
        transform: isOver ? "scale(1.01)" : "scale(1)",
      }}
    >
      {/* Header */}
      <div style={{ padding: z.padding, borderBottom: "1px solid var(--card-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          {/* Client logo */}
          {client.sending_domain && !isDemo && (
            <ClientLogo domain={client.sending_domain} size={zoom === "large" ? 64 : zoom === "normal" ? 52 : 40} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: `${z.nameSize}px`, fontWeight: 600, color: "var(--text-primary)", marginBottom: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {client.name}
              {isDemo && <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 500, color: "var(--text-dim)", background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: "4px", padding: "1px 5px" }}>demo</span>}
            </div>
            {client.current?.snapshot_date && (
              <div style={{ fontSize: "11px", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                {(() => {
                  const end = new Date(); end.setDate(end.getDate() - 3);
                  const start = new Date(end); start.setDate(start.getDate() - 29);
                  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  return `${fmt(start)} – ${fmt(end)}`;
                })()}
              </div>
            )}
          </div>
        </div>

        {score != null && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); setScoreOpen(o => !o); }}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "right" }}
            >
              <div style={{ fontSize: `${z.scoreSize}px`, fontWeight: 700, fontFamily: "var(--font-mono)", lineHeight: 1, color: scoreColor(score) }}>
                {score}
              </div>
              <div style={{ fontSize: "10px", color: "var(--text-dim)", marginTop: "2px", display: "flex", alignItems: "center", gap: "3px", justifyContent: "flex-end" }}>
                <span>score</span>
                {scoreDelta != null && Math.abs(scoreDelta) >= 1 && (
                  <span style={{ color: scoreDelta > 0 ? "var(--positive)" : "var(--negative)", fontFamily: "var(--font-mono)", fontSize: "10px" }}>
                    {scoreDelta > 0 ? "↑" : "↓"}{Math.abs(scoreDelta)}
                  </span>
                )}
                <span style={{ color: "var(--text-dim)", fontSize: "9px", marginLeft: "1px" }}>{scoreOpen ? "▲" : "▼"}</span>
              </div>
            </button>

            {scoreOpen && client.current && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 20,
                  background: "var(--surface)", border: "1px solid var(--card-border)",
                  borderRadius: "12px", padding: "18px 20px", width: "280px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "16px" }}>Score breakdown</div>
                {[
                  { label: "Open Rate",   weight: "30%", threshold: "Max at 35%+",   value: Math.min((avg([client.current.campaign_open_rate,   client.current.flow_open_rate])   ?? 0) / 0.35,  1) * 100, pts: Math.round(Math.min((avg([client.current.campaign_open_rate,   client.current.flow_open_rate])   ?? 0) / 0.35,  1) * 30) },
                  { label: "Click Rate",  weight: "15%", threshold: "Max at 1%+",    value: Math.min((avg([client.current.campaign_click_rate,  client.current.flow_click_rate])  ?? 0) / 0.01,  1) * 100, pts: Math.round(Math.min((avg([client.current.campaign_click_rate,  client.current.flow_click_rate])  ?? 0) / 0.01,  1) * 15) },
                  { label: "Bounce Rate", weight: "20%", threshold: "Max at < 0.5%", value: Math.max(1 - (avg([client.current.campaign_bounce_rate, client.current.flow_bounce_rate]) ?? 0) / 0.02,  0) * 100, pts: Math.round(Math.max(1 - (avg([client.current.campaign_bounce_rate, client.current.flow_bounce_rate]) ?? 0) / 0.02,  0) * 20) },
                  { label: "Spam Rate",   weight: "25%", threshold: "Max at < 0.1%", value: Math.max(1 - (avg([client.current.campaign_spam_rate,   client.current.flow_spam_rate])   ?? 0) / 0.001, 0) * 100, pts: Math.round(Math.max(1 - (avg([client.current.campaign_spam_rate,   client.current.flow_spam_rate])   ?? 0) / 0.001, 0) * 25) },
                  { label: "Unsub Rate",  weight: "10%", threshold: "Max at < 0.5%", value: Math.max(1 - (avg([client.current.campaign_unsub_rate,  client.current.flow_unsub_rate])  ?? 0) / 0.005, 0) * 100, pts: Math.round(Math.max(1 - (avg([client.current.campaign_unsub_rate,  client.current.flow_unsub_rate])  ?? 0) / 0.005, 0) * 10) },
                ].map(row => (
                  <div key={row.label} style={{ marginBottom: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                      <div>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{row.label}</span>
                        <span style={{ fontSize: "11px", color: "var(--text-dim)", marginLeft: "6px" }}>{row.weight} weight</span>
                        <div style={{ fontSize: "11px", color: "var(--positive)", marginTop: "3px" }}>{row.threshold}</div>
                      </div>
                      <span style={{ fontSize: "15px", fontWeight: 700, fontFamily: "var(--font-mono)", color: row.value >= 75 ? "var(--positive)" : row.value >= 50 ? "var(--accent)" : "var(--negative)" }}>{row.pts} pts</span>
                    </div>
                    <div style={{ height: "5px", borderRadius: "3px", background: "var(--card-border)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(row.value, 100)}%`, background: row.value >= 75 ? "var(--positive)" : row.value >= 50 ? "var(--accent)" : "var(--negative)", borderRadius: "3px", transition: "width 0.3s" }} />
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid var(--card-border)", marginTop: "4px", paddingTop: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Total</span>
                  <span style={{ fontSize: "16px", fontWeight: 700, fontFamily: "var(--font-mono)", color: scoreColor(score) }}>{score} / 100</span>
                </div>
                <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.5 }}>All metrics averaged across campaigns + flows.</div>
              </div>
            )}
          </div>
        )}
      </div>

      {!client.current ? (
        <div style={{ padding: "24px", textAlign: "center", color: "var(--text-dim)", fontSize: "13px" }}>Run a sync to load data</div>
      ) : (
        <div style={{ padding: `0 ${z.padding.split(" ")[1] ?? "16px"}`, paddingTop: "12px", paddingBottom: "14px" }}>
          <div style={{ marginBottom: isCompact ? 0 : "12px" }}>
            <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "4px" }}>Campaigns</div>
            {CAMPAIGN_METRICS.map(def => (
              <MetricRow key={def.key} def={def} current={client.current} previous={client.previous} labelSize={z.labelSize} valueSize={z.valueSize} />
            ))}
          </div>
          {!isCompact && (
            <div style={{ paddingTop: "10px" }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "4px" }}>Flows</div>
              {FLOW_METRICS.map(def => (
                <MetricRow key={def.key} def={def} current={client.current} previous={client.previous} labelSize={z.labelSize} valueSize={z.valueSize} />
              ))}
            </div>
          )}
          {!isCompact && client.postmaster && (
            <PostmasterSection postmaster={client.postmaster} labelSize={z.labelSize} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [clients, setClients] = useState<ClientWithMetrics[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [zoom, setZoom] = useState<Zoom>("normal");
  const [search, setSearch] = useState("");
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load preferences from localStorage
  useEffect(() => {
    const t = localStorage.getItem("dd-theme") as Theme | null;
    const z = localStorage.getItem("dd-zoom") as Zoom | null;
    const o = localStorage.getItem("dd-order");
    if (t) setTheme(t);
    if (z) setZoom(z);
    if (o) setOrder(JSON.parse(o));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load");
      const data: ClientWithMetrics[] = await res.json();
      setClients(data);
      setIsDemo(data.length > 0 && data[0].id.startsWith("demo-"));
      setLastSync(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sorted + filtered clients
  const sortedClients = order.length
    ? [...clients].sort((a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
    : clients;

  const filtered = search.trim()
    ? sortedClients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : sortedClients;

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("dd-theme", next);
  }

  function setZoomSave(z: Zoom) {
    setZoom(z);
    localStorage.setItem("dd-zoom", z);
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/sync");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Sync failed");
      } else {
        await load();
      }
    } catch {
      setError("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  // Drag handlers
  function handleDragStart(i: number) { setDragIndex(i); }
  function handleDragEnter(i: number) { setOverIndex(i); }
  function handleDragEnd() {
    if (dragIndex != null && overIndex != null && dragIndex !== overIndex) {
      const newOrder = filtered.map(c => c.id);
      const [moved] = newOrder.splice(dragIndex, 1);
      newOrder.splice(overIndex, 0, moved);
      setOrder(newOrder);
      localStorage.setItem("dd-order", JSON.stringify(newOrder));
    }
    setDragIndex(null);
    setOverIndex(null);
  }

  const synced = clients.filter(c => c.current && !c.id.startsWith("demo-")).length;
  const tok = THEMES[theme];

  return (
    <div style={{ minHeight: "100vh", background: tok["--bg"], color: tok["--text-primary"], fontFamily: "var(--font-ui)", ...Object.fromEntries(Object.entries(tok).map(([k, v]) => [k, v])) }}>
      <style>{`
        @media (max-width: 640px) {
          .dd-search { display: none !important; }
          .dd-stats { display: none !important; }
          .dd-lastsync { display: none !important; }
          .dd-zoom { display: none !important; }
          .dd-signout { display: none !important; }
          .dd-header-inner { gap: 8px !important; }
          .dd-main { padding: 12px 12px 60px !important; }
          .dd-legend { padding: 8px 12px !important; flex-wrap: wrap; gap: 8px !important; }
        }
      `}</style>
      {/* Header */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, background: tok["--header-bg"], backdropFilter: "blur(8px)", borderBottom: `1px solid ${tok["--card-border"]}` }}>
        <div className="dd-header-inner" style={{ maxWidth: "1600px", margin: "0 auto", padding: "0 20px", height: "54px", display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={theme === "light" ? "/logo-light.png" : "/logo.png"} alt="Email Evolution" style={{ height: "28px", width: "auto", objectFit: "contain" }} />
          </div>

          {/* Search */}
          <div className="dd-search" style={{ flex: 1, maxWidth: "300px", position: "relative" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: tok["--text-dim"] }}>
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
              <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search accounts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: "100%", padding: "7px 12px 7px 32px",
                borderRadius: "7px", background: tok["--surface"],
                border: `1px solid ${tok["--card-border"]}`,
                color: tok["--text-primary"], fontSize: "13px",
                fontFamily: "var(--font-ui)", outline: "none",
              }}
              onFocus={e => (e.target.style.borderColor = tok["--accent"])}
              onBlur={e => (e.target.style.borderColor = tok["--card-border"])}
            />
          </div>

          {/* Stats */}
          {!loading && !isDemo && (
            <span className="dd-stats" style={{ padding: "3px 10px", borderRadius: "20px", background: tok["--surface"], border: `1px solid ${tok["--card-border"]}`, fontSize: "12px", color: tok["--text-secondary"], flexShrink: 0 }}>
              {clients.length} accounts · {synced} synced
            </span>
          )}

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
            {lastSync && <span className="dd-lastsync" style={{ fontSize: "11px", color: tok["--text-dim"], fontFamily: "var(--font-mono)", flexShrink: 0 }}>{lastSync.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>}

            {/* Zoom */}
            <div className="dd-zoom" style={{ display: "flex", borderRadius: "7px", overflow: "hidden", border: `1px solid ${tok["--card-border"]}`, flexShrink: 0 }}>
              {(["compact", "normal", "large"] as Zoom[]).map(z => (
                <button key={z} onClick={() => setZoomSave(z)} style={{ padding: "5px 10px", background: zoom === z ? tok["--accent"] : tok["--surface"], border: "none", color: zoom === z ? "white" : tok["--text-secondary"], fontSize: "11px", fontWeight: zoom === z ? 600 : 400, cursor: "pointer", transition: "all 0.15s", textTransform: "capitalize" }}>
                  {z === "compact" ? "S" : z === "normal" ? "M" : "L"}
                </button>
              ))}
            </div>

            {/* Theme toggle */}
            <button onClick={toggleTheme} style={{ padding: "6px 8px", borderRadius: "7px", background: tok["--surface"], border: `1px solid ${tok["--card-border"]}`, color: tok["--text-secondary"], cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {theme === "dark" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </button>

            {!isDemo && (
              <button onClick={handleSync} disabled={syncing} style={{ padding: "6px 14px", borderRadius: "7px", background: syncing ? tok["--surface"] : tok["--accent"], border: `1px solid ${syncing ? tok["--card-border"] : "transparent"}`, color: syncing ? tok["--text-secondary"] : "white", fontSize: "13px", fontWeight: 600, cursor: syncing ? "not-allowed" : "pointer", transition: "all 0.15s", flexShrink: 0 }}>
                {syncing ? "Syncing…" : "Sync Now"}
              </button>
            )}

            <Link href="/admin" style={{ padding: "6px 14px", borderRadius: "7px", background: tok["--surface"], border: `1px solid ${tok["--card-border"]}`, color: tok["--text-secondary"], fontSize: "13px", fontWeight: 500, textDecoration: "none", flexShrink: 0 }}>
              {isDemo ? "Add Accounts" : "Accounts"}
            </Link>

            <button className="dd-signout" onClick={async () => { await fetch("/api/auth", { method: "DELETE" }); window.location.href = "/login"; }} style={{ padding: "6px 12px", borderRadius: "7px", background: "transparent", border: `1px solid ${tok["--card-border"]}`, color: tok["--text-dim"], fontSize: "13px", cursor: "pointer", flexShrink: 0 }}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Demo banner */}
      {isDemo && (
        <div style={{ background: `${tok["--accent-dim"]}`, borderBottom: `1px solid ${tok["--accent"]}30`, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}>
          <span style={{ fontSize: "13px", color: tok["--accent"] }}>
            👋 Demo data — showing what your dashboard will look like.
          </span>
          <Link href="/admin" style={{ fontSize: "13px", fontWeight: 600, color: tok["--accent"], textDecoration: "underline" }}>Add real accounts →</Link>
        </div>
      )}

      {/* Legend / Key */}
      <div style={{ position: "sticky", top: "54px", zIndex: 40, background: tok["--header-bg"], backdropFilter: "blur(8px)", borderBottom: `1px solid ${tok["--card-border"]}` }}>
        <div className="dd-legend" style={{ maxWidth: "1600px", margin: "0 auto", padding: "8px 20px", display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
          {/* Metric color key */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {[
              { c: tok["--positive"], l: "Great" },
              { c: tok["--warning"],  l: "Good"  },
              { c: tok["--negative"], l: "Poor"  },
            ].map(({ c, l }) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c }} />
                <span style={{ fontSize: "11px", color: tok["--text-secondary"] }}>{l}</span>
              </div>
            ))}
          </div>

          <div style={{ width: "1px", height: "14px", background: tok["--card-border"] }} />

          {/* Score key */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setScoreInfoOpen(o => !o)}
              style={{
                background: scoreInfoOpen ? `rgba(59,130,246,0.12)` : "rgba(255,255,255,0.05)",
                border: `1px solid ${scoreInfoOpen ? tok["--accent"] : tok["--card-border"]}`,
                borderRadius: "7px",
                cursor: "pointer",
                padding: "5px 10px",
                display: "flex", alignItems: "center", gap: "10px",
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: "12px", fontWeight: 600, color: tok["--text-secondary"] }}>Score <span style={{ fontSize: "10px", color: tok["--accent"] }}>{scoreInfoOpen ? "▲" : "▼"}</span></span>
              {[{ c: tok["--positive"], l: "75–100" }, { c: tok["--accent"], l: "50–74" }, { c: tok["--negative"], l: "0–49" }].map(({ c, l }) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <div style={{ width: "10px", height: "3px", background: c, borderRadius: "2px" }} />
                  <span style={{ fontSize: "11px", color: tok["--text-secondary"] }}>{l}</span>
                </div>
              ))}
            </button>
            {scoreInfoOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 10px)", left: 0, zIndex: 100,
                background: tok["--surface"], border: `1px solid ${tok["--card-border"]}`,
                borderRadius: "10px", padding: "14px 16px", width: "280px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: tok["--text-primary"], marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.06em" }}>How the score is calculated</div>
                {[
                  { label: "Open Rate",   weight: 30, desc: "Average across campaigns + flows",            threshold: "Max at 35%+"   },
                  { label: "Spam Rate",   weight: 25, desc: "Lower is better — critical for inbox placement", threshold: "Max at < 0.1%" },
                  { label: "Bounce Rate", weight: 20, desc: "Lower is better — penalises hard bounces",     threshold: "Max at < 0.5%" },
                  { label: "Click Rate",  weight: 15, desc: "Average across campaigns + flows",            threshold: "Max at 1%+"    },
                  { label: "Unsub Rate",  weight: 10, desc: "Lower is better — signals audience health",   threshold: "Max at < 0.5%" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px", gap: "12px" }}>
                    <div>
                      <div style={{ fontSize: "14px", color: tok["--text-primary"], fontWeight: 600 }}>{row.label}</div>
                      <div style={{ fontSize: "12px", color: tok["--text-dim"], marginTop: "2px" }}>{row.desc}</div>
                      <div style={{ fontSize: "12px", color: tok["--positive"], marginTop: "2px" }}>{row.threshold}</div>
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 700, fontFamily: "var(--font-mono)", color: tok["--accent"], flexShrink: 0 }}>{row.weight}% weight</div>
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${tok["--card-border"]}`, marginTop: "10px", paddingTop: "10px", fontSize: "12px", color: tok["--text-dim"], lineHeight: 1.5 }}>
                  All metrics averaged across campaigns + flows. Score is out of 100.
                </div>
              </div>
            )}
          </div>

          <div style={{ width: "1px", height: "14px", background: tok["--card-border"] }} />
          <span style={{ fontSize: "11px", color: tok["--text-dim"] }}>vs. previous 30 days</span>

          {search && <span style={{ marginLeft: "auto", fontSize: "12px", color: tok["--text-dim"] }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>}
          {!search && <span style={{ marginLeft: "auto", fontSize: "11px", color: tok["--text-dim"] }}>Drag cards to reorder</span>}
        </div>
      </div>

      {/* Priorities */}
      {!loading && !isDemo && <PrioritiesPanel clients={clients} tok={tok} />}

      {/* Grid */}
      <main className="dd-main" style={{ maxWidth: "1600px", margin: "0 auto", padding: "20px 20px 60px" }}>
        {error && <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "8px", background: tok["--negative-dim"], border: `1px solid rgba(239,68,68,0.2)`, color: tok["--negative"], fontSize: "14px" }}>{error}</div>}

        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${ZOOM_CONFIG[zoom].minCard}px, 1fr))`, gap: "16px" }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ height: "340px", borderRadius: "10px", background: tok["--card"], border: `1px solid ${tok["--card-border"]}`, opacity: 0.4 }} />)}
          </div>
        ) : filtered.length === 0 && search ? (
          <div style={{ textAlign: "center", padding: "60px 24px", color: tok["--text-secondary"], fontSize: "14px" }}>
            No accounts matching &quot;{search}&quot;
          </div>
        ) : clients.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 24px" }}>
            <p style={{ fontSize: "16px", fontWeight: 600, color: tok["--text-primary"], marginBottom: "8px" }}>No accounts added yet</p>
            <p style={{ fontSize: "14px", color: tok["--text-secondary"], marginBottom: "20px" }}>Add your Klaviyo client accounts to start monitoring.</p>
            <Link href="/admin" style={{ display: "inline-block", padding: "10px 24px", borderRadius: "8px", background: tok["--accent"], color: "white", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>Add Account</Link>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${ZOOM_CONFIG[zoom].minCard}px, 1fr))`, gap: "16px" }}>
            {filtered.map((c, i) => (
              <ClientCard
                key={c.id} client={c} index={i} zoom={zoom} isDemo={isDemo}
                isDragging={dragIndex === i} isOver={overIndex === i}
                onDragStart={() => handleDragStart(i)}
                onDragEnter={() => handleDragEnter(i)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
