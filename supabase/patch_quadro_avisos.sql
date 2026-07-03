-- HUB Depto Tributario - Quadro de Avisos
-- Tabelas, RLS e storage para textos, imagens, anexos, post-its e desenhos.

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
create index if not exists idx_quadro_avisos_created_by on public.quadro_avisos(created_by);
create index if not exists idx_quadro_avisos_created_by_email on public.quadro_avisos(lower(created_by_email));
create index if not exists idx_quadro_aviso_usuarios_email on public.quadro_aviso_usuarios(lower(email));
create index if not exists idx_quadro_aviso_usuarios_user_id on public.quadro_aviso_usuarios(user_id);

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
security definer
set search_path = public, auth
as $$
  select lower(coalesce(
    nullif(auth.jwt()->>'email', ''),
    (select au.email from auth.users au where au.id = auth.uid()),
    ''
  ))
$$;

create or replace function public.quadro_profile_is_active(p_user_id uuid, p_email text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where (
      p.id = p_user_id
      or (p_email is not null and lower(p.email) = lower(p_email))
    )
      and coalesce(p.active, true) = true
  )
$$;

create or replace function public.quadro_profile_is_admin(p_user_id uuid, p_email text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where (
      p.id = p_user_id
      or (p_email is not null and lower(p.email) = lower(p_email))
    )
      and coalesce(p.active, true) = true
      and p.role::text = 'admin'
  )
$$;

create or replace function public.can_insert_quadro_aviso(p_created_by uuid, p_created_by_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.quadro_profile_is_active(auth.uid(), public.quadro_current_user_email())
    and (
      public.quadro_profile_is_admin(auth.uid(), public.quadro_current_user_email())
      or p_created_by = auth.uid()
      or lower(coalesce(p_created_by_email, '')) = public.quadro_current_user_email()
    )
$$;

create or replace function public.can_read_quadro_aviso(p_aviso_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.quadro_profile_is_active(auth.uid(), public.quadro_current_user_email())
    and exists (
      select 1
      from public.quadro_avisos qa
      where qa.id = p_aviso_id
        and (
          qa.visibility = 'geral'
          or public.quadro_profile_is_admin(auth.uid(), public.quadro_current_user_email())
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
  select
    public.quadro_profile_is_active(auth.uid(), public.quadro_current_user_email())
    and exists (
      select 1
      from public.quadro_avisos qa
      where qa.id = p_aviso_id
        and (
          public.quadro_profile_is_admin(auth.uid(), public.quadro_current_user_email())
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
with check (public.can_insert_quadro_aviso(created_by, created_by_email));

drop policy if exists "quadro_avisos_update_owner_or_admin" on public.quadro_avisos;
create policy "quadro_avisos_update_owner_or_admin"
on public.quadro_avisos for update
to authenticated
using (public.can_manage_quadro_aviso(id))
with check (public.can_manage_quadro_aviso(id));

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

insert into storage.buckets (id, name, public)
values ('hub-anexos', 'hub-anexos', true)
on conflict (id) do update set public = true;

drop policy if exists "quadro_avisos_storage_select" on storage.objects;
create policy "quadro_avisos_storage_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'quadro-avisos'
);

drop policy if exists "quadro_avisos_storage_insert" on storage.objects;
create policy "quadro_avisos_storage_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'quadro-avisos'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.quadro_profile_is_admin(auth.uid(), public.quadro_current_user_email())
  )
);

drop policy if exists "quadro_avisos_storage_update" on storage.objects;
create policy "quadro_avisos_storage_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'quadro-avisos'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.quadro_profile_is_admin(auth.uid(), public.quadro_current_user_email())
  )
)
with check (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'quadro-avisos'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.quadro_profile_is_admin(auth.uid(), public.quadro_current_user_email())
  )
);

drop policy if exists "quadro_avisos_storage_delete" on storage.objects;
create policy "quadro_avisos_storage_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'quadro-avisos'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.quadro_profile_is_admin(auth.uid(), public.quadro_current_user_email())
  )
);

grant select, insert, update, delete on public.quadro_avisos to authenticated;
grant select, insert, update, delete on public.quadro_aviso_usuarios to authenticated;
grant execute on function public.can_insert_quadro_aviso(uuid, text) to authenticated;
grant execute on function public.can_read_quadro_aviso(uuid) to authenticated;
grant execute on function public.can_manage_quadro_aviso(uuid) to authenticated;
grant execute on function public.quadro_current_user_email() to authenticated;
grant execute on function public.quadro_profile_is_active(uuid, text) to authenticated;
grant execute on function public.quadro_profile_is_admin(uuid, text) to authenticated;
grant execute on function public.quadro_touch_updated_at() to authenticated;

select pg_notify('pgrst', 'reload schema') as postgres_schema_reload_requested;

commit;
