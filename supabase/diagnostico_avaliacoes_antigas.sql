-- HUB Depto Tributário — Etapa D, passo 1: DIAGNÓSTICO (somente leitura, não altera nada).
-- Confere se as tabelas antigas de Avaliações (avaliacoes e avaliacoes_coordenacao, das versões 1 a 3)
-- ainda têm dados ou dependências antes de qualquer limpeza.
-- Rode no SQL Editor do Supabase. O resultado sai numa tabela só: item | resultado | observação.

with
existe as (
  select
    to_regclass('public.avaliacoes') is not null as av,
    to_regclass('public.avaliacoes_coordenacao') is not null as coord,
    to_regclass('public.avd_avaliacoes') is not null as nova
),
contagens as (
  select
    (select case when av then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.avaliacoes', false, true, '')))[1]::text::int end from existe) as av_qtd,
    (select case when coord then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.avaliacoes_coordenacao', false, true, '')))[1]::text::int end from existe) as coord_qtd,
    (select case when nova then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.avd_avaliacoes', false, true, '')))[1]::text::int end from existe) as nova_qtd
),
competencias as (
  select case when (select av from existe) then
    (xpath('/row/c/text()', query_to_xml(
      'select coalesce(string_agg(distinct competencia, '', '' order by competencia), ''(nenhuma)'') as c from public.avaliacoes',
      false, true, '')))[1]::text
  end as lista
),
-- Objetos do banco que dependem das tabelas antigas (visões, chaves estrangeiras de outras tabelas).
dependentes as (
  select distinct c.relname::text || ' (visão)' as nome
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class c on c.oid = r.ev_class
  where d.refobjid in (select to_regclass('public.avaliacoes') union select to_regclass('public.avaliacoes_coordenacao'))
    and c.oid not in (select to_regclass('public.avaliacoes') union select to_regclass('public.avaliacoes_coordenacao'))
  union
  select distinct conrelid::regclass::text || ' (chave estrangeira)'
  from pg_constraint
  where contype = 'f'
    and confrelid in (select to_regclass('public.avaliacoes') union select to_regclass('public.avaliacoes_coordenacao'))
    and conrelid not in (select to_regclass('public.avaliacoes') union select to_regclass('public.avaliacoes_coordenacao'))
),
-- Funções cujo código cita as tabelas antigas (exceto o próprio gatilho antigo).
funcoes as (
  select p.proname
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname <> 'avaliacoes_guard'
    and (p.prosrc ~* '\mavaliacoes_coordenacao\M' or p.prosrc ~* '(from|join|into|update|table)\s+(public\.)?avaliacoes\M')
)
select 1 as ordem, 'Tabela antiga avaliacoes existe?' as item,
       case when av then 'sim' else 'não' end as resultado,
       case when av then '' else 'Já removida: nada a limpar.' end as observacao
from existe
union all
select 2, 'Registros em avaliacoes', coalesce(av_qtd::text, '—'),
       case when av_qtd > 0 then 'Há dados antigos: serão guardados em backup antes de apagar.' else '' end
from contagens
union all
select 3, 'Competências em avaliacoes', coalesce((select lista from competencias), '—'), ''
union all
select 4, 'Tabela antiga avaliacoes_coordenacao existe?', case when coord then 'sim' else 'não' end, '' from existe
union all
select 5, 'Registros em avaliacoes_coordenacao', coalesce(coord_qtd::text, '—'), '' from contagens
union all
select 6, 'Registros na tabela ATUAL (avd_avaliacoes)', coalesce(nova_qtd::text, '—'),
       'Tabela em uso pelo HUB: não será tocada.'
from contagens
union all
select 7, 'Objetos que dependem das tabelas antigas',
       coalesce((select string_agg(nome, ', ') from dependentes), 'nenhum'),
       case when exists (select 1 from dependentes) then 'ATENÇÃO: precisa ser avaliado antes de apagar.' else 'OK' end
union all
select 8, 'Funções que citam as tabelas antigas',
       coalesce((select string_agg(proname, ', ') from funcoes), 'nenhuma'),
       case when exists (select 1 from funcoes) then 'ATENÇÃO: precisa ser avaliado antes de apagar.' else 'OK' end
union all
select 9, 'Gatilho antigo avaliacoes_guard existe?',
       case when exists (select 1 from pg_proc where proname = 'avaliacoes_guard' and pronamespace = 'public'::regnamespace) then 'sim' else 'não' end,
       case when exists (select 1 from pg_proc where proname = 'avaliacoes_guard' and pronamespace = 'public'::regnamespace)
            then 'Será removido junto com as tabelas antigas.' else '' end
order by ordem;
