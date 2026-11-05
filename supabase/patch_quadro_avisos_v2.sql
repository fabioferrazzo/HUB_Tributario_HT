begin;

create table if not exists public.quadro_avisos (
  id uuid primary key default gen_random_uuid(),
  cell integer not null default 1,
  kind text not null default 'texto',
  visibility text not null default 'geral',
  title text not null default 'Aviso',
  content text not null default '',
  color text not null default '#ffffff',
  file_name text,
  file_url text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quadro_avisos
  add column if not exists cell integer not null default 1,
  add column if not exists kind text not null default 'texto',
  add column if not exists visibility text not null default 'geral',
  add column if not exists title text not null default 'Aviso',
  add column if not exists content text not null default '',
  add column if not exists color text not null default '#ffffff',
  add column if not exists file_name text,
  add column if not exists file_url text,
  add column if not exists created_by uuid,
  add column if not exists created_by_email text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.quadro_avisos
  drop constraint if exists quadro_avisos_cell_check,
  add constraint quadro_avisos_cell_check check (cell between 1 and 10);

alter table public.quadro_avisos
  drop constraint if exists quadro_avisos_kind_check,
  add constraint quadro_avisos_kind_check check (kind in ('texto', 'imagem', 'anexo', 'postit'));

alter table public.quadro_avisos
  drop constraint if exists quadro_avisos_visibility_check,
  add constraint quadro_avisos_visibility_check check (visibility in ('geral', 'particular'));

create table if not exists public.quadro_aviso_usuarios (
  aviso_id uuid not null references public.quadro_avisos(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  email text not null,
  nome text,
  created_at timestamptz not null default now(),
  primary key (aviso_id, email)
);

alter table public.quadro_aviso_usuarios
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists email text,
  add column if not exists nome text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_quadro_avisos_cell on public.quadro_avisos(cell);
create index if not exists idx_quadro_avisos_visibility on public.quadro_avisos(visibility);
create index if not exists idx_quadro_avisos_created_by on public.quadro_avisos(created_by);
create index if not exists idx_quadro_avisos_created_by_email on public.quadro_avisos(lower(created_by_email));
create index if not exists idx_quadro_aviso_usuarios_user_id on public.quadro_aviso_usuarios(user_id);
create index if not exists idx_quadro_aviso_usuarios_email on public.quadro_aviso_usuarios(lower(email));

create or replace function public.quadro_current_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.can_insert_quadro_aviso(p_created_by uuid, p_created_by_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_active_user()
    and (
      public.is_admin()
      or p_created_by = auth.uid()
      or lower(coalesce(p_created_by_email, '')) = public.quadro_current_email()
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
        or lower(coalesce(qa.created_by_email, '')) = public.quadro_current_email()
      )
  )
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
        or lower(coalesce(qa.created_by_email, '')) = public.quadro_current_email()
        or exists (
          select 1
          from public.quadro_aviso_usuarios qau
          where qau.aviso_id = qa.id
            and (
              qau.user_id = auth.uid()
              or lower(coalesce(qau.email, '')) = public.quadro_current_email()
            )
        )
      )
  )
$$;

create or replace function public.notify_quadro_aviso_particular(p_aviso_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_title text;
  v_content text;
begin
  select created_by, coalesce(nullif(title, ''), 'Quadro de Avisos'), coalesce(content, '')
    into v_creator, v_title, v_content
  from public.quadro_avisos
  where id = p_aviso_id
    and visibility = 'particular';

  if not found then
    return;
  end if;

  insert into public.notificacoes (
    user_id,
    tipo,
    titulo,
    body,
    meta,
    target_type,
    target_id,
    target_ref,
    dedupe_key,
    route,
    tone,
    active,
    created_at,
    updated_at
  )
  select distinct
    coalesce(qau.user_id, p.id) as user_id,
    'quadro_aviso',
    'Novo aviso particular',
    'Voce recebeu um aviso particular no Quadro de Avisos: ' || v_title,
    jsonb_build_object(
      'avisoId', p_aviso_id,
      'route', 'pautas',
      'tab', 'avisos',
      'title', v_title,
      'content', left(v_content, 240)
    )::text,
    'quadro_aviso',
    p_aviso_id,
    p_aviso_id::text,
    'quadro_aviso:' || p_aviso_id::text || ':' || coalesce(qau.user_id, p.id)::text,
    'pautas',
    'info',
    true,
    now(),
    now()
  from public.quadro_aviso_usuarios qau
  left join public.profiles p on lower(p.email) = lower(qau.email)
  where qau.aviso_id = p_aviso_id
    and coalesce(qau.user_id, p.id) is not null
    and coalesce(qau.user_id, p.id) <> coalesce(v_creator, '00000000-0000-0000-0000-000000000000'::uuid)
  on conflict (user_id, dedupe_key) do update
    set titulo = excluded.titulo,
        body = excluded.body,
        meta = excluded.meta,
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        target_ref = excluded.target_ref,
        route = excluded.route,
        tone = excluded.tone,
        active = true,
        read_at = null,
        updated_at = now();
end;
$$;

alter table public.quadro_avisos enable row level security;
alter table public.quadro_aviso_usuarios enable row level security;

drop policy if exists "quadro_avisos_select_allowed" on public.quadro_avisos;
create policy "quadro_avisos_select_allowed"
on public.quadro_avisos for select
to authenticated
using (public.can_read_quadro_aviso(id));

drop policy if exists "quadro_avisos_insert_authenticated" on public.quadro_avisos;
drop policy if exists "quadro_avisos_insert_active_owner" on public.quadro_avisos;
create policy "quadro_avisos_insert_active_owner"
on public.quadro_avisos for insert
to authenticated
with check (public.can_insert_quadro_aviso(created_by, created_by_email));

drop policy if exists "quadro_avisos_update_owner_or_admin" on public.quadro_avisos;
create policy "quadro_avisos_update_owner_or_admin"
on public.quadro_avisos for update
to authenticated
using (public.can_manage_quadro_aviso(id))
with check (public.can_insert_quadro_aviso(created_by, created_by_email));

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
  and ((storage.foldername(name))[1] = 'quadro-avisos')
);

drop policy if exists "quadro_avisos_storage_insert" on storage.objects;
create policy "quadro_avisos_storage_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'hub-anexos'
  and ((storage.foldername(name))[1] = 'quadro-avisos')
);

drop policy if exists "quadro_avisos_storage_update" on storage.objects;
create policy "quadro_avisos_storage_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'hub-anexos'
  and ((storage.foldername(name))[1] = 'quadro-avisos')
  and (owner = auth.uid() or public.is_admin())
)
with check (
  bucket_id = 'hub-anexos'
  and ((storage.foldername(name))[1] = 'quadro-avisos')
  and (owner = auth.uid() or public.is_admin())
);

drop policy if exists "quadro_avisos_storage_delete" on storage.objects;
create policy "quadro_avisos_storage_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'hub-anexos'
  and ((storage.foldername(name))[1] = 'quadro-avisos')
  and (owner = auth.uid() or public.is_admin())
);

grant select, insert, update, delete on public.quadro_avisos to authenticated;
grant select, insert, update, delete on public.quadro_aviso_usuarios to authenticated;
grant execute on function public.quadro_current_email() to authenticated;
grant execute on function public.can_insert_quadro_aviso(uuid, text) to authenticated;
grant execute on function public.can_read_quadro_aviso(uuid) to authenticated;
grant execute on function public.can_manage_quadro_aviso(uuid) to authenticated;
grant execute on function public.notify_quadro_aviso_particular(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
