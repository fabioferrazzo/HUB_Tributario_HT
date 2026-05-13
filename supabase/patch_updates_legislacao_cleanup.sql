-- HUB Depto Tributario - limpeza de registros ruins em Legislacoes.
-- Remove materias/noticias e atalhos genericos que foram gravados como legislacao.

delete from public.noticias
where tipo = 'legislacao'
  and (
    url ilike '%camara.leg.br/noticias%'
    or url ilike '%senado.leg.br/noticias%'
    or source_url ilike '%camara.leg.br/noticias%'
    or source_url ilike '%senado.leg.br/noticias%'
    or url ilike '%cgibs.gov.br/regulamentos%'
    or lower(titulo) like '%cigarro%'
    or lower(titulo) like '%conteudo do%'
    or lower(titulo) like '-->%'
    or lower(titulo) like '%csibs%'
    or lower(titulo) in ('reforma tributaria', 'reforma tributária')
  );

insert into public.noticias (
  titulo,
  fonte,
  url,
  published_at,
  expires_at,
  active,
  tipo,
  source_type,
  source_url
)
values
  (
    'Portaria Conjunta MF/CGIBS nº 7, de 30 de abril de 2026',
    'Diario Oficial da Uniao',
    'https://www.in.gov.br/web/dou/-/portaria-conjunta-mf/cgibs-n-7-de-30-de-abril-de-2026-702822417',
    '2026-04-30',
    '2026-12-31',
    true,
    'legislacao',
    'oficial',
    'https://www.in.gov.br/'
  ),
  (
    'Resolucao CGIBS nº 6, de 30 de abril de 2026',
    'Comite Gestor do IBS',
    'https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf',
    '2026-04-30',
    '2026-12-31',
    true,
    'legislacao',
    'oficial',
    'https://www.cgibs.gov.br/regulamentos'
  ),
  (
    'Decreto nº 12.955, de 29 de abril de 2026',
    'Planalto',
    'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm',
    '2026-04-29',
    '2026-12-31',
    true,
    'legislacao',
    'oficial',
    'https://www.planalto.gov.br/'
  ),
  (
    'Lei Complementar nº 227, de 13 de janeiro de 2026',
    'Planalto',
    'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm',
    '2026-01-13',
    '2026-12-31',
    true,
    'legislacao',
    'oficial',
    'https://www.planalto.gov.br/'
  ),
  (
    'Lei Complementar nº 214, de 16 de janeiro de 2025',
    'Planalto',
    'https://www.planalto.gov.br/ccivil_03/leis/lcp/Lcp214compilado.htm',
    '2025-01-16',
    '2026-12-31',
    true,
    'legislacao',
    'oficial',
    'https://www.planalto.gov.br/'
  )
on conflict (tipo, url) do update
set
  titulo = excluded.titulo,
  fonte = excluded.fonte,
  published_at = excluded.published_at,
  expires_at = excluded.expires_at,
  active = true,
  source_type = excluded.source_type,
  source_url = excluded.source_url;
