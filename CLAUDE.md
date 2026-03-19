# Deliverability Dashboard — Project Notes

## Metric Thresholds

These are the benchmarks used to color-code metric values (red/amber/green).

### Campaigns

| Metric    | Poor       | Good         | Great   |
|-----------|------------|--------------|---------|
| Open Rate | < 35%      | 35–40%       | 40%+    |
| Click Rate| < 0.5%     | 0.5–1%       | 1%+     |
| Bounce    | —          | —            | < 0.5%  |
| Unsub     | —          | —            | < 0.3%  |
| Spam      | —          | —            | < 0.02% |

### Flows

| Metric    | Poor       | Good         | Great   |
|-----------|------------|--------------|---------|
| Open Rate | < 35%      | 35–45%       | 45%+    |
| Click Rate| < 1%       | 1–1.5%       | 1.5%+   |
| Bounce    | —          | —            | < 0.5%  |
| Unsub     | —          | —            | < 0.3%  |
| Spam      | —          | —            | < 0.02% |

**Color coding:**
- 🔴 Red = Poor
- 🟡 Amber = Good (middle tier)
- 🟢 Green = Great

Bounce, Unsub, Spam only have two states: green (great) or red (not great). No amber tier.

## Tech Notes

- Next.js 16 uses `proxy.ts` (not `middleware.ts`). Must be named `proxy`.
- Admin and dashboard pages use hardcoded hex colors (NOT CSS variables) to avoid Tailwind v4 color override issues.
- `/api/sync` is the browser-safe sync route (cookie auth). `/api/cron` is for Vercel cron (CRON_SECRET header).
- Klaviyo rate limits: sequential calls only, 1.5s between campaign/flow, 2s between windows.
- `spam_complaint_rate` and `spam_complaints` are valid Klaviyo stat names.
