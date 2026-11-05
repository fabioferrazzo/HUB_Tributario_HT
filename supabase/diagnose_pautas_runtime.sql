-- HUB Depto Tributario - diagnostico rapido de Pautas em runtime.
-- Rode no Supabase SQL Editor do MESMO projeto usado em VITE_SUPABASE_URL no Netlify.
-- Objetivo: confirmar que as tabelas nativas existem e recarregar o cache REST/PostgREST.

select
  current_database() as database_name,
  current_user as sql_user,
  now() as checked_at;

select
  to_regclass('public.pautas') as public_pautas,
  to_regclass('public.pauta_usuarios') as public_pauta_usuarios,
  to_regclass('public.pauta_anexos') as public_pauta_anexos,
  to_regclass('public.pauta_conclusoes') as public_pauta_conclusoes;

select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('pautas', 'pauta_usuarios', 'pauta_anexos', 'pauta_conclusoes')
order by table_name;

-- Se as tabelas aparecerem acima, mas o app ainda disser "schema cache",
-- este comando solicita ao PostgREST/Supabase REST que recarregue o schema.
select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;
