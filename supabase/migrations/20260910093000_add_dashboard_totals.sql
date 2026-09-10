create view public.dashboard_totals
with (security_invoker = true)
as
select
  (select count(*)::integer from public.launches) as launch_count,
  (select coalesce(sum(m.trade_count), 0)::bigint from public.launch_metrics m) as trade_count;

revoke all on table public.dashboard_totals from public, anon, authenticated;
grant select on table public.dashboard_totals to service_role;

comment on view public.dashboard_totals is
  'Fast dashboard counters derived from incremental launch summaries.';
