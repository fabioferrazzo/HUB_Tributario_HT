-- HUB Depto Tributário: Avaliações por desempenho
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez).
-- - avaliacoes: autoavaliação do colaborador (cada um vê e edita só a própria; trava após o envio).
-- - avaliacoes_coordenacao: notas do coordenador, subcoordenação e recomendações
--   (só o administrador grava; o colaborador vê depois que a avaliação é devolvida).

begin;

create table if not exists public.avaliacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  colaborador_nome text not null default '',
  competencia text not null check (competencia ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  status text not null default 'rascunho' check (status in ('rascunho', 'enviada', 'devolvida')),
  autoavaliacao jsonb not null default '{}'::jsonb,
  feedback jsonb not null default '{}'::jsonb,
  enviada_em timestamptz,
  devolvida_em timestamptz,
  corrigida_por uuid references public.profiles(id) on delete set null,
  corrigida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, competencia)
);

create table if not exists public.avaliacoes_coordenacao (
  avaliacao_id uuid primary key references public.avaliacoes(id) on delete cascade,
  coordenador jsonb not null default '{}'::jsonb,
  subcoordenacao jsonb not null default '{}'::jsonb,
  recomendacoes text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists avaliacoes_competencia_idx on public.avaliacoes (competencia);

alter table public.avaliacoes enable row level security;
alter table public.avaliacoes_coordenacao enable row level security;

grant select, insert, update, delete on public.avaliacoes to authenticated;
grant select, insert, update, delete on public.avaliacoes_coordenacao to authenticated;

-- Regras de situação: o colaborador só cria/edita rascunho e pode enviar; depois do envio
-- só o administrador altera (corrige, devolve ou reabre).
create or replace function public.avaliacoes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.corrigida_por := null;
    new.corrigida_em := null;
    new.devolvida_em := null;
  else
    if old.status <> 'rascunho' then
      raise exception 'Avaliação já enviada: somente a coordenação pode alterá-la.';
    end if;
    new.user_id := old.user_id;
    new.corrigida_por := old.corrigida_por;
    new.corrigida_em := old.corrigida_em;
    new.devolvida_em := old.devolvida_em;
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

drop policy if exists "avaliacoes_select" on public.avaliacoes;
create policy "avaliacoes_select" on public.avaliacoes
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "avaliacoes_insert" on public.avaliacoes;
create policy "avaliacoes_insert" on public.avaliacoes
for insert to authenticated
with check (public.is_active_user() and (user_id = auth.uid() or public.is_admin()));

drop policy if exists "avaliacoes_update" on public.avaliacoes;
create policy "avaliacoes_update" on public.avaliacoes
for update to authenticated
using ((user_id = auth.uid() and status = 'rascunho') or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "avaliacoes_delete" on public.avaliacoes;
create policy "avaliacoes_delete" on public.avaliacoes
for delete to authenticated
using (public.is_admin() or (user_id = auth.uid() and status = 'rascunho'));

drop policy if exists "avaliacoes_coord_select" on public.avaliacoes_coordenacao;
create policy "avaliacoes_coord_select" on public.avaliacoes_coordenacao
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.avaliacoes a
    where a.id = avaliacao_id and a.user_id = auth.uid() and a.status = 'devolvida'
  )
);

drop policy if exists "avaliacoes_coord_write" on public.avaliacoes_coordenacao;
create policy "avaliacoes_coord_write" on public.avaliacoes_coordenacao
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
