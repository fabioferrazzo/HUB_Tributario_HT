-- HUB Depto Tributário: Controle de Apuração (reconstrução no HUB) — Etapa 1: base de dados e regras
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez).
-- Equivalente ao servidor do app "Controle de Apuração" v0.11.8 FIX13 (+ SALVARFECHAR01, COLRENAME01, CELLNOTE01…),
-- com usuários do HUB: administrador do HUB = ADM do app; demais usuários ativos = donos de carteira.

begin;

-- ---------------------------------------------------------------------------------------------
-- Tabelas

create table if not exists public.apur_companies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id),
  legal_name text not null,
  cnpj text not null default '',
  dominio_code text not null default '',
  tax_regime text not null default 'OUTROS',
  envio text not null default '',
  particularities text not null default '',
  notes text not null default '',
  checklist jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists apur_companies_owner_idx on public.apur_companies (owner_user_id, deleted, display_order);

create table if not exists public.apur_periods (
  owner_user_id uuid not null references public.profiles(id),
  competence text not null check (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'REOPENED')),
  source_competence text,
  layout jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  opened_by uuid references public.profiles(id),
  saved_at timestamptz,
  saved_by uuid references public.profiles(id),
  reopened_at timestamptz,
  reopened_by uuid references public.profiles(id),
  progress_saved_at timestamptz,
  progress_saved_by uuid references public.profiles(id),
  primary key (owner_user_id, competence)
);

create table if not exists public.apur_snapshots (
  company_id uuid not null references public.apur_companies(id),
  competence text not null,
  owner_user_id uuid references public.profiles(id),
  legal_name text not null,
  cnpj text not null default '',
  dominio_code text not null default '',
  tax_regime text not null default 'OUTROS',
  envio text not null default '',
  particularities text not null default '',
  notes text not null default '',
  checklist jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, competence)
);
create index if not exists apur_snapshots_owner_idx on public.apur_snapshots (owner_user_id, competence, display_order);

create table if not exists public.apur_checks (
  company_id uuid not null references public.apur_companies(id),
  competence text not null,
  item_id text not null,
  item_label text not null default '',
  status text not null default 'PENDING' check (status in ('PENDING', 'DONE', 'ALERT', 'NA')),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  primary key (company_id, competence, item_id)
);
create index if not exists apur_checks_comp_idx on public.apur_checks (competence, company_id);

create table if not exists public.apur_monthly_notes (
  company_id uuid not null references public.apur_companies(id),
  competence text not null,
  note text not null default '',
  is_pending boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  primary key (company_id, competence)
);

create table if not exists public.apur_admin_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.apur_companies(id),
  competence text not null,
  item_id text not null default '__ROW__',
  item_label text,
  note_type text not null default 'MESSAGE' check (note_type in ('MESSAGE', 'DIRECTIVE', 'RECORD')),
  note text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_by uuid references public.profiles(id),
  archived_at timestamptz
);
create index if not exists apur_admin_notes_idx on public.apur_admin_notes (company_id, competence, active);

create table if not exists public.apur_visual_marks (
  company_id uuid not null references public.apur_companies(id),
  competence text not null,
  item_id text not null default '__ROW__',
  color text not null check (color in ('YELLOW', 'ORANGE', 'GREEN')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  primary key (company_id, competence, item_id)
);

create table if not exists public.apur_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.apur_companies(id),
  competence text,
  original_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint not null default 0,
  sha256 text not null default '',
  note text not null default '',
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id)
);
create index if not exists apur_documents_company_idx on public.apur_documents (company_id, deleted, created_at);

create table if not exists public.apur_alerts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null default '',
  severity text not null default 'INFO' check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  active boolean not null default true,
  starts_on date,
  ends_on date,
  target_all boolean not null default true,
  target_user_ids uuid[] not null default '{}',
  font_size integer not null default 15 check (font_size between 12 and 28),
  is_bold boolean not null default false,
  highlight_yellow boolean not null default false,
  deleted boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id)
);

create table if not exists public.apur_audit (
  id bigserial primary key,
  user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists apur_audit_created_idx on public.apur_audit (created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Funções auxiliares (texto, regime, competência)

create or replace function public.apur_txt(p text)
returns text language sql immutable as $$
  select coalesce(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '')
$$;

create or replace function public.apur_multiline(p text, p_max integer default 4000)
returns text language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(replace(replace(coalesce(p, ''), E'\r\n', E'\n'), E'\r', E'\n'), E'[ \t]+', ' ', 'g'), E' +\n', E'\n', 'g')), p_max)
$$;

