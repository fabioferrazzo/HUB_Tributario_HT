-- HUB Depto Tributário: Controle de Férias no HUB
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez).
-- Mesmas regras do app "Controle de Férias" do servidor (v1.5.0), com os usuários do HUB:
--   administradores e gestores do HUB = ADM do app; demais usuários ativos = usuários comuns.
-- As tabelas não são acessadas diretamente: tudo passa pelas funções fer_* abaixo.

begin;

-- ---------------------------------------------------------------------------------------------
-- Tabelas

create table if not exists public.fer_usuarios (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references public.profiles(id),
  participa boolean not null default true,
  dias_semestre numeric(6,2) not null default 15 check (dias_semestre between 0 and 60),
  modo text not null default 'corridos' check (modo in ('corridos', 'uteis')),
  inicio_semestre text not null default '' check (inicio_semestre = '' or inicio_semestre ~ '^\d{4}-[IV]$'),
  saldo_inicial numeric(8,2) not null default 0,
  cor text not null default '#0eb1a2' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  criado_em timestamptz not null default now()
);

create table if not exists public.fer_ferias (
  id bigint generated always as identity primary key,
  usuario_id bigint not null references public.fer_usuarios(id),
  inicio date not null,
  fim date not null,
  motivo text not null default '',
  observacao text not null default '',
  criado_por bigint references public.fer_usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_por bigint references public.fer_usuarios(id),
  atualizado_em timestamptz,
  check (fim >= inicio)
);
create index if not exists fer_ferias_usuario_idx on public.fer_ferias (usuario_id, inicio);

create table if not exists public.fer_ausencias (
  id bigint generated always as identity primary key,
  usuario_id bigint not null references public.fer_usuarios(id),
  justificativa text not null,
  criado_por bigint references public.fer_usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_por bigint references public.fer_usuarios(id),
  atualizado_em timestamptz
);

create table if not exists public.fer_ausencia_dias (
  ausencia_id bigint not null references public.fer_ausencias(id) on delete cascade,
  usuario_id bigint not null references public.fer_usuarios(id),
  data date not null,
  primary key (usuario_id, data)
);
create index if not exists fer_ausencia_dias_aus_idx on public.fer_ausencia_dias (ausencia_id);

create table if not exists public.fer_feriados (
  id bigint generated always as identity primary key,
  data date not null unique,
  descricao text not null,
  ativo boolean not null default true,
  origem text not null default 'manual' check (origem in ('auto', 'manual'))
);

create table if not exists public.fer_feriados_anos (ano integer primary key);

create table if not exists public.fer_auditoria (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  user_id uuid references public.profiles(id),
  acao text not null,
  detalhe text not null default ''
);
create index if not exists fer_auditoria_quando_idx on public.fer_auditoria (quando desc);

