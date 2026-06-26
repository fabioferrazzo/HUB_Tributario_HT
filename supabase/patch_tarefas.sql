-- HUB Depto Tributario - modulo Tarefas
-- Cria persistencia, responsaveis, anexos e RLS para tarefas.

create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text not null default '',
  prazo timestamptz,
  prioridade text not null default 'normal' check (prioridade in ('alta', 'normal', 'baixa')),
  status text not null default 'aberta' check (status in ('aberta', 'concluida')),
  archived_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tarefas
  add column if not exists archived_at timestamptz;

create index if not exists tarefas_archived_at_idx
  on public.tarefas (archived_at);

create table if not exists public.tarefa_usuarios (
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tarefa_id, user_id)
);

create table if not exists public.tarefa_anexos (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

drop trigger if exists tarefas_touch_updated_at on public.tarefas;
create trigger tarefas_touch_updated_at
before update on public.tarefas
for each row execute function public.touch_updated_at();

create or replace function public.can_read_tarefa(target_tarefa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tarefas t
    where t.id = target_tarefa_id
      and public.is_active_user()
      and (
        public.is_manager()
        or t.created_by = auth.uid()
        or exists (
          select 1
          from public.tarefa_usuarios tu
          where tu.tarefa_id = target_tarefa_id
            and tu.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_manage_tarefa(target_tarefa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tarefas t
    where t.id = target_tarefa_id
      and public.is_active_user()
      and (
        public.is_manager()
        or t.created_by = auth.uid()
      )
  );
$$;

alter table public.tarefas enable row level security;
alter table public.tarefa_usuarios enable row level security;
alter table public.tarefa_anexos enable row level security;

drop policy if exists "tarefas_select_allowed" on public.tarefas;
create policy "tarefas_select_allowed"
on public.tarefas for select
to authenticated
using (public.can_read_tarefa(id));

drop policy if exists "tarefas_insert_active" on public.tarefas;
create policy "tarefas_insert_active"
on public.tarefas for insert
to authenticated
with check (public.is_active_user() and created_by = auth.uid());

drop policy if exists "tarefas_update_owner_or_manager" on public.tarefas;
create policy "tarefas_update_owner_or_manager"
on public.tarefas for update
to authenticated
using (public.can_manage_tarefa(id))
with check (public.can_manage_tarefa(id));

drop policy if exists "tarefas_delete_owner_or_manager" on public.tarefas;
create policy "tarefas_delete_owner_or_manager"
on public.tarefas for delete
to authenticated
using (public.can_manage_tarefa(id));

drop policy if exists "tarefa_usuarios_select_allowed" on public.tarefa_usuarios;
create policy "tarefa_usuarios_select_allowed"
on public.tarefa_usuarios for select
to authenticated
using (public.can_read_tarefa(tarefa_id));

drop policy if exists "tarefa_usuarios_manage_owner_or_manager" on public.tarefa_usuarios;
create policy "tarefa_usuarios_manage_owner_or_manager"
on public.tarefa_usuarios for all
to authenticated
using (public.can_manage_tarefa(tarefa_id))
with check (public.can_manage_tarefa(tarefa_id));

drop policy if exists "tarefa_anexos_select_allowed" on public.tarefa_anexos;
create policy "tarefa_anexos_select_allowed"
on public.tarefa_anexos for select
to authenticated
using (uploaded_by = auth.uid() or public.can_read_tarefa(tarefa_id));

drop policy if exists "tarefa_anexos_manage_owner_or_manager" on public.tarefa_anexos;
create policy "tarefa_anexos_manage_owner_or_manager"
on public.tarefa_anexos for all
to authenticated
using (uploaded_by = auth.uid() or public.can_manage_tarefa(tarefa_id))
with check (uploaded_by = auth.uid() or public.can_manage_tarefa(tarefa_id));
