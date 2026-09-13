create table if not exists public.lab_price_seconds (
  token_address text not null references public.launches(token_address),
  source text not null check (source in ('curve', 'market')),
  observed_second timestamptz not null,
  high_price numeric not null,
  low_price numeric not null,
  close_price numeric not null,
  close_at timestamptz not null,
  close_event_key text not null,
  trade_count integer not null default 1,
  primary key (token_address, source, observed_second)
);

create index if not exists lab_price_seconds_token_time_idx
  on public.lab_price_seconds (token_address, observed_second);

alter table public.lab_price_seconds enable row level security;
revoke all on table public.lab_price_seconds from public, anon, authenticated;
grant select, insert, update on table public.lab_price_seconds to service_role;

insert into public.lab_price_seconds (
  token_address, source, observed_second, high_price, low_price,
  close_price, close_at, close_event_key, trade_count
)
select
  c.token_address,
  'curve',
  date_trunc('second', c.observed_at),
  max(c.unit_price_raw),
  min(c.unit_price_raw),
  (array_agg(c.unit_price_raw order by c.observed_at desc, c.event_id desc))[1],
  max(c.observed_at),
  (array_agg(c.event_id order by c.observed_at desc, c.event_id desc))[1],
  count(*)::integer
from public.lab_funnel_checkpoints c
where c.unit_price_raw > 0
group by c.token_address, date_trunc('second', c.observed_at)
on conflict (token_address, source, observed_second) do nothing;

insert into public.lab_price_seconds (
  token_address, source, observed_second, high_price, low_price,
  close_price, close_at, close_event_key, trade_count
)
select
  md.token_address,
  'market',
  date_trunc('second', md.block_time),
  max(md.price_usd),
  min(md.price_usd),
  (array_agg(md.price_usd order by md.block_time desc, md.market_event_id desc))[1],
  max(md.block_time),
  (array_agg(md.market_event_id order by md.block_time desc, md.market_event_id desc))[1],
  count(*)::integer
from public.trade_market_data md
where md.price_usd > 0
  and md.is_launch_price
  and not md.is_price_outlier
group by md.token_address, date_trunc('second', md.block_time)
on conflict (token_address, source, observed_second) do nothing;

create or replace function public.upsert_curve_lab_price_second()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.unit_price_raw <= 0 then return new; end if;

  insert into public.lab_price_seconds (
    token_address, source, observed_second, high_price, low_price,
    close_price, close_at, close_event_key, trade_count
  ) values (
    new.token_address, 'curve', date_trunc('second', new.observed_at),
    new.unit_price_raw, new.unit_price_raw, new.unit_price_raw,
    new.observed_at, new.event_id, 1
  )
  on conflict (token_address, source, observed_second) do update set
    high_price = greatest(public.lab_price_seconds.high_price, excluded.high_price),
    low_price = least(public.lab_price_seconds.low_price, excluded.low_price),
    close_price = case
      when (excluded.close_at, excluded.close_event_key) >=
           (public.lab_price_seconds.close_at, public.lab_price_seconds.close_event_key)
      then excluded.close_price else public.lab_price_seconds.close_price end,
    close_at = greatest(public.lab_price_seconds.close_at, excluded.close_at),
    close_event_key = case
      when (excluded.close_at, excluded.close_event_key) >=
           (public.lab_price_seconds.close_at, public.lab_price_seconds.close_event_key)
      then excluded.close_event_key else public.lab_price_seconds.close_event_key end,
    trade_count = public.lab_price_seconds.trade_count + 1;
  return new;
end;
$$;

drop trigger if exists zz_lab_checkpoint_upsert_price_second on public.lab_funnel_checkpoints;
create trigger zz_lab_checkpoint_upsert_price_second
after insert on public.lab_funnel_checkpoints
for each row execute function public.upsert_curve_lab_price_second();

create or replace function public.upsert_market_lab_price_second()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.price_usd is null or new.price_usd <= 0 or not new.is_launch_price or new.is_price_outlier then
    return new;
  end if;

  insert into public.lab_price_seconds (
    token_address, source, observed_second, high_price, low_price,
    close_price, close_at, close_event_key, trade_count
  ) values (
    new.token_address, 'market', date_trunc('second', new.block_time),
    new.price_usd, new.price_usd, new.price_usd,
    new.block_time, new.market_event_id, 1
  )
  on conflict (token_address, source, observed_second) do update set
    high_price = greatest(public.lab_price_seconds.high_price, excluded.high_price),
    low_price = least(public.lab_price_seconds.low_price, excluded.low_price),
    close_price = case
      when (excluded.close_at, excluded.close_event_key) >=
           (public.lab_price_seconds.close_at, public.lab_price_seconds.close_event_key)
      then excluded.close_price else public.lab_price_seconds.close_price end,
    close_at = greatest(public.lab_price_seconds.close_at, excluded.close_at),
    close_event_key = case
      when (excluded.close_at, excluded.close_event_key) >=
           (public.lab_price_seconds.close_at, public.lab_price_seconds.close_event_key)
      then excluded.close_event_key else public.lab_price_seconds.close_event_key end,
    trade_count = public.lab_price_seconds.trade_count + 1;
  return new;
end;
$$;

drop trigger if exists zz_market_trade_upsert_lab_price_second on public.trade_market_data;
create trigger zz_market_trade_upsert_lab_price_second
after insert on public.trade_market_data
for each row execute function public.upsert_market_lab_price_second();

revoke execute on function public.upsert_curve_lab_price_second() from public, anon, authenticated;
revoke execute on function public.upsert_market_lab_price_second() from public, anon, authenticated;
grant execute on function public.upsert_curve_lab_price_second() to service_role;
grant execute on function public.upsert_market_lab_price_second() to service_role;

comment on table public.lab_price_seconds is
  'Lossless one-second high, low, close and trade-count summaries used by configurable Lab replays.';
