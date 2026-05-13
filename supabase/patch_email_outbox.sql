-- HUB Depto Tributario - base futura para e-mails transacionais
-- Este patch cria a fila de e-mails, mas nao ativa disparo automatico.

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

create index if not exists email_outbox_status_schedule_idx
on public.email_outbox (status, scheduled_for);

create index if not exists email_outbox_target_idx
on public.email_outbox (target_type, target_ref);

drop trigger if exists email_outbox_touch_updated_at on public.email_outbox;
create trigger email_outbox_touch_updated_at
before update on public.email_outbox
for each row execute function public.touch_updated_at();

alter table public.email_outbox enable row level security;

drop policy if exists "email_outbox_select_managers" on public.email_outbox;
create policy "email_outbox_select_managers"
on public.email_outbox for select
to authenticated
using (public.is_manager());

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
    where p.active
      and p.id = v_lembrete.created_by
    union
    select p.id, p.email, p.nome
    from public.lembrete_usuarios lu
    join public.profiles p on p.id = lu.user_id
    where lu.lembrete_id = p_lembrete_id
      and p.active
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
    where p.active
    union
    select l.id as lembrete_id, l.titulo, l.descricao, l.prazo, l.created_by, p.id as user_id, p.email, p.nome
    from due_lembretes l
    join public.lembrete_usuarios lu on lu.lembrete_id = l.id
    join public.profiles p on p.id = lu.user_id
    where p.active
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

grant execute on function public.queue_email(text, text, text, text, text, text, text, timestamptz, text, text, uuid) to service_role;
grant execute on function public.queue_lembrete_created_emails(uuid) to service_role;
grant execute on function public.queue_lembrete_deadline_emails(timestamptz, timestamptz) to service_role;
