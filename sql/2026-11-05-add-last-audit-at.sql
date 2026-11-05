-- Audit checkbox on each dashboard card.
-- Ticked while last_audit_at is within the last 14 days, then it resets on its own.

alter table clients
  add column if not exists last_audit_at timestamptz;
