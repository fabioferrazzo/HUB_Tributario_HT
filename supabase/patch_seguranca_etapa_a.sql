-- HUB Depto Tributário — Etapa A (segurança): fila de e-mails e notificações.
-- Pode ser executado mais de uma vez. Não apaga dados.
--
-- 1) Só o servidor (funções da Netlify, com a chave de serviço) pode pôr e-mails na fila.
--    Antes, qualquer pessoa com o endereço do Supabase — mesmo sem login — podia chamar queue_email.
-- 2) "Apagar notificações antigas": cada usuário apaga só as próprias; administrador apaga todas.
-- 3) "Avisar conclusão de pauta": só quem está logado, em nome próprio, e só se a conclusão existir.
-- 4) Funções que exigem usuário logado deixam de aceitar chamadas anônimas.

begin;

-- 1) Fila de e-mails ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('queue_email', 'queue_lembrete_created_emails', 'queue_lembrete_deadline_emails')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- 2) Notificações antigas ----------------------------------------------------------------------
create or replace function public.purge_old_notifications(p_days integer default 5)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if v_uid is null then
    return 0;
  end if;

  delete from public.notificacoes
  where created_at < now() - make_interval(days => greatest(coalesce(p_days, 5), 1))
    and (user_id = v_uid or public.is_admin());

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_old_notifications(integer) from public, anon;
grant execute on function public.purge_old_notifications(integer) to authenticated, service_role;

-- 3) Conclusão de pauta ------------------------------------------------------------------------
-- A função original (que grava o aviso e o e-mail aos administradores) passa a ser interna;
-- a pública confere quem está chamando antes de usá-la.
do $$
begin
  if to_regprocedure('public.notify_pauta_conclusion_interno(uuid,uuid)') is null
     and to_regprocedure('public.notify_pauta_conclusion(uuid,uuid)') is not null then
    alter function public.notify_pauta_conclusion(uuid, uuid) rename to notify_pauta_conclusion_interno;
  end if;
end $$;

revoke all on function public.notify_pauta_conclusion_interno(uuid, uuid) from public, anon, authenticated;
grant execute on function public.notify_pauta_conclusion_interno(uuid, uuid) to service_role;

create or replace function public.notify_pauta_conclusion(p_pauta_id uuid, p_completed_by uuid default auth.uid())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quem uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.';
  end if;

  v_quem := coalesce(p_completed_by, v_uid);
  if v_quem <> v_uid and not public.is_admin() then
    raise exception 'Não é possível avisar a conclusão em nome de outra pessoa.';
  end if;

  if not exists (
    select 1 from public.pauta_conclusoes c
    where c.pauta_id = p_pauta_id and c.user_id = v_quem
  ) then
    return 0;
  end if;

  return public.notify_pauta_conclusion_interno(p_pauta_id, v_quem);
end;
$$;

revoke all on function public.notify_pauta_conclusion(uuid, uuid) from public, anon;
grant execute on function public.notify_pauta_conclusion(uuid, uuid) to authenticated, service_role;

-- 4) Funções de usuário logado: sem acesso anônimo ----------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_lembrete', 'sync_user_notifications')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

commit;

-- Conferência (deve retornar false nas três primeiras linhas e true nas duas últimas):
select 'anon pode enfileirar e-mail' as teste,
       has_function_privilege('anon', p.oid, 'execute') as resultado
from pg_proc p where p.proname = 'queue_email'
union all
select 'usuário logado pode enfileirar e-mail', has_function_privilege('authenticated', p.oid, 'execute')
from pg_proc p where p.proname = 'queue_email'
union all
select 'anon pode apagar notificações', has_function_privilege('anon', 'public.purge_old_notifications(integer)', 'execute')
union all
select 'usuário logado avisa conclusão de pauta', has_function_privilege('authenticated', 'public.notify_pauta_conclusion(uuid,uuid)', 'execute')
union all
select 'servidor pode enfileirar e-mail', has_function_privilege('service_role', p.oid, 'execute')
from pg_proc p where p.proname = 'queue_email';
