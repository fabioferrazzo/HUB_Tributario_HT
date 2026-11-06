-- HUB Depto Tributario - Permissoes de Arquivos e de anexos (06/11/2026)
--
-- 1) Menu Arquivos (tabelas arquivo_recursos e arquivo_pastas)
--    Antes: so o administrador publicava para todos; os demais so enviavam
--    itens "pessoais", invisiveis aos colegas.
--    Agora:
--      - qualquer usuario ativo envia arquivos e cria pastas visiveis a todos
--        (escopo "global") ou pessoais;
--      - todos leem e baixam os itens globais;
--      - editar e excluir: o autor (somente os proprios) ou o administrador (todos).
--    O armazenamento (bucket hub-arquivos) ja segue essas regras: leitura
--    conforme o item, envio pelo proprio usuario, alteracao/exclusao pelo dono
--    ou administrador.
--
-- 2) Anexos (bucket hub-anexos)
--    Antes: qualquer usuario logado podia gravar arquivos em qualquer pasta de
--    tarefa ou de lembrete, inclusive de outras pessoas.
--    Agora so grava anexo quem pode gerenciar o item:
--      - pautas/<id>/...   -> administrador
--      - tarefas/<id>/...  -> quem pode gerenciar a tarefa
--      - <lembrete>/...    -> quem pode gerenciar o lembrete
--      - quadro-avisos/... -> regra propria (patch_anexos_privados.sql), inalterada
--
-- Seguro para executar mais de uma vez.

begin;

-- 1) Arquivos ---------------------------------------------------------------

drop policy if exists "arquivo_recursos_insert_active" on public.arquivo_recursos;
create policy "arquivo_recursos_insert_active"
on public.arquivo_recursos for insert
to authenticated
with check (
  public.is_active_user()
  and created_by = auth.uid()
);

drop policy if exists "arquivo_recursos_update_owner_or_admin" on public.arquivo_recursos;
create policy "arquivo_recursos_update_owner_or_admin"
on public.arquivo_recursos for update
to authenticated
using (public.can_manage_arquivo(created_by))
with check (public.can_manage_arquivo(created_by));

drop policy if exists "arquivo_pastas_insert_active" on public.arquivo_pastas;
create policy "arquivo_pastas_insert_active"
on public.arquivo_pastas for insert
to authenticated
with check (
  public.is_active_user()
  and created_by = auth.uid()
);

drop policy if exists "arquivo_pastas_update_owner_or_admin" on public.arquivo_pastas;
create policy "arquivo_pastas_update_owner_or_admin"
on public.arquivo_pastas for update
to authenticated
using (public.can_manage_arquivo(created_by))
with check (public.can_manage_arquivo(created_by));

-- (leitura e exclusao continuam: leitura dos globais por todos e dos pessoais
--  pelo autor/admin; exclusao pelo autor ou admin)

-- 2) Anexos -----------------------------------------------------------------

drop policy if exists "hub_anexos_insert_authenticated" on storage.objects;
create policy "hub_anexos_insert_authenticated"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'hub-anexos'
  and owner = auth.uid()
  and (
    (
      (storage.foldername(name))[1] = 'pautas'
      and public.is_admin()
    )
    or (
      (storage.foldername(name))[1] = 'tarefas'
      and public.can_manage_tarefa(public.uuid_or_null((storage.foldername(name))[2]))
    )
    or (
      coalesce((storage.foldername(name))[1], '') not in ('pautas', 'tarefas', 'quadro-avisos')
      and public.can_manage_lembrete(public.uuid_or_null((storage.foldername(name))[1]))
    )
  )
);

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