-- Acesso só pelas funções (tabelas fechadas para o app e para a chave pública).
do $$
declare t text;
begin
  foreach t in array array['fer_usuarios', 'fer_ferias', 'fer_ausencias', 'fer_ausencia_dias', 'fer_feriados', 'fer_feriados_anos', 'fer_auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Utilidades

-- "Hoje" no horário de Brasília (o banco do Supabase roda em UTC).
create or replace function public.fer_hoje()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

create or replace function public.fer_txt_data(p timestamptz)
returns text language sql stable set search_path = public as $$
  select case when p is null then '' else to_char(p at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') end
$$;

create or replace function public.fer_br(p date)
returns text language sql immutable set search_path = public as $$
  select to_char(p, 'DD/MM/YYYY')
$$;

-- Semestres: Inverno = mai a out (AAAA-I); Verão = nov a abr (AAAA-V, AAAA = ano de novembro).
create or replace function public.fer_semestre_idx(p date)
returns integer language sql immutable set search_path = public as $$
  select case
    when extract(month from p) between 5 and 10 then extract(year from p)::int * 2
    when extract(month from p) >= 11 then extract(year from p)::int * 2 + 1
    else (extract(year from p)::int - 1) * 2 + 1
  end
$$;

create or replace function public.fer_semestre_chave(p_idx integer)
returns text language sql immutable set search_path = public as $$
  select (p_idx / 2)::text || '-' || case when p_idx % 2 = 1 then 'V' else 'I' end
$$;

create or replace function public.fer_chave_valida(p text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p, '') ~ '^\d{4}-[IV]$'
$$;

-- Letras do texto (inclui acentuadas), para a regra "justificativa com mais de 10 letras".
create or replace function public.fer_conta_letras(p text)
returns integer language sql immutable set search_path = public as $$
  select coalesce(length(regexp_replace(coalesce(p, ''), '[^A-Za-zÀ-ÖØ-öø-ÿĀ-ſ]', '', 'g')), 0)
$$;

create or replace function public.fer_data(p text, p_campo text)
returns date language plpgsql immutable set search_path = public as $$
begin
  if coalesce(p, '') !~ '^\d{4}-\d{2}-\d{2}' then raise exception 'Data inválida em "%".', p_campo; end if;
  return left(p, 10)::date;
exception when others then
  raise exception 'Data inválida em "%".', p_campo;
end;
$$;

create or replace function public.fer_num(p text, p_campo text)
returns numeric language plpgsql immutable set search_path = public as $$
begin
  return nullif(trim(coalesce(p, '')), '')::numeric;
exception when others then
  raise exception 'Valor inválido em "%".', p_campo;
end;
$$;

-- Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, o mesmo do app do servidor).
create or replace function public.fer_pascoa(p_ano integer)
returns date language plpgsql immutable set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mes int; dia int;
begin
  a := p_ano % 19; b := p_ano / 100; c := p_ano % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31; dia := (h + l - 7 * m + 114) % 31 + 1;
  return make_date(p_ano, mes, dia);
end;
$$;

-- Gera os feriados nacionais de cada ano uma única vez (o ADM pode desativar ou incluir outros).
create or replace function public.fer_garantir_feriados(p_de integer, p_ate integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_ano int; p date;
begin
  for v_ano in greatest(p_de, 1990)..least(p_ate, 2200) loop
    continue when exists (select 1 from public.fer_feriados_anos fa where fa.ano = v_ano);
    p := public.fer_pascoa(v_ano);
    insert into public.fer_feriados (data, descricao, ativo, origem)
    select x.d, x.n, true, 'auto' from (values
      (make_date(v_ano, 1, 1), 'Confraternização Universal'),
      (p - 48, 'Carnaval (segunda)'),
      (p - 47, 'Carnaval (terça)'),
      (p - 2, 'Sexta-feira Santa'),
      (make_date(v_ano, 4, 21), 'Tiradentes'),
      (make_date(v_ano, 5, 1), 'Dia do Trabalho'),
      (p + 60, 'Corpus Christi'),
      (make_date(v_ano, 9, 7), 'Independência do Brasil'),
      (make_date(v_ano, 10, 12), 'Nossa Senhora Aparecida'),
      (make_date(v_ano, 11, 2), 'Finados'),
      (make_date(v_ano, 11, 15), 'Proclamação da República'),
      (make_date(v_ano, 11, 20), 'Dia da Consciência Negra'),
      (make_date(v_ano, 12, 25), 'Natal')
    ) as x(d, n)
    on conflict (data) do nothing;
    insert into public.fer_feriados_anos (ano) values (v_ano) on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.fer_e_util(p date)
returns boolean language sql stable security definer set search_path = public as $$
  select extract(isodow from p) < 6 and not exists (select 1 from public.fer_feriados f where f.data = p and f.ativo)
$$;

create or replace function public.fer_adm()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_manager()
$$;

-- Cadastro do Férias para cada usuário ativo do HUB (criado na primeira vez em que aparece).
create or replace function public.fer_sincronizar_usuarios()
returns void language plpgsql security definer set search_path = public as $$
declare
  cores text[] := array['#0eb1a2', '#4f6bd8', '#e0803a', '#c2477a', '#6a9e2f', '#8a5cc7', '#d4a017', '#2f8fb8', '#b5523b', '#3d9970', '#7a6f5a', '#d65f9a'];
  r record; n int;
begin
  for r in select p.id from public.profiles p
           where public.profile_is_active(p) and not exists (select 1 from public.fer_usuarios u where u.user_id = p.id)
           order by p.nome, p.id loop
    select count(*) into n from public.fer_usuarios;
    insert into public.fer_usuarios (user_id, inicio_semestre, cor)
    values (r.id, public.fer_semestre_chave(public.fer_semestre_idx(public.fer_hoje())), cores[(n % 12) + 1])
    on conflict (user_id) do nothing;
  end loop;
end;
$$;

-- Usuário do Férias de quem está chamando (exige usuário ativo no HUB).
create or replace function public.fer_eu()
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Sessão inválida ou usuário inativo.' using errcode = '42501';
  end if;
  select id into v from public.fer_usuarios where user_id = auth.uid();
  if v is null then
    perform public.fer_sincronizar_usuarios();
    select id into v from public.fer_usuarios where user_id = auth.uid();
  end if;
  return v;
end;
$$;

create or replace function public.fer_exigir_adm()
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint := public.fer_eu();
begin
  if not public.fer_adm() then raise exception 'Somente o ADM (administrador ou gestor do HUB) pode fazer isso.' using errcode = '42501'; end if;
  return v;
end;
$$;

create or replace function public.fer_nome(p_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select p.nome from public.fer_usuarios u join public.profiles p on p.id = u.user_id where u.id = p_id), '')
$$;

create or replace function public.fer_auditar(p_acao text, p_detalhe text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.fer_auditoria (user_id, acao, detalhe) values (auth.uid(), p_acao, left(coalesce(p_detalhe, ''), 2000))
$$;

-- ---------------------------------------------------------------------------------------------
-- Leitura: tudo o que a tela precisa (os saldos são calculados na tela, com as mesmas regras).

create or replace function public.fer_dados()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_eu bigint := public.fer_eu();
  v_adm boolean := public.fer_adm();
  v_hoje date := public.fer_hoje();
  v_me jsonb;
begin
  perform public.fer_sincronizar_usuarios();
  perform public.fer_garantir_feriados(extract(year from v_hoje)::int - 2, extract(year from v_hoje)::int + 3);
  select jsonb_build_object('id', u.id, 'nome', p.nome, 'login', p.email, 'papel', case when v_adm then 'ADM' else 'USUARIO' end, 'participa', u.participa)
    into v_me from public.fer_usuarios u join public.profiles p on p.id = u.user_id where u.id = v_eu;
  return jsonb_build_object(
    'me', v_me,
    'hoje', to_char(v_hoje, 'YYYY-MM-DD'),
    'usuarios', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', u.id, 'nome', p.nome, 'cor', u.cor, 'participa', u.participa, 'ativo', public.profile_is_active(p),
                           'modo', u.modo, 'dias_semestre', u.dias_semestre)
        || case when v_adm or u.id = v_eu then jsonb_build_object(
             'login', p.email, 'papel', case when (to_jsonb(p)->>'role') in ('admin', 'gestor') then 'ADM' else 'USUARIO' end,
             'inicio_semestre', u.inicio_semestre, 'saldo_inicial', u.saldo_inicial, 'criado_em', public.fer_txt_data(u.criado_em))
           else '{}'::jsonb end
        order by lower(p.nome), u.id)
      from public.fer_usuarios u join public.profiles p on p.id = u.user_id
      where public.profile_is_active(p)
         or exists (select 1 from public.fer_ferias f where f.usuario_id = u.id)
         or exists (select 1 from public.fer_ausencias a where a.usuario_id = u.id)), '[]'::jsonb),
    'ferias', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'usuario_id', f.usuario_id, 'inicio', to_char(f.inicio, 'YYYY-MM-DD'), 'fim', to_char(f.fim, 'YYYY-MM-DD'),
               'motivo', f.motivo, 'observacao', f.observacao, 'criado_por', public.fer_nome(f.criado_por), 'criado_em', public.fer_txt_data(f.criado_em),
               'atualizado_por', public.fer_nome(f.atualizado_por), 'atualizado_em', public.fer_txt_data(f.atualizado_em)) order by f.inicio, f.id)
      from public.fer_ferias f), '[]'::jsonb),
    'ausencias', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'usuario_id', a.usuario_id,
               'dias', (select jsonb_agg(to_char(d.data, 'YYYY-MM-DD') order by d.data) from public.fer_ausencia_dias d where d.ausencia_id = a.id),
               'justificativa', a.justificativa, 'criado_por', public.fer_nome(a.criado_por), 'criado_em', public.fer_txt_data(a.criado_em),
               'atualizado_por', public.fer_nome(a.atualizado_por), 'atualizado_em', public.fer_txt_data(a.atualizado_em)) order by a.id)
      from public.fer_ausencias a where exists (select 1 from public.fer_ausencia_dias d where d.ausencia_id = a.id)), '[]'::jsonb),
    'inicios', coalesce((select jsonb_agg(distinct u.inicio_semestre) from public.fer_usuarios u where u.inicio_semestre <> ''), '[]'::jsonb),
    'feriados', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'data', to_char(f.data, 'YYYY-MM-DD'), 'descricao', f.descricao, 'ativo', f.ativo, 'origem', f.origem) order by f.data)
      from public.fer_feriados f), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Férias

