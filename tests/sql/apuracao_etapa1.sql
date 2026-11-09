\set QUIET on
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.try(label text, stmt text) returns text language plpgsql as $$
declare v text;
begin
  execute stmt into v;
  return 'OK    ' || label || coalesce(' -> ' || left(v, 160), '');
exception when others then
  return 'ERRO  ' || label || ' -> ' || left(sqlerrm, 160);
end $$;
begin;
-- auxiliares
select 'regime: ' || public.apur_canonical_regime('sn') || ' | ' || public.apur_canonical_regime('Presumido') || ' | ' || public.apur_canonical_regime('LR') || ' | ' || public.apur_canonical_regime('cooperativa');
select 'checklist SN: ' || (select string_agg(e->>'id', ',') from jsonb_array_elements(public.apur_checklist_for_regime('Simples Nacional')) e);
select 'checklist LP ids: ' || (select string_agg(e->>'id', ',') from jsonb_array_elements(public.apur_checklist_for_regime('LP')) e);
select 'cnpj valido 11.222.333/0001-81: ' || public.apur_valid_cnpj('11.222.333/0001-81') || ' | invalido: ' || public.apur_valid_cnpj('11222333000182');
select 'comp: ' || public.apur_prev_comp('2026-01') || ' ' || public.apur_next_comp('2026-12') || ' ' || public.apur_comp_label('2026-11');
select 'norm: ' || public.apur_norm_key('  Saídas / ICMS-ST  ') || ' | slug ' || public.apur_item_slug('EFD Contrib.');

-- Bia monta a carteira
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select pg_temp.try('Bia cria empresa A (sem competência)', $q$select public.apur_company_create('{"id":"10000000-0000-0000-0000-000000000001","legal_name":"Alfa Ltda","tax_regime":"SN","cnpj":"11.222.333/0001-81","dominio_code":"101"}'::jsonb)::text$q$);
select pg_temp.try('Bia cria duplicada (mesmo CNPJ)', $q$select public.apur_company_create('{"legal_name":"Alfa 2","cnpj":"11222333000181"}'::jsonb)::text$q$);
select pg_temp.try('Bia CNPJ inválido', $q$select public.apur_company_create('{"legal_name":"X","cnpj":"123"}'::jsonb)::text$q$);
select pg_temp.try('Bia marca DONE em A/2026-10 (cria período e foto)', $q$select public.apur_set_check('10000000-0000-0000-0000-000000000001','2026-10','saidas','Saídas','DONE')::text$q$);
select pg_temp.try('Bia cria empresa B na competência', $q$select public.apur_company_create('{"id":"10000000-0000-0000-0000-000000000002","legal_name":"Beta SA","tax_regime":"Lucro Presumido","competence":"2026-10"}'::jsonb)::text$q$);
select pg_temp.try('Bia cria empresa em 2026-12 (não gerada)', $q$select public.apur_company_create('{"legal_name":"Gama","competence":"2026-12"}'::jsonb)::text$q$);
select pg_temp.try('Bia nota de célula', $q$select public.apur_set_check_note('10000000-0000-0000-0000-000000000001','2026-10','entradas','Entradas','compras acima da média')::text$q$);
select pg_temp.try('Bia muda status sem apagar nota', $q$select public.apur_set_check('10000000-0000-0000-0000-000000000001','2026-10','entradas','Entradas','DONE')::text$q$);
select 'nota preservada: ' || (select note || '/' || status from public.apur_checks where item_id='entradas');
select pg_temp.try('Bia pendência mensal B', $q$select public.apur_set_monthly_note('10000000-0000-0000-0000-000000000002','2026-10','aguardando extrato',true)::text$q$);
select pg_temp.try('Bia grifo amarelo linha', $q$select public.apur_set_visual_mark('10000000-0000-0000-0000-000000000001','2026-10',null,'YELLOW')::text$q$);
select pg_temp.try('Bia nota ADM (proibido)', $q$select public.apur_admin_note_create('10000000-0000-0000-0000-000000000001','2026-10',null,'MESSAGE','x')::text$q$);
select pg_temp.try('Bia + coluna', $q$select public.apur_column_add(null,'custom-abcdefghij12','Compras','2026-10')::text$q$);
select pg_temp.try('Bia + coluna repetida', $q$select public.apur_column_add(null,'custom-abcdefghij13','compras','2026-10')::text$q$);
select pg_temp.try('Bia renomeia coluna ISS -> Serviços', $q$select public.apur_column_rename(null,'iss','Serviços','2026-10')::text$q$);
select 'labels A: ' || (select string_agg(e->>'label', ',') from public.apur_companies c, jsonb_array_elements(c.checklist) e where c.id='10000000-0000-0000-0000-000000000001');
select 'foto A segue cadastro: ' || (select checklist::text like '%Serviços%' from public.apur_snapshots where company_id='10000000-0000-0000-0000-000000000001' and competence='2026-10');
select pg_temp.try('Bia reordena (B, A)', $q$select public.apur_reorder(null, array['10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001']::uuid[], '2026-10')::text$q$);
select 'ordem: ' || (select string_agg(legal_name || '=' || display_order, ',' order by display_order) from public.apur_companies);
select pg_temp.try('Bia tenta carteira de outro', $q$select public.apur_reorder('c0000000-0000-0000-0000-00000000000c', array[]::uuid[], null)::text$q$);
select pg_temp.try('Bia gera período sem fechar', $q$select public.apur_competence_action('generate_next', null, '2026-10')::text$q$);
select pg_temp.try('Bia salva progresso em 10/2026 (não se aplica)', $q$select public.apur_competence_action('save_progress', null, '2026-10')::text$q$);
select pg_temp.try('Bia salva (fecha) 10/2026', $q$select public.apur_competence_action('save', null, '2026-10', '{"widths":{"saidas":80}}'::jsonb)::text$q$);
select pg_temp.try('Bia altera após fechar', $q$select public.apur_set_check('10000000-0000-0000-0000-000000000001','2026-10','iss','ISS','DONE')::text$q$);
select pg_temp.try('Bia gera novo período incompleto (FIX13)', $q$select public.apur_competence_action('generate_next', null, '2026-10')::text$q$);
select pg_temp.try('Resumo de conclusão', $q$select public.apur_completion_summary(null,'2026-10')::text$q$);
select pg_temp.try('Bia reabre 10/2026', $q$select public.apur_competence_action('reopen', null, '2026-10')::text$q$);
-- conclui tudo
do $$ declare r record; e jsonb; begin
  for r in select company_id, checklist from public.apur_snapshots where competence='2026-10' loop
    for e in select * from jsonb_array_elements(r.checklist) loop
      perform public.apur_set_check(r.company_id,'2026-10',e->>'id',e->>'label','DONE');
    end loop;
  end loop;
