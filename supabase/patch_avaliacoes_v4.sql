-- HUB Depto Tributário: Avaliações por desempenho — nova versão (17/11/2026)
-- Formulário igual à planilha "AVALIAÇÃO POR DESEMPENHO - DEPTO de GESTÃO E PLANEJAMENTO TRIBUTÁRIO".
-- Começa do zero em tabelas novas (avd_*); as tabelas antigas (avaliacoes, avaliacoes_coordenacao) não são alteradas.
-- Acesso só pelas funções abaixo:
--   colaborador (não administrador): preenche, salva rascunho, salva para a coordenação, envia réplica;
--   coordenação (administradores): painel por competência, corrige, finaliza, reabre, devolve, responde réplica.
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez).

begin;

create table if not exists public.avd_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  colaborador_nome text not null default '',
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'rascunho' check (status in ('rascunho', 'enviada', 'em_correcao', 'finalizada', 'replica')),
  colaborador jsonb not null default '{}'::jsonb,
  coordenacao jsonb not null default '{}'::jsonb,
  replicas jsonb not null default '[]'::jsonb,
  enviada_em timestamptz,
  finalizada_em timestamptz,
  corrigida_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, competencia)
);
create index if not exists avd_avaliacoes_comp_idx on public.avd_avaliacoes (competencia, status);

create table if not exists public.avd_eventos (
  id bigserial primary key,
  avaliacao_id uuid not null references public.avd_avaliacoes(id) on delete cascade,
  em timestamptz not null default now(),
  por uuid references public.profiles(id) on delete set null,
  por_nome text not null default '',
  acao text not null,
  detalhe text not null default ''
);
create index if not exists avd_eventos_aval_idx on public.avd_eventos (avaliacao_id, em);

alter table public.avd_avaliacoes enable row level security;
alter table public.avd_eventos enable row level security;
revoke all on public.avd_avaliacoes, public.avd_eventos from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Auxiliares

create or replace function public.avd_criterios()
returns text[] language sql immutable as $$
  select array['producao', 'disposicoes', 'regras', 'erros', 'aprendizado', 'atendimento', 'autonomia']
$$;

create or replace function public.avd_usuario()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sessão do HUB não encontrada.'; end if;
  if not public.is_active_user() then raise exception 'Usuário inativo.'; end if;
  return auth.uid();
end;
$$;

create or replace function public.avd_nome(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(nome), ''), email, '') from public.profiles where id = p_id
$$;

