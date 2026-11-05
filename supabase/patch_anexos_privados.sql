-- HUB Depto Tributario - Anexos privados (05/11/2026)
--
-- Objetivo: impedir acesso aos anexos sem login e sem permissao.
--   1. Bucket hub-anexos deixa de ser publico. Os arquivos passam a ser
--      abertos por links assinados temporarios (1 hora), gerados pelo app
--      apenas para quem pode ver a pauta, tarefa, lembrete ou aviso.
--   2. Arquivos do Quadro de Avisos so podem ser lidos por quem pode ver
--      o aviso (avisos particulares deixam de ser legiveis por todos).
--   3. Envio de arquivo do Quadro de Avisos so na pasta do proprio usuario.
--
-- Ordem: executar DEPOIS de patch_quadro_avisos_v2.sql.
-- Seguro para executar mais de uma vez.
--
-- ATENCAO: aplicar junto com o deploy do app que usa links assinados.
-- Com o app antigo (links publicos), os anexos de Pautas e do Quadro de
-- Avisos deixam de abrir ate o novo deploy.

begin;

-- 1. Caminho do arquivo no Storage (substitui o link publico salvo)
alter table public.quadro_avisos
  add column if not exists file_path text;

update public.quadro_avisos
set file_path = substring(file_url from '/storage/v1/object/public/hub-anexos/([^?]+)')
where file_path is null
  and file_url like '%/storage/v1/object/public/hub-anexos/%';

update public.quadro_avisos
set file_url = null
where file_path is not null
  and file_url like '%/storage/v1/object/public/hub-anexos/%';

create index if not exists idx_quadro_avisos_file_path on public.quadro_avisos(file_path);

-- 2. Permissao de leitura do arquivo = permissao de leitura do aviso
create or replace function public.can_read_quadro_aviso_file(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.quadro_avisos qa
    where qa.file_path = p_path
      and public.can_read_quadro_aviso(qa.id)
  )
$$;

grant execute on function public.can_read_quadro_aviso_file(text) to authenticated;

-- 3. Leitura geral do hub-anexos: mesma regra de antes, mas sem a pasta
--    quadro-avisos (que passa a ter regra propria, mais restrita)
drop policy if exists "hub_anexos_read_authenticated" on storage.objects;
create policy "hub_anexos_read_authenticated"
on storage.objects for select
to authenticated
using (
  bucket_id = 'hub-anexos'
  and coalesce((storage.foldername(name))[1], '') <> 'quadro-avisos'
  and (
    owner = auth.uid()
    or public.is_manager()
    or (
      (storage.foldername(name))[1] = 'tarefas'
      and public.can_read_tarefa(public.uuid_or_null((storage.foldername(name))[2]))
    )
    or (
      (storage.foldername(name))[1] = 'pautas'
      and public.can_read_pauta(public.uuid_or_null((storage.foldername(name))[2]))
    )
    or public.can_read_lembrete(public.uuid_or_null((storage.foldername(name))[1]))
  )
);

-- 4. Envio geral do hub-anexos: mesma regra de antes, sem a pasta quadro-avisos
drop policy if exists "hub_anexos_insert_authenticated" on storage.objects;
create policy "hub_anexos_insert_authenticated"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'hub-anexos'
  and owner = auth.uid()
  and coalesce((storage.foldername(name))[1], '') <> 'quadro-avisos'
  and (
    coalesce((storage.foldername(name))[1], '') <> 'pautas'
    or public.is_admin()
  )
);

-- 5. Regras proprias do Quadro de Avisos
drop policy if exists "quadro_avisos_storage_select" on storage.objects;
create policy "quadro_avisos_storage_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'quadro-avisos'
  and (
    owner = auth.uid()
    or public.is_admin()
    or public.can_read_quadro_aviso_file(name)
  )
);

drop policy if exists "quadro_avisos_storage_insert" on storage.objects;
create policy "quadro_avisos_storage_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'quadro-avisos'
  and (storage.foldername(name))[2] = auth.uid()::text
  and owner = auth.uid()
  and public.is_active_user()
);

-- 6. Bucket privado (links publicos deixam de funcionar)
insert into storage.buckets (id, name, public)
values ('hub-anexos', 'hub-anexos', false)
on conflict (id) do update set public = false;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
