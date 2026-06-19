-- HUB Depto Tributario - RLS runtime para Calendario de Tarefas
-- Execute no projeto Supabase correto do HUB:
-- https://kgorlrpparhcrprwamlc.supabase.co
--
-- Objetivo:
-- - corrigir INSERT bloqueado por RLS em public.tarefas;
-- - garantir que created_by seja sempre o usuario autenticado real;
-- - permitir que usuarios marcados visualizem tarefas;
-- - impedir que usuario marcado edite/exclua tarefa criada por outro usuario;
-- - gerar notificacao persistente quando um usuario for marcado em tarefa.

begin;

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
    where p.id = auth.uid()
      and coalesce(p.active, true) = true
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
    where p.id = auth.uid()
      and coalesce(p.active, true) = true
      and p.role::text in ('admin', 'gestor')
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
      and p.id = auth.uid()
      and coalesce(p.active, true) = true
  );
$$;

create or replace function public.set_tarefa_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  if not public.task_current_user_is_active() then
    raise exception 'Usuario inativo ou sem perfil ativo.';
  end if;

  -- O criador da tarefa deve ser sempre a sessao Supabase real.
  new.created_by := auth.uid();
  new.updated_at := now();
  if new.created_at is null then
    new.created_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists tarefas_set_created_by on public.tarefas;
create trigger tarefas_set_created_by
before insert on public.tarefas
for each row execute function public.set_tarefa_created_by();

create or replace function public.can_insert_tarefa(p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.task_current_user_is_active();
$$;

create or replace function public.can_insert_tarefa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.task_current_user_is_active();
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
      and public.task_current_user_is_active()
      and (
        public.task_current_user_is_manager()
        or t.created_by = auth.uid()
      )
  );
$$;

create or replace function public.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;

  return value::uuid;
exception when others then
  return null;
end;
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
drop policy if exists "tarefas_insert_owner_or_manager" on public.tarefas;
create policy "tarefas_insert_active"
on public.tarefas for insert
to authenticated
with check (public.can_insert_tarefa());

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

drop policy if exists "hub_anexos_tarefas_select_allowed" on storage.objects;
create policy "hub_anexos_tarefas_select_allowed"
on storage.objects for select
to authenticated
using (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'tarefas'
  and public.can_read_tarefa(public.uuid_or_null((storage.foldername(name))[2]))
);

drop policy if exists "hub_anexos_tarefas_insert_manage" on storage.objects;
create policy "hub_anexos_tarefas_insert_manage"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'tarefas'
  and public.can_manage_tarefa(public.uuid_or_null((storage.foldername(name))[2]))
);

drop policy if exists "hub_anexos_tarefas_update_manage" on storage.objects;
create policy "hub_anexos_tarefas_update_manage"
on storage.objects for update
to authenticated
using (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'tarefas'
  and public.can_manage_tarefa(public.uuid_or_null((storage.foldername(name))[2]))
)
with check (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'tarefas'
  and public.can_manage_tarefa(public.uuid_or_null((storage.foldername(name))[2]))
);

drop policy if exists "hub_anexos_tarefas_delete_manage" on storage.objects;
create policy "hub_anexos_tarefas_delete_manage"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'tarefas'
  and public.can_manage_tarefa(public.uuid_or_null((storage.foldername(name))[2]))
);

create or replace function public.notify_tarefa_usuario_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notificacoes (
    user_id,
    tipo,
    titulo,
    body,
    meta,
    target_type,
    target_ref,
    dedupe_key,
    route,
    tone,
    active,
    created_at,
    updated_at
  )
  select
    new.user_id,
    'tarefa_assigned',
    'Nova tarefa atribuida',
    t.titulo,
    coalesce(creator.nome, creator.email, 'HUB Depto Tributario'),
    'tarefa',
    t.id::text,
    'tarefa_assigned:' || t.id::text || ':' || new.user_id::text,
    'tarefas',
    'info',
    true,
    now(),
    now()
  from public.tarefas t
  left join public.profiles creator on creator.id = t.created_by
  where t.id = new.tarefa_id
    and new.user_id <> t.created_by
  on conflict (user_id, dedupe_key) do update
  set titulo = excluded.titulo,
      body = excluded.body,
      meta = excluded.meta,
      target_type = excluded.target_type,
      target_ref = excluded.target_ref,
      route = excluded.route,
      tone = excluded.tone,
      active = true,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists tarefa_usuarios_notify_assigned on public.tarefa_usuarios;
create trigger tarefa_usuarios_notify_assigned
after insert on public.tarefa_usuarios
for each row execute function public.notify_tarefa_usuario_assigned();

grant execute on function public.task_current_user_is_active() to authenticated;
grant execute on function public.task_current_user_is_manager() to authenticated;
grant execute on function public.task_profile_matches_current_user(uuid) to authenticated;
grant execute on function public.set_tarefa_created_by() to authenticated;
grant execute on function public.can_insert_tarefa() to authenticated;
grant execute on function public.can_insert_tarefa(uuid) to authenticated;
grant execute on function public.can_read_tarefa(uuid) to authenticated;
grant execute on function public.can_manage_tarefa(uuid) to authenticated;
grant execute on function public.uuid_or_null(text) to authenticated;
grant execute on function public.notify_tarefa_usuario_assigned() to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