create or replace function public.avd_log(p_aval uuid, p_acao text, p_detalhe text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.avd_eventos (avaliacao_id, por, por_nome, acao, detalhe)
  values (p_aval, auth.uid(), coalesce(public.avd_nome(auth.uid()), ''), p_acao, left(coalesce(p_detalhe, ''), 500))
$$;

-- Confere as notas de um bloco {criterio: {nota, justificativa}}; devolve quantos critérios têm nota válida.
create or replace function public.avd_conferir_notas(p jsonb, p_rotulo text)
returns integer language plpgsql immutable as $$
declare
  k text; v jsonb; n numeric; total integer := 0;
begin
  if p is null or jsonb_typeof(p) = 'null' then return 0; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'Notas inválidas (%).', p_rotulo; end if;
  for k, v in select * from jsonb_each(p) loop
    if not (k = any (public.avd_criterios())) then raise exception 'Critério desconhecido: %.', k; end if;
    if jsonb_typeof(v) <> 'object' then raise exception 'Nota inválida em % (%).', k, p_rotulo; end if;
    if length(coalesce(v->>'justificativa', '')) > 2000 then raise exception 'Justificativa longa demais em % (%).', k, p_rotulo; end if;
    if v ? 'nota' and jsonb_typeof(v->'nota') <> 'null' then
      if jsonb_typeof(v->'nota') <> 'number' then raise exception 'Nota inválida em % (%).', k, p_rotulo; end if;
      n := (v->>'nota')::numeric;
      if n < 0 or n > 10 then raise exception 'As notas vão de 0 a 10 (% em %).', k, p_rotulo; end if;
      total := total + 1;
    end if;
  end loop;
  return total;
end;
$$;

create or replace function public.avd_conferir_tamanho(p jsonb, p_rotulo text)
returns void language plpgsql immutable as $$
begin
  if p is not null and length(p::text) > 60000 then raise exception 'Conteúdo grande demais em %.', p_rotulo; end if;
end;
$$;

-- Avaliação em JSON para a tela. p_coord = quem pede é coordenação (vê tudo e o histórico).
create or replace function public.avd_json(a public.avd_avaliacoes, p_coord boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'userId', a.user_id, 'colaboradorNome', a.colaborador_nome,
    'colaboradorEmail', (select email from public.profiles where id = a.user_id),
    'competencia', a.competencia, 'status', a.status,
    'colaborador', case when p_coord and a.status = 'rascunho' then '{}'::jsonb else a.colaborador end,
    'coordenacao', case when p_coord or a.status in ('finalizada', 'replica') then a.coordenacao else null end,
    'replicas', a.replicas,
    'enviadaEm', a.enviada_em, 'finalizadaEm', a.finalizada_em, 'updatedAt', a.updated_at,
    'eventos', case when p_coord then coalesce((
      select jsonb_agg(jsonb_build_object('em', e.em, 'por', e.por_nome, 'acao', e.acao, 'detalhe', e.detalhe) order by e.em, e.id)
      from public.avd_eventos e where e.avaliacao_id = a.id), '[]'::jsonb) else null end
  )
$$;

create or replace function public.avd_carregar(p_id uuid, p_coord boolean)
returns public.avd_avaliacoes language plpgsql stable security definer set search_path = public as $$
declare a public.avd_avaliacoes;
begin
  perform public.avd_usuario();
  select * into a from public.avd_avaliacoes where id = p_id;
  if not found then raise exception 'Avaliação não encontrada.'; end if;
  if p_coord then
    if not public.is_admin() then raise exception 'Somente a coordenação pode fazer isso.'; end if;
  elsif a.user_id is distinct from auth.uid() then
    raise exception 'Sem permissão para esta avaliação.';
  end if;
  return a;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Colaborador

-- Avaliações do próprio usuário (a parte da coordenação só aparece depois de finalizada).
create or replace function public.avd_minhas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.avd_usuario();
begin
  return coalesce((select jsonb_agg(public.avd_json(a, false) order by a.competencia desc)
                   from public.avd_avaliacoes a where a.user_id = v_uid), '[]'::jsonb);
end;
$$;

-- Salva o rascunho da competência ou "salva para a coordenação" (p_enviar = true).
create or replace function public.avd_salvar_colaborador(p_competencia text, p_colaborador jsonb, p_enviar boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.avd_usuario();
  a public.avd_avaliacoes;
  v_notas integer;
begin
  if public.is_admin() then raise exception 'A coordenação não preenche autoavaliação.'; end if;
  if p_competencia is null or p_competencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Competência inválida.'; end if;
  if jsonb_typeof(coalesce(p_colaborador, 'null'::jsonb)) <> 'object' then raise exception 'Formulário inválido.'; end if;
  perform public.avd_conferir_tamanho(p_colaborador, 'formulário');
  v_notas := public.avd_conferir_notas(p_colaborador->'notas', 'autoavaliação');
  if p_enviar and v_notas < 7 then raise exception 'Informe a nota dos 7 critérios antes de salvar para a coordenação.'; end if;

  select * into a from public.avd_avaliacoes where user_id = v_uid and competencia = p_competencia for update;
  if found and a.status <> 'rascunho' then
    raise exception 'A avaliação de % já foi enviada à coordenação e não pode mais ser alterada.', substr(p_competencia, 6, 2) || '/' || substr(p_competencia, 1, 4);
  end if;
  if not found then
    insert into public.avd_avaliacoes (user_id, colaborador_nome, competencia, status, colaborador)
    values (v_uid, coalesce(public.avd_nome(v_uid), ''), p_competencia, 'rascunho', p_colaborador)
    returning * into a;
    perform public.avd_log(a.id, 'Criou o rascunho');
  else
    update public.avd_avaliacoes set colaborador = p_colaborador, colaborador_nome = coalesce(public.avd_nome(v_uid), colaborador_nome), updated_at = now()
    where id = a.id returning * into a;
  end if;
  if p_enviar then
    update public.avd_avaliacoes set status = 'enviada', enviada_em = now(), updated_at = now() where id = a.id returning * into a;
    perform public.avd_log(a.id, 'Salvou para a coordenação');
  end if;
  return public.avd_json(a, false);
end;
$$;

-- Réplica: só com a avaliação finalizada; não altera nada da avaliação.
create or replace function public.avd_replica(p_id uuid, p_texto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.avd_avaliacoes := public.avd_carregar(p_id, false);
  v_txt text := btrim(coalesce(p_texto, ''));
begin
  if a.status <> 'finalizada' then raise exception 'A réplica só pode ser enviada com a avaliação finalizada.'; end if;
  if v_txt = '' then raise exception 'Escreva a réplica.'; end if;
  if length(v_txt) > 4000 then raise exception 'Réplica com mais de 4.000 caracteres.'; end if;
  update public.avd_avaliacoes
  set replicas = replicas || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'texto', v_txt, 'enviadaEm', now())),
      status = 'replica', updated_at = now()
  where id = a.id returning * into a;
  perform public.avd_log(a.id, 'Enviou réplica');
  return public.avd_json(a, false);
end;
$$;

-- Exclusão: colaborador só o próprio rascunho; a coordenação qualquer uma (a tela pede confirmação).
create or replace function public.avd_excluir(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.avd_usuario();
  a public.avd_avaliacoes;
begin
  select * into a from public.avd_avaliacoes where id = p_id;
  if not found then raise exception 'Avaliação não encontrada.'; end if;
  if not public.is_admin() then
    if a.user_id is distinct from v_uid then raise exception 'Sem permissão para esta avaliação.'; end if;
    if a.status <> 'rascunho' then raise exception 'Só é possível excluir rascunhos.'; end if;
  end if;
  delete from public.avd_avaliacoes where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Coordenação

-- Painel da competência: avaliações (rascunhos sem conteúdo) e colaboradores ativos (não administradores).
create or replace function public.avd_painel(p_competencia text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.avd_usuario();
  if not public.is_admin() then raise exception 'Somente a coordenação acessa o painel.'; end if;
  if p_competencia is null or p_competencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Competência inválida.'; end if;
  return jsonb_build_object(
    'avaliacoes', coalesce((select jsonb_agg(public.avd_json(a, true) - 'eventos' order by a.colaborador_nome)
                            from public.avd_avaliacoes a where a.competencia = p_competencia), '[]'::jsonb),
    'colaboradores', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', coalesce(nullif(btrim(p.nome), ''), p.email), 'email', p.email)
                                                order by coalesce(nullif(btrim(p.nome), ''), p.email))
                               from public.profiles p where coalesce(p.active, true) and p.role <> 'admin'), '[]'::jsonb),
    'competencias', coalesce((select jsonb_agg(distinct a.competencia) from public.avd_avaliacoes a where a.status <> 'rascunho'), '[]'::jsonb)
  );
