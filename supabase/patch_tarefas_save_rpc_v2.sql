-- Patch: salvamento de tarefas com responsaveis resolvidos no Supabase.
-- Execute no projeto Supabase correto do HUB Depto Tributario:
-- https://kgorlrpparhcrprwamlc.supabase.co

begin;

create or replace function public.save_tarefa_v2(
  p_id uuid,
  p_titulo text,
  p_descricao text,
  p_prazo timestamptz,
  p_prioridade text,
  p_status text,
  p_destaque boolean,
  p_origem text,
  p_coord_item_id uuid,
  p_responsaveis text[] default '{}'::text[]
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
      and coalesce(p.active, true) = true
  ) then
    raise exception 'Usuario inativo ou sem perfil ativo.';
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and coalesce(p.active, true) = true
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
  select v_task_id, p.id
  from public.profiles p
  where coalesce(p.active, true) = true
    and (
      lower(p.email) = any (
        select lower(nullif(btrim(value), ''))
        from unnest(coalesce(p_responsaveis, '{}'::text[])) as value
        where nullif(btrim(value), '') is not null
      )
      or p.id::text = any (
        select lower(nullif(btrim(value), ''))
        from unnest(coalesce(p_responsaveis, '{}'::text[])) as value
        where nullif(btrim(value), '') is not null
      )
    )
  on conflict do nothing;

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
    tu.user_id,
    'tarefa_assigned',
    'Nova tarefa atribuida',
    t.titulo,
    coalesce(creator.nome, creator.email, 'HUB Depto Tributario'),
    'tarefa',
    t.id::text,
    'tarefa_assigned:' || t.id::text || ':' || tu.user_id::text,
    'tasks',
    'info',
    true,
    now(),
    now()
  from public.tarefa_usuarios tu
  join public.tarefas t on t.id = tu.tarefa_id
  left join public.profiles creator on creator.id = t.created_by
  where tu.tarefa_id = v_task_id
    and tu.user_id <> t.created_by
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

  return v_task_id;
end;
$$;

grant execute on function public.save_tarefa_v2(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  boolean,
  text,
  uuid,
  text[]
) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
