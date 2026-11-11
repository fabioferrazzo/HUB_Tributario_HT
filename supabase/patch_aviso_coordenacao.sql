-- HUB Depto Tributário: "Aviso da Coordenação" no Quadro geral
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez).
--
-- Um aviso geral, no alto do Quadro geral, visto por todos os usuários ativos.
-- Só administradores e gestores do HUB publicam, trocam ou retiram o aviso.
-- Cada publicação fica guardada (histórico); a tela mostra só o aviso em vigor.
-- Ao publicar, cada usuário recebe uma notificação no sino do HUB.

begin;

create table if not exists public.hub_aviso_coordenacao (
  id uuid primary key default gen_random_uuid(),
  conteudo text not null,
  nivel text not null default 'normal' check (nivel in ('normal', 'importante')),
  validade date,
  ativo boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  removed_by uuid references public.profiles(id),
  removed_at timestamptz
);
create index if not exists hub_aviso_coordenacao_ativo_idx on public.hub_aviso_coordenacao (ativo, created_at desc);

alter table public.hub_aviso_coordenacao enable row level security;
revoke all on table public.hub_aviso_coordenacao from anon, authenticated;

-- Aviso em vigor (ou nulo) e se quem chama pode editar.
create or replace function public.hub_aviso_coord_atual()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Sessão inválida ou usuário inativo.' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'id', a.id, 'conteudo', a.conteudo, 'nivel', a.nivel,
           'validade', to_char(a.validade, 'YYYY-MM-DD'),
           'autor', coalesce(p.nome, p.email, ''), 'publicadoEm', a.created_at)
    into v
    from public.hub_aviso_coordenacao a
    left join public.profiles p on p.id = a.created_by
   where a.ativo
     and (a.validade is null or a.validade >= (now() at time zone 'America/Sao_Paulo')::date)
   order by a.created_at desc
   limit 1;
  return jsonb_build_object('aviso', v, 'podeEditar', public.is_manager());
end;
$$;

create or replace function public.hub_aviso_coord_publicar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_conteudo text := trim(coalesce(p->>'conteudo', ''));
  v_nivel text := case when p->>'nivel' = 'importante' then 'importante' else 'normal' end;
  v_validade date;
  v_texto text;
begin
  if auth.uid() is null or not public.is_active_user() or not public.is_manager() then
    raise exception 'Só administradores e gestores do HUB publicam o Aviso da Coordenação.' using errcode = '42501';
  end if;
  v_texto := trim(regexp_replace(regexp_replace(v_conteudo, '<[^>]*>', ' ', 'g'), '&nbsp;|\s+', ' ', 'g'));
  if v_texto = '' then raise exception 'Escreva o aviso antes de publicar.'; end if;
  if length(v_conteudo) > 20000 then raise exception 'Aviso muito longo (máximo de 20 mil caracteres).'; end if;
  begin
    v_validade := nullif(trim(coalesce(p->>'validade', '')), '')::date;
  exception when others then
    raise exception 'Data de validade inválida.';
  end;
  if v_validade is not null and v_validade < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A validade não pode ser uma data passada.';
  end if;

  update public.hub_aviso_coordenacao set ativo = false, removed_by = auth.uid(), removed_at = now() where ativo;
  insert into public.hub_aviso_coordenacao (conteudo, nivel, validade, created_by)
  values (v_conteudo, v_nivel, v_validade, auth.uid()) returning id into v_id;

  -- Sino do HUB: avisa os demais usuários ativos.
  if to_regclass('public.notificacoes') is not null then
    insert into public.notificacoes (user_id, tipo, titulo, body, meta, target_type, target_id, target_ref, dedupe_key, route, tone, active, created_at, updated_at)
    select pr.id, 'aviso_coordenacao',
           case when v_nivel = 'importante' then 'Aviso da Coordenação (importante)' else 'Novo Aviso da Coordenação' end,
           left(v_texto, 240), '', 'aviso_coordenacao', v_id, v_id::text,
           'aviso_coord:' || v_id::text || ':' || pr.id::text, 'home',
           case when v_nivel = 'importante' then 'warning' else 'info' end, true, now(), now()
      from public.profiles pr
     where public.profile_is_active(pr) and pr.id <> auth.uid()
    on conflict do nothing;
  end if;

  return public.hub_aviso_coord_atual();
end;
$$;

create or replace function public.hub_aviso_coord_remover()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  if auth.uid() is null or not public.is_active_user() or not public.is_manager() then
    raise exception 'Só administradores e gestores do HUB retiram o Aviso da Coordenação.' using errcode = '42501';
  end if;
  with u as (
    update public.hub_aviso_coordenacao set ativo = false, removed_by = auth.uid(), removed_at = now()
     where ativo returning id
  ) select array_agg(id) into v_ids from u;
  if to_regclass('public.notificacoes') is not null and v_ids is not null then
    update public.notificacoes set active = false, updated_at = now() where tipo = 'aviso_coordenacao' and target_id = any(v_ids);
  end if;
  return public.hub_aviso_coord_atual();
end;
$$;

revoke all on function public.hub_aviso_coord_atual() from public, anon;
revoke all on function public.hub_aviso_coord_publicar(jsonb) from public, anon;
revoke all on function public.hub_aviso_coord_remover() from public, anon;
grant execute on function public.hub_aviso_coord_atual() to authenticated;
grant execute on function public.hub_aviso_coord_publicar(jsonb) to authenticated;
grant execute on function public.hub_aviso_coord_remover() to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
