-- HUB Depto Tributario - objetos centrais ausentes.
-- Execute no Supabase SQL Editor quando o check_hub_status indicar pendencias
-- em lembretes, tarefas, arquivos, links, noticias, coordenacao ou buckets.
--
-- Este patch e idempotente: cria o que faltar e substitui policies/funcoes
-- operacionais sem apagar dados existentes.

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

alter table public.profiles
  add column if not exists active boolean not null default true;

update public.profiles as p
set active = coalesce(
  nullif(to_jsonb(p)->>'is_active', '')::boolean,
  nullif(to_jsonb(p)->>'active', '')::boolean,
  true
);

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

create or replace function public.profile_is_active(p_profile public.profiles)
returns boolean
language sql
stable
as $$
  select coalesce(
    nullif(to_jsonb(p_profile)->>'active', '')::boolean,
    nullif(to_jsonb(p_profile)->>'is_active', '')::boolean,
    true
  );
$$;

create or replace function public.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if value is null or trim(value) = '' then
    return null;
  end if;

  return value::uuid;
exception
  when invalid_text_representation then
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
    from public.profiles p
    where p.id = auth.uid()
      and public.profile_is_active(p)
      and (to_jsonb(p)->>'role') = 'admin'
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
    from public.profiles p
    where p.id = auth.uid()
      and public.profile_is_active(p)
      and (to_jsonb(p)->>'role') in ('admin', 'gestor')
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
    from public.profiles p
    where p.id = auth.uid()
      and public.profile_is_active(p)
  );
$$;

create table if not exists public.lembretes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text not null default '',
  prazo timestamptz,
  prioridade text not null default 'normal' check (prioridade in ('alta', 'normal', 'baixa')),
  status text not null default 'aberto' check (status in ('aberto', 'concluido', 'vencido')),
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

create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text not null default '',
  prazo timestamptz,
  prioridade text not null default 'normal' check (prioridade in ('alta', 'normal', 'baixa')),
  status text not null default 'aberta' check (status in ('aberta', 'concluida')),
  archived_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tarefas
  add column if not exists archived_at timestamptz;

create index if not exists tarefas_archived_at_idx
  on public.tarefas (archived_at);

create table if not exists public.tarefa_usuarios (
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tarefa_id, user_id)
);

create table if not exists public.tarefa_anexos (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

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
  processing_status text not null default 'none',
  processing_message text not null default '',
  processed_file_name text,
  processed_storage_path text,
  processed_mime_type text,
  processed_size_bytes bigint,
  processed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.arquivo_recursos
  add column if not exists processing_status text not null default 'none',
  add column if not exists processing_message text not null default '',
  add column if not exists processed_file_name text,
  add column if not exists processed_storage_path text,
  add column if not exists processed_mime_type text,
  add column if not exists processed_size_bytes bigint,
  add column if not exists processed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'arquivo_recursos_processing_status_check'
      and conrelid = 'public.arquivo_recursos'::regclass
  ) then
    alter table public.arquivo_recursos
      add constraint arquivo_recursos_processing_status_check
      check (processing_status in ('none', 'pending', 'processing', 'ready', 'error'));
  end if;
end;
$$;

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
  tipo text not null default 'noticia' check (tipo in ('noticia', 'legislacao')),
  source_type text not null default 'oficial' check (source_type in ('oficial', 'especializada')),
  source_url text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.noticias
  add column if not exists tipo text not null default 'noticia',
  add column if not exists source_type text not null default 'oficial',
  add column if not exists source_url text,
  add column if not exists active boolean not null default true,
  add column if not exists expires_at date,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists noticias_tipo_url_unique
on public.noticias (tipo, url);

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  body text not null default '',
  meta text not null default '',
  target_type text,
  target_id uuid,
  target_ref text,
  dedupe_key text,
  route text not null default 'home',
  tone text not null default 'info',
  active boolean not null default true,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notificacoes
  add column if not exists meta text not null default '',
  add column if not exists target_ref text,
  add column if not exists dedupe_key text,
  add column if not exists route text not null default 'home',
  add column if not exists tone text not null default 'info',
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.notificacoes
set dedupe_key = coalesce(dedupe_key, id::text)
where dedupe_key is null;

