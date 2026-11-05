begin;

alter table public.tarefas
  add column if not exists archived_at timestamptz;

create index if not exists tarefas_archived_at_idx
  on public.tarefas (archived_at);

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
