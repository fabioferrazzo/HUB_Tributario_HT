-- Patch: arquivamento seguro de tarefas para exclusao logica.
-- Execute no projeto Supabase correto do HUB Depto Tributario:
-- https://kgorlrpparhcrprwamlc.supabase.co

begin;

create or replace function public.archive_tarefa(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task_id uuid;
  v_created_by uuid;
  v_is_manager boolean := false;
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and coalesce(p.active, true) = true
      and p.role::text in ('admin', 'gestor')
  ) into v_is_manager;

  select t.id, t.created_by
    into v_task_id, v_created_by
  from public.tarefas t
  where t.id = p_id;

  if v_task_id is null then
    raise exception 'Tarefa nao encontrada.';
  end if;

  if not v_is_manager and v_created_by <> v_user_id then
    raise exception 'Sem permissao para excluir esta tarefa.';
  end if;

  update public.tarefas
     set archived_at = now(),
         updated_at = now()
   where id = v_task_id;

  return v_task_id;
end;
$$;

grant execute on function public.archive_tarefa(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
