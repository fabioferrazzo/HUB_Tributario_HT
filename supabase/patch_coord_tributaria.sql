-- HUB Depto Tributario - Coordenacao Tributaria multiusuario.
-- Execute no SQL Editor do Supabase antes do deploy que ativara a sincronizacao.

create table if not exists public.coord_colaboradores (
  id text primary key,
  nome text not null,
  email text not null,
  funcao text not null default '',
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coord_itens (
  id text primary key,
  titulo text not null,
  descricao text not null default '',
  tipo text not null default 'colaborador' check (tipo in ('colaborador', 'coordenacao', 'pauta')),
  colaborador_id text references public.coord_colaboradores(id) on delete set null,
  prazo text not null default '',
  prioridade text not null default 'media' check (prioridade in ('alta', 'media', 'baixa')),
  recorrencia text not null default 'none' check (recorrencia in ('none', 'weekly', 'monthly')),
  status text not null default 'aberto' check (status in ('aberto', 'concluido')),
  pinned text not null default 'main' check (pinned in ('main', 'hidden')),
  anexos jsonb not null default '[]'::jsonb,
  deleted_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists coord_colaboradores_touch_updated_at on public.coord_colaboradores;
create trigger coord_colaboradores_touch_updated_at
before update on public.coord_colaboradores
for each row execute function public.touch_updated_at();

drop trigger if exists coord_itens_touch_updated_at on public.coord_itens;
create trigger coord_itens_touch_updated_at
before update on public.coord_itens
for each row execute function public.touch_updated_at();

alter table public.coord_colaboradores enable row level security;
alter table public.coord_itens enable row level security;

drop policy if exists "coord_colaboradores_select_manager" on public.coord_colaboradores;
create policy "coord_colaboradores_select_manager"
on public.coord_colaboradores for select
to authenticated
using (public.is_manager());

drop policy if exists "coord_colaboradores_manage_manager" on public.coord_colaboradores;
create policy "coord_colaboradores_manage_manager"
on public.coord_colaboradores for all
to authenticated
using (public.is_manager())
with check (public.is_manager());

drop policy if exists "coord_itens_select_manager" on public.coord_itens;
create policy "coord_itens_select_manager"
on public.coord_itens for select
to authenticated
using (public.is_manager());

drop policy if exists "coord_itens_manage_manager" on public.coord_itens;
create policy "coord_itens_manage_manager"
on public.coord_itens for all
to authenticated
using (public.is_manager())
with check (public.is_manager());
