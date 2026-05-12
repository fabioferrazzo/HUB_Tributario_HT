-- HUB Depto Tributario - Links uteis persistentes.
-- Execute no SQL Editor se a tabela/policies de links ainda nao estiverem no projeto.

create extension if not exists pgcrypto;

create table if not exists public.links_uteis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  titulo text not null,
  url text not null,
  scope text not null default 'privado' check (scope in ('privado', 'global')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists links_uteis_touch_updated_at on public.links_uteis;
create trigger links_uteis_touch_updated_at
before update on public.links_uteis
for each row execute function public.touch_updated_at();

alter table public.links_uteis enable row level security;

drop policy if exists "links_select_allowed" on public.links_uteis;
create policy "links_select_allowed"
on public.links_uteis for select
to authenticated
using (scope = 'global' or user_id = auth.uid() or public.is_manager());

drop policy if exists "links_insert_active" on public.links_uteis;
create policy "links_insert_active"
on public.links_uteis for insert
to authenticated
with check (
  public.is_active_user()
  and user_id = auth.uid()
  and (scope = 'privado' or public.is_manager())
);

drop policy if exists "links_update_own_or_manager_global" on public.links_uteis;
create policy "links_update_own_or_manager_global"
on public.links_uteis for update
to authenticated
using (user_id = auth.uid() or public.is_manager())
with check (
  public.is_manager()
  or (
    user_id = auth.uid()
    and scope = 'privado'
  )
);

drop policy if exists "links_delete_own_or_manager" on public.links_uteis;
create policy "links_delete_own_or_manager"
on public.links_uteis for delete
to authenticated
using (user_id = auth.uid() or public.is_manager());
