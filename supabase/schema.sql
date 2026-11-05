-- HUB Depto. Tributario - Supabase schema
-- Execute no SQL Editor do Supabase apos criar o projeto.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'gestor', 'colaborador');
  end if;

  if not exists (select 1 from pg_type where typname = 'lembrete_status') then
    create type public.lembrete_status as enum ('aberto', 'concluido', 'vencido');
  end if;

  if not exists (select 1 from pg_type where typname = 'prioridade') then
    create type public.prioridade as enum ('alta', 'normal', 'baixa');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nome text not null,
  role public.app_role not null default 'colaborador',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lembretes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text not null default '',
  prazo timestamptz,
  prioridade public.prioridade not null default 'normal',
  status public.lembrete_status not null default 'aberto',
  confidencial boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lembrete_usuarios (
  lembrete_id uuid not null references public.lembretes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lembrete_id, user_id)
);

create table if not exists public.lembrete_anexos (
  id uuid primary key default gen_random_uuid(),
  lembrete_id uuid not null references public.lembretes(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  body text not null default '',
  target_type text,
  target_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.links_uteis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  titulo text not null,
  url text not null,
  scope text not null default 'privado' check (scope in ('privado', 'global')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.noticias (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  fonte text,
  url text not null,
  published_at date,
  expires_at date,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active
      and role = 'admin'
  );
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active
      and role in ('admin', 'gestor')
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active
  );
$$;

create or replace function public.can_read_lembrete(target_lembrete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lembretes l
    where l.id = target_lembrete_id
      and public.is_active_user()
      and (
        public.is_admin()
        or l.created_by = auth.uid()
        or (
          exists (
            select 1
            from public.lembrete_usuarios lu_any
            where lu_any.lembrete_id = target_lembrete_id
          )
          and (
            not coalesce(l.confidencial, false)
            or exists (
              select 1
              from public.lembrete_usuarios lu
              where lu.lembrete_id = target_lembrete_id
                and lu.user_id = auth.uid()
            )
          )
        )
      )
  );
$$;

create or replace function public.can_manage_lembrete(target_lembrete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lembretes l
    where l.id = target_lembrete_id
      and public.is_active_user()
      and (l.created_by = auth.uid() or public.is_admin())
  );
$$;

create or replace function public.set_lembrete_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$$;

create or replace function public.normalize_lembrete_confidencial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.confidencial := false;
  end if;

  return new;
end;
$$;

create or replace function public.create_lembrete(
  p_titulo text,
  p_descricao text default '',
  p_prazo timestamptz default null,
  p_prioridade public.prioridade default 'normal',
  p_status public.lembrete_status default 'aberto',
  p_responsaveis text[] default '{}'::text[],
  p_confidencial boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lembrete_id uuid;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Usuario sem permissao para criar lembrete.';
  end if;

  insert into public.lembretes (
    titulo,
    descricao,
    prazo,
    prioridade,
    status,
    confidencial,
    created_by
  )
  values (
    nullif(trim(p_titulo), ''),
    coalesce(p_descricao, ''),
    p_prazo,
    p_prioridade,
    p_status,
    coalesce(p_confidencial, false) and public.is_admin(),
    auth.uid()
  )
  returning id into v_lembrete_id;

  insert into public.lembrete_usuarios (lembrete_id, user_id)
  select v_lembrete_id, p.id
  from public.profiles p
  where p.active
    and p.email = any(coalesce(p_responsaveis, '{}'::text[]))
  on conflict do nothing;

  return v_lembrete_id;
end;
$$;

grant execute on function public.create_lembrete(
  text,
  text,
  timestamptz,
  public.prioridade,
  public.lembrete_status,
  text[],
  boolean
) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists lembretes_touch_updated_at on public.lembretes;
create trigger lembretes_touch_updated_at
before update on public.lembretes
for each row execute function public.touch_updated_at();

drop trigger if exists lembretes_set_created_by on public.lembretes;
create trigger lembretes_set_created_by
before insert on public.lembretes
for each row execute function public.set_lembrete_created_by();

drop trigger if exists lembretes_normalize_confidencial on public.lembretes;
create trigger lembretes_normalize_confidencial
before insert or update on public.lembretes
for each row execute function public.normalize_lembrete_confidencial();

drop trigger if exists links_uteis_touch_updated_at on public.links_uteis;
create trigger links_uteis_touch_updated_at
before update on public.links_uteis
for each row execute function public.touch_updated_at();

drop trigger if exists noticias_touch_updated_at on public.noticias;
create trigger noticias_touch_updated_at
before update on public.noticias
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.lembretes enable row level security;
alter table public.lembrete_usuarios enable row level security;
alter table public.lembrete_anexos enable row level security;
alter table public.notificacoes enable row level security;
alter table public.links_uteis enable row level security;
alter table public.noticias enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_select_own_or_manager" on public.profiles;
create policy "profiles_select_own_or_manager"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or public.is_manager()
  or (active and public.is_active_user())
);

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
on public.profiles for insert
to authenticated
with check (public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "lembretes_select_allowed" on public.lembretes;
create policy "lembretes_select_allowed"
on public.lembretes for select
to authenticated
using (public.can_read_lembrete(id));

drop policy if exists "lembretes_insert_authenticated" on public.lembretes;
create policy "lembretes_insert_authenticated"
on public.lembretes for insert
to authenticated
with check (public.is_active_user());

drop policy if exists "lembretes_update_owner_or_manager" on public.lembretes;
create policy "lembretes_update_owner_or_manager"
on public.lembretes for update
to authenticated
using (public.can_manage_lembrete(id))
with check (public.can_manage_lembrete(id));

drop policy if exists "lembretes_delete_owner_or_manager" on public.lembretes;
create policy "lembretes_delete_owner_or_manager"
on public.lembretes for delete
to authenticated
using (public.can_manage_lembrete(id));

drop policy if exists "lembrete_usuarios_select_allowed" on public.lembrete_usuarios;
create policy "lembrete_usuarios_select_allowed"
on public.lembrete_usuarios for select
to authenticated
using (public.can_read_lembrete(lembrete_id));

drop policy if exists "lembrete_usuarios_manage_owner_or_manager" on public.lembrete_usuarios;
create policy "lembrete_usuarios_manage_owner_or_manager"
on public.lembrete_usuarios for all
to authenticated
using (public.can_manage_lembrete(lembrete_id))
with check (public.can_manage_lembrete(lembrete_id));

drop policy if exists "lembrete_anexos_select_allowed" on public.lembrete_anexos;
create policy "lembrete_anexos_select_allowed"
on public.lembrete_anexos for select
to authenticated
using (uploaded_by = auth.uid() or public.can_read_lembrete(lembrete_id));

drop policy if exists "lembrete_anexos_manage_owner_or_manager" on public.lembrete_anexos;
create policy "lembrete_anexos_manage_owner_or_manager"
on public.lembrete_anexos for all
to authenticated
using (uploaded_by = auth.uid() or public.can_manage_lembrete(lembrete_id))
with check (uploaded_by = auth.uid() or public.can_manage_lembrete(lembrete_id));

drop policy if exists "notificacoes_select_own" on public.notificacoes;
create policy "notificacoes_select_own"
on public.notificacoes for select
to authenticated
using (user_id = auth.uid() or public.is_manager());

drop policy if exists "notificacoes_update_own" on public.notificacoes;
create policy "notificacoes_update_own"
on public.notificacoes for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "links_select_allowed" on public.links_uteis;
create policy "links_select_allowed"
on public.links_uteis for select
to authenticated
using (scope = 'global' or user_id = auth.uid() or public.is_manager());

drop policy if exists "links_manage_own_or_admin_global" on public.links_uteis;
create policy "links_manage_own_or_admin_global"
on public.links_uteis for all
to authenticated
using (user_id = auth.uid() or public.is_manager())
with check (
  user_id = auth.uid()
  or (scope = 'global' and public.is_manager())
);

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

drop policy if exists "audit_select_admin" on public.audit_logs;
create policy "audit_select_admin"
on public.audit_logs for select
to authenticated
using (public.is_admin());

insert into storage.buckets (id, name, public)
values ('hub-anexos', 'hub-anexos', false)
on conflict (id) do nothing;

drop policy if exists "hub_anexos_read_authenticated" on storage.objects;
create policy "hub_anexos_read_authenticated"
on storage.objects for select
to authenticated
using (bucket_id = 'hub-anexos');

drop policy if exists "hub_anexos_insert_authenticated" on storage.objects;
create policy "hub_anexos_insert_authenticated"
on storage.objects for insert
to authenticated
with check (bucket_id = 'hub-anexos' and owner = auth.uid());

drop policy if exists "hub_anexos_update_owner_or_admin" on storage.objects;
create policy "hub_anexos_update_owner_or_admin"
on storage.objects for update
to authenticated
using (bucket_id = 'hub-anexos' and (owner = auth.uid() or public.is_manager()))
with check (bucket_id = 'hub-anexos' and (owner = auth.uid() or public.is_manager()));

drop policy if exists "hub_anexos_delete_owner_or_admin" on storage.objects;
create policy "hub_anexos_delete_owner_or_admin"
on storage.objects for delete
to authenticated
using (bucket_id = 'hub-anexos' and (owner = auth.uid() or public.is_manager()));