end $$;
select pg_temp.try('Bia limpa pendência', $q$select public.apur_set_monthly_note('10000000-0000-0000-0000-000000000002','2026-10','',false)::text$q$);
select pg_temp.try('Bia fecha de novo', $q$select public.apur_competence_action('save', null, '2026-10')::text$q$);
select pg_temp.try('Bia gera 11/2026', $q$select public.apur_competence_action('generate_next', null, '2026-10')::text$q$);
select 'fotos 11/2026: ' || (select count(*) from public.apur_snapshots where competence='2026-11') || ' | checks 11/2026: ' || (select count(*) from public.apur_checks where competence='2026-11') || ' | layout herdado: ' || (select layout::text from public.apur_periods where competence='2026-11');
select pg_temp.try('Bia gera 11/2026 de novo', $q$select public.apur_competence_action('generate_next', null, '2026-10')::text$q$);
select pg_temp.try('Bia reabre 10/2026 com 11 existente', $q$select public.apur_competence_action('reopen', null, '2026-10')::text$q$);
select pg_temp.try('Bia salva progresso 11/2026', $q$select public.apur_competence_action('save_progress', null, '2026-11')::text$q$);
select pg_temp.try('Bia exclui A em 11/2026', $q$select public.apur_company_delete('10000000-0000-0000-0000-000000000001','2026-11')::text$q$);
select 'A excluída, fotos A: ' || (select string_agg(competence, ',' order by competence) from public.apur_snapshots where company_id='10000000-0000-0000-0000-000000000001');
select 'Bia vê empresas: ' || (select count(*) from public.apur_companies) || ' | fotos: ' || (select count(*) from public.apur_snapshots) || ' | checks: ' || (select count(*) from public.apur_checks);
select pg_temp.try('Bia chama função interna', $q$select public.apur_capture_snapshots('b0000000-0000-0000-0000-00000000000b','2026-11','b0000000-0000-0000-0000-00000000000b')::text$q$);
select pg_temp.try('Bia escreve direto na tabela', $q$update public.apur_companies set legal_name='hack' returning legal_name$q$);
select pg_temp.try('Bia fecha 11/2026 (fechar)', $q$select public.apur_competence_action('save', null, '2026-11')::text$q$);
select pg_temp.try('Bia altera 11/2026 fechada', $q$select public.apur_set_check('10000000-0000-0000-0000-000000000002','2026-11','saidas','Saídas','DONE')::text$q$);
reset role;