create or replace function public.apur_norm_key(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
    translate(lower(public.apur_txt(p)),
      'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
      'aaaaaaeeeeiiiiooooouuuucnyy'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function public.apur_item_slug(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(public.apur_norm_key(p), '[^a-z0-9]+', '-', 'g'), '-')
$$;

create or replace function public.apur_regime_code(p text)
returns text language plpgsql immutable as $$
declare
  k text := public.apur_norm_key(p);
  compact text := replace(k, ' ', '');
  t text[] := string_to_array(k, ' ');
begin
  if compact in ('sn', 'simples') or 'sn' = any(t) or position('simplesnacional' in compact) > 0
     or ('simples' = any(t) and 'nacional' = any(t)) then
    return 'SN';
  end if;
  if compact in ('lp', 'presumido') or 'lp' = any(t) or position('lucropresumido' in compact) > 0
     or ('lucro' = any(t) and 'presumido' = any(t)) then
    return 'LP';
  end if;
  if compact in ('lr', 'real') or 'lr' = any(t) or position('lucroreal' in compact) > 0
     or ('lucro' = any(t) and 'real' = any(t)) then
    return 'LR';
  end if;
  return 'OTHER';
end;
$$;

create or replace function public.apur_canonical_regime(p text, p_fallback text default 'OUTROS')
returns text language sql immutable as $$
  select case public.apur_regime_code(p)
    when 'SN' then 'SIMPLES NACIONAL'
    when 'LP' then 'LUCRO PRESUMIDO'
    when 'LR' then 'LUCRO REAL'
    else coalesce(nullif(upper(public.apur_txt(p)), ''), p_fallback)
  end
$$;

create or replace function public.apur_default_labels(p_regime text)
returns text[] language sql immutable as $$
  select case public.apur_canonical_regime(p_regime)
    when 'SIMPLES NACIONAL' then array['Saídas','Entradas','Simples','ISS','REINF','ICMS','DeSTDA','DIRBI','FUNRURAL','Enviado']
    when 'LUCRO PRESUMIDO' then array['Saídas','Entradas','ISS','CSLL','IRPJ','ICMS','PIS/COFINS','REINF','EFD Contrib.','EFD ICMS/GIA','DIRBI','FUNRURAL','Aplicações','Enviado']
    when 'LUCRO REAL' then array['Saídas','Entradas','ISS','CSLL','IRPJ','ICMS','PIS/COFINS','REINF','EFD Contrib.','EFD ICMS/GIA','DIRBI','FUNRURAL','Aplicações','Enviado']
    when 'COOPERATIVA' then array['Saídas','Entradas','ISS','CSLL','IRPJ','ICMS','PIS/COFINS','REINF','EFD Contrib.','EFD ICMS/GIA','DIRBI','FUNRURAL','Aplicações','Enviado']
    else array['Saídas','Entradas','ISS','ICMS','REINF','Enviado']
  end
$$;

create or replace function public.apur_checklist_for_regime(p_regime text)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', coalesce(nullif(public.apur_item_slug(l), ''), gen_random_uuid()::text), 'label', l) order by o), '[]'::jsonb)
  from unnest(public.apur_default_labels(p_regime)) with ordinality as x(l, o)
$$;

create or replace function public.apur_clean_cnpj(p text)
returns text language sql immutable as $$ select regexp_replace(coalesce(p, ''), '\D', '', 'g') $$;

create or replace function public.apur_valid_cnpj(p text)
returns boolean language plpgsql immutable as $$
declare
  d text := public.apur_clean_cnpj(p);
  n int[];
  sz int; total int; rem int; chk int; i int; w int[];
begin
  if d = '' then return true; end if;
  if length(d) <> 14 or d = repeat(left(d, 1), 14) then return false; end if;
  n := array(select substr(d, g, 1)::int from generate_series(1, 14) g);
  foreach sz in array array[12, 13] loop
    w := array(select g from generate_series(sz - 7, 2, -1) g) || array[9,8,7,6,5,4,3,2];
    total := 0;
    for i in 1..sz loop total := total + n[i] * w[i]; end loop;
    rem := total % 11;
    chk := case when rem < 2 then 0 else 11 - rem end;
    if n[sz + 1] <> chk then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function public.apur_domain_code(p text)
returns text language sql immutable as $$
  select case when public.apur_txt(p) ~ '^\d+\.0$' then left(public.apur_txt(p), -2) else public.apur_txt(p) end
$$;

create or replace function public.apur_valid_comp(p text)
returns boolean language sql immutable as $$ select coalesce(p, '') ~ '^\d{4}-(0[1-9]|1[0-2])$' $$;

create or replace function public.apur_prev_comp(p text)
returns text language sql immutable as $$
  select case when public.apur_valid_comp(p) then to_char(to_date(p || '-01', 'YYYY-MM-DD') - interval '1 month', 'YYYY-MM') else '' end
$$;

create or replace function public.apur_next_comp(p text)
returns text language sql immutable as $$
  select case when public.apur_valid_comp(p) then to_char(to_date(p || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM') else '' end
$$;

-- SALVARFECHAR01: de 11/2026 em diante, "Salvar" só grava e "Fechar Apuração" encerra o período.
create or replace function public.apur_separate_close(p text)
returns boolean language sql immutable as $$ select coalesce(p, '') >= '2026-11' $$;

create or replace function public.apur_encerrada(p text)
returns text language sql immutable as $$ select case when public.apur_separate_close(p) then 'fechada' else 'salva' end $$;

create or replace function public.apur_comp_label(p text)
returns text language sql immutable as $$
  select case when public.apur_valid_comp(p) then substr(p, 6, 2) || '/' || substr(p, 1, 4) else coalesce(p, '') end
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões e contexto

-- Dono de carteira: usuário ativo do HUB que não é administrador.
create or replace function public.apur_active_owner(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_uid and p.active and p.role::text <> 'admin')
$$;

create or replace function public.apur_require_user()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Sessão inválida ou usuário inativo.';
  end if;
  return auth.uid();
end;
$$;

-- Carteira em que a operação atua: o ADM informa o responsável; o usuário comum só atua na própria.
create or replace function public.apur_resolve_owner(p_owner uuid, p_msg text default 'Selecione um responsável.')
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
begin
  if public.is_admin() then
    if p_owner is null then raise exception '%', p_msg; end if;
    if not public.apur_active_owner(p_owner) then raise exception 'Responsável não encontrado ou inativo.'; end if;
    return p_owner;
  end if;
  if p_owner is not null and p_owner <> v_uid then
    raise exception 'Sem permissão para alterar outra carteira.';
  end if;
  return v_uid;
end;
$$;

create or replace function public.apur_audit_log(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.apur_audit (user_id, action, entity_type, entity_id, details) values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------
-- Competências (períodos) e fotografias

create or replace function public.apur_has_later(p_owner uuid, p_comp text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.apur_periods where owner_user_id = p_owner and competence > p_comp)
$$;

create or replace function public.apur_later_comp(p_owner uuid, p_comp text)
returns text language sql stable security definer set search_path = public as $$
  select competence from public.apur_periods where owner_user_id = p_owner and competence > p_comp order by competence limit 1
$$;

-- Competência reaberta com mês posterior: a fotografia do mês é a única fonte editável.
create or replace function public.apur_historical_only(p_owner uuid, p_comp text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.apur_valid_comp(p_comp) and exists (
    select 1 from public.apur_periods p
    where p.owner_user_id = p_owner and p.competence = p_comp and p.status = 'REOPENED'
      and public.apur_has_later(p_owner, p_comp)
  )
$$;

create or replace function public.apur_ensure_period(p_owner uuid, p_comp text, p_by uuid default null, p_source text default null, p_layout jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.apur_valid_comp(p_comp) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  insert into public.apur_periods (owner_user_id, competence, status, source_competence, layout, opened_at, opened_by)
  values (p_owner, p_comp, 'OPEN', coalesce(p_source, public.apur_prev_comp(p_comp)), coalesce(p_layout, '{}'::jsonb), now(), p_by)
  on conflict (owner_user_id, competence) do nothing;
end;
$$;

create or replace function public.apur_assert_mutable(p_owner uuid, p_comp text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.apur_periods where owner_user_id = p_owner and competence = p_comp and status = 'CLOSED') then
    raise exception 'Esta apuração está % e bloqueada. Reabra a competência antes de alterar dados.', public.apur_encerrada(p_comp);
  end if;
end;
$$;

-- FIX08: inclusão/exclusão de linhas só em período existente, exceto na primeira competência da carteira.
create or replace function public.apur_assert_membership_mutable(p_owner uuid, p_comp text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform public.apur_assert_mutable(p_owner, p_comp);
  if not exists (select 1 from public.apur_periods where owner_user_id = p_owner and competence = p_comp)
     and exists (select 1 from public.apur_periods where owner_user_id = p_owner) then
    raise exception 'A competência % ainda não foi gerada. Abra a última apuração % e use Gerar novo período.',
      public.apur_comp_label(p_comp), public.apur_encerrada(public.apur_prev_comp(p_comp));
  end if;
end;
$$;

create or replace function public.apur_competence_has_data(p_owner uuid, p_comp text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.apur_periods where owner_user_id = p_owner and competence = p_comp)
      or exists (select 1 from public.apur_snapshots where owner_user_id = p_owner and competence = p_comp)
      or exists (select 1 from public.apur_checks x join public.apur_companies c on c.id = x.company_id where c.owner_user_id = p_owner and x.competence = p_comp)
      or exists (select 1 from public.apur_monthly_notes x join public.apur_companies c on c.id = x.company_id where c.owner_user_id = p_owner and x.competence = p_comp)
      or exists (select 1 from public.apur_visual_marks x join public.apur_companies c on c.id = x.company_id where c.owner_user_id = p_owner and x.competence = p_comp)
      or exists (select 1 from public.apur_admin_notes x join public.apur_companies c on c.id = x.company_id where c.owner_user_id = p_owner and x.competence = p_comp)
$$;

create or replace function public.apur_normalize_company_order(p_owner uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ordered as (
    select id, row_number() over (order by case when display_order > 0 then 0 else 1 end, display_order, lower(legal_name), id) as pos
    from public.apur_companies where owner_user_id = p_owner and not deleted
  )
  update public.apur_companies c set display_order = o.pos from ordered o where c.id = o.id and c.display_order <> o.pos;
  select count(*) into n from public.apur_companies where owner_user_id = p_owner and not deleted;
  return n;
end;
$$;

create or replace function public.apur_next_company_order(p_owner uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(max(display_order), 0) + 1 from public.apur_companies where owner_user_id = p_owner and not deleted
$$;

create or replace function public.apur_normalize_snapshot_order(p_owner uuid, p_comp text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ordered as (
    select company_id, row_number() over (order by case when display_order > 0 then 0 else 1 end, display_order, lower(legal_name), company_id) as pos
    from public.apur_snapshots where owner_user_id = p_owner and competence = p_comp
  )
  update public.apur_snapshots s set display_order = o.pos, updated_at = now()
  from ordered o where s.company_id = o.company_id and s.competence = p_comp and s.display_order <> o.pos;
  select count(*) into n from public.apur_snapshots where owner_user_id = p_owner and competence = p_comp;
  return n;
end;
$$;

create or replace function public.apur_capture_snapshots(p_owner uuid, p_comp text, p_by uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.apur_valid_comp(p_comp) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  perform public.apur_assert_mutable(p_owner, p_comp);
  perform public.apur_ensure_period(p_owner, p_comp, p_by);
  insert into public.apur_snapshots (company_id, competence, owner_user_id, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order, created_at, updated_at)
  select id, p_comp, p_owner, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order, now(), now()
  from public.apur_companies where owner_user_id = p_owner and not deleted
  on conflict (company_id, competence) do update set
    owner_user_id = excluded.owner_user_id, legal_name = excluded.legal_name, cnpj = excluded.cnpj, dominio_code = excluded.dominio_code,
    tax_regime = excluded.tax_regime, envio = excluded.envio, particularities = excluded.particularities, notes = excluded.notes,
    checklist = excluded.checklist, display_order = excluded.display_order, updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.apur_ensure_snapshot(p_company uuid, p_comp text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.apur_snapshots;
  c public.apur_companies;
begin
  if not public.apur_valid_comp(p_comp) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  select * into s from public.apur_snapshots where company_id = p_company and competence = p_comp;
  if found then
    perform public.apur_assert_mutable(coalesce(s.owner_user_id, (select owner_user_id from public.apur_companies where id = p_company)), p_comp);
    return;
  end if;
  select * into c from public.apur_companies where id = p_company and not deleted;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  perform public.apur_assert_mutable(c.owner_user_id, p_comp);
  perform public.apur_ensure_period(c.owner_user_id, p_comp, null);
  insert into public.apur_snapshots (company_id, competence, owner_user_id, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order)
  values (p_company, p_comp, c.owner_user_id, c.legal_name, c.cnpj, c.dominio_code, c.tax_regime, c.envio, c.particularities, c.notes, c.checklist, c.display_order);
end;
$$;

-- Período "travado" para a sincronização do cadastro mestre: fechado, ou reaberto com mês posterior.
create or replace function public.apur_period_frozen(p_owner uuid, p_comp text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.apur_periods cp
    where cp.owner_user_id = p_owner and cp.competence = p_comp
      and (cp.status = 'CLOSED' or (cp.status = 'REOPENED' and exists (
        select 1 from public.apur_periods later where later.owner_user_id = cp.owner_user_id and later.competence > cp.competence)))
  )
$$;

-- Sincroniza o cadastro mestre apenas com competências ainda mutáveis (fotografias salvas nunca são reescritas).
create or replace function public.apur_sync_master_history(p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  c public.apur_companies;
  n integer;
  it jsonb;
begin
  select * into c from public.apur_companies where id = p_company and not deleted;
  if not found then return 0; end if;
  update public.apur_snapshots s set
    owner_user_id = c.owner_user_id, legal_name = c.legal_name, cnpj = c.cnpj, dominio_code = c.dominio_code, tax_regime = c.tax_regime,
    envio = c.envio, particularities = c.particularities, notes = c.notes, checklist = c.checklist, display_order = c.display_order, updated_at = now()
  where s.company_id = p_company and not public.apur_period_frozen(s.owner_user_id, s.competence);
  get diagnostics n = row_count;
  for it in select * from jsonb_array_elements(coalesce(c.checklist, '[]'::jsonb)) loop
    if public.apur_txt(it->>'id') <> '' and public.apur_txt(it->>'label') <> '' then
      update public.apur_checks mc set item_label = public.apur_txt(it->>'label')
      where mc.company_id = p_company and mc.item_id = public.apur_txt(it->>'id')
        and not exists (
          select 1 from public.apur_snapshots cs
          where cs.company_id = mc.company_id and cs.competence = mc.competence and public.apur_period_frozen(cs.owner_user_id, cs.competence));
    end if;
  end loop;
  return n;
end;
$$;

-- Métrica mensal de uma empresa (mesma regra do app: DONE só com todos os itens DONE/N/A, sem alerta e sem pendência).
create or replace function public.apur_company_metrics(p_company uuid, p_comp text, p_checklist jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_statuses text[];
  v_applicable int; v_done int; v_total int;
  v_progress int;
  v_pending boolean := false; v_obs boolean := false;
  v_alert boolean; v_all_done boolean; v_started boolean; v_notes int;
  v_overall text;
begin
  select array_agg(coalesce(mc.status, 'PENDING') order by x.o)
    into v_statuses
  from jsonb_array_elements(coalesce(p_checklist, '[]'::jsonb)) with ordinality as x(item, o)
  left join public.apur_checks mc on mc.company_id = p_company and mc.competence = p_comp and mc.item_id = x.item->>'id'
  where coalesce(x.item->>'id', '') <> '';
  v_statuses := coalesce(v_statuses, '{}');
  v_total := cardinality(v_statuses);
  select count(*) filter (where s <> 'NA'), count(*) filter (where s = 'DONE') into v_applicable, v_done from unnest(v_statuses) s;
  v_progress := case when v_applicable > 0 then round(v_done::numeric * 100 / v_applicable) when v_total > 0 then 100 else 0 end;
  select coalesce(is_pending, false), public.apur_txt(note) <> '' into v_pending, v_obs
  from public.apur_monthly_notes where company_id = p_company and competence = p_comp;
  v_pending := coalesce(v_pending, false); v_obs := coalesce(v_obs, false);
  v_alert := 'ALERT' = any(v_statuses);
  v_all_done := v_total > 0 and not exists (select 1 from unnest(v_statuses) s where s not in ('DONE', 'NA'));
  v_overall := case when v_pending or v_alert then 'ALERT' when v_all_done then 'DONE' else 'PENDING' end;
  v_started := exists (select 1 from public.apur_snapshots where company_id = p_company and competence = p_comp)
            or exists (select 1 from public.apur_checks where company_id = p_company and competence = p_comp)
            or exists (select 1 from public.apur_monthly_notes where company_id = p_company and competence = p_comp)
            or exists (select 1 from public.apur_admin_notes where company_id = p_company and competence = p_comp);
  select count(*) into v_notes from public.apur_admin_notes where company_id = p_company and competence = p_comp and active;
  return jsonb_build_object('overall', v_overall, 'progress', v_progress, 'started', v_started, 'has_pending', v_pending,
    'has_obs', v_obs, 'has_check_alert', v_alert, 'admin_notes', v_notes);
end;
$$;

create or replace function public.apur_completion_summary_internal(p_owner uuid, p_comp text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r record; m jsonb; total int := 0;
  incomplete jsonb := '[]'::jsonb;
begin
  for r in select * from public.apur_snapshots where owner_user_id = p_owner and competence = p_comp order by display_order, lower(legal_name) loop
    total := total + 1;
    m := public.apur_company_metrics(r.company_id, p_comp, r.checklist);
    if m->>'overall' <> 'DONE' then
      incomplete := incomplete || jsonb_build_array(jsonb_build_object('company_id', r.company_id, 'legal_name', r.legal_name, 'overall', m->>'overall', 'progress', (m->>'progress')::int));
    end if;
  end loop;
  return jsonb_build_object('competence', p_comp, 'total', total, 'done', total - jsonb_array_length(incomplete),
    'incomplete_count', jsonb_array_length(incomplete), 'incomplete', incomplete);
end;
$$;

-- Contexto da empresa na competência (inclusive linha histórica cujo cadastro atual foi excluído).
-- Retorna o dono da carteira naquela competência e valida o acesso do usuário.
create or replace function public.apur_company_context(p_company uuid, p_comp text, out o_owner uuid, out o_has_company boolean, out o_company_deleted boolean, out o_has_snapshot boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  c public.apur_companies;
  s public.apur_snapshots;
begin
  select * into c from public.apur_companies where id = p_company;
  o_has_company := found;
  o_company_deleted := coalesce(c.deleted, true);
  o_has_snapshot := false;
  if p_comp is not null and public.apur_valid_comp(p_comp) then
    select * into s from public.apur_snapshots where company_id = p_company and competence = p_comp;
    if found then
      o_has_snapshot := true;
      o_owner := coalesce(s.owner_user_id, c.owner_user_id);
    end if;
  end if;
  if o_owner is null and o_has_company then o_owner := c.owner_user_id; end if;
  if not o_has_company and not o_has_snapshot then raise exception 'Empresa não encontrada.'; end if;
  if not public.is_admin() and o_owner is distinct from auth.uid() then raise exception 'Sem permissão.'; end if;
  if not o_has_snapshot and (not o_has_company or o_company_deleted) then raise exception 'Empresa não encontrada.'; end if;
end;
$$;

-- Regime: itens que faltam (Lucro Presumido/Real/Cooperativa sem nenhum item próprio do regime).
create or replace function public.apur_add_missing_regime_items(p_items jsonb, p_regime text)
returns jsonb language plpgsql immutable as $$
declare
  v_regime text := public.apur_canonical_regime(p_regime);
  v_proprios text[];
  v_tem text[];
  v_defaults jsonb;
  v_out jsonb := '[]'::jsonb;
  d jsonb; i jsonb; k text;
  v_used text[] := '{}';
  v_ids text[] := '{}';
  v_id text;
  v_by jsonb := '{}'::jsonb;
begin
  if v_regime not in ('LUCRO PRESUMIDO', 'LUCRO REAL', 'COOPERATIVA') then return p_items; end if;
  select array_agg(public.apur_norm_key(l)) into v_proprios from unnest(public.apur_default_labels(v_regime)) l
  where public.apur_norm_key(l) not in (select public.apur_norm_key(x) from unnest(public.apur_default_labels('SIMPLES NACIONAL')) x);
  select coalesce(array_agg(public.apur_norm_key(e->>'label')), '{}') into v_tem from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where jsonb_typeof(e) = 'object';
  if v_proprios && v_tem then return p_items; end if;
  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if jsonb_typeof(i) = 'object' and public.apur_txt(i->>'label') <> '' and not (v_by ? public.apur_norm_key(i->>'label')) then
      v_by := v_by || jsonb_build_object(public.apur_norm_key(i->>'label'), i);
    end if;
  end loop;
  v_defaults := public.apur_checklist_for_regime(v_regime);
  for d in select * from jsonb_array_elements(v_defaults) loop
    k := public.apur_norm_key(d->>'label');
    v_out := v_out || jsonb_build_array(coalesce(v_by->k, d));
    v_used := v_used || k;
  end loop;
  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if jsonb_typeof(i) = 'object' and not (public.apur_norm_key(i->>'label') = any(v_used)) then
      v_out := v_out || jsonb_build_array(i);
    end if;
  end loop;
  -- ids únicos
  select jsonb_agg(case when rn > 1 then e || jsonb_build_object('id', (e->>'id') || '-' || (o - 1)) else e end order by o)
    into v_out
  from (select e, o, row_number() over (partition by e->>'id' order by o) rn from jsonb_array_elements(v_out) with ordinality x(e, o)) z;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;

-- REGIME01: troca de regime -> itens do novo regime + itens personalizados (mantém ids existentes).
create or replace function public.apur_merge_checklist_for_regime(p_company uuid, p_comp text, p_items jsonb, p_regime text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_defaults jsonb := public.apur_checklist_for_regime(p_regime);
  v_known text[];
  v_keep text[] := '{}';
  v_by jsonb := '{}'::jsonb;
  v_out jsonb := '[]'::jsonb;
  v_used text[] := '{}';
  d jsonb; i jsonb; k text; old jsonb;
begin
  select array_agg(distinct public.apur_norm_key(l)) into v_known
  from unnest(public.apur_default_labels('SIMPLES NACIONAL') || public.apur_default_labels('LUCRO PRESUMIDO') || public.apur_default_labels('OUTROS')) l;
  if p_comp is not null then
    select coalesce(array_agg(item_id), '{}') into v_keep from public.apur_checks
    where company_id = p_company and competence = p_comp and (status <> 'PENDING' or coalesce(note, '') <> '');
  end if;
  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    k := public.apur_norm_key(i->>'label');
    if k <> '' then v_by := v_by || jsonb_build_object(k, i); end if;
  end loop;
  for d in select * from jsonb_array_elements(v_defaults) loop
    k := public.apur_norm_key(d->>'label'); old := v_by->k;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', coalesce(nullif(old->>'id', ''), d->>'id'), 'label', d->>'label'));
    v_used := v_used || k;
  end loop;
  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    k := public.apur_norm_key(i->>'label');
    if k = '' or k = any(v_used) then continue; end if;
    if not (k = any(v_known)) or (i->>'id') = any(v_keep) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', coalesce(nullif(i->>'id', ''), public.apur_item_slug(k)), 'label', i->>'label'));
      v_used := v_used || k;
    end if;
  end loop;
  select jsonb_agg(case when rn > 1 then e || jsonb_build_object('id', (e->>'id') || '-' || (o - 1)) else e end order by o)
    into v_out
  from (select e, o, row_number() over (partition by e->>'id' order by o) rn from jsonb_array_elements(v_out) with ordinality x(e, o)) z;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;

-- COLRENAME01: empresa nova herda os títulos que a carteira já usa para os mesmos itens.
create or replace function public.apur_align_labels(p_owner uuid, p_items jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  with votes as (
    select lower(public.apur_txt(e->>'id')) as iid, public.apur_txt(e->>'label') as label, count(*) as n
    from public.apur_companies c, jsonb_array_elements(c.checklist) e
    where c.owner_user_id = p_owner and not c.deleted and jsonb_typeof(e) = 'object'
      and public.apur_txt(e->>'id') <> '' and public.apur_txt(e->>'label') <> ''
    group by 1, 2
  ), best as (
    select distinct on (iid) iid, label from votes order by iid, n desc, label
  )
  select coalesce(jsonb_agg(case when b.label is not null then x.e || jsonb_build_object('label', b.label) else x.e end order by x.o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality x(e, o)
  left join best b on b.iid = lower(public.apur_txt(x.e->>'id'))
$$;

-- Duplicidade na carteira (cadastro atual) ou na fotografia de uma competência.
create or replace function public.apur_duplicate_reason(p_owner uuid, p_name text, p_cnpj text, p_dominio text, p_exclude uuid default null, p_comp text default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_cnpj text := public.apur_clean_cnpj(p_cnpj);
  v_dom text := lower(public.apur_domain_code(p_dominio));
  v_suffix text := case when p_comp is null then '' else ' nesta competência' end;
begin
  for r in
    select id as cid, legal_name, cnpj, dominio_code from public.apur_companies where p_comp is null and owner_user_id = p_owner and not deleted
    union all
    select company_id, legal_name, cnpj, dominio_code from public.apur_snapshots where p_comp is not null and owner_user_id = p_owner and competence = p_comp
  loop
    if p_exclude is not null and r.cid = p_exclude then continue; end if;
    if v_cnpj <> '' and public.apur_clean_cnpj(r.cnpj) = v_cnpj then return 'CNPJ já cadastrado' || v_suffix; end if;
    if v_dom <> '' and lower(public.apur_domain_code(r.dominio_code)) = v_dom then return 'Código Domínio já cadastrado' || v_suffix; end if;
    if v_cnpj = '' and v_dom = '' and public.apur_norm_key(r.legal_name) = public.apur_norm_key(p_name) then return 'Nome da empresa já cadastrado' || v_suffix; end if;
  end loop;
  return null;
end;
$$;

create or replace function public.apur_duplicate_company_id(p_owner uuid, p_name text, p_cnpj text, p_dominio text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_cnpj text := public.apur_clean_cnpj(p_cnpj);
  v_dom text := lower(public.apur_domain_code(p_dominio));
begin
  for r in select id, legal_name, cnpj, dominio_code from public.apur_companies where owner_user_id = p_owner and not deleted loop
    if (v_cnpj <> '' and public.apur_clean_cnpj(r.cnpj) = v_cnpj)
       or (v_dom <> '' and lower(public.apur_domain_code(r.dominio_code)) = v_dom)
       or (v_cnpj = '' and v_dom = '' and public.apur_norm_key(r.legal_name) = public.apur_norm_key(p_name)) then
      return r.id;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.apur_clean_checklist(p_items jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', public.apur_txt(e->>'id'), 'label', public.apur_txt(e->>'label')) order by o), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) with ordinality x(e, o)
  where jsonb_typeof(e) = 'object' and public.apur_txt(e->>'id') <> '' and public.apur_txt(e->>'label') <> ''
$$;

-- ---------------------------------------------------------------------------------------------
-- Operações (chamadas pelo app; todas validam permissão e competência)

-- Empresa: criar (cadastro atual ou, em competência histórica reaberta, só na fotografia do mês).
create or replace function public.apur_company_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_owner uuid;
  v_name text := public.apur_txt(p->>'legal_name');
  v_cnpj text := public.apur_clean_cnpj(p->>'cnpj');
  v_dom text := public.apur_domain_code(p->>'dominio_code');
  v_regime text := public.apur_canonical_regime(coalesce(nullif(p->>'tax_regime', ''), 'OUTROS'));
  v_checklist jsonb;
  v_comp text := nullif(public.apur_txt(p->>'competence'), '');
  v_cid uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_reason text;
  v_hist boolean := false;
  v_match uuid;
  v_order int;
begin
  v_owner := case when public.is_admin() and nullif(p->>'owner_user_id', '') is not null then (p->>'owner_user_id')::uuid else v_uid end;
  if v_name = '' then raise exception 'Nome da empresa é obrigatório.'; end if;
  if v_cnpj <> '' and not public.apur_valid_cnpj(v_cnpj) then raise exception 'CNPJ inválido. Confira os 14 dígitos.'; end if;
  if not public.apur_active_owner(v_owner) then raise exception 'Responsável não encontrado ou inativo.'; end if;
  v_checklist := public.apur_clean_checklist(p->'checklist');
  if jsonb_array_length(v_checklist) = 0 then v_checklist := public.apur_checklist_for_regime(v_regime); end if;
  if v_comp is not null then
    perform public.apur_assert_membership_mutable(v_owner, v_comp);
    v_hist := public.apur_historical_only(v_owner, v_comp);
  end if;
  if v_hist then
    v_reason := public.apur_duplicate_reason(v_owner, v_name, v_cnpj, v_dom, null, v_comp);
    if v_reason is not null then raise exception '%.', v_reason; end if;
    v_match := public.apur_duplicate_company_id(v_owner, v_name, v_cnpj, v_dom);
    if v_match is not null then
      v_cid := v_match;
    else
      insert into public.apur_companies (id, owner_user_id, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order, deleted)
      values (v_cid, v_owner, v_name, v_cnpj, v_dom, v_regime, public.apur_txt(p->>'envio'), public.apur_txt(p->>'particularities'), public.apur_txt(p->>'notes'), v_checklist, 0, true);
    end if;
    select coalesce(max(display_order), 0) + 1 into v_order from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp;
    insert into public.apur_snapshots (company_id, competence, owner_user_id, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order)
    values (v_cid, v_comp, v_owner, v_name, v_cnpj, v_dom, v_regime, public.apur_txt(p->>'envio'), public.apur_txt(p->>'particularities'), public.apur_txt(p->>'notes'), v_checklist, v_order);
    perform public.apur_audit_log('CREATE_HISTORICAL', 'company', v_cid::text, jsonb_build_object('legal_name', v_name, 'owner_user_id', v_owner, 'competence', v_comp, 'historical_only', true));
  else
    v_reason := public.apur_duplicate_reason(v_owner, v_name, v_cnpj, v_dom);
    if v_reason is not null then raise exception '% para este responsável.', v_reason; end if;
    v_checklist := public.apur_align_labels(v_owner, v_checklist);
    insert into public.apur_companies (id, owner_user_id, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order, deleted)
    values (v_cid, v_owner, v_name, v_cnpj, v_dom, v_regime, public.apur_txt(p->>'envio'), public.apur_txt(p->>'particularities'), public.apur_txt(p->>'notes'), v_checklist, public.apur_next_company_order(v_owner), false);
    if v_comp is not null then perform public.apur_ensure_snapshot(v_cid, v_comp); end if;
    perform public.apur_audit_log('CREATE', 'company', v_cid::text, jsonb_build_object('legal_name', v_name, 'owner_user_id', v_owner, 'competence', v_comp, 'period_membership', v_comp is not null));
  end if;
  return jsonb_build_object('ok', true, 'id', v_cid, 'competence', v_comp, 'period_membership', v_comp is not null, 'historical_only', v_hist);
end;
$$;

-- Empresa: editar.
create or replace function public.apur_company_update(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_comp text := nullif(public.apur_txt(p->>'competence'), '');
  ctx record;
  co public.apur_companies;
  sn public.apur_snapshots;
  v_hist boolean := false;
  v_owner uuid;
  v_checklist jsonb;
  v_base_checklist jsonb;
  v_base_regime text;
  v_new_regime text;
  v_name text; v_cnpj text; v_dom text; v_reason text; v_order int;
  it jsonb;
begin
  select * into ctx from public.apur_company_context(p_id, v_comp);
  select * into co from public.apur_companies where id = p_id;
  if v_comp is not null then select * into sn from public.apur_snapshots where company_id = p_id and competence = v_comp; end if;
  v_hist := v_comp is not null and sn.company_id is not null and public.apur_historical_only(ctx.o_owner, v_comp);
  v_cnpj := public.apur_clean_cnpj(p->>'cnpj');
  v_dom := public.apur_domain_code(p->>'dominio_code');
  if v_cnpj <> '' and not public.apur_valid_cnpj(v_cnpj) then raise exception 'CNPJ inválido. Confira os 14 dígitos.'; end if;
  v_checklist := public.apur_clean_checklist(p->'checklist');
  if v_hist then
    perform public.apur_assert_mutable(ctx.o_owner, v_comp);
    v_owner := ctx.o_owner;
    if nullif(p->>'owner_user_id', '') is not null and (p->>'owner_user_id')::uuid <> v_owner then
      raise exception 'Em competência histórica, a troca de responsável não é aplicada ao cadastro futuro. Faça a correção somente na carteira atual.';
    end if;
    v_base_checklist := sn.checklist; v_base_regime := sn.tax_regime;
    v_name := coalesce(nullif(public.apur_txt(p->>'legal_name'), ''), sn.legal_name);
  else
    if co.id is null or co.deleted then raise exception 'Empresa não encontrada no cadastro atual.'; end if;
    v_owner := co.owner_user_id;
    if public.is_admin() and nullif(p->>'owner_user_id', '') is not null then v_owner := (p->>'owner_user_id')::uuid; end if;
    if not public.apur_active_owner(v_owner) then raise exception 'Responsável não encontrado ou inativo.'; end if;
    if v_comp is not null then perform public.apur_assert_mutable(co.owner_user_id, v_comp); end if;
    v_base_checklist := co.checklist; v_base_regime := co.tax_regime;
    v_name := coalesce(nullif(public.apur_txt(p->>'legal_name'), ''), co.legal_name);
  end if;
  if jsonb_array_length(v_checklist) = 0 then v_checklist := v_base_checklist; end if;
  v_new_regime := public.apur_canonical_regime(coalesce(nullif(p->>'tax_regime', ''), v_base_regime));
  if v_new_regime <> public.apur_canonical_regime(v_base_regime)
     and (select array_agg(public.apur_norm_key(e->>'label') order by o) from jsonb_array_elements(v_checklist) with ordinality x(e, o))
       is not distinct from (select array_agg(public.apur_norm_key(e->>'label') order by o) from jsonb_array_elements(v_base_checklist) with ordinality x(e, o)) then
    v_checklist := public.apur_merge_checklist_for_regime(p_id, v_comp, v_checklist, v_new_regime);
  end if;
  v_checklist := public.apur_add_missing_regime_items(v_checklist, v_new_regime);
  if v_hist then
    v_reason := public.apur_duplicate_reason(v_owner, v_name, v_cnpj, v_dom, p_id, v_comp);
    if v_reason is not null then raise exception '%.', v_reason; end if;
    update public.apur_snapshots set legal_name = v_name, cnpj = v_cnpj, dominio_code = v_dom, tax_regime = v_new_regime,
      envio = public.apur_txt(p->>'envio'), particularities = public.apur_txt(p->>'particularities'), notes = public.apur_txt(p->>'notes'),
      checklist = v_checklist, updated_at = now()
    where company_id = p_id and competence = v_comp and owner_user_id = v_owner;
    for it in select * from jsonb_array_elements(v_checklist) loop
      update public.apur_checks set item_label = it->>'label' where company_id = p_id and competence = v_comp and item_id = it->>'id';
    end loop;
    perform public.apur_audit_log('UPDATE_HISTORICAL', 'company', p_id::text, jsonb_build_object('competence', v_comp, 'historical_only', true));
  else
    v_reason := public.apur_duplicate_reason(v_owner, v_name, v_cnpj, v_dom, p_id);
    if v_reason is not null then raise exception '% para este responsável.', v_reason; end if;
    v_order := case when v_owner = co.owner_user_id then co.display_order else public.apur_next_company_order(v_owner) end;
    update public.apur_companies set owner_user_id = v_owner, legal_name = v_name, cnpj = v_cnpj, dominio_code = v_dom, tax_regime = v_new_regime,
      envio = public.apur_txt(p->>'envio'), particularities = public.apur_txt(p->>'particularities'), notes = public.apur_txt(p->>'notes'),
      checklist = v_checklist, display_order = v_order, updated_at = now()
    where id = p_id;
    if v_owner <> co.owner_user_id then
      perform public.apur_normalize_company_order(co.owner_user_id);
      perform public.apur_normalize_company_order(v_owner);
    end if;
    perform public.apur_sync_master_history(p_id);
    perform public.apur_audit_log('UPDATE', 'company', p_id::text, jsonb_build_object('legal_name', v_name, 'global_master_data', true));
  end if;
  return jsonb_build_object('ok', true, 'historical_only', v_hist);
end;
$$;

-- Empresa: excluir linha (vale do período aberto em diante; competências salvas preservadas).
create or replace function public.apur_company_delete(p_id uuid, p_competence text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_comp text := nullif(public.apur_txt(p_competence), '');
  ctx record;
  co public.apur_companies;
  v_has_snap boolean := false;
  v_hist boolean := false;
begin
  select * into ctx from public.apur_company_context(p_id, v_comp);
  select * into co from public.apur_companies where id = p_id;
  v_has_snap := ctx.o_has_snapshot;
  v_hist := v_comp is not null and v_has_snap and (public.apur_historical_only(ctx.o_owner, v_comp)
            or co.id is null or co.deleted or co.owner_user_id <> ctx.o_owner);
  if v_hist then
    perform public.apur_assert_mutable(ctx.o_owner, v_comp);
    delete from public.apur_checks where company_id = p_id and competence = v_comp;
    delete from public.apur_monthly_notes where company_id = p_id and competence = v_comp;
    delete from public.apur_visual_marks where company_id = p_id and competence = v_comp;
    update public.apur_admin_notes set active = false, archived_by = v_uid, archived_at = now() where company_id = p_id and competence = v_comp and active;
    delete from public.apur_snapshots where company_id = p_id and competence = v_comp;
    perform public.apur_normalize_snapshot_order(ctx.o_owner, v_comp);
    perform public.apur_audit_log('DELETE_HISTORICAL', 'company', p_id::text, jsonb_build_object('competence', v_comp, 'historical_only', true, 'master_preserved', true));
  else
    if co.id is null or co.deleted then raise exception 'Empresa não encontrada no cadastro atual.'; end if;
    if v_comp is not null then
      perform public.apur_assert_membership_mutable(co.owner_user_id, v_comp);
      delete from public.apur_snapshots where company_id = p_id and competence = v_comp;
    end if;
    update public.apur_companies set deleted = true, updated_at = now() where id = p_id;
    perform public.apur_normalize_company_order(co.owner_user_id);
    perform public.apur_audit_log('DELETE', 'company', p_id::text, jsonb_build_object('competence', v_comp, 'removed_from_current_period', v_comp is not null, 'history_preserved', true));
  end if;
  return jsonb_build_object('ok', true, 'competence', v_comp, 'history_preserved', true, 'historical_only', v_hist);
end;
$$;

-- Ordem das empresas (arrastar). Atualiza a fotografia da competência e, sem mês posterior, o cadastro.
create or replace function public.apur_reorder(p_owner uuid, p_company_ids uuid[], p_competence text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.apur_resolve_owner(p_owner, 'Selecione um responsável para reordenar a carteira.');
  v_comp text := nullif(public.apur_txt(p_competence), '');
  v_ids uuid[] := coalesce(p_company_ids, '{}');
  v_hist boolean := false;
  v_set uuid[];
begin
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then raise exception 'A ordem contém empresas duplicadas.'; end if;
  if v_comp is not null then perform public.apur_assert_mutable(v_owner, v_comp); end if;
  if v_comp is not null and exists (select 1 from public.apur_periods where owner_user_id = v_owner and competence = v_comp) then
    select array_agg(company_id order by company_id) into v_set from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp;
    if coalesce(v_set, '{}') <> (select coalesce(array_agg(x order by x), '{}') from unnest(v_ids) x) then
      raise exception 'A ordem deve conter todas as empresas desta competência.';
    end if;
    update public.apur_snapshots s set display_order = x.o, updated_at = now()
    from unnest(v_ids) with ordinality x(id, o)
    where s.owner_user_id = v_owner and s.competence = v_comp and s.company_id = x.id;
    v_hist := public.apur_has_later(v_owner, v_comp);
  end if;
  if not v_hist then
    select array_agg(id order by id) into v_set from public.apur_companies where owner_user_id = v_owner and not deleted;
    if coalesce(v_set, '{}') <> (select coalesce(array_agg(x order by x), '{}') from unnest(v_ids) x) then
      raise exception 'A ordem deve conter todas as empresas ativas da carteira.';
    end if;
    update public.apur_companies c set display_order = x.o, updated_at = now()
    from unnest(v_ids) with ordinality x(id, o) where c.id = x.id;
  end if;
  perform public.apur_audit_log('REORDER', 'company_portfolio', v_owner::text, jsonb_build_object('company_ids', to_jsonb(v_ids), 'competence', v_comp, 'historical_only', v_hist));
  return jsonb_build_object('ok', true, 'count', cardinality(v_ids));
end;
$$;

-- Status de um item do checklist (não apaga a nota da célula).
create or replace function public.apur_set_check(p_company uuid, p_competence text, p_item_id text, p_item_label text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_status text := upper(coalesce(nullif(public.apur_txt(p_status), ''), 'PENDING'));
  ctx record;
begin
  if v_status not in ('PENDING', 'DONE', 'ALERT', 'NA') then raise exception 'Status inválido.'; end if;
  if not public.apur_valid_comp(p_competence) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  if public.apur_txt(p_item_id) = '' then raise exception 'Coluna não informada.'; end if;
  select * into ctx from public.apur_company_context(p_company, p_competence);
  perform public.apur_assert_mutable(ctx.o_owner, p_competence);
  perform public.apur_ensure_snapshot(p_company, p_competence);
  insert into public.apur_checks (company_id, competence, item_id, item_label, status, updated_at, updated_by)
  values (p_company, p_competence, public.apur_txt(p_item_id), public.apur_txt(p_item_label), v_status, now(), v_uid)
  on conflict (company_id, competence, item_id) do update set item_label = excluded.item_label, status = excluded.status, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform public.apur_audit_log('SET_STATUS', 'monthly_check', p_company || ':' || p_competence || ':' || p_item_id, jsonb_build_object('status', v_status));
  return jsonb_build_object('ok', true);
end;
$$;

-- CELLNOTE01: nota de uma célula (empresa x coluna x competência). Não altera o status.
create or replace function public.apur_set_check_note(p_company uuid, p_competence text, p_item_id text, p_item_label text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_note text := public.apur_multiline(p_note, 1000);
  ctx record;
begin
  if public.apur_txt(p_item_id) = '' then raise exception 'Coluna não informada.'; end if;
  if not public.apur_valid_comp(p_competence) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  select * into ctx from public.apur_company_context(p_company, p_competence);
  perform public.apur_assert_mutable(ctx.o_owner, p_competence);
  perform public.apur_ensure_snapshot(p_company, p_competence);
  insert into public.apur_checks (company_id, competence, item_id, item_label, status, note, updated_at, updated_by)
  values (p_company, p_competence, public.apur_txt(p_item_id), public.apur_txt(p_item_label), 'PENDING', nullif(v_note, ''), now(), v_uid)
  on conflict (company_id, competence, item_id) do update set note = excluded.note, item_label = excluded.item_label, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform public.apur_audit_log(case when v_note <> '' then 'SET_NOTE' else 'CLEAR_NOTE' end, 'monthly_check', p_company || ':' || p_competence || ':' || p_item_id, jsonb_build_object('length', length(v_note)));
  return jsonb_build_object('ok', true, 'note', v_note);
end;
$$;

-- Pendência / observação mensal da empresa.
create or replace function public.apur_set_monthly_note(p_company uuid, p_competence text, p_note text, p_is_pending boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_note text := public.apur_multiline(p_note, 4000);
  ctx record;
begin
  if not public.apur_valid_comp(p_competence) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  select * into ctx from public.apur_company_context(p_company, p_competence);
  perform public.apur_assert_mutable(ctx.o_owner, p_competence);
  perform public.apur_ensure_snapshot(p_company, p_competence);
  if v_note = '' and not coalesce(p_is_pending, false) then
    delete from public.apur_monthly_notes where company_id = p_company and competence = p_competence;
    perform public.apur_audit_log('CLEAR', 'monthly_company_note', p_company || ':' || p_competence, '{}'::jsonb);
  else
    insert into public.apur_monthly_notes (company_id, competence, note, is_pending, updated_at, updated_by)
    values (p_company, p_competence, v_note, coalesce(p_is_pending, false), now(), v_uid)
    on conflict (company_id, competence) do update set note = excluded.note, is_pending = excluded.is_pending, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    perform public.apur_audit_log('UPSERT', 'monthly_company_note', p_company || ':' || p_competence, jsonb_build_object('is_pending', coalesce(p_is_pending, false)));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Notas do administrador (recado, determinação, registro) por empresa/célula.
create or replace function public.apur_admin_note_create(p_company uuid, p_competence text, p_item_id text, p_note_type text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_item text := coalesce(nullif(public.apur_txt(p_item_id), ''), '__ROW__');
  v_type text := upper(coalesce(nullif(public.apur_txt(p_note_type), ''), 'MESSAGE'));
  v_note text := public.apur_multiline(p_note, 4000);
  v_label text := 'Empresa / competência';
  v_checklist jsonb;
  v_id uuid := gen_random_uuid();
  ctx record;
begin
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  if v_note = '' then raise exception 'Informe o texto da nota.'; end if;
  if v_type not in ('MESSAGE', 'DIRECTIVE', 'RECORD') then raise exception 'Tipo de nota inválido.'; end if;
  if not public.apur_valid_comp(p_competence) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  select * into ctx from public.apur_company_context(p_company, p_competence);
  perform public.apur_assert_mutable(ctx.o_owner, p_competence);
  perform public.apur_ensure_snapshot(p_company, p_competence);
  if v_item <> '__ROW__' then
    select checklist into v_checklist from public.apur_snapshots where company_id = p_company and competence = p_competence;
    select public.apur_txt(e->>'label') into v_label from jsonb_array_elements(coalesce(v_checklist, '[]'::jsonb)) e where public.apur_txt(e->>'id') = v_item limit 1;
    if v_label is null then raise exception 'Item do checklist não encontrado.'; end if;
  end if;
  insert into public.apur_admin_notes (id, company_id, competence, item_id, item_label, note_type, note, active, created_by)
  values (v_id, p_company, p_competence, v_item, v_label, v_type, v_note, true, v_uid);
  perform public.apur_audit_log('CREATE', 'admin_note', v_id::text, jsonb_build_object('company_id', p_company, 'owner_user_id', ctx.o_owner, 'competence', p_competence, 'item_id', v_item, 'note_type', v_type));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.apur_admin_note_archive(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  r public.apur_admin_notes;
  ctx record;
begin
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  select * into r from public.apur_admin_notes where id = p_id;
  if not found then raise exception 'Nota administrativa não encontrada.'; end if;
  select * into ctx from public.apur_company_context(r.company_id, r.competence);
  perform public.apur_assert_mutable(ctx.o_owner, r.competence);
  if r.active then
    update public.apur_admin_notes set active = false, archived_by = v_uid, archived_at = now() where id = p_id;
    perform public.apur_audit_log('ARCHIVE', 'admin_note', p_id::text, jsonb_build_object('company_id', r.company_id, 'competence', r.competence, 'item_id', r.item_id));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Grifo (marca visual) da linha ou da célula.
create or replace function public.apur_set_visual_mark(p_company uuid, p_competence text, p_item_id text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_item text := coalesce(nullif(public.apur_txt(p_item_id), ''), '__ROW__');
  v_color text := coalesce(nullif(upper(public.apur_txt(p_color)), ''), 'NONE');
  ctx record;
begin
  if v_color not in ('NONE', 'YELLOW', 'ORANGE', 'GREEN') then raise exception 'Cor de grifo inválida.'; end if;
  if not public.apur_valid_comp(p_competence) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  select * into ctx from public.apur_company_context(p_company, p_competence);
  perform public.apur_assert_mutable(ctx.o_owner, p_competence);
  perform public.apur_ensure_snapshot(p_company, p_competence);
  if v_color = 'NONE' then
    delete from public.apur_visual_marks where company_id = p_company and competence = p_competence and item_id = v_item;
    perform public.apur_audit_log('CLEAR', 'visual_mark', p_company || ':' || p_competence || ':' || v_item, '{}'::jsonb);
  else
    insert into public.apur_visual_marks (company_id, competence, item_id, color, updated_at, updated_by)
    values (p_company, p_competence, v_item, v_color, now(), v_uid)
    on conflict (company_id, competence, item_id) do update set color = excluded.color, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    perform public.apur_audit_log('UPSERT', 'visual_mark', p_company || ':' || p_competence || ':' || v_item, jsonb_build_object('color', v_color));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Coluna nova do checklist em toda a carteira (ou só na fotografia de competência histórica reaberta).
create or replace function public.apur_column_add(p_owner uuid, p_item_id text, p_label text, p_competence text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.apur_resolve_owner(p_owner, 'Selecione um responsável antes de criar a coluna.');
  v_item text := lower(public.apur_txt(p_item_id));
  v_label text := public.apur_txt(p_label);
  v_comp text := nullif(public.apur_txt(p_competence), '');
  v_hist boolean := false;
  v_rows int; v_conflicts text[];
begin
  if v_comp is not null then perform public.apur_assert_mutable(v_owner, v_comp); end if;
  if v_item !~ '^custom-[a-z0-9-]{10,80}$' then raise exception 'Identificador da coluna inválido.'; end if;
  if v_label = '' then raise exception 'Informe o título da nova coluna.'; end if;
  if length(v_label) > 80 then raise exception 'O título pode ter no máximo 80 caracteres.'; end if;
  v_hist := v_comp is not null and public.apur_historical_only(v_owner, v_comp);
  if v_hist then
    select count(*) into v_rows from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp;
    if v_rows = 0 then raise exception 'O responsável selecionado não possui empresas nesta competência.'; end if;
    if exists (select 1 from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp and jsonb_array_length(checklist) >= 120) then
      raise exception 'Uma empresa da carteira atingiu o limite de 120 itens de checklist.'; end if;
    select array_agg(legal_name) into v_conflicts from public.apur_snapshots s
    where owner_user_id = v_owner and competence = v_comp and exists (select 1 from jsonb_array_elements(s.checklist) e where public.apur_norm_key(e->>'label') = public.apur_norm_key(v_label));
    if v_conflicts is not null then raise exception 'Já existe uma coluna com esse título em: %', array_to_string(v_conflicts[1:3], ', ') || case when cardinality(v_conflicts) > 3 then '...' else '' end; end if;
    update public.apur_snapshots set checklist = checklist || jsonb_build_array(jsonb_build_object('id', v_item, 'label', v_label)), updated_at = now()
    where owner_user_id = v_owner and competence = v_comp;
  else
    select count(*) into v_rows from public.apur_companies where owner_user_id = v_owner and not deleted;
    if v_rows = 0 then raise exception 'O responsável selecionado não possui empresas cadastradas.'; end if;
    if exists (select 1 from public.apur_companies where owner_user_id = v_owner and not deleted and jsonb_array_length(checklist) >= 120) then
      raise exception 'Uma empresa da carteira atingiu o limite de 120 itens de checklist.'; end if;
    select array_agg(legal_name) into v_conflicts from public.apur_companies c
    where owner_user_id = v_owner and not deleted and exists (select 1 from jsonb_array_elements(c.checklist) e where public.apur_norm_key(e->>'label') = public.apur_norm_key(v_label));
    if v_conflicts is not null then raise exception 'Já existe uma coluna com esse título em: %', array_to_string(v_conflicts[1:3], ', ') || case when cardinality(v_conflicts) > 3 then '...' else '' end; end if;
    update public.apur_companies set checklist = checklist || jsonb_build_array(jsonb_build_object('id', v_item, 'label', v_label)), updated_at = now()
    where owner_user_id = v_owner and not deleted;
    perform public.apur_sync_master_history(id) from public.apur_companies where owner_user_id = v_owner and not deleted;
  end if;
  perform public.apur_audit_log('CREATE', 'checklist_column', v_item, jsonb_build_object('owner_user_id', v_owner, 'label', v_label, 'companies_updated', v_rows, 'competence', v_comp, 'historical_only', v_hist));
  return jsonb_build_object('ok', true, 'id', v_item, 'label', v_label, 'companies_updated', v_rows);
end;
$$;

-- COLRENAME01: renomear coluna da carteira (mantém o id: status, ordem e larguras preservados).
create or replace function public.apur_column_rename(p_owner uuid, p_item_id text, p_label text, p_competence text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.apur_resolve_owner(p_owner, 'Selecione um responsável antes de renomear a coluna.');
  v_item text := lower(public.apur_txt(p_item_id));
  v_label text := public.apur_txt(p_label);
  v_comp text := nullif(public.apur_txt(p_competence), '');
  v_hist boolean := false;
  v_conflicts text[]; v_old text[]; v_rows int;
begin
  if v_comp is not null then perform public.apur_assert_mutable(v_owner, v_comp); end if;
  if v_item = '' or length(v_item) > 100 then raise exception 'Coluna inválida.'; end if;
  if v_label = '' then raise exception 'Informe o novo título da coluna.'; end if;
  if length(v_label) > 80 then raise exception 'O título pode ter no máximo 80 caracteres.'; end if;
  v_hist := v_comp is not null and public.apur_historical_only(v_owner, v_comp);
  create temp table if not exists apur_tmp_rows (cid uuid, legal_name text, checklist jsonb) on commit drop;
  delete from apur_tmp_rows;
  if v_hist then
    insert into apur_tmp_rows select company_id, legal_name, checklist from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp;
  else
    insert into apur_tmp_rows select id, legal_name, checklist from public.apur_companies where owner_user_id = v_owner and not deleted;
  end if;
  select array_agg(legal_name) into v_conflicts from apur_tmp_rows r
  where exists (select 1 from jsonb_array_elements(r.checklist) e where public.apur_norm_key(e->>'label') = public.apur_norm_key(v_label) and lower(public.apur_txt(e->>'id')) <> v_item);
  if v_conflicts is not null then raise exception 'Já existe outra coluna com esse título em: %', array_to_string(v_conflicts[1:3], ', ') || case when cardinality(v_conflicts) > 3 then '...' else '' end; end if;
  select array_agg(distinct public.apur_txt(e->>'label')) into v_old from apur_tmp_rows r, jsonb_array_elements(r.checklist) e where lower(public.apur_txt(e->>'id')) = v_item;
  if v_old is null then raise exception 'Coluna não encontrada nesta carteira.'; end if;
  select count(*) into v_rows from apur_tmp_rows r where exists (select 1 from jsonb_array_elements(r.checklist) e where lower(public.apur_txt(e->>'id')) = v_item);
  if v_hist then
    update public.apur_snapshots s set checklist = (
      select jsonb_agg(case when lower(public.apur_txt(e->>'id')) = v_item then e || jsonb_build_object('label', v_label) else e end order by o)
      from jsonb_array_elements(s.checklist) with ordinality x(e, o)), updated_at = now()
    where owner_user_id = v_owner and competence = v_comp and exists (select 1 from jsonb_array_elements(s.checklist) e where lower(public.apur_txt(e->>'id')) = v_item);
  else
    update public.apur_companies c set checklist = (
      select jsonb_agg(case when lower(public.apur_txt(e->>'id')) = v_item then e || jsonb_build_object('label', v_label) else e end order by o)
      from jsonb_array_elements(c.checklist) with ordinality x(e, o)), updated_at = now()
    where owner_user_id = v_owner and not deleted and exists (select 1 from jsonb_array_elements(c.checklist) e where lower(public.apur_txt(e->>'id')) = v_item);
    perform public.apur_sync_master_history(id) from public.apur_companies where owner_user_id = v_owner and not deleted;
  end if;
  perform public.apur_audit_log('RENAME', 'checklist_column', v_item, jsonb_build_object('owner_user_id', v_owner, 'old_label', to_jsonb(v_old), 'label', v_label, 'companies_updated', v_rows, 'competence', v_comp));
  return jsonb_build_object('ok', true, 'id', v_item, 'label', v_label, 'old_label', to_jsonb(v_old), 'companies_updated', v_rows);
end;
$$;

-- Ciclo da competência: salvar (fecha; até 10/2026) / fechar (de 11/2026), salvar progresso, reabrir, gerar novo período.
create or replace function public.apur_competence_action(p_action text, p_owner uuid, p_competence text, p_layout jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_admin boolean := public.is_admin();
  v_owner uuid := public.apur_resolve_owner(p_owner, 'Selecione um usuário responsável antes de operar a competência.');
  v_comp text := public.apur_txt(p_competence);
  v_action text := lower(public.apur_txt(p_action));
  per public.apur_periods;
  v_hist boolean; v_count int; v_target text; v_later text;
  v_completion jsonb; v_orphans text[] := '{}';
  snap record; co public.apur_companies;
  v_result jsonb;
begin
  if not public.apur_valid_comp(v_comp) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  select * into per from public.apur_periods where owner_user_id = v_owner and competence = v_comp;

  if v_action = 'save' then
    if per.competence is not null and per.status = 'CLOSED' then raise exception 'Esta apuração já está %.', public.apur_encerrada(v_comp); end if;
    if per.competence is null and exists (select 1 from public.apur_periods where owner_user_id = v_owner) then
      raise exception 'A competência % ainda não foi gerada. Abra a última apuração % e use Gerar novo período.', public.apur_comp_label(v_comp), public.apur_encerrada(public.apur_prev_comp(v_comp));
    end if;
    v_hist := per.competence is not null and per.status = 'REOPENED' and public.apur_has_later(v_owner, v_comp);
    if v_hist then
      select count(*) into v_count from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp;
    else
      v_count := public.apur_capture_snapshots(v_owner, v_comp, v_uid);
      if v_count = 0 then raise exception 'Não há empresas nesta carteira para salvar a apuração.'; end if;
    end if;
    if length(coalesce(p_layout, '{}'::jsonb)::text) > 50000 then raise exception 'Configuração visual da competência excede o limite permitido.'; end if;
    update public.apur_periods set status = 'CLOSED', layout = coalesce(p_layout, layout, '{}'::jsonb), saved_at = now(), saved_by = v_uid
    where owner_user_id = v_owner and competence = v_comp;
    v_result := jsonb_build_object('owner_user_id', v_owner, 'competence', v_comp, 'status', 'CLOSED', 'companies', v_count, 'saved_at', now(), 'historical_reopen', v_hist);
    perform public.apur_audit_log('SAVE', 'competence', v_owner || ':' || v_comp, v_result);

  elsif v_action = 'save_progress' then
    if not public.apur_separate_close(v_comp) then raise exception 'Nesta competência, use “Salvar apuração”, que fecha o período.'; end if;
    perform public.apur_assert_membership_mutable(v_owner, v_comp);
    if per.competence is null then
      if public.apur_capture_snapshots(v_owner, v_comp, v_uid) = 0 then raise exception 'Não há empresas nesta carteira para salvar.'; end if;
      select * into per from public.apur_periods where owner_user_id = v_owner and competence = v_comp;
    end if;
    update public.apur_periods set progress_saved_at = now(), progress_saved_by = v_uid where owner_user_id = v_owner and competence = v_comp;
    v_result := jsonb_build_object('owner_user_id', v_owner, 'competence', v_comp, 'status', per.status, 'progress_saved_at', now());
    perform public.apur_audit_log('SAVE_PROGRESS', 'competence', v_owner || ':' || v_comp, v_result);

  elsif v_action = 'reopen' then
    if per.competence is null or per.status <> 'CLOSED' then raise exception 'Somente uma apuração % pode ser reaberta.', public.apur_encerrada(v_comp); end if;
    v_later := public.apur_later_comp(v_owner, v_comp);
    if v_later is not null and not v_admin then
      raise exception 'Não é possível reabrir % porque já existe período posterior (%).', public.apur_comp_label(v_comp), public.apur_comp_label(v_later);
    end if;
    if not exists (select 1 from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp) then raise exception 'Fotografia da apuração não encontrada.'; end if;
    if v_later is null then
      for snap in select * from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp order by display_order loop
        select * into co from public.apur_companies where id = snap.company_id and not deleted;
        if co.id is null or co.owner_user_id <> v_owner then v_orphans := v_orphans || snap.legal_name; continue; end if;
        update public.apur_companies set legal_name = snap.legal_name, cnpj = snap.cnpj, dominio_code = snap.dominio_code, tax_regime = snap.tax_regime,
          envio = snap.envio, particularities = snap.particularities, notes = snap.notes, checklist = snap.checklist, display_order = snap.display_order, updated_at = now()
        where id = snap.company_id;
      end loop;
    end if;
    update public.apur_periods set status = 'REOPENED', reopened_at = now(), reopened_by = v_uid where owner_user_id = v_owner and competence = v_comp;
    v_result := jsonb_build_object('owner_user_id', v_owner, 'competence', v_comp, 'status', 'REOPENED', 'reopened_at', now(),
      'historical_only', v_later is not null, 'later_competence', v_later, 'orphan_lines', to_jsonb(v_orphans));
    perform public.apur_audit_log('REOPEN', 'competence', v_owner || ':' || v_comp, v_result);

  elsif v_action = 'generate_next' then
    v_target := public.apur_next_comp(v_comp);
    -- EMPTYPER01: carteira esvaziada pelo ADM -> fecha a origem como apuração vazia e abre o mês seguinte vazio.
    if v_admin and not exists (select 1 from public.apur_companies where owner_user_id = v_owner and not deleted) then
      if per.competence is null then raise exception 'Período de origem não encontrado nesta carteira.'; end if;
      if public.apur_competence_has_data(v_owner, v_target) then raise exception 'A competência % já existe nesta carteira.', public.apur_comp_label(v_target); end if;
      if per.status <> 'CLOSED' then
        update public.apur_periods set status = 'CLOSED', saved_at = now(), saved_by = v_uid where owner_user_id = v_owner and competence = v_comp;
      end if;
      insert into public.apur_periods (owner_user_id, competence, status, source_competence, layout, opened_at, opened_by)
      values (v_owner, v_target, 'OPEN', v_comp, coalesce(per.layout, '{}'::jsonb), now(), v_uid);
      v_result := jsonb_build_object('owner_user_id', v_owner, 'source_competence', v_comp, 'competence', v_target, 'status', 'OPEN', 'companies', 0, 'empty_period', true);
    else
      if per.competence is null or per.status <> 'CLOSED' then
        raise exception '% a apuração de origem antes de gerar o novo período.', case when public.apur_separate_close(v_comp) then 'Feche' else 'Salve' end;
      end if;
      if public.apur_competence_has_data(v_owner, v_target) then raise exception 'A competência % já existe nesta carteira.', public.apur_comp_label(v_target); end if;
      if not exists (select 1 from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp) then
        raise exception 'A apuração % não possui fotografia de empresas para duplicar.', public.apur_encerrada(v_comp);
      end if;
      -- FIX13: usuário comum só gera o mês seguinte com todas as empresas concluídas.
      if not v_admin then
        v_completion := public.apur_completion_summary_internal(v_owner, v_comp);
        if (v_completion->>'incomplete_count')::int > 0 then
          raise exception 'Não foi possível gerar novo período, pois ainda há % % no período atual. Revise-as ou entre em contato com o usuário ADM.',
            v_completion->>'incomplete_count', case when (v_completion->>'incomplete_count')::int = 1 then 'empresa não concluída' else 'empresas não concluídas' end
            using errcode = 'P0002';
        end if;
      end if;
      v_count := 0;
      for snap in select * from public.apur_snapshots where owner_user_id = v_owner and competence = v_comp order by display_order, lower(legal_name) loop
        select * into co from public.apur_companies where id = snap.company_id;
        if co.id is null or co.deleted then raise exception 'A empresa % não está ativa. Regularize a carteira antes de gerar o novo período.', snap.legal_name; end if;
        if co.owner_user_id <> v_owner then raise exception 'A empresa % mudou de responsável. Regularize a carteira antes de gerar o novo período.', snap.legal_name; end if;
        update public.apur_companies set legal_name = snap.legal_name, cnpj = snap.cnpj, dominio_code = snap.dominio_code, tax_regime = snap.tax_regime,
          envio = snap.envio, particularities = snap.particularities, notes = snap.notes, checklist = snap.checklist, display_order = snap.display_order, updated_at = now()
        where id = snap.company_id;
        insert into public.apur_snapshots (company_id, competence, owner_user_id, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order)
        values (snap.company_id, v_target, v_owner, snap.legal_name, snap.cnpj, snap.dominio_code, snap.tax_regime, snap.envio, snap.particularities, snap.notes, snap.checklist, snap.display_order);
        v_count := v_count + 1;
      end loop;
      perform public.apur_normalize_company_order(v_owner);
      insert into public.apur_periods (owner_user_id, competence, status, source_competence, layout, opened_at, opened_by)
      values (v_owner, v_target, 'OPEN', v_comp, coalesce(per.layout, '{}'::jsonb), now(), v_uid);
      v_result := jsonb_build_object('owner_user_id', v_owner, 'source_competence', v_comp, 'competence', v_target, 'status', 'OPEN', 'companies', v_count, 'checks_copied', 0);
    end if;
    perform public.apur_audit_log('GENERATE_NEXT', 'competence', v_owner || ':' || v_target, v_result);
  else
    raise exception 'Operação de competência inválida.';
  end if;
  return jsonb_build_object('ok', true) || v_result;
end;
$$;

-- Resumo de conclusão (usado pela tela antes de gerar o novo período).
create or replace function public.apur_completion_summary(p_owner uuid, p_competence text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := public.apur_resolve_owner(p_owner);
begin
  if not public.apur_valid_comp(p_competence) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  return public.apur_completion_summary_internal(v_owner, p_competence);
end;
$$;

-- Layout visual da competência (larguras de colunas etc.).
create or replace function public.apur_save_layout(p_owner uuid, p_competence text, p_layout jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_owner uuid := public.apur_resolve_owner(p_owner);
begin
  if not public.apur_valid_comp(p_competence) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  if length(coalesce(p_layout, '{}'::jsonb)::text) > 50000 then raise exception 'Configuração visual da competência excede o limite permitido.'; end if;
  update public.apur_periods set layout = coalesce(p_layout, '{}'::jsonb) where owner_user_id = v_owner and competence = p_competence and status <> 'CLOSED';
  return jsonb_build_object('ok', true);
end;
$$;

-- Excluir todas as empresas da carteira (somente ADM; exige digitar EXCLUIR).
create or replace function public.apur_delete_all(p_owner uuid, p_competence text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_comp text := nullif(public.apur_txt(p_competence), '');
  v_n int; r record;
begin
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  if public.apur_txt(p_confirm) <> 'EXCLUIR' then raise exception 'Confirmação inválida. Digite EXCLUIR para confirmar.'; end if;
  if p_owner is null or not public.apur_active_owner(p_owner) then raise exception 'Selecione o responsável cuja carteira será excluída.'; end if;
  select count(*) into v_n from public.apur_companies where owner_user_id = p_owner and not deleted;
  if v_n = 0 then return jsonb_build_object('ok', true, 'deleted', 0); end if;
  if v_comp is not null then perform public.apur_assert_membership_mutable(p_owner, v_comp); end if;
  for r in select id from public.apur_companies where owner_user_id = p_owner and not deleted loop
    if v_comp is not null then delete from public.apur_snapshots where company_id = r.id and competence = v_comp; end if;
    update public.apur_companies set deleted = true, updated_at = now() where id = r.id;
    perform public.apur_audit_log('DELETE', 'company', r.id::text, jsonb_build_object('competence', v_comp, 'removed_from_current_period', v_comp is not null, 'history_preserved', true, 'bulk', true));
  end loop;
  perform public.apur_normalize_company_order(p_owner);
  perform public.apur_audit_log('DELETE_ALL', 'company', null, jsonb_build_object('owner_user_id', p_owner, 'competence', v_comp, 'deleted', v_n));
  return jsonb_build_object('ok', true, 'deleted', v_n);
end;
$$;

-- Transferir a carteira (empresas ativas) de um usuário para outro.
create or replace function public.apur_transfer_portfolio(p_from uuid, p_to uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_next int; v_n int;
begin
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  if p_to is null or p_to = p_from then raise exception 'Selecione um usuário de destino diferente.'; end if;
  if not exists (select 1 from public.profiles where id = p_from) then raise exception 'Usuário de origem não encontrado.'; end if;
  if not public.apur_active_owner(p_to) then raise exception 'O destino precisa ser um usuário ativo (não administrador).'; end if;
  v_next := public.apur_next_company_order(p_to);
  with ordered as (
    select id, row_number() over (order by display_order, lower(legal_name), id) - 1 as k
    from public.apur_companies where owner_user_id = p_from and not deleted
  )
  update public.apur_companies c set owner_user_id = p_to, display_order = v_next + o.k, updated_at = now() from ordered o where c.id = o.id;
  get diagnostics v_n = row_count;
  perform public.apur_normalize_company_order(p_from);
  perform public.apur_normalize_company_order(p_to);
  perform public.apur_audit_log('TRANSFER_PORTFOLIO', 'user', p_from::text, jsonb_build_object('target_user_id', p_to, 'company_count', v_n));
  return jsonb_build_object('ok', true, 'transferred', v_n, 'source_user_id', p_from, 'target_user_id', p_to);
end;
$$;

-- Importação de empresas (a planilha é lida no navegador; aqui validação e gravação).
create or replace function public.apur_import_companies(p_owner uuid, p_competence text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_owner uuid;
  v_comp text := nullif(public.apur_txt(p_competence), '');
  r jsonb; v_name text; v_dom text; v_cnpj text; v_key text; v_reason text; v_regime text; v_checklist jsonb; v_cid uuid;
  v_seen_cnpj text[] := '{}'; v_seen_dom text[] := '{}'; v_seen_name text[] := '{}';
  v_imported int := 0; v_skipped jsonb := '[]'::jsonb;
begin
  v_owner := case when public.is_admin() and p_owner is not null then p_owner else v_uid end;
  if not public.apur_active_owner(v_owner) then raise exception 'Responsável não encontrado ou inativo.'; end if;
  if v_comp is not null then perform public.apur_assert_membership_mutable(v_owner, v_comp); end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_name := public.apur_txt(r->>'legal_name'); v_dom := public.apur_domain_code(r->>'dominio_code'); v_cnpj := public.apur_clean_cnpj(r->>'cnpj');
    if v_name = '' then continue; end if;
    v_key := public.apur_norm_key(v_name); v_reason := null;
    if v_cnpj <> '' and not public.apur_valid_cnpj(v_cnpj) then v_reason := 'CNPJ inválido';
    elsif v_cnpj <> '' and v_cnpj = any(v_seen_cnpj) then v_reason := 'CNPJ repetido na planilha';
    elsif v_dom <> '' and lower(v_dom) = any(v_seen_dom) then v_reason := 'Código Domínio repetido na planilha';
    elsif v_cnpj = '' and v_dom = '' and v_key = any(v_seen_name) then v_reason := 'Nome repetido na planilha';
    end if;
    if v_reason is null then v_reason := public.apur_duplicate_reason(v_owner, v_name, v_cnpj, v_dom); end if;
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('legal_name', v_name, 'reason', v_reason));
      continue;
    end if;
    v_cid := gen_random_uuid();
    v_regime := public.apur_canonical_regime(coalesce(nullif(r->>'tax_regime', ''), 'OUTROS'));
    v_checklist := public.apur_clean_checklist(r->'checklist');
    if jsonb_array_length(v_checklist) = 0 then v_checklist := public.apur_checklist_for_regime(v_regime); end if;
    v_checklist := public.apur_align_labels(v_owner, v_checklist);
    insert into public.apur_companies (id, owner_user_id, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order, deleted)
    values (v_cid, v_owner, v_name, v_cnpj, v_dom, v_regime, public.apur_txt(r->>'envio'), public.apur_txt(r->>'particularities'), public.apur_txt(r->>'notes'), v_checklist, public.apur_next_company_order(v_owner), false);
    if v_comp is not null then perform public.apur_ensure_snapshot(v_cid, v_comp); end if;
    v_imported := v_imported + 1;
    if v_cnpj <> '' then v_seen_cnpj := v_seen_cnpj || v_cnpj; end if;
    if v_dom <> '' then v_seen_dom := v_seen_dom || lower(v_dom); end if;
    if v_key <> '' then v_seen_name := v_seen_name || v_key; end if;
  end loop;
  perform public.apur_audit_log('IMPORT', 'company', null, jsonb_build_object('owner_user_id', v_owner, 'imported', v_imported, 'skipped', jsonb_array_length(v_skipped)));
  return jsonb_build_object('ok', true, 'imported', v_imported, 'skipped', v_skipped);
end;
$$;

-- Prévia da importação: marca duplicidades contra a carteira atual (mesma regra do servidor).
create or replace function public.apur_import_preview(p_owner uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_owner uuid := case when public.is_admin() and p_owner is not null then p_owner else v_uid end;
  r jsonb; v_out jsonb := '[]'::jsonb; v_reason text;
begin
  if not public.apur_active_owner(v_owner) then raise exception 'Responsável não encontrado ou inativo.'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_reason := null;
    if public.apur_clean_cnpj(r->>'cnpj') <> '' and not public.apur_valid_cnpj(r->>'cnpj') then v_reason := 'CNPJ inválido'; end if;
    if v_reason is null then v_reason := public.apur_duplicate_reason(v_owner, r->>'legal_name', r->>'cnpj', r->>'dominio_code'); end if;
    v_out := v_out || jsonb_build_array(r || jsonb_build_object('importable', v_reason is null, 'duplicate_reason', v_reason));
  end loop;
  return v_out;
end;
$$;

-- Dashboard ADM: totais por responsável na competência.
create or replace function public.apur_admin_dashboard(p_competence text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  u record; r record; m jsonb; item jsonb;
  v_users jsonb := '[]'::jsonb;
  t jsonb := jsonb_build_object('total',0,'done',0,'pending',0,'alerts',0,'with_pending',0,'with_obs',0,'admin_notes',0,'not_started',0);
  k text;
  v_has_period boolean;
begin
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  if not public.apur_valid_comp(p_competence) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  for u in select id, nome, email from public.profiles where active and role::text <> 'admin' order by lower(nome) loop
    item := jsonb_build_object('user', jsonb_build_object('id', u.id, 'display_name', u.nome, 'email', u.email),
      'total',0,'done',0,'pending',0,'alerts',0,'with_pending',0,'with_obs',0,'admin_notes',0,'not_started',0);
    v_has_period := exists (select 1 from public.apur_periods where owner_user_id = u.id and competence = p_competence);
    for r in
      select company_id as cid, checklist from public.apur_snapshots where v_has_period and owner_user_id = u.id and competence = p_competence
      union all
      select id, checklist from public.apur_companies where not v_has_period and owner_user_id = u.id and not deleted
    loop
      m := public.apur_company_metrics(r.cid, p_competence, r.checklist);
      item := jsonb_set(item, '{total}', to_jsonb((item->>'total')::int + 1));
      k := case m->>'overall' when 'DONE' then 'done' when 'ALERT' then 'alerts' else 'pending' end;
      item := jsonb_set(item, array[k], to_jsonb((item->>k)::int + 1));
      if (m->>'has_pending')::boolean then item := jsonb_set(item, '{with_pending}', to_jsonb((item->>'with_pending')::int + 1)); end if;
      if (m->>'has_obs')::boolean then item := jsonb_set(item, '{with_obs}', to_jsonb((item->>'with_obs')::int + 1)); end if;
      if (m->>'admin_notes')::int > 0 then item := jsonb_set(item, '{admin_notes}', to_jsonb((item->>'admin_notes')::int + 1)); end if;
      if not (m->>'started')::boolean then item := jsonb_set(item, '{not_started}', to_jsonb((item->>'not_started')::int + 1)); end if;
    end loop;
    v_users := v_users || jsonb_build_array(item);
    for k in select jsonb_object_keys(t) loop
      t := jsonb_set(t, array[k], to_jsonb((t->>k)::int + (item->>k)::int));
    end loop;
  end loop;
  return jsonb_build_object('competence', p_competence, 'users', v_users, 'totals', t);
end;
$$;

-- Histórico ADM: métricas por responsável e competência (fotografias) + notas do administrador.
create or replace function public.apur_admin_history(p_owner uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  u record; cp record; r record; m jsonb; row jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_notes jsonb;
  k text;
begin
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  for u in select id, nome from public.profiles where role::text <> 'admin' and (p_owner is null or id = p_owner) order by lower(nome) loop
    for cp in select distinct competence from public.apur_snapshots where owner_user_id = u.id order by competence desc loop
      row := jsonb_build_object('user_id', u.id, 'user_name', u.nome, 'competence', cp.competence,
        'total',0,'done',0,'pending',0,'alerts',0,'with_pending',0,'with_obs',0,'admin_notes',0);
      for r in select company_id, checklist from public.apur_snapshots where owner_user_id = u.id and competence = cp.competence loop
        m := public.apur_company_metrics(r.company_id, cp.competence, r.checklist);
        row := jsonb_set(row, '{total}', to_jsonb((row->>'total')::int + 1));
        k := case m->>'overall' when 'DONE' then 'done' when 'ALERT' then 'alerts' else 'pending' end;
        row := jsonb_set(row, array[k], to_jsonb((row->>k)::int + 1));
        if (m->>'has_pending')::boolean then row := jsonb_set(row, '{with_pending}', to_jsonb((row->>'with_pending')::int + 1)); end if;
        if (m->>'has_obs')::boolean then row := jsonb_set(row, '{with_obs}', to_jsonb((row->>'with_obs')::int + 1)); end if;
        if (m->>'admin_notes')::int > 0 then row := jsonb_set(row, '{admin_notes}', to_jsonb((row->>'admin_notes')::int + 1)); end if;
      end loop;
      v_rows := v_rows || jsonb_build_array(row);
    end loop;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(n) || jsonb_build_object(
      'owner_user_id', coalesce(cs.owner_user_id, co.owner_user_id),
      'company_name', coalesce(cs.legal_name, co.legal_name),
      'owner_name', ow.nome, 'created_by_name', cr.nome) order by n.created_at desc), '[]'::jsonb)
    into v_notes
  from public.apur_admin_notes n
  join public.apur_companies co on co.id = n.company_id
  left join public.apur_snapshots cs on cs.company_id = n.company_id and cs.competence = n.competence
  left join public.profiles ow on ow.id = coalesce(cs.owner_user_id, co.owner_user_id)
  left join public.profiles cr on cr.id = n.created_by
  where p_owner is null or coalesce(cs.owner_user_id, co.owner_user_id) = p_owner;
  return jsonb_build_object('rows', v_rows, 'notes', v_notes);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Migração da base do app antigo (somente ADM). A tela de migração do HUB lê a base (.db/.htbackup)
-- no navegador, troca os usuários antigos pelos usuários do HUB escolhidos pelo ADM e envia as linhas
-- em lotes. Pode ser repetida: cada linha é inserida ou atualizada pela chave original.

create or replace function public.apur_migrate_rows(p_table text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  perform public.apur_require_user();
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Lote inválido.'; end if;

  if p_table = 'companies' then
    insert into public.apur_companies (id, owner_user_id, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order, deleted, created_at, updated_at)
    select id, owner_user_id, legal_name, coalesce(cnpj, ''), coalesce(dominio_code, ''), public.apur_canonical_regime(tax_regime), coalesce(envio, ''), coalesce(particularities, ''), coalesce(notes, ''),
           coalesce(checklist, '[]'::jsonb), coalesce(display_order, 0), coalesce(deleted, false), coalesce(created_at, now()), coalesce(updated_at, now())
    from jsonb_to_recordset(p_rows) as x(id uuid, owner_user_id uuid, legal_name text, cnpj text, dominio_code text, tax_regime text, envio text, particularities text, notes text,
                                         checklist jsonb, display_order int, deleted boolean, created_at timestamptz, updated_at timestamptz)
    on conflict (id) do update set owner_user_id = excluded.owner_user_id, legal_name = excluded.legal_name, cnpj = excluded.cnpj, dominio_code = excluded.dominio_code,
      tax_regime = excluded.tax_regime, envio = excluded.envio, particularities = excluded.particularities, notes = excluded.notes, checklist = excluded.checklist,
      display_order = excluded.display_order, deleted = excluded.deleted, created_at = excluded.created_at, updated_at = excluded.updated_at;
  elsif p_table = 'periods' then
    insert into public.apur_periods (owner_user_id, competence, status, source_competence, layout, opened_at, opened_by, saved_at, saved_by, reopened_at, reopened_by, progress_saved_at, progress_saved_by)
    select owner_user_id, competence, status, source_competence, coalesce(layout, '{}'::jsonb), coalesce(opened_at, now()), opened_by, saved_at, saved_by, reopened_at, reopened_by, progress_saved_at, progress_saved_by
    from jsonb_to_recordset(p_rows) as x(owner_user_id uuid, competence text, status text, source_competence text, layout jsonb, opened_at timestamptz, opened_by uuid,
                                         saved_at timestamptz, saved_by uuid, reopened_at timestamptz, reopened_by uuid, progress_saved_at timestamptz, progress_saved_by uuid)
    on conflict (owner_user_id, competence) do update set status = excluded.status, source_competence = excluded.source_competence, layout = excluded.layout,
      opened_at = excluded.opened_at, opened_by = excluded.opened_by, saved_at = excluded.saved_at, saved_by = excluded.saved_by, reopened_at = excluded.reopened_at,
      reopened_by = excluded.reopened_by, progress_saved_at = excluded.progress_saved_at, progress_saved_by = excluded.progress_saved_by;
  elsif p_table = 'snapshots' then
    insert into public.apur_snapshots (company_id, competence, owner_user_id, legal_name, cnpj, dominio_code, tax_regime, envio, particularities, notes, checklist, display_order, created_at, updated_at)
    select company_id, competence, owner_user_id, legal_name, coalesce(cnpj, ''), coalesce(dominio_code, ''), public.apur_canonical_regime(tax_regime), coalesce(envio, ''), coalesce(particularities, ''),
           coalesce(notes, ''), coalesce(checklist, '[]'::jsonb), coalesce(display_order, 0), coalesce(created_at, now()), coalesce(updated_at, now())
    from jsonb_to_recordset(p_rows) as x(company_id uuid, competence text, owner_user_id uuid, legal_name text, cnpj text, dominio_code text, tax_regime text, envio text,
                                         particularities text, notes text, checklist jsonb, display_order int, created_at timestamptz, updated_at timestamptz)
    on conflict (company_id, competence) do update set owner_user_id = excluded.owner_user_id, legal_name = excluded.legal_name, cnpj = excluded.cnpj,
      dominio_code = excluded.dominio_code, tax_regime = excluded.tax_regime, envio = excluded.envio, particularities = excluded.particularities, notes = excluded.notes,
      checklist = excluded.checklist, display_order = excluded.display_order, created_at = excluded.created_at, updated_at = excluded.updated_at;
  elsif p_table = 'checks' then
    insert into public.apur_checks (company_id, competence, item_id, item_label, status, note, updated_at, updated_by)
    select company_id, competence, item_id, coalesce(item_label, ''), coalesce(status, 'PENDING'), nullif(note, ''), coalesce(updated_at, now()), updated_by
    from jsonb_to_recordset(p_rows) as x(company_id uuid, competence text, item_id text, item_label text, status text, note text, updated_at timestamptz, updated_by uuid)
    on conflict (company_id, competence, item_id) do update set item_label = excluded.item_label, status = excluded.status, note = excluded.note,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  elsif p_table = 'monthly_notes' then
    insert into public.apur_monthly_notes (company_id, competence, note, is_pending, updated_at, updated_by)
    select company_id, competence, coalesce(note, ''), coalesce(is_pending, false), coalesce(updated_at, now()), updated_by
    from jsonb_to_recordset(p_rows) as x(company_id uuid, competence text, note text, is_pending boolean, updated_at timestamptz, updated_by uuid)
    on conflict (company_id, competence) do update set note = excluded.note, is_pending = excluded.is_pending, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  elsif p_table = 'admin_notes' then
    insert into public.apur_admin_notes (id, company_id, competence, item_id, item_label, note_type, note, active, created_by, created_at, archived_by, archived_at)
    select id, company_id, competence, coalesce(item_id, '__ROW__'), item_label, coalesce(note_type, 'MESSAGE'), note, coalesce(active, true), created_by, coalesce(created_at, now()), archived_by, archived_at
    from jsonb_to_recordset(p_rows) as x(id uuid, company_id uuid, competence text, item_id text, item_label text, note_type text, note text, active boolean,
                                         created_by uuid, created_at timestamptz, archived_by uuid, archived_at timestamptz)
    on conflict (id) do update set item_label = excluded.item_label, note_type = excluded.note_type, note = excluded.note, active = excluded.active,
      created_by = excluded.created_by, created_at = excluded.created_at, archived_by = excluded.archived_by, archived_at = excluded.archived_at;
  elsif p_table = 'visual_marks' then
    insert into public.apur_visual_marks (company_id, competence, item_id, color, updated_at, updated_by)
    select company_id, competence, coalesce(item_id, '__ROW__'), color, coalesce(updated_at, now()), updated_by
    from jsonb_to_recordset(p_rows) as x(company_id uuid, competence text, item_id text, color text, updated_at timestamptz, updated_by uuid)
    on conflict (company_id, competence, item_id) do update set color = excluded.color, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  elsif p_table = 'alerts' then
    insert into public.apur_alerts (id, title, message, severity, active, starts_on, ends_on, target_all, target_user_ids, font_size, is_bold, highlight_yellow,
                                    deleted, created_by, created_at, updated_at, updated_by, deleted_at, deleted_by)
    select id, title, coalesce(message, ''), coalesce(severity, 'INFO'), coalesce(active, true), starts_on, ends_on, coalesce(target_all, true), coalesce(target_user_ids, '{}'),
           least(28, greatest(12, coalesce(font_size, 15))), coalesce(is_bold, false), coalesce(highlight_yellow, false), coalesce(deleted, false), created_by,
           coalesce(created_at, now()), coalesce(updated_at, now()), updated_by, deleted_at, deleted_by
    from jsonb_to_recordset(p_rows) as x(id uuid, title text, message text, severity text, active boolean, starts_on date, ends_on date, target_all boolean,
                                         target_user_ids uuid[], font_size int, is_bold boolean, highlight_yellow boolean, deleted boolean, created_by uuid,
                                         created_at timestamptz, updated_at timestamptz, updated_by uuid, deleted_at timestamptz, deleted_by uuid)
    on conflict (id) do update set title = excluded.title, message = excluded.message, severity = excluded.severity, active = excluded.active,
      starts_on = excluded.starts_on, ends_on = excluded.ends_on, target_all = excluded.target_all, target_user_ids = excluded.target_user_ids,
      font_size = excluded.font_size, is_bold = excluded.is_bold, highlight_yellow = excluded.highlight_yellow, deleted = excluded.deleted,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by, deleted_at = excluded.deleted_at, deleted_by = excluded.deleted_by;
  elsif p_table = 'documents' then
    insert into public.apur_documents (id, company_id, competence, original_name, storage_path, mime_type, size_bytes, sha256, note, uploaded_by, created_at, deleted, deleted_at, deleted_by)
    select id, company_id, competence, original_name, storage_path, mime_type, coalesce(size_bytes, 0), coalesce(sha256, ''), coalesce(note, ''), uploaded_by,
           coalesce(created_at, now()), coalesce(deleted, false), deleted_at, deleted_by
    from jsonb_to_recordset(p_rows) as x(id uuid, company_id uuid, competence text, original_name text, storage_path text, mime_type text, size_bytes bigint, sha256 text,
                                         note text, uploaded_by uuid, created_at timestamptz, deleted boolean, deleted_at timestamptz, deleted_by uuid)
    on conflict (id) do update set competence = excluded.competence, original_name = excluded.original_name, storage_path = excluded.storage_path,
      mime_type = excluded.mime_type, size_bytes = excluded.size_bytes, sha256 = excluded.sha256, note = excluded.note, deleted = excluded.deleted,
      deleted_at = excluded.deleted_at, deleted_by = excluded.deleted_by;
  elsif p_table = 'audit' then
    insert into public.apur_audit (user_id, action, entity_type, entity_id, details, created_at)
    select user_id, action, entity_type, entity_id, coalesce(details, '{}'::jsonb) || jsonb_build_object('migrado', true, 'id_original', old_id), coalesce(created_at, now())
    from jsonb_to_recordset(p_rows) as x(old_id bigint, user_id uuid, action text, entity_type text, entity_id text, details jsonb, created_at timestamptz)
    where not exists (select 1 from public.apur_audit a where a.details->>'migrado' = 'true' and (a.details->>'id_original')::bigint = x.old_id);
  else
    raise exception 'Tabela de migração desconhecida: %', p_table;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- Leitura (RLS): ADM vê tudo; usuário vê a própria carteira, inclusive o histórico das fotografias.
-- Gravação: somente pelas funções acima (nenhuma política de insert/update/delete para o app).

create or replace function public.apur_can_read_company(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.apur_companies c where c.id = p_company and c.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.apur_snapshots s where s.company_id = p_company and s.owner_user_id = auth.uid()
  )
$$;

create or replace function public.apur_can_read_month(p_company uuid, p_comp text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.apur_snapshots s where s.company_id = p_company and s.competence = p_comp and s.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.apur_companies c where c.id = p_company and not c.deleted and c.owner_user_id = auth.uid()
  )
$$;

alter table public.apur_companies enable row level security;
alter table public.apur_periods enable row level security;
alter table public.apur_snapshots enable row level security;
alter table public.apur_checks enable row level security;
alter table public.apur_monthly_notes enable row level security;
alter table public.apur_admin_notes enable row level security;
alter table public.apur_visual_marks enable row level security;
alter table public.apur_documents enable row level security;
alter table public.apur_alerts enable row level security;
alter table public.apur_audit enable row level security;

revoke all on public.apur_companies, public.apur_periods, public.apur_snapshots, public.apur_checks, public.apur_monthly_notes,
  public.apur_admin_notes, public.apur_visual_marks, public.apur_documents, public.apur_alerts, public.apur_audit from anon, authenticated;
grant select on public.apur_companies, public.apur_periods, public.apur_snapshots, public.apur_checks, public.apur_monthly_notes,
  public.apur_admin_notes, public.apur_visual_marks, public.apur_documents, public.apur_alerts, public.apur_audit to authenticated;

drop policy if exists "apur_companies_select" on public.apur_companies;
create policy "apur_companies_select" on public.apur_companies for select to authenticated
using (public.is_active_user() and public.apur_can_read_company(id));

drop policy if exists "apur_periods_select" on public.apur_periods;
create policy "apur_periods_select" on public.apur_periods for select to authenticated
using (public.is_active_user() and (public.is_admin() or owner_user_id = auth.uid()));

drop policy if exists "apur_snapshots_select" on public.apur_snapshots;
create policy "apur_snapshots_select" on public.apur_snapshots for select to authenticated
using (public.is_active_user() and (public.is_admin() or owner_user_id = auth.uid()));

drop policy if exists "apur_checks_select" on public.apur_checks;
create policy "apur_checks_select" on public.apur_checks for select to authenticated
using (public.is_active_user() and public.apur_can_read_month(company_id, competence));

drop policy if exists "apur_monthly_notes_select" on public.apur_monthly_notes;
create policy "apur_monthly_notes_select" on public.apur_monthly_notes for select to authenticated
using (public.is_active_user() and public.apur_can_read_month(company_id, competence));

drop policy if exists "apur_admin_notes_select" on public.apur_admin_notes;
create policy "apur_admin_notes_select" on public.apur_admin_notes for select to authenticated
using (public.is_active_user() and public.apur_can_read_month(company_id, competence));

drop policy if exists "apur_visual_marks_select" on public.apur_visual_marks;
create policy "apur_visual_marks_select" on public.apur_visual_marks for select to authenticated
using (public.is_active_user() and public.apur_can_read_month(company_id, competence));

drop policy if exists "apur_documents_select" on public.apur_documents;
create policy "apur_documents_select" on public.apur_documents for select to authenticated
using (public.is_active_user() and not deleted and (
  public.is_admin()
  or (competence is not null and exists (select 1 from public.apur_snapshots s where s.company_id = apur_documents.company_id and s.competence = apur_documents.competence and s.owner_user_id = auth.uid()))
  or ((competence is null or not exists (select 1 from public.apur_snapshots s where s.company_id = apur_documents.company_id and s.competence = apur_documents.competence))
      and exists (select 1 from public.apur_companies c where c.id = apur_documents.company_id and c.owner_user_id = auth.uid()))
));

drop policy if exists "apur_alerts_select" on public.apur_alerts;
create policy "apur_alerts_select" on public.apur_alerts for select to authenticated
using (public.is_active_user() and not deleted and (public.is_admin() or target_all or auth.uid() = any(target_user_ids)));

drop policy if exists "apur_audit_select" on public.apur_audit;
create policy "apur_audit_select" on public.apur_audit for select to authenticated
using (public.is_admin());

-- Funções internas não ficam expostas; o app só chama as operações listadas abaixo.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'apur\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- Funções chamáveis pelo app
do $$
declare f text;
begin
  foreach f in array array[
    'apur_can_read_company(uuid)', 'apur_can_read_month(uuid, text)',
    'apur_company_create(jsonb)', 'apur_company_update(uuid, jsonb)', 'apur_company_delete(uuid, text)',
    'apur_reorder(uuid, uuid[], text)', 'apur_set_check(uuid, text, text, text, text)', 'apur_set_check_note(uuid, text, text, text, text)',
    'apur_set_monthly_note(uuid, text, text, boolean)', 'apur_admin_note_create(uuid, text, text, text, text)', 'apur_admin_note_archive(uuid)',
    'apur_set_visual_mark(uuid, text, text, text)', 'apur_column_add(uuid, text, text, text)', 'apur_column_rename(uuid, text, text, text)',
    'apur_competence_action(text, uuid, text, jsonb)', 'apur_completion_summary(uuid, text)', 'apur_save_layout(uuid, text, jsonb)',
    'apur_delete_all(uuid, text, text)', 'apur_transfer_portfolio(uuid, uuid)', 'apur_import_companies(uuid, text, jsonb)',
    'apur_import_preview(uuid, jsonb)', 'apur_admin_dashboard(text)', 'apur_admin_history(uuid)', 'apur_checklist_for_regime(text)',
    'apur_canonical_regime(text, text)', 'apur_migrate_rows(text, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