create or replace function public.fer_ferias_salvar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_eu bigint := public.fer_eu();
  v_adm boolean := public.fer_adm();
  v_hoje date := public.fer_hoje();
  v_ini date := public.fer_data(p->>'inicio', 'Início');
  v_fim date := public.fer_data(p->>'fim', 'Fim');
  v_uid bigint;
  v_fid bigint;
  v_alvo record;
  v_atual record;
  v_conf record;
  v_aus text;
  v_motivo text := left(trim(coalesce(p->>'motivo', '')), 200);
  v_obs text := left(trim(coalesce(p->>'observacao', '')), 4000);
  v_avisos jsonb;
begin
  if v_fim < v_ini then raise exception 'A data final é anterior à data inicial.'; end if;
  if v_fim - v_ini > 365 then raise exception 'Período maior que 1 ano. Confira as datas.'; end if;
  v_uid := coalesce(nullif(public.fer_num(p->>'usuario_id', 'usuario_id'), 0), v_eu)::bigint;
  v_fid := coalesce(public.fer_num(p->>'id', 'id'), 0)::bigint;
  if not v_adm and v_uid <> v_eu then raise exception 'Você só pode lançar as suas próprias férias.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(7311, v_uid::int);
  select u.*, pr.nome, public.profile_is_active(pr) as ativo into v_alvo
    from public.fer_usuarios u join public.profiles pr on pr.id = u.user_id where u.id = v_uid;
  if v_alvo.id is null or not v_alvo.ativo then raise exception 'Usuário não encontrado ou inativo.'; end if;
  if not v_alvo.participa then raise exception '% não participa do controle de férias (ajuste em Usuários).', v_alvo.nome; end if;
  perform public.fer_garantir_feriados(extract(year from v_ini)::int, extract(year from v_fim)::int);

  select f.inicio, f.fim into v_conf from public.fer_ferias f
   where f.usuario_id = v_uid and f.id <> v_fid and f.inicio <= v_fim and f.fim >= v_ini order by f.inicio limit 1;
  if v_conf.inicio is not null then
    raise exception 'Já existe férias de % de % a % que se sobrepõe a este período.', v_alvo.nome, public.fer_br(v_conf.inicio), public.fer_br(v_conf.fim);
  end if;
  select string_agg(public.fer_br(d.data), ', ' order by d.data) into v_aus
    from public.fer_ausencia_dias d where d.usuario_id = v_uid and d.data between v_ini and v_fim;
  if v_aus is not null then
    raise exception '% tem ausência registrada em %. Exclua ou ajuste a ausência antes de lançar férias nesses dias.', v_alvo.nome, v_aus;
  end if;

  if v_fid <> 0 then
    select * into v_atual from public.fer_ferias where id = v_fid for update;
    if v_atual.id is null then raise exception 'Lançamento não encontrado.'; end if;
    if not v_adm then
      if v_atual.usuario_id <> v_eu then raise exception 'Você só pode editar as suas próprias férias.' using errcode = '42501'; end if;
      if v_atual.inicio <= v_hoje then raise exception 'Férias já iniciadas ou gozadas só podem ser alteradas pelo ADM.' using errcode = '42501'; end if;
      if v_ini <= v_hoje then raise exception 'O novo início precisa ser a partir de amanhã. Para datas passadas, peça ao ADM.' using errcode = '42501'; end if;
    end if;
    update public.fer_ferias set usuario_id = v_uid, inicio = v_ini, fim = v_fim, motivo = v_motivo, observacao = v_obs,
           atualizado_por = v_eu, atualizado_em = now() where id = v_fid;
    perform public.fer_auditar('FERIAS_EDITAR', format('id=%s %s %s..%s -> %s..%s', v_fid, v_alvo.nome, v_atual.inicio, v_atual.fim, v_ini, v_fim));
  else
    if not v_adm and v_ini <= v_hoje then raise exception 'Para lançar férias com início hoje ou no passado, peça ao ADM.' using errcode = '42501'; end if;
    insert into public.fer_ferias (usuario_id, inicio, fim, motivo, observacao, criado_por)
    values (v_uid, v_ini, v_fim, v_motivo, v_obs, v_eu) returning id into v_fid;
    perform public.fer_auditar('FERIAS_INCLUIR', format('id=%s %s %s..%s', v_fid, v_alvo.nome, v_ini, v_fim));
  end if;

  select coalesce(jsonb_agg(format('%s também estará de férias (%s a %s).', pr.nome, public.fer_br(f.inicio), public.fer_br(f.fim)) order by f.inicio), '[]'::jsonb)
    into v_avisos
    from public.fer_ferias f join public.fer_usuarios u on u.id = f.usuario_id join public.profiles pr on pr.id = u.user_id
   where f.usuario_id <> v_uid and public.profile_is_active(pr) and f.inicio <= v_fim and f.fim >= v_ini;
  return jsonb_build_object('ok', true, 'id', v_fid, 'avisos', v_avisos);
