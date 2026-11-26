-- HUB Depto Tributário: Registros v2
--   1. Contatos no registro (2 telefones e 2 e-mails).
--   2. Subaba Alterações: cada alteração é um item próprio (tipo 'alteracao'), ligado ao registro da empresa,
--      com categorias (contrato social, quadro societário, CNAE, endereço...) e data da alteração.
--   3. Controle de Apuração: contatos no cadastro da empresa (coluna contatos) e função própria para gravá-los,
--      sem alterar as funções que já existem no app.
-- Rode no SQL Editor do Supabase depois do patch_registros.sql (pode rodar mais de uma vez).

begin;

-- ---------------------------------------------------------------------------------------------
-- 1 e 2. Registros

alter table public.hub_registros add column if not exists telefone1 text not null default '';
alter table public.hub_registros add column if not exists telefone2 text not null default '';
alter table public.hub_registros add column if not exists email1 text not null default '';
alter table public.hub_registros add column if not exists email2 text not null default '';
alter table public.hub_registros add column if not exists categorias text[] not null default '{}';
alter table public.hub_registros add column if not exists data_alteracao date;
alter table public.hub_registros add column if not exists empresa_id uuid references public.hub_registros(id) on delete set null;

-- O CNPJ continua único entre as empresas; as alterações podem repetir o CNPJ da empresa.
drop index if exists public.hub_registros_cnpj_unico;
create unique index if not exists hub_registros_cnpj_empresa_unico on public.hub_registros (cnpj) where cnpj <> '' and tipo <> 'alteracao';
create index if not exists hub_registros_empresa on public.hub_registros (empresa_id) where empresa_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 3. Controle de Apuração: contatos da empresa

alter table public.apur_companies add column if not exists contatos jsonb not null default '{}'::jsonb;

create or replace function public.apur_company_set_contacts(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  c public.apur_companies;
  v jsonb;
begin
  select * into c from public.apur_companies where id = p_id and not deleted;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  if not public.is_admin() and c.owner_user_id <> v_uid then
    raise exception 'Sem permissão para alterar outra carteira.';
  end if;
  v := jsonb_build_object(
    'telefone1', left(public.apur_txt(p->>'telefone1'), 40),
    'telefone2', left(public.apur_txt(p->>'telefone2'), 40),
    'email1', lower(left(public.apur_txt(p->>'email1'), 120)),
    'email2', lower(left(public.apur_txt(p->>'email2'), 120))
  );
  update public.apur_companies set contatos = v, updated_at = now() where id = p_id;
  perform public.apur_audit_log('CONTACTS', 'company', p_id::text, jsonb_build_object('legal_name', c.legal_name));
  return jsonb_build_object('ok', true, 'id', p_id, 'contatos', v);
end;
$$;

revoke all on function public.apur_company_set_contacts(uuid, jsonb) from public, anon;
grant execute on function public.apur_company_set_contacts(uuid, jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
