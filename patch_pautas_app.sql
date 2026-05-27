-- HUB Depto Tributario - modulo Pautas nativo do app.
-- Execute no SQL Editor antes do deploy que remove a dependencia do Sheets.

create table if not exists public.pautas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text not null default '',
  prazo timestamptz,
  prioridade text not null default 'normal' check (prioridade in ('alta', 'normal', 'baixa')),
  status text not null default 'aberta' check (status in ('aberta', 'concluida')),
  scope text not null default 'todos' check (scope in ('todos', 'usuarios')),
  destaque boolean not null default false,
  created_by uuid references public.profiles(id),
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pauta_usuarios (
  pauta_id uuid not null references public.pautas(id) on delete cascade,
  user_id uuid references public.profiles(id),
  email text not null,
  nome text not null default '',
  created_at timestamptz not null default now(),
  primary key (pauta_id, email)
);

create table if not exists public.pauta_anexos (
  id uuid primary key default gen_random_uuid(),
  pauta_id uuid not null references public.pautas(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.pauta_conclusoes (
  pauta_id uuid not null references public.pautas(id) on delete cascade,
  user_id uuid references public.profiles(id),
  email text not null,
  nome text not null default '',
  completed_at timestamptz not null default now(),
  primary key (pauta_id, email)
);

create index if not exists pautas_prazo_idx on public.pautas (prazo);
create index if not exists pauta_usuarios_email_idx on public.pauta_usuarios (lower(email));
create index if not exists pauta_anexos_pauta_idx on public.pauta_anexos (pauta_id);
create index if not exists pauta_conclusoes_pauta_idx on public.pauta_conclusoes (pauta_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.email_escape_html(value text)
returns text
language sql
immutable
as $$
  select replace(
    replace(
      replace(
        replace(
          replace(coalesce(value, ''), '&', '&amp;'),
          '<',
          '&lt;'
        ),
        '>',
        '&gt;'
      ),
      '"',
      '&quot;'
    ),
    '''',
    '&#39;'
  );
$$;

drop trigger if exists pautas_touch_updated_at on public.pautas;
create trigger pautas_touch_updated_at
before update on public.pautas
for each row execute function public.touch_updated_at();

create or replace function public.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

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

create or replace function public.can_read_pauta(p_pauta_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pautas p
    where p.id = p_pauta_id
      and (
        public.is_manager()
        or p.scope = 'todos'
        or p.created_by = auth.uid()
        or exists (
          select 1
          from public.pauta_usuarios pu
          where pu.pauta_id = p.id
            and (
              pu.user_id = auth.uid()
              or lower(pu.email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))
            )
        )
      )
  );
$$;

create or replace function public.can_manage_pauta(p_pauta_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_admin();
$$;

create or replace function public.can_complete_pauta(p_pauta_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pautas p
    where p.id = p_pauta_id
      and (
        public.is_admin()
        or p.scope = 'todos'
        or exists (
          select 1
          from public.pauta_usuarios pu
          where pu.pauta_id = p.id
            and (
              pu.user_id = auth.uid()
              or lower(pu.email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))
            )
        )
      )
  );
$$;

create or replace function public.notify_pauta_conclusion(p_pauta_id uuid, p_completed_by uuid default auth.uid())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pauta record;
  v_user record;
  v_count integer := 0;
begin
  select *
  into v_pauta
  from public.pautas
  where id = p_pauta_id;

  if not found then
    return 0;
  end if;

  select id, email, nome
  into v_user
  from public.profiles
  where id = coalesce(p_completed_by, auth.uid());

  if not found then
    return 0;
  end if;

  insert into public.notificacoes (
    user_id,
    tipo,
    titulo,
    body,
    meta,
    target_type,
    target_ref,
    dedupe_key,
    route,
    tone,
    active,
    created_at,
    updated_at
  )
  select
    admin_profile.id,
    'pauta_concluida',
    'Pauta concluida: ' || v_pauta.titulo,
    coalesce(v_user.nome, v_user.email) || ' concluiu a pauta.',
    coalesce(to_char(v_pauta.prazo, 'DD/MM/YYYY HH24:MI'), 'Sem prazo'),
    'pauta',
    p_pauta_id::text,
    'pauta_concluida:' || p_pauta_id::text || ':' || v_user.id::text,
    'home',
    'info',
    true,
    now(),
    now()
  from public.profiles admin_profile
  where admin_profile.role = 'admin'
    and admin_profile.active
  on conflict (user_id, dedupe_key) do update
  set active = true,
      read_at = null,
      updated_at = now();

  with queued as (
    select public.queue_email(
      admin_profile.email,
      'Pauta concluida: ' || v_pauta.titulo,
      '<p>Uma pauta foi concluida no HUB Depto Tributario.</p>' ||
        '<p><strong>' || public.email_escape_html(v_pauta.titulo) || '</strong></p>' ||
        '<p><strong>Concluida por:</strong> ' || public.email_escape_html(coalesce(v_user.nome, v_user.email)) || '</p>' ||
        '<p><strong>Prazo:</strong> ' || coalesce(to_char(v_pauta.prazo, 'DD/MM/YYYY HH24:MI'), 'sem prazo') || '</p>',
      'Pauta concluida: ' || v_pauta.titulo || E'\nConcluida por: ' || coalesce(v_user.nome, v_user.email),
      'pauta_concluida',
      'pauta',
      p_pauta_id::text,
      now(),
      'pauta_concluida:' || p_pauta_id::text || ':' || v_user.id::text || ':' || admin_profile.id::text,
      admin_profile.nome,
      v_user.id
    ) as id
    from public.profiles admin_profile
    where admin_profile.role = 'admin'
      and admin_profile.active
  )
  select count(*) into v_count from queued;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.purge_old_notifications(p_days integer default 5)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  delete from public.notificacoes
  where created_at < now() - make_interval(days => greatest(coalesce(p_days, 5), 1));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.pautas enable row level security;
alter table public.pauta_usuarios enable row level security;
alter table public.pauta_anexos enable row level security;
alter table public.pauta_conclusoes enable row level security;

drop policy if exists "pautas_select_allowed" on public.pautas;
create policy "pautas_select_allowed"
on public.pautas for select
to authenticated
using (public.can_read_pauta(id));

drop policy if exists "pautas_insert_admin" on public.pautas;
create policy "pautas_insert_admin"
on public.pautas for insert
to authenticated
with check (public.is_admin());

drop policy if exists "pautas_update_admin" on public.pautas;
create policy "pautas_update_admin"
on public.pautas for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "pautas_delete_admin" on public.pautas;
create policy "pautas_delete_admin"
on public.pautas for delete
to authenticated
using (public.is_admin());

drop policy if exists "pauta_usuarios_select_allowed" on public.pauta_usuarios;
create policy "pauta_usuarios_select_allowed"
on public.pauta_usuarios for select
to authenticated
using (public.can_read_pauta(pauta_id));

drop policy if exists "pauta_usuarios_manage_admin" on public.pauta_usuarios;
create policy "pauta_usuarios_manage_admin"
on public.pauta_usuarios for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "pauta_anexos_select_allowed" on public.pauta_anexos;
create policy "pauta_anexos_select_allowed"
on public.pauta_anexos for select
to authenticated
using (public.can_read_pauta(pauta_id));

drop policy if exists "pauta_anexos_manage_admin" on public.pauta_anexos;
create policy "pauta_anexos_manage_admin"
on public.pauta_anexos for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "pauta_conclusoes_select_allowed" on public.pauta_conclusoes;
create policy "pauta_conclusoes_select_allowed"
on public.pauta_conclusoes for select
to authenticated
using (public.can_read_pauta(pauta_id));

drop policy if exists "pauta_conclusoes_insert_allowed" on public.pauta_conclusoes;
create policy "pauta_conclusoes_insert_allowed"
on public.pauta_conclusoes for insert
to authenticated
with check (
  public.can_complete_pauta(pauta_id)
  and (
    user_id = auth.uid()
    or lower(email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))
  )
);

drop policy if exists "hub_anexos_pautas_select_allowed" on storage.objects;
create policy "hub_anexos_pautas_select_allowed"
on storage.objects for select
to authenticated
using (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'pautas'
  and public.can_read_pauta(public.uuid_or_null((storage.foldername(name))[2]))
);

drop policy if exists "hub_anexos_pautas_insert_admin" on storage.objects;
create policy "hub_anexos_pautas_insert_admin"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'hub-anexos'
  and (storage.foldername(name))[1] = 'pautas'
  and public.is_admin()
);

grant execute on function public.can_read_pauta(uuid) to authenticated;
grant execute on function public.can_manage_pauta(uuid) to authenticated;
grant execute on function public.can_complete_pauta(uuid) to authenticated;
grant execute on function public.notify_pauta_conclusion(uuid, uuid) to authenticated;
grant execute on function public.purge_old_notifications(integer) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_active_user() to authenticated;
