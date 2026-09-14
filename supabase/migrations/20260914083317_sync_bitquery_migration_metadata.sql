create or replace function public.sync_bitquery_migration_metadata()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  update public.bitquery_migration_test as migration
  set
    name = metadata.name,
    symbol = metadata.symbol,
    image_url = metadata.image_url,
    description = metadata.description,
    twitter_url = metadata.twitter_url,
    telegram_url = metadata.telegram_url,
    discord_url = metadata.discord_url,
    website_url = metadata.website_url,
    farcaster_url = metadata.farcaster_url,
    creator_address = coalesce(migration.creator_address, metadata.creator_address),
    creator_tax_bps = metadata.creator_tax_bps,
    buyback_enabled = metadata.buyback_enabled,
    metadata_updated_at = metadata.updated_at,
    metadata_source = 'bitquery_launch_call'
  from public.bitquery_launch_metadata_test as metadata
  where migration.token_address = metadata.token_address
    and (
      migration.metadata_source is distinct from 'bitquery_launch_call'
      or migration.metadata_updated_at is distinct from metadata.updated_at
    );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.sync_bitquery_migration_metadata() from public, anon, authenticated;
grant execute on function public.sync_bitquery_migration_metadata() to service_role;
