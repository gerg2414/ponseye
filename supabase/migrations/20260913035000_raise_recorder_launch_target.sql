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

  if launch_total >= 20000 then
    update public.recorder_control
    set
      enabled = false,
      updated_at = now(),
      updated_by = 'launch_target_20000'
    where id = 1
      and enabled = true;
  end if;

  return new;
end;
$function$;

comment on function public.pause_recorder_at_launch_target() is
  'Pauses the recorder immediately after the 20,000th Pons launch is stored.';
