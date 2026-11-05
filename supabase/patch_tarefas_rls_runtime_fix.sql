-- HUB Depto Tributario - correção runtime de RLS para Calendario de Tarefas
-- Execute no projeto Supabase do HUB Depto Tributario:
-- https://kgorlrpparhcrprwamlc.supabase.co
--
-- Objetivo:
-- - permitir criacao de tarefas por usuario ativo autenticado;
-- - admin/gestor visualiza e gerencia todas as tarefas;
-- - criador visualiza e gerencia as proprias tarefas;
-- - usuarios marcados visualizam, mas nao editam/excluem/concluem tarefa de outro usuario;
-- - manter anexos e responsaveis protegidos pelas mesmas regras.

create or replace function public.task_profile_is_active(p_profile public.profiles)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(to_jsonb(p_profile)->>'active', '')::boolean,
    nullif(to_jsonb(p_profile)->>'is_active', '')::boolean,
    true
  );
$$;

create or replace function public.task_current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where public.task_profile_is_active(p)
      and (
        p.id = auth.uid()
        or lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
      )
  );
$$;

create or replace function public.task_current_user_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where public.task_profile_is_active(p)
      and (to_jsonb(p)->>'role') in ('admin', 'gestor')
      and (
        p.id = auth.uid()
        or lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
      )
  );
$$;

create or replace function public.task_profile_matches_current_user(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and public.task_profile_is_active(p)
      and (
        p.id = auth.uid()
        or lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
      )
  );
$$;

create or replace function public.can_insert_tarefa(p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and public.task_current_user_is_active()
    and public.task_profile_matches_current_user(p_created_by);
$$;

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
      and public.task_current_user_is_active()
      and (
        public.task_current_user_is_manager()
        or public.task_profile_matches_current_user(t.created_by)
        or exists (
          select 1
          from public.tarefa_usuarios tu
          where tu.tarefa_id = target_tarefa_id
            and public.task_profile_matches_current_user(tu.user_id)
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
      and public.task_current_user_is_active()
      and (
        public.task_current_user_is_manager()
        or public.task_profile_matches_current_user(t.created_by)
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
with check (public.can_insert_tarefa(created_by));

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

grant execute on function public.task_profile_is_active(public.profiles) to authenticated;
grant execute on function public.task_current_user_is_active() to authenticated;
grant execute on function public.task_current_user_is_manager() to authenticated;
grant execute on function public.task_profile_matches_current_user(uuid) to authenticated;
grant execute on function public.can_insert_tarefa(uuid) to authenticated;
grant execute on function public.can_read_tarefa(uuid) to authenticated;
grant execute on function public.can_manage_tarefa(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

