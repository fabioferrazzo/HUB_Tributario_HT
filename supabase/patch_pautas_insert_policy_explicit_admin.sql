-- HUB Depto Tributario - policy explicita para criar Pautas.
-- Use se public.pautas existe, o usuario admin existe em auth.users/profiles,
-- mas o insert continua retornando:
-- "new row violates row-level security policy for table pautas".
--
-- A regra segue restrita a admin ativo. Alem de public.is_admin(), ela aceita
-- o insert quando o proprio registro novo informa created_by e created_by_email
-- correspondentes a um perfil admin ativo.

drop policy if exists "pautas_insert_admin" on public.pautas;

create policy "pautas_insert_admin"
on public.pautas for insert
to authenticated
with check (
  public.is_admin()
  or exists (
    select 1
    from public.profiles p
    where p.id = created_by
      and lower(p.email) = lower(coalesce(created_by_email, ''))
      and public.profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
  )
);

drop policy if exists "pauta_usuarios_manage_admin" on public.pauta_usuarios;

create policy "pauta_usuarios_manage_admin"
on public.pauta_usuarios for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.pautas pa
    join public.profiles p on p.id = pa.created_by
    where pa.id = pauta_id
      and public.profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
      and lower(p.email) = lower(coalesce(pa.created_by_email, ''))
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.pautas pa
    join public.profiles p on p.id = pa.created_by
    where pa.id = pauta_id
      and public.profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
      and lower(p.email) = lower(coalesce(pa.created_by_email, ''))
  )
);

drop policy if exists "pauta_anexos_manage_admin" on public.pauta_anexos;

create policy "pauta_anexos_manage_admin"
on public.pauta_anexos for all
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.pautas pa
    join public.profiles p on p.id = pa.created_by
    where pa.id = pauta_id
      and public.profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
      and lower(p.email) = lower(coalesce(pa.created_by_email, ''))
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.pautas pa
    join public.profiles p on p.id = pa.created_by
    where pa.id = pauta_id
      and public.profile_is_active(p)
      and to_jsonb(p)->>'role' = 'admin'
      and lower(p.email) = lower(coalesce(pa.created_by_email, ''))
  )
);

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

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
