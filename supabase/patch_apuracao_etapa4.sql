-- HUB Depto Tributário: Controle de Apuração no HUB — Etapa 4: ciclo mensal.
-- Rode no SQL Editor do Supabase depois das etapas 1 e 2 (pode rodar mais de uma vez).
-- Mensagens do ciclo com a competência no mesmo formato do servidor antigo (AAAA-MM),
-- conforme a comparação passo a passo entre os dois sistemas.

begin;

create or replace function public.apur_comp_label(p text)
returns text language sql immutable as $$
  select coalesce(p, '')
$$;

revoke all on function public.apur_comp_label(text) from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
