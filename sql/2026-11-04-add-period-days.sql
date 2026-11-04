-- Adds 7 / 30 / 90 day periods to metrics_snapshots.
-- Existing rows become the 30-day period, so nothing on the dashboard is lost.

alter table metrics_snapshots
  add column if not exists period_days integer not null default 30;

-- Swap the old one-snapshot-per-day uniqueness for one per day per period
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    where t.relname = 'metrics_snapshots' and con.contype = 'u'
  loop
    execute format('alter table metrics_snapshots drop constraint %I', c.conname);
  end loop;
end $$;

drop index if exists metrics_snapshots_client_id_snapshot_date_key;
drop index if exists metrics_snapshots_client_id_snapshot_date_idx;

alter table metrics_snapshots
  add constraint metrics_snapshots_client_period_date_key unique (client_id, period_days, snapshot_date);
