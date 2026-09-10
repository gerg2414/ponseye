create function public.get_dashboard_home(p_limit integer default 200)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'launches', coalesce((
      select jsonb_agg(to_jsonb(recent) order by recent.launched_at desc)
      from (
        select *
        from public.launch_board
        order by launched_at desc
        limit greatest(1, least(p_limit, 200))
      ) recent
    ), '[]'::jsonb),
    'streams', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.feed)
      from (
        select feed, status, last_seen_at
        from public.stream_status
      ) s
    ), '[]'::jsonb),
    'launchCount', (select launch_count from public.dashboard_totals),
    'tradeCount', (select trade_count from public.dashboard_totals)
  );
$$;

revoke execute on function public.get_dashboard_home(integer) from public, anon, authenticated;
grant execute on function public.get_dashboard_home(integer) to service_role;

comment on function public.get_dashboard_home(integer) is
  'Returns the complete PonsEye homepage payload in one bounded database request.';
