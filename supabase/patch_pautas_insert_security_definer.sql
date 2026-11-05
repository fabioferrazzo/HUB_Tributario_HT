-- HUB Depto Tributario - correcao definitiva de INSERT em Pautas com RLS.
--
-- Contexto:
-- A tabela public.pautas existe e o perfil admin tambem existe em public.profiles,
-- mas o app ainda recebe:
-- "new row violates row-level security policy for table pautas".
--
-- Causa provavel:
-- A policy de INSERT consultava public.profiles diretamente. Em alguns cenarios,
-- essa consulta dentro da propria policy pode ser afetada por RLS/visibilidade de
-- profiles. Este patch move a checagem para funcoes SECURITY DEFINER.
--
-- Resultado esperado:
-- Apenas o usuario autenticado que tenha perfil ativo com role = admin consegue
-- criar/editar/excluir pautas e gerenciar anexos/usuarios vinculados.

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

create or replace function public.pauta_auth_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(
    nullif(auth.jwt()->>'email', ''),
    (
      select u.email
      from auth.users u
      where u.id = auth.uid()
      limit 1
    ),
    ''
  ));
$$;

create or replace function public.pauta_profile_is_admin(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and public.pauta_profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
  );
$$;

create or replace function public.pauta_current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles p
    where public.pauta_profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
      and (
        p.id = auth.uid()
        or lower(p.email) = public.pauta_auth_email()
      )
  );
$$;

create or replace function public.can_insert_pauta(p_created_by uuid, p_created_by_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles p
    where public.pauta_profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
      and (
        p.id = auth.uid()
        or lower(p.email) = public.pauta_auth_email()
      )
      and (
        p_created_by is null
        or p_created_by = p.id
        or p_created_by = auth.uid()
        or lower(coalesce(p_created_by_email, '')) = lower(p.email)
      )
  );
$$;

-- Mantem can_manage_pauta centralizado para updates, deletes e tabelas-filhas.
create or replace function public.can_manage_pauta(p_pauta_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.pauta_current_user_is_admin();
$$;

alter table public.pautas enable row level security;
alter table public.pauta_usuarios enable row level security;
alter table public.pauta_anexos enable row level security;

drop policy if exists "pautas_insert_admin" on public.pautas;
create policy "pautas_insert_admin"
on public.pautas for insert
to authenticated
with check (public.can_insert_pauta(created_by, created_by_email));

drop policy if exists "pautas_update_admin" on public.pautas;
create policy "pautas_update_admin"
on public.pautas for update
to authenticated
using (public.pauta_current_user_is_admin())
with check (public.pauta_current_user_is_admin());

drop policy if exists "pautas_delete_admin" on public.pautas;
create policy "pautas_delete_admin"
on public.pautas for delete
to authenticated
using (public.pauta_current_user_is_admin());

drop policy if exists "pauta_usuarios_manage_admin" on public.pauta_usuarios;
create policy "pauta_usuarios_manage_admin"
on public.pauta_usuarios for all
to authenticated
using (public.pauta_current_user_is_admin())
with check (public.pauta_current_user_is_admin());

drop policy if exists "pauta_anexos_manage_admin" on public.pauta_anexos;
create policy "pauta_anexos_manage_admin"
on public.pauta_anexos for all
to authenticated
using (public.pauta_current_user_is_admin())
with check (public.pauta_current_user_is_admin());

grant execute on function public.pauta_profile_is_active(public.profiles) to authenticated;
grant execute on function public.pauta_auth_email() to authenticated;
grant execute on function public.pauta_profile_is_admin(uuid) to authenticated;
grant execute on function public.pauta_current_user_is_admin() to authenticated;
grant execute on function public.can_insert_pauta(uuid, text) to authenticated;
grant execute on function public.can_manage_pauta(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

select
  public.pauta_profile_is_admin('94f9ed55-28e0-42b3-8895-6697d189e73f'::uuid) as admin_profile_ok;

select
  policyname,
  cmd,
  permissive,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('pautas', 'pauta_usuarios', 'pauta_anexos')
order by tablename, policyname;
