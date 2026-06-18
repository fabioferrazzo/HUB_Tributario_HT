-- Cache compartilhado da Agenda Tributaria.
-- Uso: rode uma vez no SQL Editor do Supabase do HUB Depto Tributario.

create table if not exists public.agenda_tributaria_cache (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2020 and 2035),
  month integer not null check (month between 1 and 12),
  source text not null default 'Receita Federal',
  source_url text,
  updated_label text,
  critical jsonb,
  dates jsonb not null default '{}'::jsonb,
  updated_by text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, month)
);

alter table public.agenda_tributaria_cache enable row level security;

drop policy if exists "agenda_cache_select_authenticated" on public.agenda_tributaria_cache;
create policy "agenda_cache_select_authenticated"
on public.agenda_tributaria_cache for select
to authenticated
using (true);

drop policy if exists "agenda_cache_admin_all" on public.agenda_tributaria_cache;
create policy "agenda_cache_admin_all"
on public.agenda_tributaria_cache for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.touch_agenda_tributaria_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agenda_tributaria_cache_touch_updated_at on public.agenda_tributaria_cache;
create trigger agenda_tributaria_cache_touch_updated_at
before update on public.agenda_tributaria_cache
for each row
execute function public.touch_agenda_tributaria_cache_updated_at();

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;
