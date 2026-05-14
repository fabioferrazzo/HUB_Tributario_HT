-- HUB Depto Tributario - anotacoes do visualizador de Arquivos.
-- Execute no Supabase SQL Editor depois de `patch_arquivos_biblioteca.sql`.

create extension if not exists pgcrypto;

create table if not exists public.arquivo_anotacoes (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.arquivo_recursos(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('highlight', 'comment')),
  text text not null,
  page integer not null default 1 check (page > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists arquivo_anotacoes_resource_idx
on public.arquivo_anotacoes (resource_id, created_at desc);

create index if not exists arquivo_anotacoes_created_by_idx
on public.arquivo_anotacoes (created_by);

create or replace function public.can_read_arquivo_recurso(target_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.arquivo_recursos r
    where r.id = target_resource_id
      and public.can_read_arquivo(r.created_by, r.scope)
  );
$$;

create or replace function public.set_arquivo_anotacao_created_by()
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
    raise exception 'Nao e permitido criar anotacoes em nome de outro usuario.';
  end if;

  return new;
end;
$$;

drop trigger if exists arquivo_anotacoes_touch_updated_at on public.arquivo_anotacoes;
create trigger arquivo_anotacoes_touch_updated_at
before update on public.arquivo_anotacoes
for each row execute function public.touch_updated_at();

drop trigger if exists arquivo_anotacoes_set_created_by on public.arquivo_anotacoes;
create trigger arquivo_anotacoes_set_created_by
before insert on public.arquivo_anotacoes
for each row execute function public.set_arquivo_anotacao_created_by();

alter table public.arquivo_anotacoes enable row level security;

drop policy if exists "arquivo_anotacoes_select_allowed" on public.arquivo_anotacoes;
create policy "arquivo_anotacoes_select_allowed"
on public.arquivo_anotacoes for select
to authenticated
using (public.can_read_arquivo_recurso(resource_id));

drop policy if exists "arquivo_anotacoes_insert_active" on public.arquivo_anotacoes;
create policy "arquivo_anotacoes_insert_active"
on public.arquivo_anotacoes for insert
to authenticated
with check (
  public.is_active_user()
  and created_by = auth.uid()
  and public.can_read_arquivo_recurso(resource_id)
);

drop policy if exists "arquivo_anotacoes_update_owner_or_admin" on public.arquivo_anotacoes;
create policy "arquivo_anotacoes_update_owner_or_admin"
on public.arquivo_anotacoes for update
to authenticated
using (public.can_manage_arquivo(created_by))
with check (
  public.can_manage_arquivo(created_by)
  and public.can_read_arquivo_recurso(resource_id)
);

drop policy if exists "arquivo_anotacoes_delete_owner_or_admin" on public.arquivo_anotacoes;
create policy "arquivo_anotacoes_delete_owner_or_admin"
on public.arquivo_anotacoes for delete
to authenticated
using (public.can_manage_arquivo(created_by));
