-- HUB Depto Tributário: Simuladores › Fator R — aba "Monitoramento"
-- Empresas monitoradas, receita e folha mês a mês, e registro do fator R no Controle de Apuração
-- (coluna "Pendência / obs. do mês"). Rode no SQL Editor do Supabase (pode rodar mais de uma vez).
-- Depende do Controle de Apuração (patch_apuracao_etapa1.sql) já instalado.

begin;

-- ---------------------------------------------------------------------------------------------
-- Tabelas

create table if not exists public.fr_empresas (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id),
  nome text not null,
  cnpj text not null default '',
  cnae text not null default '',
  inicio_atividade text not null default '',          -- 'AAAA-MM' ou vazio
  apur_company_id uuid references public.apur_companies(id) on delete set null,
  observacoes text not null default '',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fr_empresas_owner_idx on public.fr_empresas (owner_user_id, ativo, nome);

create table if not exists public.fr_lancamentos (
  empresa_id uuid not null references public.fr_empresas(id) on delete cascade,
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  receita numeric(16,2) not null default 0 check (receita >= 0),
  salarios numeric(16,2) not null default 0 check (salarios >= 0),
  prolabore numeric(16,2) not null default 0 check (prolabore >= 0),
  encargos numeric(16,2) not null default 0 check (encargos >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  primary key (empresa_id, competencia)
);

create table if not exists public.fr_registros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.fr_empresas(id) on delete cascade,
  apur_company_id uuid not null,
  competencia text not null,
  pa text not null,
  fator numeric(9,6) not null,
  anexo text not null,
  linha text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
create index if not exists fr_registros_empresa_idx on public.fr_registros (empresa_id, created_at desc);

alter table public.fr_empresas enable row level security;
alter table public.fr_lancamentos enable row level security;
alter table public.fr_registros enable row level security;
-- Acesso só pelas funções abaixo (que conferem dono ou administrador).
revoke all on public.fr_empresas, public.fr_lancamentos, public.fr_registros from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Auxiliares

create or replace function public.fr_txt(p text, p_max integer default 200)
returns text language sql immutable as $$
  select left(coalesce(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), ''), p_max)
$$;

create or replace function public.fr_num(p jsonb)
returns numeric language plpgsql immutable as $$
declare v numeric;
begin
  if p is null or jsonb_typeof(p) = 'null' then return 0; end if;
  begin
    v := round((p #>> '{}')::numeric, 2);
  exception when others then
    raise exception 'Valor numérico inválido: %', p #>> '{}';
  end;
  if v < 0 then raise exception 'Valores não podem ser negativos.'; end if;
  if v > 99999999999999 then raise exception 'Valor fora do limite.'; end if;
  return v;
end;
$$;

-- Empresa visível/alterável pelo usuário: dono ou administrador.
create or replace function public.fr_empresa_ctx(p_empresa uuid)
returns public.fr_empresas language plpgsql stable security definer set search_path = public as $$
declare
  e public.fr_empresas;
begin
  perform public.apur_require_user();
  select * into e from public.fr_empresas where id = p_empresa;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  if not public.is_admin() and e.owner_user_id is distinct from auth.uid() then raise exception 'Sem permissão.'; end if;
  return e;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Leitura

-- Empresas do usuário (administrador: todas) com lançamentos e últimos registros.
create or replace function public.fr_listar()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_admin boolean := public.is_admin();
begin
  return jsonb_build_object(
    'admin', v_admin,
    'user_id', v_uid,
    'empresas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'owner_user_id', e.owner_user_id, 'owner_nome', coalesce(nullif(p.nome, ''), p.email, ''),
        'nome', e.nome, 'cnpj', e.cnpj, 'cnae', e.cnae, 'inicio_atividade', e.inicio_atividade,
        'apur_company_id', e.apur_company_id,
        'apur_nome', case when c.id is not null and not c.deleted then c.legal_name end,
        'observacoes', e.observacoes, 'ativo', e.ativo, 'updated_at', e.updated_at,
        'lancamentos', coalesce((
          select jsonb_agg(jsonb_build_object('competencia', l.competencia, 'receita', l.receita, 'salarios', l.salarios,
                                              'prolabore', l.prolabore, 'encargos', l.encargos) order by l.competencia)
          from public.fr_lancamentos l where l.empresa_id = e.id), '[]'::jsonb),
        'registros', coalesce((
          select jsonb_agg(x order by x->>'created_at' desc) from (
            select jsonb_build_object('competencia', r.competencia, 'pa', r.pa, 'fator', r.fator, 'anexo', r.anexo, 'created_at', r.created_at) x
            from public.fr_registros r where r.empresa_id = e.id order by r.created_at desc limit 6) z), '[]'::jsonb)
      ) order by e.ativo desc, e.nome)
      from public.fr_empresas e
      left join public.profiles p on p.id = e.owner_user_id
      left join public.apur_companies c on c.id = e.apur_company_id
      where v_admin or e.owner_user_id = v_uid), '[]'::jsonb)
  );
