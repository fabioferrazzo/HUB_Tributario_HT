-- HUB Depto Tributário — Etapa D, passo 2: LIMPEZA das tabelas antigas de Avaliações (versões 1 a 3).
-- ATENÇÃO: só rode depois do diagnóstico (diagnostico_avaliacoes_antigas.sql) e da confirmação.
--
-- O que faz, numa única transação (se algo falhar, nada é alterado):
--   1. Recusa continuar se alguma visão, chave estrangeira ou função ainda usar as tabelas antigas.
--   2. Guarda uma cópia integral das duas tabelas no esquema "arquivo_morto"
--      (fora da API do app: nenhum usuário do HUB acessa esse esquema).
--   3. Apaga as tabelas antigas avaliacoes e avaliacoes_coordenacao e o gatilho avaliacoes_guard.
-- A tabela em uso pelo HUB (avd_avaliacoes) e o histórico (avd_eventos) não são tocados.
-- Pode rodar mais de uma vez: se as tabelas já tiverem sido apagadas, apenas informa.

begin;

do $$
declare
  v_dep text;
begin
  if to_regclass('public.avaliacoes') is null and to_regclass('public.avaliacoes_coordenacao') is null then
    raise notice 'As tabelas antigas já não existem. Nada a fazer.';
    return;
  end if;

  -- 1. Trava de segurança: dependências fora do conjunto antigo.
  select string_agg(nome, ', ') into v_dep from (
    select distinct c.relname::text as nome
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class c on c.oid = r.ev_class
    where d.refobjid in (select to_regclass('public.avaliacoes') union select to_regclass('public.avaliacoes_coordenacao'))
      and c.oid not in (select to_regclass('public.avaliacoes') union select to_regclass('public.avaliacoes_coordenacao'))
    union
    select distinct conrelid::regclass::text
    from pg_constraint
    where contype = 'f'
      and confrelid in (select to_regclass('public.avaliacoes') union select to_regclass('public.avaliacoes_coordenacao'))
      and conrelid not in (select to_regclass('public.avaliacoes') union select to_regclass('public.avaliacoes_coordenacao'))
    union
    select p.proname::text
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname <> 'avaliacoes_guard'
      and (p.prosrc ~* '\mavaliacoes_coordenacao\M' or p.prosrc ~* '(from|join|into|update|table)\s+(public\.)?avaliacoes\M')
  ) x;
  if v_dep is not null then
    raise exception 'Limpeza cancelada: ainda há objetos usando as tabelas antigas (%). Nada foi alterado.', v_dep;
  end if;

  -- 2. Backup integral (fora da API).
  create schema if not exists arquivo_morto;
  revoke all on schema arquivo_morto from public;
  execute 'revoke all on schema arquivo_morto from anon, authenticated';

  if to_regclass('public.avaliacoes') is not null then
    drop table if exists arquivo_morto.avaliacoes_v3_backup_20261119;
    create table arquivo_morto.avaliacoes_v3_backup_20261119 as table public.avaliacoes;
  end if;
  if to_regclass('public.avaliacoes_coordenacao') is not null then
    drop table if exists arquivo_morto.avaliacoes_coordenacao_v3_backup_20261119;
    create table arquivo_morto.avaliacoes_coordenacao_v3_backup_20261119 as table public.avaliacoes_coordenacao;
  end if;

  -- Confere a cópia antes de apagar.
  if to_regclass('public.avaliacoes') is not null and
     (select count(*) from public.avaliacoes) <> (select count(*) from arquivo_morto.avaliacoes_v3_backup_20261119) then
    raise exception 'Backup de avaliacoes incompleto. Nada foi alterado.';
  end if;
  if to_regclass('public.avaliacoes_coordenacao') is not null and
     (select count(*) from public.avaliacoes_coordenacao) <> (select count(*) from arquivo_morto.avaliacoes_coordenacao_v3_backup_20261119) then
    raise exception 'Backup de avaliacoes_coordenacao incompleto. Nada foi alterado.';
  end if;

  -- 3. Remoção (sem CASCADE: se surgir dependência não prevista, a transação falha e nada muda).
  drop table if exists public.avaliacoes_coordenacao;
  drop table if exists public.avaliacoes;
  drop function if exists public.avaliacoes_guard();

  raise notice 'Concluído: tabelas antigas apagadas; cópia guardada no esquema arquivo_morto.';
end;
$$;

commit;

-- Resultado para conferência (aparece como tabela no SQL Editor).
select 'Tabela antiga avaliacoes' as item,
       case when to_regclass('public.avaliacoes') is null then 'apagada' else 'AINDA EXISTE' end as situacao
union all
select 'Tabela antiga avaliacoes_coordenacao',
       case when to_regclass('public.avaliacoes_coordenacao') is null then 'apagada' else 'AINDA EXISTE' end
union all
select 'Backup avaliacoes (arquivo_morto)',
       case when to_regclass('arquivo_morto.avaliacoes_v3_backup_20261119') is null then 'não criado'
            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from arquivo_morto.avaliacoes_v3_backup_20261119', false, true, '')))[1]::text || ' registro(s)' end
union all
select 'Backup avaliacoes_coordenacao (arquivo_morto)',
       case when to_regclass('arquivo_morto.avaliacoes_coordenacao_v3_backup_20261119') is null then 'não criado'
            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from arquivo_morto.avaliacoes_coordenacao_v3_backup_20261119', false, true, '')))[1]::text || ' registro(s)' end
union all
select 'Tabela ATUAL avd_avaliacoes',
       case when to_regclass('public.avd_avaliacoes') is null then 'NÃO ENCONTRADA'
            else 'intacta: ' || (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.avd_avaliacoes', false, true, '')))[1]::text || ' registro(s)' end;
