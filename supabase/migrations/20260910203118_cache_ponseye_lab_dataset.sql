alter function public.get_ponseye_lab_dataset()
  rename to build_ponseye_lab_dataset;

create table public.ponseye_lab_cache (
  cache_key boolean primary key default true check (cache_key),
  payload jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now()
);

alter table public.ponseye_lab_cache enable row level security;
revoke all on table public.ponseye_lab_cache from public, anon, authenticated;
grant select, insert, update on table public.ponseye_lab_cache to service_role;

revoke execute on function public.build_ponseye_lab_dataset() from public, anon, authenticated;
grant execute on function public.build_ponseye_lab_dataset() to service_role;

insert into public.ponseye_lab_cache (cache_key, payload, refreshed_at)
values (true, public.build_ponseye_lab_dataset(), now());

create function public.get_ponseye_lab_dataset()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select cache.payload from public.ponseye_lab_cache cache where cache.cache_key),
    '[]'::jsonb
  );
$$;

revoke execute on function public.get_ponseye_lab_dataset() from public, anon, authenticated;
grant execute on function public.get_ponseye_lab_dataset() to service_role;

create function public.refresh_ponseye_lab_dataset()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  refreshed timestamptz := now();
begin
  insert into public.ponseye_lab_cache (cache_key, payload, refreshed_at)
  values (true, public.build_ponseye_lab_dataset(), refreshed)
  on conflict (cache_key) do update
    set payload = excluded.payload,
        refreshed_at = excluded.refreshed_at;

  return refreshed;
end;
$$;

revoke execute on function public.refresh_ponseye_lab_dataset() from public, anon, authenticated;
grant execute on function public.refresh_ponseye_lab_dataset() to service_role;

comment on table public.ponseye_lab_cache is
  'Cached retrospective PonsEye Lab evidence. Refresh explicitly after a recording session.';

comment on function public.get_ponseye_lab_dataset() is
  'Returns the prepared PonsEye Lab dataset without rebuilding token histories per page request.';

comment on function public.refresh_ponseye_lab_dataset() is
  'Rebuilds the PonsEye Lab dataset from recorded Surveillance evidence.';
