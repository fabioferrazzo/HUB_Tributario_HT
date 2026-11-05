-- HUB Depto Tributario - reforco RLS de Pautas por e-mail do Auth.
-- Rode no Supabase correto do HUB quando o perfil admin existe em public.profiles,
-- mas o insert em public.pautas ainda retorna erro de row-level security.
--
-- Mantem a permissao restrita a admin/gestor ativo. A diferenca e que a
-- validacao passa a aceitar tres formas de vinculo:
-- 1. public.profiles.id = auth.uid()
-- 2. public.profiles.email = auth.jwt()->>'email'
-- 3. public.profiles.email = auth.users.email do usuario autenticado

create or replace function public.profile_is_active(p_profile public.profiles)
returns boolean
language sql
stable
as $$
  select coalesce(
    nullif(to_jsonb(p_profile)->>'active', '')::boolean,
    nullif(to_jsonb(p_profile)->>'is_active', '')::boolean,
    true
  );
$$;

create or replace function public.auth_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(
    auth.jwt()->>'email',
    (
      select u.email
      from auth.users u
      where u.id = auth.uid()
      limit 1
    ),
    ''
  ));
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where public.profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
      and (
        p.id = auth.uid()
        or lower(p.email) = public.auth_email()
      )
  );
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where public.profile_is_active(p)
      and to_jsonb(p)->>'role' in ('admin', 'gestor')
      and (
        p.id = auth.uid()
        or lower(p.email) = public.auth_email()
      )
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where public.profile_is_active(p)
      and (
        p.id = auth.uid()
        or lower(p.email) = public.auth_email()
      )
  );
$$;

grant execute on function public.profile_is_active(public.profiles) to authenticated;
grant execute on function public.auth_email() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_active_user() to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

select id, email, nome, role, active
from public.profiles
where lower(email) in ('fiscal10.heixeira@gmail.com', 'fiscal10.hteixeira@gmail.com')
order by email;
