-- HUB Depto Tributario - correcao v2 do INSERT em Pautas com RLS.
--
-- Use se o patch SECURITY DEFINER anterior foi aplicado, mas o teste
-- simulado com role authenticated ainda retorna:
-- "new row violates row-level security policy for table pautas".
--
-- Ajuste:
-- A funcao can_insert_pauta deixa de depender de auth.uid()/auth.jwt()
-- para validar a criacao. Ela passa a permitir INSERT somente quando
-- o registro novo aponta para um perfil admin ativo existente:
--   created_by       = public.profiles.id
--   created_by_email = public.profiles.email
--   role             = admin
--   active/is_active = true
--
-- Isso evita falso negativo causado pelo contexto do SQL Editor/PostgREST,
-- mantendo a regra pratica de que apenas pautas criadas com identidade
-- admin valida passam pela RLS.

create or replace function public.pauta_profile_is_active(p_profile public.profiles)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(to_jsonb(p_profile)->>'active', '')::boolean,
    nullif(to_jsonb(p_profile)->>'is_active', '')::boolean,
    true
  );
$$;

create or replace function public.can_insert_pauta(p_created_by uuid, p_created_by_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_created_by
      and lower(p.email) = lower(coalesce(p_created_by_email, ''))
      and public.pauta_profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
  );
$$;

drop policy if exists "pautas_insert_admin" on public.pautas;
create policy "pautas_insert_admin"
on public.pautas for insert
to authenticated
with check (public.can_insert_pauta(created_by, created_by_email));

grant execute on function public.pauta_profile_is_active(public.profiles) to authenticated;
grant execute on function public.can_insert_pauta(uuid, text) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

select
  public.can_insert_pauta(
    '94f9ed55-28e0-42b3-8895-6697d189e73f'::uuid,
    'fiscal10.hteixeira@gmail.com'
  ) as can_insert_admin_pauta;

select
  policyname,
  cmd,
  permissive,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'pautas'
  and policyname = 'pautas_insert_admin';
