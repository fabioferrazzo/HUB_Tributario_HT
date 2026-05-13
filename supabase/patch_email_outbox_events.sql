-- HUB Depto Tributario - eventos que alimentam a fila de e-mails
-- Requer `supabase/patch_email_outbox.sql` executado antes.

create or replace function public.queue_lembrete_deadline_emails(
  p_window_start timestamptz default date_trunc('day', now() + interval '1 day'),
  p_window_end timestamptz default date_trunc('day', now() + interval '2 days')
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

  begin
    perform public.queue_lembrete_created_emails(v_lembrete_id);
  exception
    when others then
      raise notice 'Nao foi possivel enfileirar e-mails do lembrete %: %', v_lembrete_id, sqlerrm;
  end;

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

grant execute on function public.queue_lembrete_deadline_emails(timestamptz, timestamptz) to service_role;
