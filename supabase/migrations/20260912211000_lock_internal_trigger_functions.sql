revoke execute on function public.register_acquired_position()
  from public, anon, authenticated;
revoke execute on function public.track_curve_position_exit()
  from public, anon, authenticated;
revoke execute on function public.track_market_position_exit()
  from public, anon, authenticated;

grant execute on function public.register_acquired_position()
  to service_role;
grant execute on function public.track_curve_position_exit()
  to service_role;
grant execute on function public.track_market_position_exit()
  to service_role;
