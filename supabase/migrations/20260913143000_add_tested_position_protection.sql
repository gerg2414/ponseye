alter table public.acquired_positions
  alter column strategy_version set default 'strict-quiet-staggered-protected-v1',
  add column if not exists protection_checked_at timestamptz,
  add column if not exists last_position_tick_at timestamptz;

alter table public.acquired_positions
  drop constraint if exists acquired_positions_exit_reason_check,
  add constraint acquired_positions_exit_reason_check check (
    exit_reason = any (array[
      'target'::text,
      'stop'::text,
      'failure_8m'::text,
      'post_10x_below_3x'::text
    ])
  );

create or replace function public.register_acquired_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  entry_price numeric := nullif(new.metrics_snapshot ->> 'price_usd', '')::numeric;
  entry_raw numeric := nullif(new.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric;
  entry_market_cap numeric := nullif(new.metrics_snapshot ->> 'market_cap_usd', '')::numeric;
begin
  if new.stage <> 'target_locked' then return new; end if;
  if entry_market_cap is null and entry_price is not null then entry_market_cap := entry_price * 1000000000::numeric; end if;

  insert into public.acquired_positions (
    token_address, acquired_at, entry_price_usd, entry_unit_price_raw,
    entry_market_cap_usd, peak_price_usd, target_multiple, stop_multiple,
    strategy_version, position_size_usd, remaining_pct, realised_return_multiple
  ) values (
    new.token_address, new.observed_at, entry_price, entry_raw,
    entry_market_cap, entry_price, 100, null,
    'strict-quiet-staggered-protected-v1', 25, 100, 0
  )
  on conflict (token_address) do update set
    entry_price_usd = coalesce(public.acquired_positions.entry_price_usd, excluded.entry_price_usd),
    entry_unit_price_raw = coalesce(public.acquired_positions.entry_unit_price_raw, excluded.entry_unit_price_raw),
    entry_market_cap_usd = coalesce(public.acquired_positions.entry_market_cap_usd, excluded.entry_market_cap_usd),
    updated_at = now();

  return new;
end;
$function$;

revoke execute on function public.register_acquired_position() from public, anon, authenticated;
grant execute on function public.register_acquired_position() to service_role;

create or replace function public.apply_staggered_position_tick(
  p_token_address text,
  p_observed_at timestamptz,
  p_multiple numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  position_record public.acquired_positions%rowtype;
  next_hit_10x_at timestamptz;
  next_hit_20x_at timestamptz;
  next_hit_50x_at timestamptz;
  next_hit_100x_at timestamptz;
  next_realised numeric;
  next_remaining numeric;
  next_check_at timestamptz;
  close_reason text;
begin
  if p_multiple is null or p_multiple <= 0 then return; end if;

  select p.* into position_record
  from public.acquired_positions p
  where p.token_address = p_token_address
    and p.strategy_version in ('strict-quiet-staggered-v1', 'strict-quiet-staggered-protected-v1')
    and p.position_status = 'open'
    and p_observed_at >= p.acquired_at
    and (p.last_position_tick_at is null or p_observed_at >= p.last_position_tick_at)
  for update;

  if not found then return; end if;

  next_hit_10x_at := coalesce(position_record.hit_10x_at, case when p_multiple >= 10 then p_observed_at end);
  next_hit_20x_at := coalesce(position_record.hit_20x_at, case when p_multiple >= 20 then p_observed_at end);
  next_hit_50x_at := coalesce(position_record.hit_50x_at, case when p_multiple >= 50 then p_observed_at end);
  next_hit_100x_at := coalesce(position_record.hit_100x_at, case when p_multiple >= 100 then p_observed_at end);
  next_check_at := position_record.protection_checked_at;

  next_realised :=
    case when next_hit_10x_at is not null then 2 else 0 end +
    case when next_hit_20x_at is not null then 4 else 0 end +
    case when next_hit_50x_at is not null then 25 else 0 end +
    case when next_hit_100x_at is not null then 10 else 0 end;
  next_remaining := 100
    - case when next_hit_10x_at is not null then 20 else 0 end
    - case when next_hit_20x_at is not null then 20 else 0 end
    - case when next_hit_50x_at is not null then 50 else 0 end
    - case when next_hit_100x_at is not null then 10 else 0 end;

  if next_hit_100x_at is not null then
    close_reason := 'target';
  elsif position_record.hit_10x_at is null
      and next_hit_10x_at is null
      and position_record.protection_checked_at is null
      and p_observed_at >= position_record.acquired_at + interval '8 minutes' then
    next_check_at := p_observed_at;
    if p_multiple < 1 then
      close_reason := 'failure_8m';
      next_realised := p_multiple;
      next_remaining := 0;
    end if;
  elsif next_hit_10x_at is not null
      and next_hit_20x_at is null
      and p_observed_at >= next_hit_10x_at + interval '3 minutes'
      and p_multiple < 3 then
    close_reason := 'post_10x_below_3x';
    next_realised := 2 + 0.8 * p_multiple;
    next_remaining := 0;
  end if;

  update public.acquired_positions p
  set strategy_version = 'strict-quiet-staggered-protected-v1',
      peak_price_usd = case when p.entry_price_usd > 0
        then greatest(coalesce(p.peak_price_usd, p.entry_price_usd), p.entry_price_usd * p_multiple)
        else p.peak_price_usd end,
      hit_10x_at = next_hit_10x_at,
      hit_20x_at = next_hit_20x_at,
      hit_50x_at = next_hit_50x_at,
      hit_100x_at = next_hit_100x_at,
      realised_return_multiple = next_realised,
      remaining_pct = next_remaining,
      protection_checked_at = next_check_at,
      last_position_tick_at = p_observed_at,
      position_status = case when close_reason is not null then 'closed' else 'open' end,
      closed_at = case when close_reason is not null then p_observed_at else p.closed_at end,
      exit_price_usd = case when close_reason is not null and p.entry_price_usd is not null
        then p.entry_price_usd * case when close_reason = 'target' then 100 else p_multiple end
        else p.exit_price_usd end,
      exit_market_cap_usd = case when close_reason is not null and p.entry_market_cap_usd is not null
        then p.entry_market_cap_usd * case when close_reason = 'target' then 100 else p_multiple end
        else p.exit_market_cap_usd end,
      exit_reason = coalesce(close_reason, p.exit_reason),
      updated_at = now()
  where p.token_address = p_token_address;
end;
$function$;

revoke execute on function public.apply_staggered_position_tick(text, timestamptz, numeric) from public, anon, authenticated;
grant execute on function public.apply_staggered_position_tick(text, timestamptz, numeric) to service_role;

create temporary table protection_position_replay on commit drop as
with ticks as (
  select
    p.token_address,
    p.acquired_at,
    s.close_at,
    case
      when s.source = 'curve' and p.entry_unit_price_raw > 0 then s.close_price / p.entry_unit_price_raw
      when s.source = 'market' and p.entry_price_usd > 0 then s.close_price / p.entry_price_usd
    end as close_multiple,
    case
      when s.source = 'curve' and p.entry_unit_price_raw > 0 then s.high_price / p.entry_unit_price_raw
      when s.source = 'market' and p.entry_price_usd > 0 then s.high_price / p.entry_price_usd
    end as high_multiple
  from public.acquired_positions p
  join public.lab_price_seconds s
    on s.token_address = p.token_address
   and s.close_at >= p.acquired_at
  where p.strategy_version in ('strict-quiet-staggered-v1', 'strict-quiet-staggered-protected-v1')
    and ((s.source = 'curve' and p.entry_unit_price_raw > 0)
      or (s.source = 'market' and p.entry_price_usd > 0))
), path as (
  select
    p.token_address,
    min(t.close_at) filter (where t.high_multiple >= 10) as hit_10x_at,
    min(t.close_at) filter (where t.high_multiple >= 20) as hit_20x_at,
    min(t.close_at) filter (where t.high_multiple >= 50) as hit_50x_at,
    min(t.close_at) filter (where t.high_multiple >= 100) as hit_100x_at,
    max(t.high_multiple) as peak_multiple,
    max(t.close_at) as last_tick_at
  from public.acquired_positions p
  left join ticks t on t.token_address = p.token_address
  where p.strategy_version in ('strict-quiet-staggered-v1', 'strict-quiet-staggered-protected-v1')
  group by p.token_address
), checked as (
  select path.*, first_check.close_at as protection_checked_at,
    first_check.close_multiple as protection_check_multiple
  from path
  join public.acquired_positions p on p.token_address = path.token_address
  left join lateral (
    select t.close_at, t.close_multiple
    from ticks t
    where t.token_address = path.token_address
      and t.close_at >= p.acquired_at + interval '8 minutes'
    order by t.close_at
    limit 1
  ) first_check on true
), prequalified as (
  select checked.*,
    checked.protection_checked_at is not null
      and checked.protection_check_multiple < 1
      and (checked.hit_10x_at is null or checked.protection_checked_at < checked.hit_10x_at) as failure_8m
  from checked
), protected as (
  select prequalified.*, post_exit.close_at as post_exit_at,
    post_exit.close_multiple as post_exit_multiple
  from prequalified
  left join lateral (
    select t.close_at, t.close_multiple
    from ticks t
    where t.token_address = prequalified.token_address
      and prequalified.hit_10x_at is not null
      and t.close_at >= prequalified.hit_10x_at + interval '3 minutes'
      and (prequalified.hit_20x_at is null or t.close_at < prequalified.hit_20x_at)
      and t.close_multiple < 3
    order by t.close_at
    limit 1
  ) post_exit on not prequalified.failure_8m
)
select * from protected;

update public.acquired_positions p
set strategy_version = 'strict-quiet-staggered-protected-v1',
    target_multiple = 100,
    stop_multiple = null,
    protection_checked_at = replay.protection_checked_at,
    last_position_tick_at = case
      when replay.failure_8m then replay.protection_checked_at
      when replay.post_exit_at is not null then replay.post_exit_at
      when replay.hit_100x_at is not null then replay.hit_100x_at
      else replay.last_tick_at
    end,
    hit_10x_at = case when replay.failure_8m then null else replay.hit_10x_at end,
    hit_20x_at = case when replay.failure_8m or replay.post_exit_at is not null then null else replay.hit_20x_at end,
    hit_50x_at = case when replay.failure_8m or replay.post_exit_at is not null then null else replay.hit_50x_at end,
    hit_100x_at = case when replay.failure_8m or replay.post_exit_at is not null then null else replay.hit_100x_at end,
    realised_return_multiple = case
      when replay.failure_8m then replay.protection_check_multiple
      when replay.post_exit_at is not null then 2 + 0.8 * replay.post_exit_multiple
      else case when replay.hit_10x_at is not null then 2 else 0 end
        + case when replay.hit_20x_at is not null then 4 else 0 end
        + case when replay.hit_50x_at is not null then 25 else 0 end
        + case when replay.hit_100x_at is not null then 10 else 0 end
    end,
    remaining_pct = case
      when replay.failure_8m or replay.post_exit_at is not null then 0
      else 100
        - case when replay.hit_10x_at is not null then 20 else 0 end
        - case when replay.hit_20x_at is not null then 20 else 0 end
        - case when replay.hit_50x_at is not null then 50 else 0 end
        - case when replay.hit_100x_at is not null then 10 else 0 end
    end,
    peak_price_usd = case when p.entry_price_usd > 0 and replay.peak_multiple > 0
      then greatest(coalesce(p.peak_price_usd, p.entry_price_usd), p.entry_price_usd * replay.peak_multiple)
      else p.peak_price_usd end,
    position_status = case
      when replay.failure_8m or replay.post_exit_at is not null or replay.hit_100x_at is not null then 'closed'
      else 'open'
    end,
    closed_at = case
      when replay.failure_8m then replay.protection_checked_at
      when replay.post_exit_at is not null then replay.post_exit_at
      else replay.hit_100x_at
    end,
    exit_price_usd = case
      when replay.failure_8m and p.entry_price_usd is not null then p.entry_price_usd * replay.protection_check_multiple
      when replay.post_exit_at is not null and p.entry_price_usd is not null then p.entry_price_usd * replay.post_exit_multiple
      when replay.hit_100x_at is not null and p.entry_price_usd is not null then p.entry_price_usd * 100
    end,
    exit_market_cap_usd = case
      when replay.failure_8m and p.entry_market_cap_usd is not null then p.entry_market_cap_usd * replay.protection_check_multiple
      when replay.post_exit_at is not null and p.entry_market_cap_usd is not null then p.entry_market_cap_usd * replay.post_exit_multiple
      when replay.hit_100x_at is not null and p.entry_market_cap_usd is not null then p.entry_market_cap_usd * 100
    end,
    exit_reason = case
      when replay.failure_8m then 'failure_8m'
      when replay.post_exit_at is not null then 'post_10x_below_3x'
      when replay.hit_100x_at is not null then 'target'
    end,
    updated_at = now()
from protection_position_replay replay
where replay.token_address = p.token_address;

comment on function public.apply_staggered_position_tick(text, timestamptz, numeric) is
  'Tracks staged exits plus the tested eight minute failure check and the three minute post 10x collapse protection.';
comment on table public.acquired_positions is
  'Paper positions using $25 entries, staged exits at 10x, 20x, 50x and 100x, an eight minute failure check, and post 10x collapse protection.';
