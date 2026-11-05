-- HUB Depto Tributario - Correcao: salvar aviso no Quadro de Avisos (05/11/2026)
--
-- Problema (existia desde o patch_quadro_avisos.sql de 02/07): ao salvar um
-- aviso, o app grava e pede o ID de volta. A regra de leitura consultava a
-- propria tabela procurando o aviso que ainda estava sendo gravado; como ele
-- ainda nao existia, a leitura era negada e o Supabase recusava com
-- "new row violates row-level security policy for table quadro_avisos".
--
-- Correcao: a regra de leitura avalia primeiro os dados do proprio aviso
-- (geral, autor, e-mail do autor, admin). Para avisos ja gravados, o
-- resultado e o mesmo de antes (can_read_quadro_aviso continua valendo,
-- inclusive para usuarios marcados em avisos particulares).
--
-- Ordem: executar DEPOIS de patch_quadro_avisos_v2.sql.
-- Seguro para executar mais de uma vez.

begin;

drop policy if exists "quadro_avisos_select_allowed" on public.quadro_avisos;
create policy "quadro_avisos_select_allowed"
on public.quadro_avisos for select
to authenticated
using (
  visibility = 'geral'
  or public.is_admin()
  or created_by = auth.uid()
  or lower(coalesce(created_by_email, '')) = public.quadro_current_email()
  or public.can_read_quadro_aviso(id)
);

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
