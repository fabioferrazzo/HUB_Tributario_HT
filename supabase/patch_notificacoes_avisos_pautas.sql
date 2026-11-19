-- HUB Depto Tributário — Notificações (sino) de avisos do quadro e de pautas.
-- Pode ser executado mais de uma vez. Não apaga dados.
--
-- Regras:
--   Quadro de Avisos
--     • Aviso GERAL      → todos os usuários ativos são notificados (menos quem publicou).
--     • Aviso PARTICULAR → os usuários escolhidos (como já era) e todos os administradores.
--     • Aviso excluído   → a notificação some do sino de todos.
--   Pautas
--     • Nova pauta para todos      → todos os usuários ativos (menos quem criou).
--     • Nova pauta com responsáveis → os responsáveis, administradores e gestores.
--     • Pauta excluída              → a notificação some do sino de todos.
--   Quem já foi notificado não é notificado de novo quando o item é apenas editado.

begin;

-- Grava uma notificação no sino (uso interno das regras abaixo) --------------------------------
create or replace function public.hub_notif_gravar(
  p_user_id uuid,
  p_tipo text,
  p_titulo text,
  p_body text,
  p_meta text,
  p_target_type text,
  p_target_id uuid,
  p_dedupe_key text,
  p_route text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.notificacoes (
    user_id, tipo, titulo, body, meta, target_type, target_id, target_ref,
    dedupe_key, route, tone, active, created_at, updated_at
  )
  values (
    p_user_id, p_tipo, p_titulo, coalesce(p_body, ''), coalesce(p_meta, ''), p_target_type, p_target_id,
    p_target_id::text, p_dedupe_key, p_route, 'info', true, now(), now()
  )
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public.hub_notif_gravar(uuid, text, text, text, text, text, uuid, text, text) from public, anon, authenticated;

create or replace function public.hub_notif_nome(p_user_id uuid, p_email text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(trim(p.nome), '') from public.profiles p where p.id = p_user_id),
    nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
    'Alguém'
  );
$$;

revoke all on function public.hub_notif_nome(uuid, text) from public, anon, authenticated;

-- Quadro de Avisos: novo aviso (geral → todos; particular → administradores) ---------------------
create or replace function public.hub_notif_quadro_aviso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_geral boolean := coalesce(new.visibility, 'geral') <> 'particular';
  v_autor text := public.hub_notif_nome(new.created_by, new.created_by_email);
  v_titulo text := coalesce(nullif(trim(new.title), ''), 'Quadro de Avisos');
  p record;
