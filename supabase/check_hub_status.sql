-- HUB Depto Tributario - conferencia de estrutura do Supabase.
-- Consulta somente leitura. Use antes de liberar um deploy de marco.

with required_objects as (
  select *
  from (
    values
      ('table', 'profiles', 'Tabela public.profiles'),
      ('table', 'lembretes', 'Tabela public.lembretes'),
      ('table', 'lembrete_usuarios', 'Tabela public.lembrete_usuarios'),
      ('table', 'lembrete_anexos', 'Tabela public.lembrete_anexos'),
      ('table', 'arquivo_pastas', 'Tabela public.arquivo_pastas'),
      ('table', 'arquivo_recursos', 'Tabela public.arquivo_recursos'),
      ('table', 'arquivo_anotacoes', 'Tabela public.arquivo_anotacoes'),
      ('table', 'links_uteis', 'Tabela public.links_uteis'),
      ('table', 'noticias', 'Tabela public.noticias'),
      ('table', 'notificacoes', 'Tabela public.notificacoes'),
      ('table', 'email_outbox', 'Tabela public.email_outbox'),
      ('table', 'tarefas', 'Tabela public.tarefas'),
      ('table', 'tarefa_usuarios', 'Tabela public.tarefa_usuarios'),
      ('table', 'tarefa_anexos', 'Tabela public.tarefa_anexos'),
      ('table', 'pautas', 'Tabela public.pautas'),
      ('table', 'pauta_usuarios', 'Tabela public.pauta_usuarios'),
      ('table', 'pauta_anexos', 'Tabela public.pauta_anexos'),
      ('table', 'pauta_conclusoes', 'Tabela public.pauta_conclusoes'),
      ('table', 'coord_colaboradores', 'Tabela public.coord_colaboradores'),
      ('table', 'coord_itens', 'Tabela public.coord_itens'),
      ('column', 'arquivo_recursos.processing_status', 'Coluna public.arquivo_recursos.processing_status'),
      ('column', 'arquivo_recursos.processed_storage_path', 'Coluna public.arquivo_recursos.processed_storage_path'),
      ('column', 'arquivo_recursos.processed_mime_type', 'Coluna public.arquivo_recursos.processed_mime_type'),
      ('function', 'is_admin', 'Funcao public.is_admin'),
      ('function', 'is_manager', 'Funcao public.is_manager'),
      ('function', 'is_active_user', 'Funcao public.is_active_user'),
      ('function', 'create_lembrete', 'Funcao public.create_lembrete'),
      ('function', 'can_read_lembrete', 'Funcao public.can_read_lembrete'),
      ('function', 'can_manage_lembrete', 'Funcao public.can_manage_lembrete'),
      ('function', 'can_read_arquivo', 'Funcao public.can_read_arquivo'),
      ('function', 'can_manage_arquivo', 'Funcao public.can_manage_arquivo'),
      ('function', 'can_read_arquivo_recurso', 'Funcao public.can_read_arquivo_recurso'),
      ('function', 'sync_user_notifications', 'Funcao public.sync_user_notifications'),
      ('function', 'queue_email', 'Funcao public.queue_email'),
      ('function', 'queue_lembrete_created_emails', 'Funcao public.queue_lembrete_created_emails'),
      ('function', 'queue_lembrete_deadline_emails', 'Funcao public.queue_lembrete_deadline_emails'),
      ('function', 'can_read_tarefa', 'Funcao public.can_read_tarefa'),
      ('function', 'can_manage_tarefa', 'Funcao public.can_manage_tarefa'),
      ('function', 'can_read_pauta', 'Funcao public.can_read_pauta'),
      ('function', 'can_manage_pauta', 'Funcao public.can_manage_pauta'),
      ('function', 'can_complete_pauta', 'Funcao public.can_complete_pauta'),
      ('function', 'notify_pauta_conclusion', 'Funcao public.notify_pauta_conclusion'),
      ('function', 'purge_old_notifications', 'Funcao public.purge_old_notifications'),
      ('bucket', 'hub-anexos', 'Bucket storage hub-anexos'),
      ('bucket', 'hub-arquivos', 'Bucket storage hub-arquivos')
  ) as item(kind, name, label)
),
status as (
  select
    kind,
    label,
    case
      when kind = 'table' then exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = name
      )
      when kind = 'function' then exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = name
      )
      when kind = 'column' then exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = split_part(name, '.', 1)
          and column_name = split_part(name, '.', 2)
      )
      when kind = 'bucket' then exists (
        select 1
        from storage.buckets b
        where b.id = name
      )
      else false
    end as ok
  from required_objects
)
select
  case kind
    when 'table' then 'Tabela'
    when 'column' then 'Coluna'
    when 'function' then 'Funcao'
    when 'bucket' then 'Bucket'
    else kind
  end as tipo,
  label as item,
  case when ok then 'OK' else 'PENDENTE' end as status
from status
order by
  case kind when 'table' then 1 when 'column' then 2 when 'function' then 3 when 'bucket' then 4 else 5 end,
  label;
