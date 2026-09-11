create table public.recorder_control (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);

alter table public.recorder_control enable row level security;
revoke all on table public.recorder_control from public, anon, authenticated;
grant select, update on table public.recorder_control to service_role;

insert into public.recorder_control (id, enabled, updated_by)
values (1, false, 'migration');

comment on table public.recorder_control is
  'Private singleton controlling whether the Railway recorder opens its Bitquery collectors.';