end;
$$;

-- Abre uma avaliação (coordenação vê tudo e o histórico; colaborador só a própria).
create or replace function public.avd_obter(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.avd_usuario();
  a public.avd_avaliacoes;
begin
  select * into a from public.avd_avaliacoes where id = p_id;
  if not found then raise exception 'Avaliação não encontrada.'; end if;
  if public.is_admin() then
    if a.status = 'rascunho' then raise exception 'Esta avaliação ainda é rascunho do colaborador.'; end if;
    return public.avd_json(a, true);
  end if;
  if a.user_id is distinct from v_uid then raise exception 'Sem permissão para esta avaliação.'; end if;
  return public.avd_json(a, false);
end;
$$;

-- Correção: p_acao 'salvar' (fica "em correção") ou 'finalizar' (libera para o colaborador).
create or replace function public.avd_corrigir(p_id uuid, p_coordenacao jsonb, p_acao text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.avd_avaliacoes := public.avd_carregar(p_id, true);
  v_coord integer; v_sub integer;
begin
  if a.status not in ('enviada', 'em_correcao') then raise exception 'Reabra a avaliação para corrigir.'; end if;
  if p_acao not in ('salvar', 'finalizar') then raise exception 'Ação inválida.'; end if;
  if jsonb_typeof(coalesce(p_coordenacao, 'null'::jsonb)) <> 'object' then raise exception 'Correção inválida.'; end if;
  perform public.avd_conferir_tamanho(p_coordenacao, 'correção');
  v_coord := public.avd_conferir_notas(p_coordenacao->'notas', 'coordenador');
  v_sub := public.avd_conferir_notas(p_coordenacao->'subcoordenacao', 'subcoordenação');
  if jsonb_typeof(coalesce(p_coordenacao->'recomendacoes', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_coordenacao->'recomendacoes', '[]'::jsonb)) > 5 then
    raise exception 'No máximo 5 recomendações.';
  end if;
  if p_acao = 'finalizar' then
    if v_coord < 7 then raise exception 'Informe a nota do coordenador nos 7 critérios.'; end if;
    if v_sub > 0 and v_sub < 7 then raise exception 'A subcoordenação é opcional, mas, se usada, precisa de nota nos 7 critérios.'; end if;
    if btrim(coalesce(p_coordenacao->>'pontosPositivos', '')) = '' then raise exception 'Preencha o item 1 — Pontos positivos.'; end if;
    if btrim(coalesce(p_coordenacao->>'aMelhorar', '')) = '' then raise exception 'Preencha o item 2 — A melhorar/Sugestões.'; end if;
  end if;
  update public.avd_avaliacoes
  set coordenacao = p_coordenacao, corrigida_por = auth.uid(), updated_at = now(),
      status = case when p_acao = 'finalizar' then 'finalizada' else 'em_correcao' end,
      finalizada_em = case when p_acao = 'finalizar' then now() else finalizada_em end
  where id = a.id returning * into a;
  perform public.avd_log(a.id, case when p_acao = 'finalizar' then 'Finalizou a avaliação' else 'Salvou a correção' end);
  return public.avd_json(a, true);
end;
$$;

create or replace function public.avd_reabrir(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.avd_avaliacoes := public.avd_carregar(p_id, true);
begin
  if a.status not in ('finalizada', 'replica') then raise exception 'Só avaliações finalizadas podem ser reabertas.'; end if;
  update public.avd_avaliacoes set status = 'em_correcao', updated_at = now() where id = a.id returning * into a;
  perform public.avd_log(a.id, 'Reabriu para edição');
  return public.avd_json(a, true);
end;
$$;

-- Devolve ao colaborador para ajustar a autoavaliação (volta a ser rascunho).
create or replace function public.avd_devolver(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.avd_avaliacoes := public.avd_carregar(p_id, true);
begin
  if a.status not in ('enviada', 'em_correcao') then raise exception 'Só avaliações aguardando ou em correção podem ser devolvidas.'; end if;
  update public.avd_avaliacoes set status = 'rascunho', enviada_em = null, updated_at = now() where id = a.id returning * into a;
  perform public.avd_log(a.id, 'Devolveu ao colaborador para ajustes', btrim(coalesce(p_motivo, '')));
  return public.avd_json(a, true) || jsonb_build_object('colaborador', a.colaborador);
end;
$$;

-- Responde à última réplica e devolve a avaliação à situação "finalizada".
create or replace function public.avd_responder_replica(p_id uuid, p_resposta text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.avd_avaliacoes := public.avd_carregar(p_id, true);
  v_txt text := btrim(coalesce(p_resposta, ''));
  n integer;
begin
  if a.status <> 'replica' then raise exception 'Não há réplica aguardando resposta.'; end if;
  if v_txt = '' then raise exception 'Escreva a resposta.'; end if;
  if length(v_txt) > 4000 then raise exception 'Resposta com mais de 4.000 caracteres.'; end if;
  n := jsonb_array_length(a.replicas) - 1;
  update public.avd_avaliacoes
  set replicas = jsonb_set(jsonb_set(replicas, array[n::text, 'resposta'], to_jsonb(v_txt)), array[n::text, 'respondidaEm'], to_jsonb(now())),
      status = 'finalizada', updated_at = now()
  where id = a.id returning * into a;
  perform public.avd_log(a.id, 'Respondeu à réplica');
  return public.avd_json(a, true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões das funções

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'avd\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

grant execute on function public.avd_minhas() to authenticated;
grant execute on function public.avd_salvar_colaborador(text, jsonb, boolean) to authenticated;
grant execute on function public.avd_replica(uuid, text) to authenticated;
grant execute on function public.avd_excluir(uuid) to authenticated;
grant execute on function public.avd_painel(text) to authenticated;
grant execute on function public.avd_obter(uuid) to authenticated;
grant execute on function public.avd_corrigir(uuid, jsonb, text) to authenticated;
grant execute on function public.avd_reabrir(uuid) to authenticated;
grant execute on function public.avd_devolver(uuid, text) to authenticated;
grant execute on function public.avd_responder_replica(uuid, text) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
