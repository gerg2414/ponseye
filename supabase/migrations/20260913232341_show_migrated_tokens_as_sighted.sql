update public.gmgn_launches
set research_state = 'sighted',
    updated_at = now()
where lifecycle_stage = 'completed'
  and research_state = 'under_watch';

create or replace view public.gmgn_launch_board
with (security_invoker = true)
as
select
  g.token_address,
  ''::text as curve_address,
  g.name,
  g.symbol,
  g.image_url,
  coalesce(g.creator_address, '') as deployer_address,
  null::text as pair_token_address,
  'graduated'::text as status,
  coalesce(g.completed_at, g.opened_at, g.created_at) as launched_at,
  null::timestamptz as swept_at,
  coalesce(g.completed_at, g.opened_at) as graduated_at,
  g.swaps_24h as trade_count,
  g.buys_24h as buys,
  g.sells_24h as sells,
  0::integer as unique_traders,
  '0'::numeric as net_quote_raw,
  g.last_seen_at as last_trade_at,
  null::numeric as graduation_threshold_raw,
  g.progress_pct,
  g.volume_24h_usd as volume_quote_raw,
  null::numeric as last_quote_amount_raw,
  null::numeric as last_token_amount_raw,
  case when g.initial_market_cap_usd > 0 then g.ath_market_cap_usd / g.initial_market_cap_usd end as peak_multiple,
  case when g.ath_market_cap_usd > 0 then greatest(0, (1 - g.market_cap_usd / g.ath_market_cap_usd) * 100) end as drawdown_from_peak_pct,
  case when g.buys_24h + g.sells_24h > 0 then g.buys_24h::numeric * 100 / (g.buys_24h + g.sells_24h) end as buy_pressure_pct,
  0::integer as creator_trades,
  case when g.creator_token_status = 'creator_close' then 1 else 0 end as creator_sells,
  0::integer as first_minute_buyers,
  null::numeric as largest_buy_quote_raw,
  g.last_seen_at as holder_snapshot_at,
  g.holder_count,
  null::integer as holder_change_5m,
  null::numeric as largest_holder_pct,
  g.top_10_holder_pct,
  null::numeric as top_100_holder_pct,
  g.creator_balance_pct,
  g.price_usd,
  g.volume_24h_usd as volume_usd,
  g.market_cap_usd,
  g.ath_market_cap_usd,
  g.last_seen_at as usd_price_at,
  g.research_state,
  g.last_seen_at as research_state_at,
  'gmgn-migrated-v1'::text as research_rule_version,
  array['gmgn_completed']::text[] as research_reasons
from public.gmgn_launches g
where g.lifecycle_stage = 'completed';

revoke all on public.gmgn_launch_board from public, anon, authenticated;
grant select on public.gmgn_launch_board to service_role;

comment on view public.gmgn_launch_board is
  'GMGN-only PONS migrations. Migration time is the Sighted time used by the dashboard.';
