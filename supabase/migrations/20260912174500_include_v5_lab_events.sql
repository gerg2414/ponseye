do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.record_launch_research_event()'::regprocedure)
  into definition;

  definition := replace(
    definition,
    'new.research_rule_version = ''pons-momentum-v4''',
    'new.research_rule_version in (''pons-momentum-v4'', ''pons-momentum-v5'')'
  );
  definition := replace(
    definition,
    'array[''creator_sell'', ''deep_drawdown'']',
    'array[''creator_sell'']'
  );
  execute definition;

  select pg_get_functiondef('public.build_ponseye_lab_dataset()'::regprocedure)
  into definition;

  if position('''pons-momentum-v5''' in definition) = 0 then
    definition := replace(
      definition,
      '''pons-momentum-v1'', ''pons-momentum-v2'', ''pons-momentum-v3'', ''pons-momentum-v4''',
      '''pons-momentum-v1'', ''pons-momentum-v2'', ''pons-momentum-v3'', ''pons-momentum-v4'', ''pons-momentum-v5'''
    );
    execute definition;
  end if;
end;
$$;
