-- HUB Depto Tributario - notificacoes persistentes
-- Execute este patch no Supabase SQL Editor antes de testar o sino.

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

drop trigger if exists notificacoes_touch_updated_at on public.notificacoes;
create trigger notificacoes_touch_updated_at
before update on public.notificacoes
for each row execute function public.touch_updated_at();

alter table public.notificacoes enable row level security;

drop policy if exists "notificacoes_select_own" on public.notificacoes;
create policy "notificacoes_select_own"
on public.notificacoes for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "notificacoes_insert_own" on public.notificacoes;
create policy "notificacoes_insert_own"
on public.notificacoes for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "notificacoes_update_own" on public.notificacoes;
create policy "notificacoes_update_own"
on public.notificacoes for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "notificacoes_delete_own" on public.notificacoes;
create policy "notificacoes_delete_own"
on public.notificacoes for delete
to authenticated
using (user_id = auth.uid());

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

grant execute on function public.sync_user_notifications(jsonb) to authenticated;
