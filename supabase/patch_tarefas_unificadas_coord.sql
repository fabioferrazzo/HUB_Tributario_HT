-- HUB Depto Tributario - tarefas unificadas e ponte Coord -> Calendario
-- Rode este patch no Supabase do HUB Depto Tributario:
-- https://kgorlrpparhcrprwamlc.supabase.co

alter table public.tarefas
  add column if not exists destaque boolean not null default false,
  add column if not exists origem text not null default 'calendario',
  add column if not exists coord_item_id text;

create index if not exists tarefas_origem_idx
  on public.tarefas (origem);

create index if not exists tarefas_coord_item_id_idx
  on public.tarefas (coord_item_id);

alter table public.coord_itens
  add column if not exists integrar_calendario boolean not null default false,
  add column if not exists tarefa_id uuid;

create index if not exists coord_itens_tarefa_id_idx
  on public.coord_itens (tarefa_id);

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;
