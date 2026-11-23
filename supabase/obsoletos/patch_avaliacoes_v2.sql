-- HUB Depto Tributário: Avaliações — ajustes de 09/11/2026
-- Rode no SQL Editor do Supabase depois de patch_avaliacoes.sql (pode rodar mais de uma vez).
-- - Recomendações da coordenação em itens (incluir, editar, excluir).
-- - Réplica do colaborador a cada recomendação, depois que a avaliação é devolvida.

begin;

alter table public.avaliacoes add column if not exists replicas jsonb not null default '{}'::jsonb;
alter table public.avaliacoes add column if not exists replicas_em timestamptz;
alter table public.avaliacoes_coordenacao add column if not exists recomendacoes_itens jsonb not null default '[]'::jsonb;

-- Regras de situação: o colaborador só cria/edita rascunho e pode enviar; depois do envio
-- só o administrador altera (corrige, devolve ou reabre). Com a avaliação devolvida, o
-- colaborador pode apenas registrar as réplicas às recomendações.
create or replace function public.avaliacoes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replicas jsonb;
begin
  if public.is_admin() then
    if tg_op = 'UPDATE' then
      if new.autoavaliacao is distinct from old.autoavaliacao or new.feedback is distinct from old.feedback then
        new.corrigida_por := auth.uid();
        new.corrigida_em := now();
      end if;
      if new.status = 'devolvida' and old.status <> 'devolvida' then
        new.devolvida_em := now();
      end if;
      if new.status = 'enviada' and old.status = 'rascunho' then
        new.enviada_em := now();
      end if;
      if new.replicas is distinct from old.replicas then
        new.replicas_em := now();
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.corrigida_por := null;
    new.corrigida_em := null;
    new.devolvida_em := null;
    new.replicas := '{}'::jsonb;
    new.replicas_em := null;
  else
    if old.status = 'devolvida' then
      v_replicas := coalesce(new.replicas, '{}'::jsonb);
      new := old;
      if v_replicas is distinct from old.replicas then
        new.replicas := v_replicas;
        new.replicas_em := now();
        new.updated_at := now();
      end if;
      return new;
    end if;
    if old.status <> 'rascunho' then
      raise exception 'Avaliação já enviada: somente a coordenação pode alterá-la.';
    end if;
    new.user_id := old.user_id;
    new.corrigida_por := old.corrigida_por;
    new.corrigida_em := old.corrigida_em;
    new.devolvida_em := old.devolvida_em;
    new.replicas := old.replicas;
    new.replicas_em := old.replicas_em;
  end if;

  if new.status not in ('rascunho', 'enviada') then
    raise exception 'Situação inválida para o colaborador.';
  end if;
  if new.status = 'enviada' then
    new.enviada_em := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists avaliacoes_guard on public.avaliacoes;
create trigger avaliacoes_guard
before insert or update on public.avaliacoes
for each row execute function public.avaliacoes_guard();

drop policy if exists "avaliacoes_update" on public.avaliacoes;
create policy "avaliacoes_update" on public.avaliacoes
for update to authenticated
using ((user_id = auth.uid() and status in ('rascunho', 'devolvida')) or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
