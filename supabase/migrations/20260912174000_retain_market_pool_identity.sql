alter table public.trade_market_data
  add column if not exists pool_address text;

create index if not exists trade_market_data_token_pool_time_idx
  on public.trade_market_data(token_address, pool_address, block_time desc);

comment on column public.trade_market_data.pool_address is
  'Bitquery pool address retained so PonsEye can distinguish the canonical graduated pool from secondary swap legs.';
