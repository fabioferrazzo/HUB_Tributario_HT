-- HUB Depto Tributario - preparo para OCR/conversao de documentos.
-- Execute no Supabase SQL Editor depois de `patch_arquivos_biblioteca.sql`.
-- Esta etapa nao faz OCR sozinha: ela cria os campos que o worker futuro vai preencher.

alter table public.arquivo_recursos
  add column if not exists processing_status text not null default 'none',
  add column if not exists processing_message text not null default '',
  add column if not exists processed_file_name text,
  add column if not exists processed_storage_path text,
  add column if not exists processed_mime_type text,
  add column if not exists processed_size_bytes bigint,
  add column if not exists processed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'arquivo_recursos_processing_status_check'
      and conrelid = 'public.arquivo_recursos'::regclass
  ) then
    alter table public.arquivo_recursos
      add constraint arquivo_recursos_processing_status_check
      check (processing_status in ('none', 'pending', 'processing', 'ready', 'error'));
  end if;
end;
$$;

create index if not exists arquivo_recursos_processing_status_idx
on public.arquivo_recursos (processing_status, updated_at desc);

create index if not exists arquivo_recursos_processed_storage_path_idx
on public.arquivo_recursos (processed_storage_path)
where processed_storage_path is not null;

-- Permite leitura da versao processada quando o usuario ja pode ler o recurso original.
drop policy if exists "hub_arquivos_read_allowed" on storage.objects;
create policy "hub_arquivos_read_allowed"
on storage.objects for select
to authenticated
using (
  bucket_id = 'hub-arquivos'
  and (
    owner = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.arquivo_recursos r
      where (r.storage_path = name or r.processed_storage_path = name)
        and public.can_read_arquivo(r.created_by, r.scope)
    )
  )
);

-- Marca uploads existentes que podem precisar de versao pesquisavel.
update public.arquivo_recursos
set
  processing_status = 'pending',
  processing_message = 'Aguardando conversao/OCR para versao pesquisavel.'
where kind = 'upload'
  and processing_status = 'none'
  and coalesce(processed_storage_path, '') = ''
  and (
    coalesce(mime_type, '') ilike '%pdf%'
    or coalesce(mime_type, '') ilike '%presentation%'
    or coalesce(mime_type, '') ilike '%powerpoint%'
    or coalesce(mime_type, '') ilike 'image/%'
    or coalesce(file_name, '') ~* '\.(pdf|pptx?|png|jpe?g|webp|tiff?|bmp)$'
  );
