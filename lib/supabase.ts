import { createClient } from "@supabase/supabase-js";
import { DomainReputation } from "./postmaster";

export type Client = {
  id: string;
  name: string;
  api_key: string;
  sending_domain: string | null;
  created_at: string;
};

export type MetricsSnapshot = {
  id: string;
  client_id: string;
  snapshot_date: string;
  campaign_open_rate: number | null;
  campaign_click_rate: number | null;
  campaign_bounce_rate: number | null;
  campaign_unsub_rate: number | null;
  campaign_spam_rate: number | null;
  flow_open_rate: number | null;
  flow_click_rate: number | null;
  flow_bounce_rate: number | null;
  flow_unsub_rate: number | null;
  flow_spam_rate: number | null;
  created_at: string;
};

export type PostmasterSnapshot = {
  domain: string;
  snapshot_date: string;
  domain_reputation: DomainReputation | null;
  ip_reputation: DomainReputation | null;
  spam_rate: number | null;
  dkim_success_rate: number | null;
  spf_success_rate: number | null;
  dmarc_success_rate: number | null;
};

export type ClientWithMetrics = Client & {
  current: MetricsSnapshot | null;
  previous: MetricsSnapshot | null;
  postmaster: PostmasterSnapshot | null;
};

// Service role client (for server-side API routes only)
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
