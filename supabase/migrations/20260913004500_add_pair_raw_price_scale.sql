alter table public.pair_quote_usd_rates
  add column if not exists raw_scale numeric not null default 1
  check (raw_scale > 0);

with matched_scales as (
  select
    l.pair_token_address,
    percentile_cont(0.5) within group (
      order by md.price / nullif(t.quote_amount_raw / nullif(t.token_amount_raw, 0), 0)
    ) as median_scale
  from public.trades t
  join public.trade_market_data md
    on md.token_address = t.token_address
   and md.transaction_hash = t.transaction_hash
  join public.launches l on l.token_address = t.token_address
  where md.protocol = 'pons_v2'
    and md.price > 0
    and t.quote_amount_raw > 0
    and t.token_amount_raw > 0
    and (
      md.quote_token_address = l.pair_token_address
      or (
        l.pair_token_address = '0x0000000000000000000000000000000000000000'
        and coalesce(md.quote_token_address, '') = ''
      )
    )
  group by l.pair_token_address
), rounded_scales as (
  select
    pair_token_address,
    case
      when median_scale >= 1000
        then power(10::numeric, round(log(10::numeric, median_scale::numeric)))
      else 1::numeric
    end as raw_scale
  from matched_scales
)
update public.pair_quote_usd_rates rates
set raw_scale = scales.raw_scale,
    updated_at = now()
from rounded_scales scales
where scales.pair_token_address is not distinct from rates.pair_token_address;

create or replace function public.get_pair_quote_usd_factor(p_token_address text)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select r.usd_factor * r.raw_scale
  from public.launches l
  join public.pair_quote_usd_rates r
    on r.pair_token_address is not distinct from l.pair_token_address
  where l.token_address = lower(p_token_address);
$$;

revoke execute on function public.get_pair_quote_usd_factor(text)
  from public, anon, authenticated;
grant execute on function public.get_pair_quote_usd_factor(text)
  to service_role;

with affected_tokens as (
  select l.token_address, r.usd_factor * r.raw_scale as raw_usd_factor
  from public.launches l
  join public.pair_quote_usd_rates r
    on r.pair_token_address is not distinct from l.pair_token_address
  where r.raw_scale <> 1
), curve_peaks as (
  select t.token_address,
    max(t.quote_amount_raw / nullif(t.token_amount_raw, 0)) as peak_raw
  from public.trades t
  join affected_tokens affected using (token_address)
  where t.token_amount_raw > 0
  group by t.token_address
), market_peaks as (
  select md.token_address, max(md.price_usd) as peak_usd
  from public.trade_market_data md
  join affected_tokens affected using (token_address)
  where md.price_usd > 0
  group by md.token_address
), exact_peaks as (
  select affected.token_address,
    nullif(greatest(
      coalesce(market.peak_usd, 0),
      coalesce(curve.peak_raw * affected.raw_usd_factor, 0)
    ), 0) as peak_usd
  from affected_tokens affected
  left join curve_peaks curve using (token_address)
  left join market_peaks market using (token_address)
)
update public.launch_metrics metrics
set peak_price_usd = exact.peak_usd,
    updated_at = now()
from exact_peaks exact
where exact.token_address = metrics.token_address;

select public.refresh_ponseye_lab_dataset();

comment on column public.pair_quote_usd_rates.raw_scale is
  'Converts raw quote/token unit ratios into whole-token price ratios before applying the USD quote rate.';

comment on function public.get_pair_quote_usd_factor(text) is
  'Returns the USD multiplier for a raw PONS curve unit price, including quote-token decimal scale.';
