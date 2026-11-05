-- HUB Depto Tributario - policy simples e robusta para INSERT em Pautas.
-- Use quando o INSERT em public.pautas continua sendo bloqueado por RLS
-- mesmo com o admin cadastrado em auth.users e public.profiles.
--
-- Regra:
-- - so permite criar pauta se created_by apontar para um perfil ativo
--   com role = admin.
--
-- Observacao:
-- O app preenche created_by com o UID Supabase do usuario logado.
-- Assim, o fluxo normal permanece restrito ao admin sem depender de
-- public.is_admin(), auth.jwt()->>'email' ou cache de claims.

drop policy if exists "pautas_insert_admin" on public.pautas;

create policy "pautas_insert_admin"
on public.pautas for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = created_by
      and coalesce(p.active, true) = true
      and p.role::text = 'admin'
  )
);

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

select
  policyname,
  cmd,
  roles,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'pautas'
  and policyname = 'pautas_insert_admin';
