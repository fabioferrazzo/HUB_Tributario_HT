-- HUB Depto Tributário: Avaliações — resposta da coordenação ao feedback (09/11/2026)
-- Rode no SQL Editor do Supabase depois de patch_avaliacoes_v2.sql (pode rodar mais de uma vez).
-- A resposta fica na tabela da coordenação: só o administrador grava e o colaborador
-- só lê depois que a avaliação é devolvida (regras já existentes).

begin;

alter table public.avaliacoes_coordenacao add column if not exists feedback_respostas jsonb not null default '{}'::jsonb;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
