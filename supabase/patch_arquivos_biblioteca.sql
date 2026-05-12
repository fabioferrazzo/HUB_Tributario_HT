-- HUB Depto Tributario - biblioteca de arquivos, pastas e uploads.
-- Execute no Supabase SQL Editor antes de subir o codigo do modulo Arquivos.

create extension if not exists pgcrypto;

create table if not exists public.arquivo_pastas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text not null default '',
  scope text not null default 'privado' check (scope in ('privado', 'global')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.arquivo_recursos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text not null default '',
  url text,
  categoria text not null default 'outro' check (categoria in ('drive', 'modelo', 'guia', 'anexo', 'outro')),
  scope text not null default 'privado' check (scope in ('privado', 'global')),
  folder_id uuid references public.arquivo_pastas(id) on delete set null,
  kind text not null default 'link' check (kind in ('link', 'upload')),
  file_name text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_arquivo_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuario autenticado requerido.';
  end if;

  if new.created_by is null then
    new.created_by = auth.uid();
  end if;

  if new.created_by <> auth.uid() and not public.is_admin() then
    raise exception 'Nao e permitido criar registros em nome de outro usuario.';
  end if;

  return new;
end;
$$;

create or replace function public.can_read_arquivo(target_created_by uuid, target_scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or (
      public.is_active_user()
      and (
        target_scope = 'global'
        or target_created_by = auth.uid()
      )
    );
$$;

create or replace function public.can_manage_arquivo(target_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or (public.is_active_user() and target_created_by = auth.uid());
$$;

drop trigger if exists arquivo_pastas_touch_updated_at on public.arquivo_pastas;
create trigger arquivo_pastas_touch_updated_at
before update on public.arquivo_pastas
for each row execute function public.touch_updated_at();

drop trigger if exists arquivo_recursos_touch_updated_at on public.arquivo_recursos;
create trigger arquivo_recursos_touch_updated_at
before update on public.arquivo_recursos
for each row execute function public.touch_updated_at();

drop trigger if exists arquivo_pastas_set_created_by on public.arquivo_pastas;
create trigger arquivo_pastas_set_created_by
before insert on public.arquivo_pastas
for each row execute function public.set_arquivo_created_by();

drop trigger if exists arquivo_recursos_set_created_by on public.arquivo_recursos;
create trigger arquivo_recursos_set_created_by
before insert on public.arquivo_recursos
for each row execute function public.set_arquivo_created_by();

alter table public.arquivo_pastas enable row level security;
alter table public.arquivo_recursos enable row level security;

drop policy if exists "arquivo_pastas_select_allowed" on public.arquivo_pastas;
create policy "arquivo_pastas_select_allowed"
on public.arquivo_pastas for select
to authenticated
using (public.can_read_arquivo(created_by, scope));

drop policy if exists "arquivo_pastas_insert_active" on public.arquivo_pastas;
create policy "arquivo_pastas_insert_active"
on public.arquivo_pastas for insert
to authenticated
with check (
  public.is_active_user()
  and created_by = auth.uid()
  and (scope = 'privado' or public.is_admin())
);

drop policy if exists "arquivo_pastas_update_owner_or_admin" on public.arquivo_pastas;
create policy "arquivo_pastas_update_owner_or_admin"
on public.arquivo_pastas for update
to authenticated
using (public.can_manage_arquivo(created_by))
with check (
  public.can_manage_arquivo(created_by)
  and (scope = 'privado' or public.is_admin())
);

drop policy if exists "arquivo_pastas_delete_owner_or_admin" on public.arquivo_pastas;
create policy "arquivo_pastas_delete_owner_or_admin"
on public.arquivo_pastas for delete
to authenticated
using (public.can_manage_arquivo(created_by));

drop policy if exists "arquivo_recursos_select_allowed" on public.arquivo_recursos;
create policy "arquivo_recursos_select_allowed"
on public.arquivo_recursos for select
to authenticated
using (public.can_read_arquivo(created_by, scope));

drop policy if exists "arquivo_recursos_insert_active" on public.arquivo_recursos;
create policy "arquivo_recursos_insert_active"
on public.arquivo_recursos for insert
to authenticated
with check (
  public.is_active_user()
  and created_by = auth.uid()
  and (scope = 'privado' or public.is_admin())
);

drop policy if exists "arquivo_recursos_update_owner_or_admin" on public.arquivo_recursos;
create policy "arquivo_recursos_update_owner_or_admin"
on public.arquivo_recursos for update
to authenticated
using (public.can_manage_arquivo(created_by))
with check (
  public.can_manage_arquivo(created_by)
  and (scope = 'privado' or public.is_admin())
);

drop policy if exists "arquivo_recursos_delete_owner_or_admin" on public.arquivo_recursos;
create policy "arquivo_recursos_delete_owner_or_admin"
on public.arquivo_recursos for delete
to authenticated
using (public.can_manage_arquivo(created_by));

insert into storage.buckets (id, name, public)
values ('hub-arquivos', 'hub-arquivos', false)
on conflict (id) do nothing;

drop policy if exists "hub_arquivos_read_allowed" on storage.objects;
create policy "hub_arquivos_read_allowed"
on storage.objects for select
to authenticated
using (
  bucket_id = 'hub-arquivos'
  and (
    owner = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.arquivo_recursos r
      where r.storage_path = name
        and public.can_read_arquivo(r.created_by, r.scope)
    )
  )
);

drop policy if exists "hub_arquivos_insert_authenticated" on storage.objects;
create policy "hub_arquivos_insert_authenticated"
on storage.objects for insert
to authenticated
with check (bucket_id = 'hub-arquivos' and owner = auth.uid());

drop policy if exists "hub_arquivos_update_owner_or_admin" on storage.objects;
create policy "hub_arquivos_update_owner_or_admin"
on storage.objects for update
to authenticated
using (bucket_id = 'hub-arquivos' and (owner = auth.uid() or public.is_admin()))
with check (bucket_id = 'hub-arquivos' and (owner = auth.uid() or public.is_admin()));

drop policy if exists "hub_arquivos_delete_owner_or_admin" on storage.objects;
create policy "hub_arquivos_delete_owner_or_admin"
on storage.objects for delete
to authenticated
using (bucket_id = 'hub-arquivos' and (owner = auth.uid() or public.is_admin()));
