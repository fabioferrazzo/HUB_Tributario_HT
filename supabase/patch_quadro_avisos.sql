-- HUB Depto Tributario - Quadro de Avisos
-- Cria armazenamento, acesso por RLS e compartilhamento por usuario.

begin;

create table if not exists public.quadro_avisos (
  id uuid primary key default gen_random_uuid(),
  cell integer not null default 1 check (cell between 1 and 10),
  kind text not null default 'texto' check (kind in ('texto', 'imagem', 'anexo', 'postit')),
  visibility text not null default 'geral' check (visibility in ('geral', 'particular')),
  title text not null default 'Aviso',
  content text not null default '',
  color text not null default '#ffffff',
  file_name text,
  file_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quadro_aviso_usuarios (
  aviso_id uuid not null references public.quadro_avisos(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  email text not null,
  nome text,
  created_at timestamptz not null default now(),
  primary key (aviso_id, email)
);

create index if not exists idx_quadro_avisos_cell on public.quadro_avisos(cell);
create index if not exists idx_quadro_avisos_visibility on public.quadro_avisos(visibility);
create index if not exists idx_quadro_aviso_usuarios_email on public.quadro_aviso_usuarios(lower(email));

create or replace function public.quadro_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_quadro_avisos_updated_at on public.quadro_avisos;
create trigger trg_quadro_avisos_updated_at
before update on public.quadro_avisos
for each row execute function public.quadro_touch_updated_at();

create or replace function public.quadro_current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt()->>'email', ''))
$$;

create or replace function public.can_read_quadro_aviso(p_aviso_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.quadro_avisos qa
    where qa.id = p_aviso_id
      and (
        qa.visibility = 'geral'
        or public.is_admin()
        or qa.created_by = auth.uid()
        or lower(qa.created_by_email) = public.quadro_current_user_email()
        or exists (
          select 1
          from public.quadro_aviso_usuarios qau
          where qau.aviso_id = qa.id
            and (
              qau.user_id = auth.uid()
              or lower(qau.email) = public.quadro_current_user_email()
            )
        )
      )
  )
$$;

create or replace function public.can_manage_quadro_aviso(p_aviso_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.quadro_avisos qa
    where qa.id = p_aviso_id
      and (
        public.is_admin()
        or qa.created_by = auth.uid()
        or lower(qa.created_by_email) = public.quadro_current_user_email()
      )
  )
$$;

alter table public.quadro_avisos enable row level security;
alter table public.quadro_aviso_usuarios enable row level security;

drop policy if exists "quadro_avisos_select_allowed" on public.quadro_avisos;
create policy "quadro_avisos_select_allowed"
on public.quadro_avisos for select
to authenticated
using (public.can_read_quadro_aviso(id));

drop policy if exists "quadro_avisos_insert_authenticated" on public.quadro_avisos;
create policy "quadro_avisos_insert_authenticated"
on public.quadro_avisos for insert
to authenticated
with check (
  created_by = auth.uid()
  or lower(created_by_email) = public.quadro_current_user_email()
  or public.is_admin()
);

drop policy if exists "quadro_avisos_update_owner_or_admin" on public.quadro_avisos;
create policy "quadro_avisos_update_owner_or_admin"
on public.quadro_avisos for update
to authenticated
using (public.can_manage_quadro_aviso(id))
with check (
  public.is_admin()
  or created_by = auth.uid()
  or lower(created_by_email) = public.quadro_current_user_email()
);

drop policy if exists "quadro_avisos_delete_owner_or_admin" on public.quadro_avisos;
create policy "quadro_avisos_delete_owner_or_admin"
on public.quadro_avisos for delete
to authenticated
using (public.can_manage_quadro_aviso(id));

drop policy if exists "quadro_aviso_usuarios_select_allowed" on public.quadro_aviso_usuarios;
create policy "quadro_aviso_usuarios_select_allowed"
on public.quadro_aviso_usuarios for select
to authenticated
using (public.can_read_quadro_aviso(aviso_id));

drop policy if exists "quadro_aviso_usuarios_manage_owner_or_admin" on public.quadro_aviso_usuarios;
create policy "quadro_aviso_usuarios_manage_owner_or_admin"
on public.quadro_aviso_usuarios for all
to authenticated
using (public.can_manage_quadro_aviso(aviso_id))
with check (public.can_manage_quadro_aviso(aviso_id));

grant select, insert, update, delete on public.quadro_avisos to authenticated;
grant select, insert, update, delete on public.quadro_aviso_usuarios to authenticated;
grant execute on function public.can_read_quadro_aviso(uuid) to authenticated;
grant execute on function public.can_manage_quadro_aviso(uuid) to authenticated;
grant execute on function public.quadro_current_user_email() to authenticated;
grant execute on function public.quadro_touch_updated_at() to authenticated;

select pg_notify('pgrst', 'reload schema') as postgres_schema_reload_requested;

commit;