alter table public.notificacoes
  alter column dedupe_key set not null;

create unique index if not exists notificacoes_user_dedupe_unique
on public.notificacoes (user_id, dedupe_key);

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  to_email text not null,
  to_name text,
  subject text not null,
  html_body text not null,
  text_body text not null default '',
  category text not null default 'sistema',
  target_type text,
  target_ref text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed', 'skipped')),
  scheduled_for timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  provider text,
  provider_message_id text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.coord_colaboradores (
  id text primary key,
  nome text not null,
  email text not null,
  funcao text not null default '',
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coord_itens (
  id text primary key,
  titulo text not null,
  descricao text not null default '',
  tipo text not null default 'colaborador' check (tipo in ('colaborador', 'coordenacao', 'pauta')),
  colaborador_id text references public.coord_colaboradores(id) on delete set null,
  prazo text not null default '',
  prioridade text not null default 'media' check (prioridade in ('alta', 'media', 'baixa')),
  recorrencia text not null default 'none' check (recorrencia in ('none', 'weekly', 'monthly')),
  status text not null default 'aberto' check (status in ('aberto', 'concluido')),
  pinned text not null default 'main' check (pinned in ('main', 'hidden')),
  anexos jsonb not null default '[]'::jsonb,
  deleted_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists arquivo_recursos_processing_status_idx
on public.arquivo_recursos (processing_status, updated_at desc);

create index if not exists arquivo_recursos_processed_storage_path_idx
on public.arquivo_recursos (processed_storage_path)
where processed_storage_path is not null;

create index if not exists arquivo_anotacoes_resource_idx
on public.arquivo_anotacoes (resource_id, created_at desc);

create index if not exists arquivo_anotacoes_created_by_idx
on public.arquivo_anotacoes (created_by);

create index if not exists email_outbox_status_schedule_idx
on public.email_outbox (status, scheduled_for);

create index if not exists email_outbox_target_idx
on public.email_outbox (target_type, target_ref);

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists lembretes_touch_updated_at on public.lembretes;
create trigger lembretes_touch_updated_at
before update on public.lembretes
for each row execute function public.touch_updated_at();

drop trigger if exists tarefas_touch_updated_at on public.tarefas;
create trigger tarefas_touch_updated_at
before update on public.tarefas
for each row execute function public.touch_updated_at();

drop trigger if exists arquivo_pastas_touch_updated_at on public.arquivo_pastas;
create trigger arquivo_pastas_touch_updated_at
before update on public.arquivo_pastas
for each row execute function public.touch_updated_at();

drop trigger if exists arquivo_recursos_touch_updated_at on public.arquivo_recursos;
create trigger arquivo_recursos_touch_updated_at
before update on public.arquivo_recursos
for each row execute function public.touch_updated_at();

drop trigger if exists arquivo_anotacoes_touch_updated_at on public.arquivo_anotacoes;
create trigger arquivo_anotacoes_touch_updated_at
before update on public.arquivo_anotacoes
for each row execute function public.touch_updated_at();

drop trigger if exists links_uteis_touch_updated_at on public.links_uteis;
create trigger links_uteis_touch_updated_at
before update on public.links_uteis
for each row execute function public.touch_updated_at();

drop trigger if exists noticias_touch_updated_at on public.noticias;
create trigger noticias_touch_updated_at
before update on public.noticias
for each row execute function public.touch_updated_at();

drop trigger if exists notificacoes_touch_updated_at on public.notificacoes;
create trigger notificacoes_touch_updated_at
before update on public.notificacoes
for each row execute function public.touch_updated_at();

drop trigger if exists email_outbox_touch_updated_at on public.email_outbox;
create trigger email_outbox_touch_updated_at
before update on public.email_outbox
for each row execute function public.touch_updated_at();

drop trigger if exists coord_colaboradores_touch_updated_at on public.coord_colaboradores;
create trigger coord_colaboradores_touch_updated_at
before update on public.coord_colaboradores
for each row execute function public.touch_updated_at();

drop trigger if exists coord_itens_touch_updated_at on public.coord_itens;
create trigger coord_itens_touch_updated_at
before update on public.coord_itens
for each row execute function public.touch_updated_at();

create or replace function public.set_lembrete_created_by()
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
    new.created_by := auth.uid();
  end if;

  if new.created_by <> auth.uid() and not public.is_admin() then
    raise exception 'Nao e permitido criar lembretes em nome de outro usuario.';
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

drop trigger if exists lembretes_set_created_by on public.lembretes;
create trigger lembretes_set_created_by
before insert on public.lembretes
for each row execute function public.set_lembrete_created_by();

drop trigger if exists lembretes_normalize_confidencial on public.lembretes;
create trigger lembretes_normalize_confidencial
before insert or update on public.lembretes
for each row execute function public.normalize_lembrete_confidencial();

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
    new.created_by := auth.uid();
  end if;

  if new.created_by <> auth.uid() and not public.is_admin() then
    raise exception 'Nao e permitido criar registros em nome de outro usuario.';
  end if;

  return new;
end;
$$;

drop trigger if exists arquivo_pastas_set_created_by on public.arquivo_pastas;
create trigger arquivo_pastas_set_created_by
before insert on public.arquivo_pastas
for each row execute function public.set_arquivo_created_by();

drop trigger if exists arquivo_recursos_set_created_by on public.arquivo_recursos;
create trigger arquivo_recursos_set_created_by
before insert on public.arquivo_recursos
for each row execute function public.set_arquivo_created_by();

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
    new.created_by := auth.uid();
  end if;

  if new.created_by <> auth.uid() and not public.is_admin() then
    raise exception 'Nao e permitido criar anotacoes em nome de outro usuario.';
  end if;

  return new;
end;
$$;

drop trigger if exists arquivo_anotacoes_set_created_by on public.arquivo_anotacoes;
create trigger arquivo_anotacoes_set_created_by
before insert on public.arquivo_anotacoes
for each row execute function public.set_arquivo_anotacao_created_by();

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
      and (public.is_admin() or l.created_by = auth.uid())
  );
$$;

drop function if exists public.create_lembrete(
  text,
  text,
  timestamptz,
  public.prioridade,
  public.lembrete_status,
  text[]
);

drop function if exists public.create_lembrete(
  text,
  text,
  timestamptz,
  public.prioridade,
  public.lembrete_status,
  text[],
  boolean
);

drop function if exists public.create_lembrete(
  text,
  text,
  timestamptz,
  text,
  text,
  text[],
  boolean
);

drop function if exists public.create_lembrete(
  text,
  text,
  timestamptz,
  text,
  text,
  boolean,
  text[]
);

create or replace function public.create_lembrete(
  p_titulo text,
  p_descricao text default '',
  p_prazo timestamptz default null,
  p_prioridade text default 'normal',
  p_status text default 'aberto',
  p_confidencial boolean default false,
  p_responsaveis text[] default '{}'::text[]
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
    coalesce(nullif(p_prioridade, ''), 'normal'),
    coalesce(nullif(p_status, ''), 'aberto'),
    coalesce(p_confidencial, false) and public.is_admin(),
    auth.uid()
  )
  returning id into v_lembrete_id;

  insert into public.lembrete_usuarios (lembrete_id, user_id)
  select v_lembrete_id, p.id
  from public.profiles p
  where public.profile_is_active(p)
    and p.email = any(coalesce(p_responsaveis, '{}'::text[]))
  on conflict do nothing;

  perform public.queue_lembrete_created_emails(v_lembrete_id);

  return v_lembrete_id;
end;
$$;

create or replace function public.can_read_tarefa(target_tarefa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tarefas t
    where t.id = target_tarefa_id
      and public.is_active_user()
      and (
        public.is_manager()
        or t.created_by = auth.uid()
        or exists (
          select 1
          from public.tarefa_usuarios tu
          where tu.tarefa_id = target_tarefa_id
            and tu.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_manage_tarefa(target_tarefa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tarefas t
    where t.id = target_tarefa_id
      and public.is_active_user()
      and (public.is_manager() or t.created_by = auth.uid())
  );
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

create or replace function public.queue_email(
  p_to_email text,
  p_subject text,
  p_html_body text,
  p_text_body text default '',
  p_category text default 'sistema',
  p_target_type text default null,
  p_target_ref text default null,
  p_scheduled_for timestamptz default now(),
  p_dedupe_key text default null,
  p_to_name text default null,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_dedupe_key text := coalesce(nullif(trim(p_dedupe_key), ''), gen_random_uuid()::text);
begin
  if nullif(trim(p_to_email), '') is null then
    raise exception 'Destinatario de e-mail nao informado.';
  end if;

  if nullif(trim(p_subject), '') is null then
    raise exception 'Assunto do e-mail nao informado.';
  end if;

  insert into public.email_outbox (
    dedupe_key,
    to_email,
    to_name,
    subject,
    html_body,
    text_body,
    category,
    target_type,
    target_ref,
    scheduled_for,
    created_by
  )
  values (
    v_dedupe_key,
    lower(trim(p_to_email)),
    nullif(trim(p_to_name), ''),
    trim(p_subject),
    p_html_body,
    coalesce(p_text_body, ''),
    coalesce(nullif(trim(p_category), ''), 'sistema'),
    nullif(trim(p_target_type), ''),
    nullif(trim(p_target_ref), ''),
    coalesce(p_scheduled_for, now()),
    p_created_by
  )
  on conflict (dedupe_key) do update
  set to_email = excluded.to_email,
      to_name = excluded.to_name,
      subject = excluded.subject,
      html_body = excluded.html_body,
      text_body = excluded.text_body,
      category = excluded.category,
      target_type = excluded.target_type,
      target_ref = excluded.target_ref,
      scheduled_for = excluded.scheduled_for,
      status = case
        when public.email_outbox.status in ('sent', 'processing') then public.email_outbox.status
        else 'queued'
      end,
      last_error = null,
      updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.queue_lembrete_created_emails(p_lembrete_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lembrete record;
  v_count integer := 0;
begin
  select l.*, creator.nome as creator_nome, creator.email as creator_email
  into v_lembrete
  from public.lembretes l
  left join public.profiles creator on creator.id = l.created_by
  where l.id = p_lembrete_id;

  if not found then
    return 0;
  end if;

  with recipients as (
    select p.id, p.email, p.nome
    from public.profiles p
    where public.profile_is_active(p)
      and p.id = v_lembrete.created_by
    union
    select p.id, p.email, p.nome
    from public.lembrete_usuarios lu
    join public.profiles p on p.id = lu.user_id
    where lu.lembrete_id = p_lembrete_id
      and public.profile_is_active(p)
  ),
  inserted as (
    insert into public.email_outbox (
      dedupe_key,
      to_email,
      to_name,
      subject,
      html_body,
      text_body,
      category,
      target_type,
      target_ref,
      scheduled_for,
      created_by
    )
    select
      'lembrete_created:' || p_lembrete_id::text || ':' || recipients.id::text,
      recipients.email,
      recipients.nome,
      'Novo lembrete: ' || v_lembrete.titulo,
      '<p>Um lembrete foi registrado no HUB Depto Tributario.</p>' ||
        '<p><strong>' || public.email_escape_html(v_lembrete.titulo) || '</strong></p>' ||
        '<p>' || public.email_escape_html(coalesce(v_lembrete.descricao, '')) || '</p>' ||
        '<p><strong>Prazo:</strong> ' || coalesce(to_char(v_lembrete.prazo, 'DD/MM/YYYY HH24:MI'), 'sem prazo') || '</p>',
      'Novo lembrete: ' || v_lembrete.titulo || E'\nPrazo: ' || coalesce(to_char(v_lembrete.prazo, 'DD/MM/YYYY HH24:MI'), 'sem prazo'),
      'lembrete_criado',
      'lembrete',
      p_lembrete_id::text,
      now(),
      v_lembrete.created_by
    from recipients
    on conflict (dedupe_key) do nothing
    returning id
  )
  select count(*) into v_count from inserted;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.queue_lembrete_deadline_emails(
  p_window_start timestamptz default now() + interval '23 hours',
  p_window_end timestamptz default now() + interval '25 hours'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with due_lembretes as (
    select l.*
    from public.lembretes l
    where l.status <> 'concluido'
      and l.prazo is not null
      and l.prazo >= p_window_start
      and l.prazo < p_window_end
  ),
  recipients as (
    select l.id as lembrete_id, l.titulo, l.descricao, l.prazo, l.created_by, p.id as user_id, p.email, p.nome
    from due_lembretes l
    join public.profiles p on p.id = l.created_by
    where public.profile_is_active(p)
    union
    select l.id as lembrete_id, l.titulo, l.descricao, l.prazo, l.created_by, p.id as user_id, p.email, p.nome
    from due_lembretes l
    join public.lembrete_usuarios lu on lu.lembrete_id = l.id
    join public.profiles p on p.id = lu.user_id
    where public.profile_is_active(p)
  ),
  inserted as (
    insert into public.email_outbox (
      dedupe_key,
      to_email,
      to_name,
      subject,
      html_body,
      text_body,
      category,
      target_type,
      target_ref,
      scheduled_for,
      created_by
    )
    select
      'lembrete_deadline:' || recipients.lembrete_id::text || ':' || recipients.user_id::text || ':' || to_char(recipients.prazo::date, 'YYYYMMDD'),
      recipients.email,
      recipients.nome,
      'Lembrete vence amanha: ' || recipients.titulo,
      '<p>Este lembrete vence em aproximadamente um dia.</p>' ||
        '<p><strong>' || public.email_escape_html(recipients.titulo) || '</strong></p>' ||
        '<p>' || public.email_escape_html(coalesce(recipients.descricao, '')) || '</p>' ||
        '<p><strong>Prazo:</strong> ' || to_char(recipients.prazo, 'DD/MM/YYYY HH24:MI') || '</p>',
      'Lembrete vence amanha: ' || recipients.titulo || E'\nPrazo: ' || to_char(recipients.prazo, 'DD/MM/YYYY HH24:MI'),
      'lembrete_vencimento',
      'lembrete',
      recipients.lembrete_id::text,
      now(),
      recipients.created_by
    from recipients
    on conflict (dedupe_key) do nothing
    returning id
  )
  select count(*) into v_count from inserted;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.sync_user_notifications(p_items jsonb)
returns setof public.notificacoes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_keys text[];
begin
  if v_user is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  select coalesce(array_agg(item->>'dedupe_key'), array[]::text[])
  into v_keys
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
  where coalesce(item->>'dedupe_key', '') <> '';

  update public.notificacoes
  set active = false,
      updated_at = now()
  where user_id = v_user
    and tipo in (
      'lembrete_created',
      'lembrete_assigned',
      'lembrete_due',
      'lembrete_overdue',
      'pauta_due',
      'pauta_overdue'
    )
    and active = true
    and (
      array_length(v_keys, 1) is null
      or not (dedupe_key = any(v_keys))
    );

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
    v_user,
    item->>'tipo',
    item->>'titulo',
    coalesce(item->>'body', ''),
    coalesce(item->>'meta', ''),
    nullif(item->>'target_type', ''),
    nullif(item->>'target_ref', ''),
    item->>'dedupe_key',
    coalesce(nullif(item->>'route', ''), 'home'),
    coalesce(nullif(item->>'tone', ''), 'info'),
    true,
    now(),
    now()
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
  where coalesce(item->>'dedupe_key', '') <> ''
  on conflict (user_id, dedupe_key) do update
  set tipo = excluded.tipo,
      titulo = excluded.titulo,
      body = excluded.body,
      meta = excluded.meta,
      target_type = excluded.target_type,
      target_ref = excluded.target_ref,
      route = excluded.route,
      tone = excluded.tone,
      active = true,
      updated_at = now();

  return query
  select *
  from public.notificacoes
  where user_id = v_user
    and active = true
    and read_at is null
  order by
    case tone
      when 'danger' then 0
      when 'warning' then 1
      else 2
    end,
    created_at desc;
end;
$$;

alter table public.profiles enable row level security;
alter table public.lembretes enable row level security;
alter table public.lembrete_usuarios enable row level security;
alter table public.lembrete_anexos enable row level security;
alter table public.tarefas enable row level security;
alter table public.tarefa_usuarios enable row level security;
alter table public.tarefa_anexos enable row level security;
alter table public.arquivo_pastas enable row level security;
alter table public.arquivo_recursos enable row level security;
alter table public.arquivo_anotacoes enable row level security;
alter table public.links_uteis enable row level security;
alter table public.noticias enable row level security;
alter table public.notificacoes enable row level security;
alter table public.email_outbox enable row level security;
alter table public.coord_colaboradores enable row level security;
alter table public.coord_itens enable row level security;

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
with check (public.is_active_user() and created_by = auth.uid());

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

drop policy if exists "tarefas_select_allowed" on public.tarefas;
create policy "tarefas_select_allowed"
on public.tarefas for select
to authenticated
using (public.can_read_tarefa(id));

drop policy if exists "tarefas_insert_active" on public.tarefas;
create policy "tarefas_insert_active"
on public.tarefas for insert
to authenticated
with check (public.is_active_user() and created_by = auth.uid());

drop policy if exists "tarefas_update_owner_or_manager" on public.tarefas;
create policy "tarefas_update_owner_or_manager"
on public.tarefas for update
to authenticated
using (public.can_manage_tarefa(id))
with check (public.can_manage_tarefa(id));

drop policy if exists "tarefas_delete_owner_or_manager" on public.tarefas;
create policy "tarefas_delete_owner_or_manager"
on public.tarefas for delete
to authenticated
using (public.can_manage_tarefa(id));

drop policy if exists "tarefa_usuarios_select_allowed" on public.tarefa_usuarios;
create policy "tarefa_usuarios_select_allowed"
on public.tarefa_usuarios for select
to authenticated
using (public.can_read_tarefa(tarefa_id));

drop policy if exists "tarefa_usuarios_manage_owner_or_manager" on public.tarefa_usuarios;
create policy "tarefa_usuarios_manage_owner_or_manager"
on public.tarefa_usuarios for all
to authenticated
using (public.can_manage_tarefa(tarefa_id))
with check (public.can_manage_tarefa(tarefa_id));

drop policy if exists "tarefa_anexos_select_allowed" on public.tarefa_anexos;
create policy "tarefa_anexos_select_allowed"
on public.tarefa_anexos for select
to authenticated
using (uploaded_by = auth.uid() or public.can_read_tarefa(tarefa_id));

drop policy if exists "tarefa_anexos_manage_owner_or_manager" on public.tarefa_anexos;
create policy "tarefa_anexos_manage_owner_or_manager"
on public.tarefa_anexos for all
to authenticated
using (uploaded_by = auth.uid() or public.can_manage_tarefa(tarefa_id))
with check (uploaded_by = auth.uid() or public.can_manage_tarefa(tarefa_id));

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

drop policy if exists "notificacoes_select_own" on public.notificacoes;
create policy "notificacoes_select_own"
on public.notificacoes for select
to authenticated
using (user_id = auth.uid() or public.is_manager());

drop policy if exists "notificacoes_insert_own" on public.notificacoes;
create policy "notificacoes_insert_own"
on public.notificacoes for insert
to authenticated
with check (user_id = auth.uid() or public.is_manager());

drop policy if exists "notificacoes_update_own" on public.notificacoes;
create policy "notificacoes_update_own"
on public.notificacoes for update
to authenticated
using (user_id = auth.uid() or public.is_manager())
with check (user_id = auth.uid() or public.is_manager());

drop policy if exists "notificacoes_delete_own" on public.notificacoes;
create policy "notificacoes_delete_own"
on public.notificacoes for delete
to authenticated
using (user_id = auth.uid() or public.is_manager());

drop policy if exists "email_outbox_select_managers" on public.email_outbox;
create policy "email_outbox_select_managers"
on public.email_outbox for select
to authenticated
using (public.is_manager());

drop policy if exists "coord_colaboradores_select_manager" on public.coord_colaboradores;
create policy "coord_colaboradores_select_manager"
on public.coord_colaboradores for select
to authenticated
using (public.is_manager());

drop policy if exists "coord_colaboradores_manage_manager" on public.coord_colaboradores;
create policy "coord_colaboradores_manage_manager"
on public.coord_colaboradores for all
to authenticated
using (public.is_manager())
with check (public.is_manager());

drop policy if exists "coord_itens_select_manager" on public.coord_itens;
create policy "coord_itens_select_manager"
on public.coord_itens for select
to authenticated
using (public.is_manager());

drop policy if exists "coord_itens_manage_manager" on public.coord_itens;
create policy "coord_itens_manage_manager"
on public.coord_itens for all
to authenticated
using (public.is_manager())
with check (public.is_manager());

insert into storage.buckets (id, name, public)
values
  ('hub-anexos', 'hub-anexos', false),
  ('hub-arquivos', 'hub-arquivos', false)
on conflict (id) do nothing;

drop policy if exists "hub_anexos_read_authenticated" on storage.objects;
create policy "hub_anexos_read_authenticated"
on storage.objects for select
to authenticated
using (
  bucket_id = 'hub-anexos'
  and (
    owner = auth.uid()
    or public.is_manager()
    or (
      (storage.foldername(name))[1] = 'tarefas'
      and public.can_read_tarefa(public.uuid_or_null((storage.foldername(name))[2]))
    )
    or (
      (storage.foldername(name))[1] = 'pautas'
      and public.can_read_pauta(public.uuid_or_null((storage.foldername(name))[2]))
    )
    or public.can_read_lembrete(public.uuid_or_null((storage.foldername(name))[1]))
  )
);

drop policy if exists "hub_anexos_insert_authenticated" on storage.objects;
create policy "hub_anexos_insert_authenticated"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'hub-anexos'
  and owner = auth.uid()
  and (
    coalesce((storage.foldername(name))[1], '') <> 'pautas'
    or public.is_admin()
  )
);

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
      where (r.storage_path = name or r.processed_storage_path = name)
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

grant execute on function public.profile_is_active(public.profiles) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.can_read_lembrete(uuid) to authenticated;
grant execute on function public.can_manage_lembrete(uuid) to authenticated;
grant execute on function public.create_lembrete(text, text, timestamptz, text, text, boolean, text[]) to authenticated;
grant execute on function public.can_read_tarefa(uuid) to authenticated;
grant execute on function public.can_manage_tarefa(uuid) to authenticated;
grant execute on function public.can_read_arquivo(uuid, text) to authenticated;
grant execute on function public.can_manage_arquivo(uuid) to authenticated;
grant execute on function public.can_read_arquivo_recurso(uuid) to authenticated;
grant execute on function public.sync_user_notifications(jsonb) to authenticated;
grant execute on function public.queue_email(text, text, text, text, text, text, text, timestamptz, text, text, uuid) to authenticated, service_role;
grant execute on function public.queue_lembrete_created_emails(uuid) to authenticated, service_role;
grant execute on function public.queue_lembrete_deadline_emails(timestamptz, timestamptz) to authenticated, service_role;
