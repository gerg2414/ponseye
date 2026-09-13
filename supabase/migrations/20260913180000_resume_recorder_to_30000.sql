alter table public.recorder_control
  add column if not exists launch_count bigint not null default 0,
  add column if not exists launch_target bigint not null default 30000;

update public.recorder_control
set
  launch_count = (select count(*) from public.launches),
  launch_target = 30000
where id = 1;

create or replace function public.pause_recorder_at_launch_target()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  next_launch_count bigint;
  configured_target bigint;
  recorder_was_enabled boolean;
begin
  update public.recorder_control
  set launch_count = launch_count + 1
  where id = 1
  returning launch_count, launch_target, enabled
  into next_launch_count, configured_target, recorder_was_enabled;

  if recorder_was_enabled and next_launch_count >= configured_target then
    update public.recorder_control
    set
      enabled = false,
      updated_at = now(),
      updated_by = 'launch_target_' || configured_target::text
    where id = 1;
  end if;

  return new;
end;
$function$;

revoke all on function public.pause_recorder_at_launch_target() from public, anon, authenticated;
grant execute on function public.pause_recorder_at_launch_target() to service_role;

drop trigger if exists pause_recorder_at_10000_launches on public.launches;
drop trigger if exists pause_recorder_at_launch_target on public.launches;

create trigger pause_recorder_at_launch_target
after insert on public.launches
for each row
execute function public.pause_recorder_at_launch_target();

update public.recorder_control
set
  enabled = true,
  updated_at = now(),
  updated_by = 'recent_batch_test_complete'
where id = 1;

comment on function public.pause_recorder_at_launch_target() is
  'Maintains an exact launch counter and pauses the recorder at its configured target without recounting the launches table on every insert.';

comment on column public.recorder_control.launch_count is
  'Exact number of stored launches, incremented only when a new launch row is inserted.';

comment on column public.recorder_control.launch_target is
  'Stored launch count at which the recorder automatically pauses.';
