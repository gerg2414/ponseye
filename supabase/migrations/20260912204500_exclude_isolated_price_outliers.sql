set statement_timeout = '10min';

alter table public.trade_market_data
  add column if not exists is_price_outlier boolean not null default false;

with buckets as materialized (
  select
    md.token_address,
    date_trunc('second', md.block_time) as bucket_time,
    count(*) as sample_count,
    percentile_cont(0.5) within group (order by md.source_price_usd) as median_price
  from public.trade_market_data md
  where md.is_launch_price
    and md.source_price_usd > 0
  group by md.token_address, date_trunc('second', md.block_time)
), outliers as (
  select md.market_event_id
  from public.trade_market_data md
  join buckets b
    on b.token_address = md.token_address
   and b.bucket_time = date_trunc('second', md.block_time)
  where b.sample_count >= 5
    and (
      md.source_price_usd > b.median_price * 5
      or md.source_price_usd < b.median_price / 5
    )
)
update public.trade_market_data md
set is_price_outlier = true,
    price = null,
    price_usd = null
from outliers o
where o.market_event_id = md.market_event_id;

comment on column public.trade_market_data.is_price_outlier is
  'True when a reported launch-route price differs by more than 5x from the median of at least five trades in the same second. The source price remains retained.';
