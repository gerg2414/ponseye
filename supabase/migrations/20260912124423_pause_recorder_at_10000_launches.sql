create or replace function public.pause_recorder_at_launch_target()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  launch_total bigint;
begin
  select count(*) into launch_total from public.launches;

  if launch_total >= 10000 then
    update public.recorder_control
    set
      enabled = false,
      updated_at = now(),
      updated_by = 'launch_target_10000'
    where id = 1
      and enabled = true;
  end if;

  return new;
end;
$function$;

revoke all on function public.pause_recorder_at_launch_target() from public, anon, authenticated;
grant execute on function public.pause_recorder_at_launch_target() to service_role;

drop trigger if exists pause_recorder_at_10000_launches on public.launches;

create trigger pause_recorder_at_10000_launches
after insert on public.launches
for each row
execute function public.pause_recorder_at_launch_target();

comment on function public.pause_recorder_at_launch_target() is
  'Pauses the recorder immediately after the 10,000th Pons launch is stored.';
