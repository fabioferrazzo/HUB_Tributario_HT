-- HUB Depto Tributario - ajuste de RLS para Pautas.
-- Use quando o app encontra public.pautas, mas o insert retorna:
-- "new row violates row-level security policy for table pautas".
--
-- O patch mantem a regra restrita a administradores/gestores, mas torna as
-- funcoes de permissao tolerantes a bases onde o perfil ativo esta associado
-- ao e-mail autenticado e nao apenas a auth.uid().

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
        or lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
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
        or lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
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
        or lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
      )
  );
$$;

grant execute on function public.profile_is_active(public.profiles) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_active_user() to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

select
  to_regclass('public.pautas') as public_pautas,
  to_regclass('public.pauta_usuarios') as public_pauta_usuarios,
  to_regclass('public.pauta_anexos') as public_pauta_anexos,
  to_regclass('public.pauta_conclusoes') as public_pauta_conclusoes;
