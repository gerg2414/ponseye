alter table public.acquired_positions
  alter column strategy_version set default 'strict-quiet-staggered-protected-v2',
  add column if not exists protection_minute_no integer,
  add column if not exists protection_previous_multiple numeric;

alter table public.acquired_positions
  drop constraint if exists acquired_positions_exit_reason_check,
  add constraint acquired_positions_exit_reason_check check (
    exit_reason = any (array[
      'target'::text,
      'stop'::text,
      'failure_8m'::text,
      'failure_sustained'::text,
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
    'strict-quiet-staggered-protected-v2', 25, 100, 0
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
  next_protection_minute integer;
  next_protection_multiple numeric;
  current_minute integer;
  close_reason text;
begin
  if p_multiple is null or p_multiple <= 0 then return; end if;

  select p.* into position_record
  from public.acquired_positions p
  where p.token_address = p_token_address
    and p.strategy_version in (
      'strict-quiet-staggered-v1',
      'strict-quiet-staggered-protected-v1',
      'strict-quiet-staggered-protected-v2'
    )
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
  next_protection_minute := position_record.protection_minute_no;
  next_protection_multiple := position_record.protection_previous_multiple;
  current_minute := floor(extract(epoch from (p_observed_at - position_record.acquired_at)) / 60)::integer;

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
  elsif next_hit_10x_at is not null
      and next_hit_20x_at is null
      and p_observed_at >= next_hit_10x_at + interval '3 minutes'
      and p_multiple < 3 then
    close_reason := 'post_10x_below_3x';
    next_realised := 2 + 0.8 * p_multiple;
    next_remaining := 0;
  elsif next_hit_10x_at is null
      and p_observed_at >= position_record.acquired_at + interval '8 minutes' then
    if position_record.protection_checked_at is null then
      next_check_at := p_observed_at;
      next_protection_minute := current_minute;
      next_protection_multiple := p_multiple;
      if p_multiple < 1 then
        close_reason := 'failure_8m';
        next_realised := p_multiple;
        next_remaining := 0;
      end if;
    elsif position_record.protection_minute_no is null
        or current_minute > position_record.protection_minute_no then
      if current_minute = position_record.protection_minute_no + 1
          and position_record.protection_previous_multiple < 0.5
          and p_multiple < 0.5 then
        close_reason := 'failure_sustained';
        next_realised := p_multiple;
        next_remaining := 0;
      end if;
      next_protection_minute := current_minute;
      next_protection_multiple := p_multiple;
    end if;
  end if;

  update public.acquired_positions p
  set strategy_version = 'strict-quiet-staggered-protected-v2',
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
      protection_minute_no = next_protection_minute,
      protection_previous_multiple = next_protection_multiple,
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

create temporary table repeated_failure_replay on commit drop as
with positions as (
  select p.*
  from public.acquired_positions p
  where p.position_status = 'open'
    and p.strategy_version in (
      'strict-quiet-staggered-v1',
      'strict-quiet-staggered-protected-v1',
      'strict-quiet-staggered-protected-v2'
    )
), minute_ticks as (
  select distinct on (p.token_address, minute_no.value)
    p.token_address,
    minute_no.value as minute_no,
    s.close_at,
    price.multiple
  from positions p
  join public.lab_price_seconds s
    on s.token_address = p.token_address
   and s.close_at >= p.acquired_at + interval '8 minutes'
   and (p.hit_10x_at is null or s.close_at < p.hit_10x_at)
  cross join lateral (
    select floor(extract(epoch from (s.close_at - p.acquired_at)) / 60)::integer as value
  ) minute_no
  cross join lateral (
    select case
      when s.source = 'curve' and p.entry_unit_price_raw > 0 then s.close_price / p.entry_unit_price_raw
      when s.source = 'market' and p.entry_price_usd > 0 then s.close_price / p.entry_price_usd
    end as multiple
  ) price
  where price.multiple > 0
  order by p.token_address, minute_no.value, s.close_at
), evaluated as (
  select m.*,
    lag(m.minute_no) over (partition by m.token_address order by m.minute_no) as previous_minute_no,
    lag(m.multiple) over (partition by m.token_address order by m.minute_no) as previous_multiple
  from minute_ticks m
), first_exit as (
  select distinct on (e.token_address)
    e.token_address,
    e.close_at as exit_at,
    e.multiple as exit_multiple,
    e.minute_no as exit_minute_no
  from evaluated e
  where e.minute_no = e.previous_minute_no + 1
    and e.previous_multiple < 0.5
    and e.multiple < 0.5
  order by e.token_address, e.close_at
), latest_check as (
  select distinct on (m.token_address)
    m.token_address,
    m.minute_no,
    m.multiple
  from minute_ticks m
  order by m.token_address, m.minute_no desc
)
select
  p.token_address,
  x.exit_at,
  x.exit_multiple,
  coalesce(x.exit_minute_no, l.minute_no) as protection_minute_no,
  case when x.exit_at is not null then x.exit_multiple else l.multiple end as protection_previous_multiple
from positions p
left join first_exit x on x.token_address = p.token_address
left join latest_check l on l.token_address = p.token_address;

update public.acquired_positions p
set strategy_version = 'strict-quiet-staggered-protected-v2',
    protection_minute_no = replay.protection_minute_no,
    protection_previous_multiple = replay.protection_previous_multiple,
    last_position_tick_at = case when replay.exit_at is not null then replay.exit_at else p.last_position_tick_at end,
    realised_return_multiple = case when replay.exit_at is not null then replay.exit_multiple else p.realised_return_multiple end,
    remaining_pct = case when replay.exit_at is not null then 0 else p.remaining_pct end,
    position_status = case when replay.exit_at is not null then 'closed' else p.position_status end,
    closed_at = case when replay.exit_at is not null then replay.exit_at else p.closed_at end,
    exit_price_usd = case when replay.exit_at is not null and p.entry_price_usd is not null
      then p.entry_price_usd * replay.exit_multiple else p.exit_price_usd end,
    exit_market_cap_usd = case when replay.exit_at is not null and p.entry_market_cap_usd is not null
      then p.entry_market_cap_usd * replay.exit_multiple else p.exit_market_cap_usd end,
    exit_reason = case when replay.exit_at is not null then 'failure_sustained' else p.exit_reason end,
    updated_at = now()
from repeated_failure_replay replay
where replay.token_address = p.token_address;

comment on function public.apply_staggered_position_tick(text, timestamptz, numeric) is
  'Tracks staged exits, the eight minute failure check, repeated sub 0.5x failure protection, and post 10x collapse protection.';

comment on table public.acquired_positions is
  'Paper positions using $25 entries, staged exits at 10x, 20x, 50x and 100x, an eight minute failure check, repeated sub 0.5x failure protection, and post 10x collapse protection.';
