-- The parsed columns contain everything used by the recorder, dashboard, chart,
-- live exits and lab. These full Bitquery payloads were retained for debugging
-- only and account for almost half of the database's current data volume.
set lock_timeout = '5s';

alter table public.trades
  drop column if exists raw_event;

alter table public.trade_market_data
  drop column if exists raw_trade;
