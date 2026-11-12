-- HUB Depto Tributário: Histórico e auditoria
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez).
-- Regras:
--   - Registra quem criou, editou, concluiu, arquivou ou excluiu em Pautas, Quadro de Avisos,
--     Aviso da Coordenação e Calendário de Tarefas (gatilhos no banco: vale para qualquer tela).
--   - Junta na mesma consulta o que o Controle de Férias e o Controle de Apuração já registram.
--   - Checklists pessoais não entram.
--   - Só administradores do HUB consultam. Ninguém altera nem apaga o histórico pela tela.

begin;

-- ---------------------------------------------------------------------------------------------
-- Tabelas

create table if not exists public.hub_historico (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  user_id uuid,
  modulo text not null,
  acao text not null,
  entidade_id text not null default '',
  titulo text not null default '',
  detalhes jsonb not null default '{}'::jsonb
);
create index if not exists hub_historico_quando_idx on public.hub_historico (quando desc);
create index if not exists hub_historico_user_idx on public.hub_historico (user_id, quando desc);

-- Última lista de responsáveis/destinatários registrada de cada item (para mostrar quem entrou e quem saiu).
create table if not exists public.hub_historico_membros (
  tabela text not null,
  entidade_id text not null,
  membros text[] not null default '{}',
  primary key (tabela, entidade_id)
);

do $$
declare t text;
begin
  foreach t in array array['hub_historico', 'hub_historico_membros'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Utilidades

create or replace function public.hub_hist_texto(p text, p_max int default 300)
returns text language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '<br\s*/?>|</p>|</div>|</li>', ' ', 'gi'), '<[^>]*>', '', 'g'), '\s+', ' ', 'g')), p_max)
$$;

create or replace function public.hub_hist_campo(p_campo text)
returns text language sql immutable set search_path = public as $$
  select case p_campo
    when 'titulo' then 'Título' when 'title' then 'Título'
    when 'descricao' then 'Descrição' when 'content' then 'Conteúdo' when 'conteudo' then 'Texto'
    when 'prazo' then 'Prazo' when 'prioridade' then 'Prioridade' when 'status' then 'Situação'
    when 'scope' then 'Alcance' when 'destaque' then 'Destaque' when 'color' then 'Cor' when 'cor' then 'Cor'
    when 'visibility' then 'Visibilidade' when 'kind' then 'Tipo' when 'file_name' then 'Arquivo'
    when 'cell' then 'Posição no quadro' when 'nivel' then 'Destaque' when 'validade' then 'Válido até'
    when 'fonte' then 'Tamanho do texto' when 'archived_at' then 'Arquivada em' when 'origem' then 'Origem'
    else p_campo end
$$;

