-- HUB Depto Tributario - seed dos links uteis padrao.
-- Execute no SQL Editor do projeto HUB Depto Tributario:
-- https://kgorlrpparhcrprwamlc.supabase.co

begin;

insert into public.links_uteis (id, user_id, titulo, url, scope, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111001', null, 'Dominio Sistemas', 'https://www.dominiosistemas.com.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111002', null, 'ONVIO', 'https://onvio.com.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111003', null, 'Central de Solucoes ONVIO', 'https://suporte.dominioatendimento.com/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111004', null, 'Receita Federal', 'https://www.gov.br/receitafederal/pt-br', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111005', null, 'SEFAZ RS', 'https://www.sefaz.rs.gov.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111006', null, 'DTE RS', 'https://www.sefaz.rs.gov.br/dte/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111007', null, 'Gov.br', 'https://www.gov.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111008', null, 'Portal NF-e', 'https://www.nfe.fazenda.gov.br/portal/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111009', null, 'Portal Nacional NFS-e', 'https://www.nfse.gov.br/EmissorNacional/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111010', null, 'Reforma Tributaria - Ministerio da Fazenda', 'https://www.gov.br/fazenda/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111011', null, 'Comite Gestor do IBS', 'https://www.cgibs.gov.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111012', null, 'Planalto - Legislacao', 'https://www4.planalto.gov.br/legislacao', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111013', null, 'Senado Federal', 'https://www12.senado.leg.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111014', null, 'Camara dos Deputados', 'https://www.camara.leg.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111015', null, 'Econet Editora', 'https://www.econeteditora.com.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111016', null, 'e-Auditoria', 'https://www.e-auditoria.com.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111017', null, 'Zappy Contabil', 'https://www.zappycontabil.com.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111018', null, 'SIEG', 'https://www.sieg.com/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111019', null, 'Portal Contabeis', 'https://www.contabeis.com.br/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111020', null, 'JOTA', 'https://www.jota.info/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111021', null, 'e-CAC', 'https://cav.receita.fazenda.gov.br/autenticacao/login', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111022', null, 'SPED', 'https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/sped', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111023', null, 'Simples Nacional', 'https://www8.receita.fazenda.gov.br/SimplesNacional/', 'global', now(), now()),
  ('11111111-1111-4111-8111-111111111024', null, 'PGDAS-D', 'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgdasd.app/', 'global', now(), now())
on conflict (id) do update
set
  user_id = null,
  titulo = excluded.titulo,
  url = excluded.url,
  scope = 'global',
  updated_at = now();

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
