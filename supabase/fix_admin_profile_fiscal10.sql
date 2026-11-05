-- HUB Depto Tributario - vincula o usuario fiscal10 ao perfil admin.
-- Rode no SQL Editor do projeto Supabase do HUB:
-- https://kgorlrpparhcrprwamlc.supabase.co
--
-- Use este patch quando:
-- 1. o login funciona;
-- 2. public.pautas existe;
-- 3. salvar pauta retorna erro de RLS;
-- 4. public.profiles nao possui fiscal10.hteixeira@gmail.com.

do $$
declare
  v_user_id uuid;
begin
  select id
    into v_user_id
  from auth.users
  where lower(email) = 'fiscal10.hteixeira@gmail.com'
  order by created_at asc
  limit 1;

  if v_user_id is null then
    raise exception 'Usuario fiscal10.hteixeira@gmail.com nao encontrado em auth.users. Crie esse usuario em Authentication > Users antes de rodar este patch.';
  end if;

  insert into public.profiles (id, email, nome, role, active)
  values (
    v_user_id,
    'fiscal10.hteixeira@gmail.com',
    'Fabio',
    'admin',
    true
  )
  on conflict (id) do update
  set
    email = excluded.email,
    nome = excluded.nome,
    role = excluded.role,
    active = true;
end $$;

select id, email, nome, role, active
from public.profiles
where lower(email) = 'fiscal10.hteixeira@gmail.com';

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;
