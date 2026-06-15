-- Patch: salvamento seguro de tarefas/lembretes do Calendario de Tarefas.
-- Execute no projeto Supabase do HUB Depto Tributario:
-- https://kgorlrpparhcrprwamlc.supabase.co

begin;

create or replace function public.save_tarefa(
  p_id uuid,
  p_titulo text,
  p_descricao text,
  p_prazo timestamptz,
  p_prioridade text,
  p_status text,
  p_destaque boolean,
  p_origem text,
  p_coord_item_id uuid,
  p_responsaveis uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task_id uuid := coalesce(p_id, gen_random_uuid());
  v_existing_created_by uuid;
  v_is_manager boolean := false;
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and p.active = true
  ) then
    raise exception 'Usuario inativo ou sem perfil ativo.';
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and p.active = true
      and p.role::text in ('admin', 'gestor')
  ) into v_is_manager;

  select t.created_by
    into v_existing_created_by
  from public.tarefas t
  where t.id = v_task_id;

  if v_existing_created_by is not null
     and v_existing_created_by <> v_user_id
     and not v_is_manager then
    raise exception 'Sem permissao para alterar esta tarefa.';
  end if;

  if v_existing_created_by is null then
    insert into public.tarefas (
      id,
      titulo,
      descricao,
      prazo,
      prioridade,
      status,
      destaque,
      origem,
      coord_item_id,
      created_by,
      created_at,
      updated_at
    ) values (
      v_task_id,
      coalesce(nullif(btrim(coalesce(p_titulo, '')), ''), 'Tarefa sem titulo'),
      coalesce(p_descricao, ''),
      p_prazo,
      case when p_prioridade in ('alta', 'normal', 'baixa') then p_prioridade else 'normal' end,
      case when p_status in ('aberta', 'concluida') then p_status else 'aberta' end,
      coalesce(p_destaque, false),
      coalesce(nullif(btrim(coalesce(p_origem, '')), ''), 'calendario'),
      p_coord_item_id,
      v_user_id,
      now(),
      now()
    );
  else
    update public.tarefas
       set titulo = coalesce(nullif(btrim(coalesce(p_titulo, '')), ''), 'Tarefa sem titulo'),
           descricao = coalesce(p_descricao, ''),
           prazo = p_prazo,
           prioridade = case when p_prioridade in ('alta', 'normal', 'baixa') then p_prioridade else 'normal' end,
           status = case when p_status in ('aberta', 'concluida') then p_status else 'aberta' end,
           destaque = coalesce(p_destaque, false),
           origem = coalesce(nullif(btrim(coalesce(p_origem, '')), ''), 'calendario'),
           coord_item_id = p_coord_item_id,
           updated_at = now()
     where id = v_task_id;
  end if;

  delete from public.tarefa_usuarios
   where tarefa_id = v_task_id;

  insert into public.tarefa_usuarios (tarefa_id, user_id)
  select v_task_id, responsavel.user_id
  from (
    select distinct unnest(coalesce(p_responsaveis, '{}'::uuid[])) as user_id
  ) responsavel
  join public.profiles p
    on p.id = responsavel.user_id
   and p.active = true
  on conflict do nothing;

  return v_task_id;
end;
$$;

grant execute on function public.save_tarefa(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  boolean,
  text,
  uuid,
  uuid[]
) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