-- Teste (outro usuário) não vê a carteira da Bia
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
select 'Teste vê empresas da Bia: ' || (select count(*) from public.apur_companies) || ' | checks: ' || (select count(*) from public.apur_checks);
select pg_temp.try('Teste marca empresa da Bia', $q$select public.apur_set_check('10000000-0000-0000-0000-000000000002','2026-11','saidas','Saídas','DONE')::text$q$);
select pg_temp.try('Teste dashboard ADM', $q$select public.apur_admin_dashboard('2026-11')::text$q$);
reset role;

-- ADM
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select 'ADM vê empresas: ' || (select count(*) from public.apur_companies) || ' | fotos: ' || (select count(*) from public.apur_snapshots);
select pg_temp.try('ADM reabre 10/2026 (histórica)', $q$select public.apur_competence_action('reopen', 'b0000000-0000-0000-0000-00000000000b', '2026-10')::text$q$);
select pg_temp.try('ADM edita Beta só na foto de 10/2026', $q$select public.apur_company_update('10000000-0000-0000-0000-000000000002','{"legal_name":"Beta SA (corrigida em 10)","competence":"2026-10","tax_regime":"Lucro Presumido"}'::jsonb)::text$q$);
select 'mestre Beta: ' || (select legal_name from public.apur_companies where id='10000000-0000-0000-0000-000000000002') || ' | foto 10: ' || (select legal_name from public.apur_snapshots where company_id='10000000-0000-0000-0000-000000000002' and competence='2026-10') || ' | foto 11: ' || (select legal_name from public.apur_snapshots where company_id='10000000-0000-0000-0000-000000000002' and competence='2026-11');
select pg_temp.try('ADM nota de célula (recado)', $q$select public.apur_admin_note_create('10000000-0000-0000-0000-000000000002','2026-10','saidas','DIRECTIVE','Conferir CFOP')::text$q$);
select pg_temp.try('ADM fecha 10/2026 histórica', $q$select public.apur_competence_action('save', 'b0000000-0000-0000-0000-00000000000b', '2026-10')::text$q$);
select pg_temp.try('ADM sem responsável', $q$select public.apur_competence_action('save', null, '2026-10')::text$q$);
select pg_temp.try('ADM dashboard 11/2026', $q$select public.apur_admin_dashboard('2026-11')::text$q$);
select pg_temp.try('ADM histórico', $q$select (public.apur_admin_history(null)->'rows')::text$q$);
select pg_temp.try('ADM prévia importação', $q$select public.apur_import_preview('b0000000-0000-0000-0000-00000000000b','[{"legal_name":"Beta SA"},{"legal_name":"Delta ME","cnpj":"11222333000181"},{"legal_name":"Épsilon","tax_regime":"SN"}]'::jsonb)::text$q$);
select pg_temp.try('ADM reabre 11/2026 e importa', $q$select public.apur_competence_action('reopen', 'b0000000-0000-0000-0000-00000000000b', '2026-11')::text$q$);
select pg_temp.try('ADM importa', $q$select public.apur_import_companies('b0000000-0000-0000-0000-00000000000b','2026-11','[{"legal_name":"Beta SA"},{"legal_name":"Épsilon","tax_regime":"SN","dominio_code":"500"},{"legal_name":"Zeta","dominio_code":"500"}]'::jsonb)::text$q$);
select pg_temp.try('ADM transfere carteira Bia -> Davi', $q$select public.apur_transfer_portfolio('b0000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-00000000000d')::text$q$);
select pg_temp.try('ADM transfere para ADM (proibido)', $q$select public.apur_transfer_portfolio('d0000000-0000-0000-0000-00000000000d','a0000000-0000-0000-0000-00000000000a')::text$q$);
select pg_temp.try('ADM exclui todas sem confirmar', $q$select public.apur_delete_all('d0000000-0000-0000-0000-00000000000d',null,'sim')::text$q$);
select pg_temp.try('ADM exclui todas (Davi)', $q$select public.apur_delete_all('d0000000-0000-0000-0000-00000000000d',null,'EXCLUIR')::text$q$);
select 'auditoria: ' || (select count(*) from public.apur_audit);
reset role;
rollback;
