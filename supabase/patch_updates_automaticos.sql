-- HUB Depto Tributario - noticias e legislacoes automaticas.
-- Execute no SQL Editor antes de subir as funcoes Netlify desta etapa.

alter table public.noticias
  add column if not exists tipo text not null default 'noticia' check (tipo in ('noticia', 'legislacao')),
  add column if not exists source_type text not null default 'oficial' check (source_type in ('oficial', 'especializada')),
  add column if not exists source_url text;

create unique index if not exists noticias_tipo_url_unique
on public.noticias (tipo, url);

drop trigger if exists noticias_touch_updated_at on public.noticias;
create trigger noticias_touch_updated_at
before update on public.noticias
for each row execute function public.touch_updated_at();

alter table public.noticias enable row level security;

drop policy if exists "noticias_select_active" on public.noticias;
create policy "noticias_select_active"
on public.noticias for select
to authenticated
using (active or public.is_manager());

drop policy if exists "noticias_manage_manager" on public.noticias;
create policy "noticias_manage_manager"
on public.noticias for all
to authenticated
using (public.is_manager())
with check (public.is_manager());
