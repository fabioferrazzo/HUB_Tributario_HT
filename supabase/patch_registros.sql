-- HUB Depto Tributário: aba Registros (aberturas, alterações contratuais e clientes novos)
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez).
-- Regras:
--   - Toda a equipe ativa vê e edita os registros (IE, código no Domínio, regime, observações, anexos).
--   - Só o administrador define o responsável pela apuração e exclui registros.
--   - A entrada automática por e-mail grava pelo servidor (aparece como "Sistema" no Histórico).
--   - Anexos ficam no bucket privado hub-anexos, pasta registros/<id do registro>/.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------------------------
-- Tabelas

create table if not exists public.hub_registros (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null default '' check (cnpj = '' or cnpj ~ '^\d{14}$'),
  razao_social text not null default '',
  nome_fantasia text not null default '',
  ie text not null default '',
  codigo_dominio text not null default '',
  regime text not null default '',
  data_inicio date,
  situacao_cadastral text not null default '',
  natureza_juridica text not null default '',
  municipio text not null default '',
  uf text not null default '',
  socios jsonb not null default '[]'::jsonb,
  cnae_principal jsonb,
  cnaes_secundarios jsonb not null default '[]'::jsonb,
  dados_receita jsonb,
  receita_atualizada_em timestamptz,
  observacoes text not null default '',
  tipo text not null default 'outro' check (tipo in ('abertura', 'alteracao', 'cliente_novo', 'outro')),
  status text not null default 'revisao' check (status in ('revisao', 'ativo', 'arquivado')),
  origem text not null default 'manual' check (origem in ('manual', 'email')),
  responsavel_id uuid references public.profiles(id) on delete set null,
  responsavel_definido_em timestamptz,
  responsavel_definido_por uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hub_registros_cnpj_unico on public.hub_registros (cnpj) where cnpj <> '';
create index if not exists hub_registros_status on public.hub_registros (status, updated_at desc);

create table if not exists public.hub_registros_eventos (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references public.hub_registros(id) on delete cascade,
  tipo text not null default 'outro'
    check (tipo in ('abertura', 'alteracao', 'cliente_novo', 'outro', 'receita', 'responsavel', 'nota')),
  resumo text not null default '',
  assunto text not null default '',
  remetente text not null default '',
  email_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists hub_registros_eventos_email on public.hub_registros_eventos (email_id) where email_id is not null;
create index if not exists hub_registros_eventos_registro on public.hub_registros_eventos (registro_id, created_at desc);

create table if not exists public.hub_registros_anexos (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references public.hub_registros(id) on delete cascade,
  evento_id uuid references public.hub_registros_eventos(id) on delete set null,
  file_name text not null,
  storage_path text not null,
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists hub_registros_anexos_registro on public.hub_registros_anexos (registro_id, created_at desc);

drop trigger if exists hub_registros_touch_updated_at on public.hub_registros;
create trigger hub_registros_touch_updated_at
before update on public.hub_registros
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Só o administrador define o responsável pela apuração (o servidor, sem usuário, também pode).

create or replace function public.hub_registros_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' and new.responsavel_id is not null then
      raise exception 'Somente o administrador define o responsável pela apuração.';
    end if;
    if tg_op = 'UPDATE' and new.responsavel_id is distinct from old.responsavel_id then
      raise exception 'Somente o administrador define o responsável pela apuração.';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.responsavel_id is distinct from old.responsavel_id then
    new.responsavel_definido_em := case when new.responsavel_id is null then null else now() end;
    new.responsavel_definido_por := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists hub_registros_guarda on public.hub_registros;
create trigger hub_registros_guarda
before insert or update on public.hub_registros
for each row execute function public.hub_registros_guarda();

-- ---------------------------------------------------------------------------------------------
-- Permissões

alter table public.hub_registros enable row level security;
alter table public.hub_registros_eventos enable row level security;
alter table public.hub_registros_anexos enable row level security;

drop policy if exists "hub_registros_select" on public.hub_registros;
create policy "hub_registros_select" on public.hub_registros for select to authenticated
using (public.is_active_user());

drop policy if exists "hub_registros_insert" on public.hub_registros;
create policy "hub_registros_insert" on public.hub_registros for insert to authenticated
with check (public.is_active_user() and created_by = auth.uid());

drop policy if exists "hub_registros_update" on public.hub_registros;
create policy "hub_registros_update" on public.hub_registros for update to authenticated
using (public.is_active_user()) with check (public.is_active_user());

drop policy if exists "hub_registros_delete" on public.hub_registros;
create policy "hub_registros_delete" on public.hub_registros for delete to authenticated
using (public.is_admin());

drop policy if exists "hub_registros_eventos_select" on public.hub_registros_eventos;
create policy "hub_registros_eventos_select" on public.hub_registros_eventos for select to authenticated
using (public.is_active_user());

drop policy if exists "hub_registros_eventos_insert" on public.hub_registros_eventos;
create policy "hub_registros_eventos_insert" on public.hub_registros_eventos for insert to authenticated
with check (public.is_active_user() and created_by = auth.uid());

drop policy if exists "hub_registros_eventos_delete" on public.hub_registros_eventos;
create policy "hub_registros_eventos_delete" on public.hub_registros_eventos for delete to authenticated
using (public.is_admin());

drop policy if exists "hub_registros_anexos_select" on public.hub_registros_anexos;
create policy "hub_registros_anexos_select" on public.hub_registros_anexos for select to authenticated
using (public.is_active_user());

drop policy if exists "hub_registros_anexos_insert" on public.hub_registros_anexos;
create policy "hub_registros_anexos_insert" on public.hub_registros_anexos for insert to authenticated
with check (public.is_active_user() and created_by = auth.uid());

drop policy if exists "hub_registros_anexos_delete" on public.hub_registros_anexos;
create policy "hub_registros_anexos_delete" on public.hub_registros_anexos for delete to authenticated
using (created_by = auth.uid() or public.is_manager());

grant select, insert, update, delete on public.hub_registros, public.hub_registros_eventos, public.hub_registros_anexos to authenticated;

-- Arquivos: pasta registros/ do bucket privado hub-anexos
drop policy if exists "registros_storage_select" on storage.objects;
create policy "registros_storage_select" on storage.objects for select to authenticated
using (bucket_id = 'hub-anexos' and (storage.foldername(name))[1] = 'registros' and public.is_active_user());

drop policy if exists "registros_storage_insert" on storage.objects;
create policy "registros_storage_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'hub-anexos' and (storage.foldername(name))[1] = 'registros' and owner = auth.uid() and public.is_active_user());

drop policy if exists "registros_storage_delete" on storage.objects;
create policy "registros_storage_delete" on storage.objects for delete to authenticated
using (bucket_id = 'hub-anexos' and (storage.foldername(name))[1] = 'registros' and (owner = auth.uid() or public.is_manager()));

-- ---------------------------------------------------------------------------------------------
-- Histórico (módulo "Registros")

create or replace function public.hub_registros_hist()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_titulo text := coalesce(nullif(v_row->>'razao_social', ''), nullif(v_row->>'cnpj', ''), '(sem razão social)');
  v_alt text[] := '{}';
  k text;
begin
  if tg_op = 'INSERT' then
    perform public.hub_hist_registrar('Registros', 'Criou', v_row->>'id', v_titulo,
      jsonb_build_object('Tipo', v_row->>'tipo', 'Origem', v_row->>'origem'));
  elsif tg_op = 'DELETE' then
    perform public.hub_hist_registrar('Registros', 'Excluiu', v_row->>'id', v_titulo, '{}'::jsonb);
  else
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      continue when k in ('updated_at', 'dados_receita', 'receita_atualizada_em', 'responsavel_definido_em', 'responsavel_definido_por');
      if to_jsonb(new)->k is distinct from to_jsonb(old)->k then v_alt := v_alt || k; end if;
    end loop;
    if array_length(v_alt, 1) is null then return null; end if;
    if 'responsavel_id' = any(v_alt) then
      perform public.hub_hist_registrar('Registros',
        case when new.responsavel_id is null then 'Retirou o responsável' else 'Definiu o responsável' end,
        v_row->>'id', v_titulo,
        jsonb_build_object(
          'Responsável', coalesce((select coalesce(nullif(p.nome, ''), p.email) from public.profiles p where p.id = new.responsavel_id), ''),
          'Campos', array_to_string(v_alt, ', ')));
    else
      perform public.hub_hist_registrar('Registros', 'Alterou', v_row->>'id', v_titulo,
        jsonb_build_object('Campos', array_to_string(v_alt, ', ')));
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists hub_registros_hist on public.hub_registros;
create trigger hub_registros_hist
after insert or update or delete on public.hub_registros
for each row execute function public.hub_registros_hist();

revoke all on function public.hub_registros_hist() from public, anon, authenticated;
revoke all on function public.hub_registros_guarda() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