end;
$$;

-- Empresas do Controle de Apuração que o usuário pode vincular (administrador: todas).
create or replace function public.fr_apur_empresas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_admin boolean := public.is_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.legal_name, 'cnpj', c.cnpj, 'regime', c.tax_regime,
                                        'owner_user_id', c.owner_user_id, 'owner_nome', coalesce(nullif(p.nome, ''), p.email, ''),
                                        'competencia_aberta', (select min(x.competence) from public.apur_periods x
                                                               where x.owner_user_id = c.owner_user_id and x.status <> 'CLOSED'))
                     order by c.legal_name)
    from public.apur_companies c left join public.profiles p on p.id = c.owner_user_id
    where not c.deleted and (v_admin or c.owner_user_id = v_uid)), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Gravação

-- Cria (sem "id") ou altera (com "id") uma empresa monitorada.
create or replace function public.fr_empresa_salvar(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_id uuid := nullif(p_dados->>'id', '')::uuid;
  v_nome text := public.fr_txt(p_dados->>'nome', 160);
  v_cnpj text := regexp_replace(coalesce(p_dados->>'cnpj', ''), '\D', '', 'g');
  v_cnae text := public.fr_txt(p_dados->>'cnae', 20);
  v_inicio text := public.fr_txt(p_dados->>'inicio_atividade', 7);
  v_obs text := public.apur_multiline(p_dados->>'observacoes', 1000);
  v_apur uuid := nullif(p_dados->>'apur_company_id', '')::uuid;
  v_ativo boolean := coalesce((p_dados->>'ativo')::boolean, true);
  e public.fr_empresas;
  ctx record;
begin
  if v_nome = '' then raise exception 'Informe o nome da empresa.'; end if;
  if v_cnpj <> '' and length(v_cnpj) not in (11, 14) then raise exception 'CNPJ (ou CPF) inválido.'; end if;
  if v_inicio <> '' and not public.apur_valid_comp(v_inicio) then raise exception 'Início de atividade inválido. Use AAAA-MM.'; end if;
  if v_apur is not null then
    select * into ctx from public.apur_company_context(v_apur, null);   -- confere permissão na empresa do Controle
  end if;
  if v_id is null then
    insert into public.fr_empresas (owner_user_id, nome, cnpj, cnae, inicio_atividade, apur_company_id, observacoes, ativo)
    values (v_uid, v_nome, v_cnpj, v_cnae, v_inicio, v_apur, v_obs, v_ativo) returning * into e;
  else
    perform public.fr_empresa_ctx(v_id);
    update public.fr_empresas set nome = v_nome, cnpj = v_cnpj, cnae = v_cnae, inicio_atividade = v_inicio,
      apur_company_id = v_apur, observacoes = v_obs, ativo = v_ativo, updated_at = now()
    where id = v_id returning * into e;
  end if;
  return jsonb_build_object('ok', true, 'id', e.id);
end;
$$;

-- Exclui a empresa e todos os lançamentos dela (pedido de confirmação fica na tela).
create or replace function public.fr_empresa_excluir(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fr_empresa_ctx(p_empresa);
  delete from public.fr_empresas where id = p_empresa;
  return jsonb_build_object('ok', true);
end;
$$;

-- Grava vários meses de uma vez: [{competencia, receita, salarios, prolabore, encargos}, ...].
-- Mês com todos os valores zerados é apagado.
create or replace function public.fr_lancamentos_salvar(p_empresa uuid, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  l jsonb;
  v_comp text;
  v_rec numeric; v_sal numeric; v_pro numeric; v_enc numeric;
  n integer := 0;
begin
  perform public.fr_empresa_ctx(p_empresa);
  if jsonb_typeof(coalesce(p_linhas, 'null'::jsonb)) <> 'array' then raise exception 'Lista de meses inválida.'; end if;
  if jsonb_array_length(p_linhas) > 240 then raise exception 'Envie no máximo 240 meses por vez.'; end if;
  for l in select * from jsonb_array_elements(p_linhas) loop
    v_comp := l->>'competencia';
    if not public.apur_valid_comp(v_comp) then raise exception 'Competência inválida: %', coalesce(v_comp, ''); end if;
    v_rec := public.fr_num(l->'receita'); v_sal := public.fr_num(l->'salarios');
    v_pro := public.fr_num(l->'prolabore'); v_enc := public.fr_num(l->'encargos');
    if v_rec = 0 and v_sal = 0 and v_pro = 0 and v_enc = 0 then
      delete from public.fr_lancamentos where empresa_id = p_empresa and competencia = v_comp;
    else
      insert into public.fr_lancamentos (empresa_id, competencia, receita, salarios, prolabore, encargos, updated_at, updated_by)
      values (p_empresa, v_comp, v_rec, v_sal, v_pro, v_enc, now(), v_uid)
      on conflict (empresa_id, competencia) do update set receita = excluded.receita, salarios = excluded.salarios,
        prolabore = excluded.prolabore, encargos = excluded.encargos, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    end if;
    n := n + 1;
  end loop;
  update public.fr_empresas set updated_at = now() where id = p_empresa;
  return jsonb_build_object('ok', true, 'meses', n);
end;
$$;

-- Registra o fator R na coluna "Pendência / obs. do mês" do Controle de Apuração da empresa vinculada.
-- Substitui uma linha "Fator R ..." anterior da mesma competência e mantém o restante do texto e a marcação de pendência.
create or replace function public.fr_registrar_apuracao(p_empresa uuid, p_competencia text, p_pa text, p_fator numeric,
                                                       p_folha12 numeric, p_receita12 numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  e public.fr_empresas;
  ctx record;
  v_anexo text;
  v_pct text;
  v_linha text;
  v_atual text;
  v_pend boolean;
  v_novo text;
begin
  e := public.fr_empresa_ctx(p_empresa);
  if e.apur_company_id is null then raise exception 'Vincule a empresa a uma linha do Controle de Apuração antes de registrar.'; end if;
  if not public.apur_valid_comp(p_competencia) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  if not public.apur_valid_comp(p_pa) then raise exception 'Período de apuração inválido. Use AAAA-MM.'; end if;
  if p_fator is null or p_fator < 0 or p_fator > 100 then raise exception 'Fator R inválido.'; end if;
  select * into ctx from public.apur_company_context(e.apur_company_id, p_competencia);  -- dono da linha ou administrador
  perform public.apur_assert_membership_mutable(ctx.o_owner, p_competencia);            -- competência fechada ou ainda não gerada: bloqueia
  v_anexo := case when p_fator >= 0.28 then 'III' else 'V' end;
  v_pct := replace(to_char(round(p_fator * 100, 2), 'FM9999990.00'), '.', ',');
  v_linha := 'Fator R (PA ' || substr(p_pa, 6, 2) || '/' || substr(p_pa, 1, 4) || '): ' || v_pct || '% — Anexo ' || v_anexo;
  if coalesce(p_folha12, 0) > 0 or coalesce(p_receita12, 0) > 0 then
    v_linha := v_linha || ' (folha 12m R$ ' || replace(replace(replace(to_char(round(coalesce(p_folha12, 0), 2), 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.')
               || ' ÷ receita 12m R$ ' || replace(replace(replace(to_char(round(coalesce(p_receita12, 0), 2), 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.') || ')';
  end if;
  v_linha := v_linha || ' · registrado em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  select note, is_pending into v_atual, v_pend from public.apur_monthly_notes
  where company_id = e.apur_company_id and competence = p_competencia;
  v_atual := coalesce(v_atual, '');
  -- remove registros anteriores do fator R e linhas vazias nas pontas
  select coalesce(string_agg(t, E'\n' order by n), '') into v_novo
  from (select t, n from regexp_split_to_table(v_atual, E'\n') with ordinality as s(t, n)
        where t !~ '^\s*Fator R \(PA ') z;
  v_novo := btrim(v_novo, E' \n\r\t');
  v_novo := case when v_novo = '' then v_linha else v_novo || E'\n' || v_linha end;
  if length(v_novo) > 4000 then raise exception 'A observação do mês ficaria com mais de 4.000 caracteres. Reduza o texto atual no Controle de Apuração.'; end if;
  perform public.apur_set_monthly_note(e.apur_company_id, p_competencia, v_novo, coalesce(v_pend, false));
  insert into public.fr_registros (empresa_id, apur_company_id, competencia, pa, fator, anexo, linha, created_by)
  values (e.id, e.apur_company_id, p_competencia, p_pa, round(p_fator, 6), v_anexo, v_linha, v_uid);
  return jsonb_build_object('ok', true, 'linha', v_linha, 'nota', v_novo);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões das funções

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fr\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'fr_listar()', 'fr_apur_empresas()', 'fr_empresa_salvar(jsonb)', 'fr_empresa_excluir(uuid)',
    'fr_lancamentos_salvar(uuid, jsonb)', 'fr_registrar_apuracao(uuid, text, text, numeric, numeric, numeric)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