create or replace function public.hub_hist_valor(p jsonb, p_campo text)
returns text language sql immutable set search_path = public as $$
  select case
    when p is null or jsonb_typeof(p) = 'null' then '—'
    when jsonb_typeof(p) = 'boolean' then case when p::text = 'true' then 'sim' else 'não' end
    when jsonb_typeof(p) = 'string' and p_campo in ('prazo', 'archived_at') and (p #>> '{}') ~ '^\d{4}-\d{2}-\d{2}'
      then replace(to_char(((p #>> '{}')::timestamptz) at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), ' 00:00', '')
    when jsonb_typeof(p) = 'string' and p_campo = 'validade' and (p #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
      then to_char((p #>> '{}')::date, 'DD/MM/YYYY')
    when jsonb_typeof(p) = 'string' then coalesce(nullif(public.hub_hist_texto(p #>> '{}'), ''), '(vazio)')
    else left(p::text, 300) end
$$;

create or replace function public.hub_hist_registrar(p_modulo text, p_acao text, p_id text, p_titulo text, p_detalhes jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.hub_historico (user_id, modulo, acao, entidade_id, titulo, detalhes)
  values (auth.uid(), p_modulo, p_acao, coalesce(p_id, ''), left(coalesce(nullif(public.hub_hist_texto(p_titulo, 200), ''), '(sem título)'), 200), coalesce(p_detalhes, '{}'::jsonb))
$$;

-- Nomes atuais dos responsáveis/destinatários de um item.
create or replace function public.hub_hist_membros_atuais(p_tabela text, p_fk text, p_id uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare v text[];
begin
  if to_regclass('public.' || p_tabela) is null then return '{}'; end if;
  execute format(
    'select coalesce(array_agg(n order by n), ''{}'') from (select distinct coalesce(nullif(p.nome, ''''), p.email, m.user_id::text) as n from public.%I m left join public.profiles p on p.id = m.user_id where m.%I = $1) x',
    p_tabela, p_fk) into v using p_id;
  return coalesce(v, '{}');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Gatilho único: roda no fim da transação (já com responsáveis/destinatários gravados)

create or replace function public.hub_hist_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_id text := v_row->>'id';
  v_mod text; v_acao text; v_titulo text;
  v_ignorar text[] := array['id', 'created_at', 'updated_at', 'created_by', 'created_by_email', 'file_url', 'file_path',
                            'removed_by', 'removed_at', 'ativo', 'coord_item_id'];
  v_alt jsonb := '{}'::jsonb;
  v_det jsonb := '{}'::jsonb;
  v_mtab text; v_mfk text;
  v_membros text[]; v_antes text[]; v_tinha boolean;
  v_privado boolean := false;
  k text;
begin
  if tg_table_name = 'pautas' then
    v_mod := 'Pautas'; v_titulo := v_row->>'titulo'; v_mtab := 'pauta_usuarios'; v_mfk := 'pauta_id';
  elsif tg_table_name = 'tarefas' then
    v_mod := 'Calendário de Tarefas'; v_titulo := v_row->>'titulo'; v_mtab := 'tarefa_usuarios'; v_mfk := 'tarefa_id';
  elsif tg_table_name = 'quadro_avisos' then
    v_mod := 'Quadro de Avisos'; v_titulo := coalesce(nullif(v_row->>'title', ''), v_row->>'file_name', 'Post-it');
    v_mtab := 'quadro_aviso_usuarios'; v_mfk := 'aviso_id';
    v_privado := coalesce(v_row->>'visibility', '') = 'particular';
  elsif tg_table_name = 'hub_aviso_coordenacao' then
    v_mod := 'Aviso da Coordenação'; v_titulo := public.hub_hist_texto(v_row->>'conteudo', 120);
  else
    return null;
  end if;

  -- Alterações campo a campo (texto de avisos particulares não é copiado para o histórico).
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      continue when k = any(v_ignorar);
      if (v_old->k) is distinct from (v_new->k) then
        if v_privado and k in ('content', 'title') then
          v_alt := v_alt || jsonb_build_object(public.hub_hist_campo(k), jsonb_build_object('de', '(particular)', 'para', '(alterado)'));
        else
          v_alt := v_alt || jsonb_build_object(public.hub_hist_campo(k),
                     jsonb_build_object('de', public.hub_hist_valor(v_old->k, k), 'para', public.hub_hist_valor(v_new->k, k)));
        end if;
      end if;
    end loop;
  end if;

  -- Responsáveis / destinatários: compara com a última lista registrada.
  if v_mtab is not null and v_id is not null then
    select true, membros into v_tinha, v_antes from public.hub_historico_membros where tabela = tg_table_name and entidade_id = v_id;
    if tg_op = 'DELETE' then
      delete from public.hub_historico_membros where tabela = tg_table_name and entidade_id = v_id;
      v_membros := coalesce(v_antes, '{}');
    else
      v_membros := public.hub_hist_membros_atuais(v_mtab, v_mfk, v_id::uuid);
      insert into public.hub_historico_membros (tabela, entidade_id, membros) values (tg_table_name, v_id, v_membros)
      on conflict (tabela, entidade_id) do update set membros = excluded.membros;
      if tg_op = 'UPDATE' and coalesce(v_tinha, false) and v_antes is distinct from v_membros then
        v_det := v_det || jsonb_build_object(
          'entraram', to_jsonb(array(select unnest(v_membros) except select unnest(v_antes))),
          'sairam', to_jsonb(array(select unnest(v_antes) except select unnest(v_membros))));
      end if;
    end if;
  end if;

  -- Ação
  if tg_op = 'INSERT' then
    v_acao := case when tg_table_name = 'hub_aviso_coordenacao' then 'Publicou' else 'Criou' end;
    v_det := v_det || jsonb_strip_nulls(jsonb_build_object(
      'prazo', case when v_row ? 'prazo' and v_row->>'prazo' is not null then public.hub_hist_valor(v_row->'prazo', 'prazo') end,
      'prioridade', nullif(v_row->>'prioridade', ''),
      'visibilidade', nullif(v_row->>'visibility', ''),
      'validade', case when v_row->>'validade' is not null then public.hub_hist_valor(v_row->'validade', 'validade') end,
      'destaque', case when tg_table_name = 'hub_aviso_coordenacao' then nullif(v_row->>'nivel', '') end,
      'cor', case when tg_table_name = 'hub_aviso_coordenacao' and coalesce(v_row->>'cor', 'padrao') <> 'padrao' then v_row->>'cor' end,
      'para', case when coalesce(array_length(v_membros, 1), 0) > 0 then to_jsonb(v_membros) end));
  elsif tg_op = 'DELETE' then
    v_acao := 'Excluiu';
    if v_mtab is not null and coalesce(array_length(v_membros, 1), 0) > 0 then v_det := v_det || jsonb_build_object('para', to_jsonb(v_membros)); end if;
  else
    if tg_table_name = 'hub_aviso_coordenacao' and coalesce((v_old->>'ativo')::boolean, true) and not coalesce((v_new->>'ativo')::boolean, true) then
      v_acao := 'Retirou';
    elsif (v_old->>'status') is distinct from (v_new->>'status') and v_new->>'status' in ('concluida', 'concluída') then
      v_acao := 'Concluiu';
    elsif (v_old->>'status') is distinct from (v_new->>'status') and v_old->>'status' in ('concluida', 'concluída') then
      v_acao := 'Reabriu';
    elsif (v_old->>'archived_at') is null and (v_new->>'archived_at') is not null then
      v_acao := 'Arquivou';
    elsif (v_old->>'archived_at') is not null and (v_new->>'archived_at') is null then
      v_acao := 'Desarquivou';
    elsif v_alt = '{}'::jsonb and v_det = '{}'::jsonb then
      return null; -- só mudou a data de atualização: nada a registrar
    elsif v_alt = '{}'::jsonb then
      v_acao := case when tg_table_name = 'tarefas' then 'Alterou responsáveis' else 'Alterou destinatários' end;
    elsif tg_table_name = 'quadro_avisos' and (select count(*) from jsonb_object_keys(v_alt)) = 1 and v_alt ? 'Posição no quadro' then
      v_acao := 'Moveu';
    else
      v_acao := 'Editou';
    end if;
    if v_alt <> '{}'::jsonb then v_det := v_det || jsonb_build_object('alteracoes', v_alt); end if;
  end if;

  perform public.hub_hist_registrar(v_mod, v_acao, v_id, v_titulo, v_det);
  return null;
end;
$$;

-- Conclusão individual de pauta (cada destinatário marca a sua).
create or replace function public.hub_hist_conclusao_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_titulo text;
begin
  select titulo into v_titulo from public.pautas where id::text = v_row->>'pauta_id';
  if v_titulo is null then return null; end if; -- pauta excluída: já registrado na exclusão
  perform public.hub_hist_registrar('Pautas', case when tg_op = 'INSERT' then 'Marcou como concluída (para si)' else 'Desmarcou a conclusão (para si)' end,
                                    v_row->>'pauta_id', v_titulo, '{}'::jsonb);
  return null;
end;
$$;

-- Liga os gatilhos nas tabelas que existirem.
do $$
declare t text;
begin
  foreach t in array array['pautas', 'tarefas', 'quadro_avisos', 'hub_aviso_coordenacao'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop trigger if exists hub_historico_trg on public.%I', t);
    execute format('create constraint trigger hub_historico_trg after insert or update or delete on public.%I
                    deferrable initially deferred for each row execute function public.hub_hist_trg()', t);
  end loop;
  if to_regclass('public.pauta_conclusoes') is not null then
    drop trigger if exists hub_historico_conclusao_trg on public.pauta_conclusoes;
    -- No fim da transação: se a pauta foi excluída junto, não registra a "desmarcação".
    create constraint trigger hub_historico_conclusao_trg after insert or delete on public.pauta_conclusoes
      deferrable initially deferred for each row execute function public.hub_hist_conclusao_trg();
  end if;
end $$;

-- Ponto de partida: guarda os responsáveis/destinatários atuais (as mudanças passam a ser comparadas a partir daqui).
insert into public.hub_historico_membros (tabela, entidade_id, membros)
select 'tarefas', t.id::text, public.hub_hist_membros_atuais('tarefa_usuarios', 'tarefa_id', t.id) from public.tarefas t
on conflict do nothing;
insert into public.hub_historico_membros (tabela, entidade_id, membros)
select 'pautas', p.id::text, public.hub_hist_membros_atuais('pauta_usuarios', 'pauta_id', p.id) from public.pautas p
on conflict do nothing;
insert into public.hub_historico_membros (tabela, entidade_id, membros)
select 'quadro_avisos', q.id::text, public.hub_hist_membros_atuais('quadro_aviso_usuarios', 'aviso_id', q.id) from public.quadro_avisos q
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- Consulta (só administradores)

create or replace function public.hub_hist_apur_acao(p_action text, p_entity text)
returns text language sql immutable set search_path = public as $$
  select case p_entity || ':' || p_action
    when 'company:CREATE' then 'Cadastrou empresa'
    when 'company:CREATE_HISTORICAL' then 'Cadastrou empresa (competência passada)'
    when 'company:UPDATE' then 'Editou empresa'
    when 'company:UPDATE_HISTORICAL' then 'Editou empresa (competência passada)'
    when 'company:DELETE' then 'Excluiu empresa'
    when 'company:DELETE_HISTORICAL' then 'Excluiu empresa (competência passada)'
    when 'company:DELETE_ALL' then 'Excluiu todas as empresas'
    when 'company:IMPORT' then 'Importou empresas'
    when 'company_portfolio:REORDER' then 'Reordenou a carteira'
    when 'company_document:UPLOAD' then 'Anexou documento'
    when 'company_document:DELETE' then 'Excluiu documento'
    when 'monthly_check:SET_STATUS' then 'Alterou item do checklist'
    when 'monthly_check:SET_NOTE' then 'Anotou item do checklist'
    when 'monthly_check:CLEAR_NOTE' then 'Apagou anotação do checklist'
    when 'monthly_company_note:UPSERT' then 'Registrou pendência/observação'
    when 'monthly_company_note:CLEAR' then 'Apagou pendência/observação'
    when 'visual_mark:UPSERT' then 'Grifou linha'
    when 'visual_mark:CLEAR' then 'Tirou grifo'
    when 'admin_note:CREATE' then 'Criou nota do administrador'
    when 'admin_note:ARCHIVE' then 'Arquivou nota do administrador'
    when 'alert:CREATE' then 'Criou alerta'
    when 'alert:UPDATE' then 'Editou alerta'
    when 'alert:DELETE' then 'Excluiu alerta'
    when 'checklist_column:CREATE' then 'Criou coluna do checklist'
    when 'checklist_column:RENAME' then 'Renomeou coluna do checklist'
    when 'competence:SAVE' then 'Fechou a competência'
    when 'competence:SAVE_PROGRESS' then 'Salvou o progresso da competência'
    when 'competence:REOPEN' then 'Reabriu a competência'
    when 'competence:GENERATE_NEXT' then 'Gerou a próxima competência'
    when 'user:TRANSFER_PORTFOLIO' then 'Transferiu carteira'
    else initcap(replace(lower(p_action), '_', ' ')) || ' (' || p_entity || ')' end
$$;

create or replace function public.hub_hist_ferias_acao(p_acao text)
returns text language sql immutable set search_path = public as $$
  select case p_acao
    when 'FERIAS_INCLUIR' then 'Incluiu férias' when 'FERIAS_EDITAR' then 'Editou férias' when 'FERIAS_EXCLUIR' then 'Excluiu férias'
    when 'AUSENCIA_INCLUIR' then 'Incluiu ausência' when 'AUSENCIA_EDITAR' then 'Editou ausência' when 'AUSENCIA_EXCLUIR' then 'Excluiu ausência'
    when 'USUARIO_EDITAR' then 'Editou configurações do usuário' when 'FERIADO_SALVAR' then 'Salvou feriado'
    when 'FERIADO_EXCLUIR' then 'Excluiu feriado' when 'EXPORTAR_XLSX' then 'Exportou planilha'
    else initcap(replace(lower(p_acao), '_', ' ')) end
$$;

create or replace function public.hub_hist_apur_titulo(p_entity text, p_entity_id text, p_det jsonb)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_det jsonb := coalesce(p_det, '{}'::jsonb);
  v_partes text[] := string_to_array(coalesce(p_entity_id, ''), ':');
  v_comp text := coalesce(nullif(v_det->>'competence', ''), case when p_entity in ('monthly_check', 'competence', 'monthly_company_note', 'visual_mark') then v_partes[2] end);
  v_nome text := nullif(v_det->>'legal_name', '');
  v_cid text := coalesce(nullif(v_det->>'company_id', ''), case when p_entity in ('company', 'company_document', 'monthly_check', 'monthly_company_note', 'visual_mark') then v_partes[1] end);
  v_out text[] := '{}';
begin
  if v_nome is null and v_cid ~ '^[0-9a-f-]{36}$' and to_regclass('public.apur_companies') is not null then
    execute 'select legal_name from public.apur_companies where id = $1::uuid' into v_nome using v_cid;
  end if;
  if p_entity in ('competence', 'user') and v_partes[1] ~ '^[0-9a-f-]{36}$' then
    select coalesce(nullif(nome, ''), email) into v_nome from public.profiles where id = v_partes[1]::uuid;
    if v_nome is not null then v_nome := 'Carteira de ' || v_nome; end if;
  end if;
  if v_nome is not null then v_out := v_out || v_nome; end if;
  if v_comp ~ '^\d{4}-\d{2}$' then v_out := v_out || (right(v_comp, 2) || '/' || left(v_comp, 4)); end if;
  if p_entity = 'monthly_check' and coalesce(v_partes[3], '') <> '' then v_out := v_out || v_partes[3]; end if;
  if coalesce(v_det->>'item_id', '') <> '' and p_entity = 'admin_note' then v_out := v_out || (v_det->>'item_id'); end if;
  if coalesce(array_length(v_out, 1), 0) = 0 then
    return coalesce(nullif(v_det->>'title', ''), nullif(v_det->>'label', ''), p_entity_id, '');
  end if;
  return array_to_string(v_out, ' · ');
end;
$$;

create or replace function public.hub_hist_ferias_texto(p text)
returns text language sql immutable set search_path = public as $$
  -- "id=8 Bia 2027-02-08..2027-02-19" -> "Bia 08/02/2027 a 19/02/2027"
  select replace(regexp_replace(regexp_replace(coalesce(p, ''), '^id=\d+\s*', ''), '(\d{4})-(\d{2})-(\d{2})', '\3/\2/\1', 'g'), '..', ' a ')
$$;

-- p: {de: 'AAAA-MM-DD', ate: 'AAAA-MM-DD', modulo, usuario (uuid), busca, limite (até 500), deslocamento}
create or replace function public.hub_historico_listar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_de timestamptz := coalesce(nullif(p->>'de', '')::date, (now() at time zone 'America/Sao_Paulo')::date - 30)::timestamp at time zone 'America/Sao_Paulo';
  v_ate timestamptz := (coalesce(nullif(p->>'ate', '')::date, (now() at time zone 'America/Sao_Paulo')::date) + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_modulo text := nullif(p->>'modulo', '');
  v_usuario uuid := nullif(p->>'usuario', '')::uuid;
  v_busca text := nullif(btrim(coalesce(p->>'busca', '')), '');
  v_limite int := least(greatest(coalesce((p->>'limite')::int, 100), 1), 500);
  v_desloc int := greatest(coalesce((p->>'deslocamento')::int, 0), 0);
  v_sql text;
  v_itens jsonb; v_total bigint;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Somente administradores consultam o histórico.' using errcode = '42501';
  end if;

  v_sql := 'select h.quando, h.user_id, h.modulo, h.acao, h.titulo, h.detalhes from public.hub_historico h';
  if to_regclass('public.fer_auditoria') is not null then
    v_sql := v_sql || ' union all select f.quando, f.user_id, ''Férias'', public.hub_hist_ferias_acao(f.acao), public.hub_hist_ferias_texto(f.detalhe), ''{}''::jsonb from public.fer_auditoria f';
  end if;
  if to_regclass('public.apur_audit') is not null then
    v_sql := v_sql || ' union all select a.created_at, a.user_id, ''Apuração'', public.hub_hist_apur_acao(a.action, a.entity_type),
      public.hub_hist_apur_titulo(a.entity_type, a.entity_id, a.details),
      coalesce(a.details, ''{}''::jsonb) from public.apur_audit a';
  end if;

  v_sql := 'with base as (' || v_sql || '),
    filtrado as (
      select b.*, coalesce(nullif(pr.nome, ''''), pr.email, case when b.user_id is null then ''Sistema'' else ''(usuário removido)'' end) as usuario
      from base b left join public.profiles pr on pr.id = b.user_id
      where b.quando >= $1 and b.quando < $2
        and ($3 is null or b.modulo = $3)
        and ($4 is null or b.user_id = $4)
        and ($5 is null or (b.titulo || '' '' || b.acao || '' '' || b.detalhes::text) ilike ''%'' || $5 || ''%''))
    select (select count(*) from filtrado),
           coalesce((select jsonb_agg(jsonb_build_object(''quando'', x.quando, ''usuario'', x.usuario, ''modulo'', x.modulo,
                       ''acao'', x.acao, ''titulo'', x.titulo, ''detalhes'', x.detalhes) order by x.quando desc)
                     from (select * from filtrado order by quando desc limit $6 offset $7) x), ''[]''::jsonb)';
  execute v_sql into v_total, v_itens using v_de, v_ate, v_modulo, v_usuario, v_busca, v_limite, v_desloc;

  return jsonb_build_object(
    'total', v_total,
    'itens', v_itens,
    'usuarios', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'nome', coalesce(nullif(pr.nome, ''), pr.email)) order by lower(coalesce(nullif(pr.nome, ''), pr.email)))
                          from public.profiles pr), '[]'::jsonb),
    'modulos', to_jsonb(array['Pautas', 'Quadro de Avisos', 'Aviso da Coordenação', 'Calendário de Tarefas', 'Férias', 'Apuração'])
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'hub\_hist\_%' or p.proname = 'hub_historico_listar') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

grant execute on function public.hub_historico_listar(jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