end;
$$;

create or replace function public.fer_ferias_excluir(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_eu bigint := public.fer_eu(); f record;
begin
  select x.*, public.fer_nome(x.usuario_id) as nome into f from public.fer_ferias x where x.id = p_id;
  if f.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if not public.fer_adm() then
    if f.usuario_id <> v_eu then raise exception 'Você só pode excluir as suas próprias férias.' using errcode = '42501'; end if;
    if f.inicio <= public.fer_hoje() then raise exception 'Férias já iniciadas ou gozadas só podem ser excluídas pelo ADM.' using errcode = '42501'; end if;
  end if;
  delete from public.fer_ferias where id = p_id;
  perform public.fer_auditar('FERIAS_EXCLUIR', format('id=%s %s %s..%s motivo=%L obs=%L', p_id, f.nome, f.inicio, f.fim, f.motivo, f.observacao));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ausências (um ou mais dias, não precisam ser seguidos; não mexem no saldo de férias)

create or replace function public.fer_ausencia_salvar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_eu bigint := public.fer_eu();
  v_adm boolean := public.fer_adm();
  v_hoje date := public.fer_hoje();
  v_aid bigint := coalesce(public.fer_num(p->>'id', 'id'), 0)::bigint;
  v_uid bigint := coalesce(nullif(public.fer_num(p->>'usuario_id', 'usuario_id'), 0), v_eu)::bigint;
  v_alvo record;
  v_atual record;
  v_dias date[];
  v_just text := left(trim(coalesce(p->>'justificativa', '')), 2000);
  v_letras int;
  v_lista text;
  v_primeiro date;
  v_acao text;
  d text;
begin
  if not v_adm and v_uid <> v_eu then raise exception 'Você só pode registrar as suas próprias ausências.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(7311, v_uid::int);
  select u.*, pr.nome, public.profile_is_active(pr) as ativo into v_alvo
    from public.fer_usuarios u join public.profiles pr on pr.id = u.user_id where u.id = v_uid;
  if v_alvo.id is null or not v_alvo.ativo then raise exception 'Usuário não encontrado ou inativo.'; end if;
  if jsonb_typeof(p->'dias') is distinct from 'array' or jsonb_array_length(p->'dias') = 0 then
    raise exception 'Selecione pelo menos um dia de ausência.';
  end if;
  v_dias := '{}';
  for d in select jsonb_array_elements_text(p->'dias') loop
    v_dias := v_dias || public.fer_data(d, 'Dia');
  end loop;
  select array_agg(distinct x order by x) into v_dias from unnest(v_dias) x;
  if array_length(v_dias, 1) > 62 then raise exception 'Máximo de 62 dias por registro.'; end if;
  v_letras := public.fer_conta_letras(v_just);
  if v_letras < 11 then raise exception 'A justificativa precisa ter mais de 10 letras (escritas: %).', v_letras; end if;

  if v_aid <> 0 then
    select * into v_atual from public.fer_ausencias where id = v_aid for update;
    if v_atual.id is null then raise exception 'Ausência não encontrada.'; end if;
    if not v_adm then
      select min(data) into v_primeiro from public.fer_ausencia_dias where ausencia_id = v_aid;
      if v_atual.usuario_id <> v_eu then raise exception 'Você só pode editar as suas próprias ausências.' using errcode = '42501'; end if;
      if v_primeiro is not null and v_primeiro <= v_hoje then raise exception 'Ausência que já começou só pode ser alterada pelo ADM.' using errcode = '42501'; end if;
    end if;
  end if;

  select string_agg(public.fer_br(x), ', ' order by x) into v_lista from unnest(v_dias) x
   where exists (select 1 from public.fer_ferias f where f.usuario_id = v_uid and f.inicio <= x and f.fim >= x);
  if v_lista is not null then raise exception '% está de férias em %. Ausência não pode coincidir com férias.', v_alvo.nome, v_lista; end if;
  select string_agg(public.fer_br(ad.data), ', ' order by ad.data) into v_lista from public.fer_ausencia_dias ad
   where ad.usuario_id = v_uid and ad.ausencia_id <> v_aid and ad.data = any(v_dias);
  if v_lista is not null then raise exception 'Já existe ausência de % em %.', v_alvo.nome, v_lista; end if;

  if v_aid <> 0 then
    update public.fer_ausencias set usuario_id = v_uid, justificativa = v_just, atualizado_por = v_eu, atualizado_em = now() where id = v_aid;
    delete from public.fer_ausencia_dias where ausencia_id = v_aid;
    v_acao := 'AUSENCIA_EDITAR';
  else
    insert into public.fer_ausencias (usuario_id, justificativa, criado_por) values (v_uid, v_just, v_eu) returning id into v_aid;
    v_acao := 'AUSENCIA_INCLUIR';
  end if;
  insert into public.fer_ausencia_dias (ausencia_id, usuario_id, data) select v_aid, v_uid, x from unnest(v_dias) x;
  perform public.fer_auditar(v_acao, format('id=%s %s dias=%s', v_aid, v_alvo.nome, array_to_string(v_dias, ',')));
  perform public.fer_garantir_feriados(extract(year from v_dias[1])::int, extract(year from v_dias[array_length(v_dias, 1)])::int);
  select string_agg(public.fer_br(x), ', ' order by x), count(*) into v_lista, v_letras from unnest(v_dias) x where not public.fer_e_util(x);
  return jsonb_build_object('ok', true, 'id', v_aid, 'avisos',
    case when v_lista is null then '[]'::jsonb else jsonb_build_array(format('Inclui %s dia(s) de fim de semana/feriado: %s.', v_letras, v_lista)) end);
end;
$$;

create or replace function public.fer_ausencia_excluir(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_eu bigint := public.fer_eu(); a record; v_dias date[];
begin
  select x.*, public.fer_nome(x.usuario_id) as nome into a from public.fer_ausencias x where x.id = p_id;
  if a.id is null then raise exception 'Ausência não encontrada.'; end if;
  select array_agg(data order by data) into v_dias from public.fer_ausencia_dias where ausencia_id = p_id;
  if not public.fer_adm() then
    if a.usuario_id <> v_eu then raise exception 'Você só pode excluir as suas próprias ausências.' using errcode = '42501'; end if;
    if v_dias is not null and v_dias[1] <= public.fer_hoje() then raise exception 'Ausência que já começou só pode ser excluída pelo ADM.' using errcode = '42501'; end if;
  end if;
  delete from public.fer_ausencia_dias where ausencia_id = p_id;
  delete from public.fer_ausencias where id = p_id;
  perform public.fer_auditar('AUSENCIA_EXCLUIR', format('id=%s %s dias=%s just=%L', p_id, a.nome, array_to_string(v_dias, ','), a.justificativa));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Usuários (ADM): só a participação no controle; nome, e-mail e perfil vêm do cadastro do HUB.

create or replace function public.fer_usuario_salvar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_eu bigint := public.fer_exigir_adm();
  v_id bigint := coalesce(public.fer_num(p->>'id', 'id'), 0)::bigint;
  v_u record;
  v_dias numeric := coalesce(public.fer_num(p->>'dias_semestre', 'Dias por semestre'), 15);
  v_saldo numeric := coalesce(public.fer_num(p->>'saldo_inicial', 'Saldo inicial'), 0);
  v_modo text := case when p->>'modo' = 'uteis' then 'uteis' else 'corridos' end;
  v_ini text := coalesce(p->>'inicio_semestre', '');
  v_cor text := coalesce(p->>'cor', '');
  v_part boolean := coalesce((p->>'participa')::boolean, true);
begin
  select u.*, pr.nome, pr.email into v_u from public.fer_usuarios u join public.profiles pr on pr.id = u.user_id where u.id = v_id;
  if v_u.id is null then raise exception 'Usuário não encontrado. Os usuários são cadastrados no HUB (Configurações > Usuários).'; end if;
  if v_dias < 0 or v_dias > 60 then raise exception 'Dias por semestre deve ficar entre 0 e 60.'; end if;
  if abs(v_saldo) >= 100000 then raise exception 'Saldo inicial inválido.'; end if;
  if v_ini <> '' and not public.fer_chave_valida(v_ini) then raise exception 'Semestre inicial inválido.'; end if;
  if v_ini = '' then v_ini := public.fer_semestre_chave(public.fer_semestre_idx(public.fer_hoje())); end if;
  if v_cor !~ '^#[0-9a-fA-F]{6}$' then v_cor := v_u.cor; end if;
  update public.fer_usuarios set participa = v_part, dias_semestre = v_dias, modo = v_modo, inicio_semestre = v_ini,
         saldo_inicial = v_saldo, cor = v_cor where id = v_id;
  perform public.fer_auditar('USUARIO_EDITAR', format('id=%s %s participa=%s dias=%s modo=%s inicio=%s saldo_ini=%s',
          v_id, v_u.email, v_part, v_dias, v_modo, v_ini, v_saldo));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Feriados (ADM)

create or replace function public.fer_feriado_salvar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_eu bigint := public.fer_exigir_adm();
  v_id bigint := coalesce(public.fer_num(p->>'id', 'id'), 0)::bigint;
  v_data date := public.fer_data(p->>'data', 'Data');
  v_desc text := left(trim(coalesce(p->>'descricao', '')), 80);
  v_ativo boolean := coalesce((p->>'ativo')::boolean, true);
begin
  if v_desc = '' then raise exception 'Informe a descrição do feriado.'; end if;
  if v_id = 0 then perform public.fer_garantir_feriados(extract(year from v_data)::int, extract(year from v_data)::int); end if;
  if exists (select 1 from public.fer_feriados where data = v_data and id <> v_id) then
    raise exception 'Já existe feriado em %.', public.fer_br(v_data);
  end if;
  if v_id <> 0 then
    update public.fer_feriados set data = v_data, descricao = v_desc, ativo = v_ativo where id = v_id;
    if not found then raise exception 'Feriado não encontrado.'; end if;
  else
    insert into public.fer_feriados (data, descricao, ativo, origem) values (v_data, v_desc, v_ativo, 'manual') returning id into v_id;
  end if;
  perform public.fer_auditar('FERIADO_SALVAR', format('id=%s %s %s ativo=%s', v_id, v_data, v_desc, v_ativo));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.fer_feriado_excluir(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_eu bigint := public.fer_exigir_adm(); f record;
begin
  select * into f from public.fer_feriados where id = p_id;
  if f.id is null then raise exception 'Feriado não encontrado.'; end if;
  if f.origem = 'auto' then raise exception 'Feriado nacional não é excluído: desative-o para não contar.'; end if;
  delete from public.fer_feriados where id = p_id;
  perform public.fer_auditar('FERIADO_EXCLUIR', format('%s %s', f.data, f.descricao));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fer_feriados_ano(p_ano integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_eu bigint := public.fer_exigir_adm();
begin
  if p_ano is null or p_ano < 1990 or p_ano > 2200 then raise exception 'Ano inválido.'; end if;
  perform public.fer_garantir_feriados(p_ano, p_ano);
  return jsonb_build_object('ok', true);
end;
$$;

-- Registro de exportação (a planilha é montada na tela).
create or replace function public.fer_registrar_exportacao(p_detalhe text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_eu bigint := public.fer_eu();
begin
  perform public.fer_auditar('EXPORTAR_XLSX', left(coalesce(p_detalhe, ''), 300));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões: só as funções chamadas pela tela ficam abertas aos usuários logados.

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fer\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'fer_dados()', 'fer_ferias_salvar(jsonb)', 'fer_ferias_excluir(bigint)', 'fer_ausencia_salvar(jsonb)', 'fer_ausencia_excluir(bigint)',
    'fer_usuario_salvar(jsonb)', 'fer_feriado_salvar(jsonb)', 'fer_feriado_excluir(bigint)', 'fer_feriados_ano(integer)', 'fer_registrar_exportacao(text)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