begin
  -- Na edição, só notifica quando um aviso particular passa a ser geral.
  if tg_op = 'UPDATE' and not (v_geral and coalesce(old.visibility, 'geral') = 'particular') then
    return new;
  end if;

  for p in
    select pr.id
    from public.profiles pr
    where public.profile_is_active(pr)
      and pr.id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
      and (v_geral or (to_jsonb(pr)->>'role') = 'admin')
  loop
    perform public.hub_notif_gravar(
      p.id,
      'quadro_aviso',
      case when v_geral then 'Novo aviso no Quadro geral' else 'Novo aviso particular' end,
      v_titulo,
      'Por ' || v_autor || case when v_geral then ' · para todos' else ' · para usuários selecionados' end,
      'quadro_aviso',
      new.id,
      'quadro_aviso:' || new.id::text || ':' || p.id::text,
      'pautas'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists hub_notif_quadro_aviso_ins on public.quadro_avisos;
create trigger hub_notif_quadro_aviso_ins
  after insert on public.quadro_avisos
  for each row execute function public.hub_notif_quadro_aviso();

drop trigger if exists hub_notif_quadro_aviso_upd on public.quadro_avisos;
create trigger hub_notif_quadro_aviso_upd
  after update of visibility on public.quadro_avisos
  for each row execute function public.hub_notif_quadro_aviso();

-- Aviso particular: usuários escolhidos (mesma regra de antes, com texto legível no sino) ----------
create or replace function public.notify_quadro_aviso_particular(p_aviso_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_creator_email text;
  v_title text;
begin
  if not public.can_manage_quadro_aviso(p_aviso_id) then
    raise exception 'Sem permissão para notificar este aviso.' using errcode = '42501';
  end if;

  select created_by, created_by_email, coalesce(nullif(title, ''), 'Quadro de Avisos')
    into v_creator, v_creator_email, v_title
  from public.quadro_avisos
  where id = p_aviso_id
    and visibility = 'particular';

  if not found then
    return;
  end if;

  insert into public.notificacoes (
    user_id, tipo, titulo, body, meta, target_type, target_id, target_ref,
    dedupe_key, route, tone, active, created_at, updated_at
  )
  select distinct
    coalesce(qau.user_id, p.id),
    'quadro_aviso',
    'Novo aviso particular',
    v_title,
    'Por ' || public.hub_notif_nome(v_creator, v_creator_email) || ' · para você',
    'quadro_aviso',
    p_aviso_id,
    p_aviso_id::text,
    'quadro_aviso:' || p_aviso_id::text || ':' || coalesce(qau.user_id, p.id)::text,
    'pautas',
    'info',
    true,
    now(),
    now()
  from public.quadro_aviso_usuarios qau
  left join public.profiles p on lower(p.email) = lower(qau.email)
  where qau.aviso_id = p_aviso_id
    and coalesce(qau.user_id, p.id) is not null
    and coalesce(qau.user_id, p.id) <> coalesce(v_creator, '00000000-0000-0000-0000-000000000000'::uuid)
  on conflict (user_id, dedupe_key) do update
    set titulo = excluded.titulo,
        body = excluded.body,
        meta = excluded.meta,
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        target_ref = excluded.target_ref,
        route = excluded.route,
        tone = excluded.tone,
        active = true,
        read_at = null,
        updated_at = now();
end;
$$;

revoke all on function public.notify_quadro_aviso_particular(uuid) from public, anon;
grant execute on function public.notify_quadro_aviso_particular(uuid) to authenticated, service_role;

-- Pautas: nova pauta ---------------------------------------------------------------------------
create or replace function public.hub_notif_pauta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_todos boolean := coalesce(new.scope, '') = 'todos';
  v_autor text := public.hub_notif_nome(new.created_by, new.created_by_email);
  p record;
begin
  for p in
    select pr.id
    from public.profiles pr
    where public.profile_is_active(pr)
      and pr.id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
      and (v_todos or (to_jsonb(pr)->>'role') in ('admin', 'gestor'))
  loop
    perform public.hub_notif_gravar(
      p.id,
      'pauta_nova',
      'Nova pauta: ' || coalesce(nullif(trim(new.titulo), ''), 'sem título'),
      case when new.prazo is null then 'Sem prazo' else 'Prazo: ' || to_char(new.prazo at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') end,
      'Por ' || v_autor,
      'pauta',
      new.id,
      'pauta_nova:' || new.id::text || ':' || p.id::text,
      'pautas'
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists hub_notif_pauta_ins on public.pautas;
create trigger hub_notif_pauta_ins
  after insert on public.pautas
  for each row execute function public.hub_notif_pauta();

-- Pautas: responsável incluído (avisa quem foi marcado) ------------------------------------------
create or replace function public.hub_notif_pauta_responsavel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pauta record;
  v_user uuid;
begin
  select id, titulo, prazo, created_by, created_by_email into v_pauta
  from public.pautas where id = new.pauta_id;
  if not found then
    return new;
  end if;

  v_user := coalesce(new.user_id, (select pr.id from public.profiles pr where lower(pr.email) = lower(new.email) limit 1));
  if v_user is null or v_user = coalesce(v_pauta.created_by, '00000000-0000-0000-0000-000000000000'::uuid) then
    return new;
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = v_user and public.profile_is_active(pr)) then
    return new;
  end if;

  perform public.hub_notif_gravar(
    v_user,
    'pauta_nova',
    'Nova pauta: ' || coalesce(nullif(trim(v_pauta.titulo), ''), 'sem título'),
    case when v_pauta.prazo is null then 'Sem prazo' else 'Prazo: ' || to_char(v_pauta.prazo at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') end,
    'Por ' || public.hub_notif_nome(v_pauta.created_by, v_pauta.created_by_email) || ' · você é responsável',
    'pauta',
    v_pauta.id,
    'pauta_nova:' || v_pauta.id::text || ':' || v_user::text,
    'pautas'
  );
  return new;
end;
$$;

drop trigger if exists hub_notif_pauta_resp_ins on public.pauta_usuarios;
create trigger hub_notif_pauta_resp_ins
  after insert on public.pauta_usuarios
  for each row execute function public.hub_notif_pauta_responsavel();

-- Item excluído: some do sino --------------------------------------------------------------------
create or replace function public.hub_notif_item_excluido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notificacoes
     set active = false, updated_at = now()
   where target_type = tg_argv[0]
     and target_ref = old.id::text
     and active = true;
  return old;
end;
$$;

drop trigger if exists hub_notif_quadro_aviso_del on public.quadro_avisos;
create trigger hub_notif_quadro_aviso_del
  after delete on public.quadro_avisos
  for each row execute function public.hub_notif_item_excluido('quadro_aviso');

drop trigger if exists hub_notif_pauta_del on public.pautas;
create trigger hub_notif_pauta_del
  after delete on public.pautas
  for each row execute function public.hub_notif_item_excluido('pauta');

revoke all on function public.hub_notif_quadro_aviso() from public, anon, authenticated;
revoke all on function public.hub_notif_pauta() from public, anon, authenticated;
revoke all on function public.hub_notif_pauta_responsavel() from public, anon, authenticated;
revoke all on function public.hub_notif_item_excluido() from public, anon, authenticated;

commit;

-- Conferência: deve listar 6 gatilhos.
select tgname as gatilho, tgrelid::regclass as tabela
from pg_trigger
where tgname like 'hub_notif_%'
order by 1;
