-- HUB Depto. Tributario - RPC para criacao de lembretes
-- Execute uma vez no SQL Editor do Supabase.
--
-- Objetivo:
-- criar lembretes por uma funcao controlada, permitindo qualquer usuario ativo
-- sem depender de insert direto do front nas policies RLS da tabela.

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

drop function if exists public.create_lembrete(
  text,
  text,
  timestamptz,
  public.prioridade,
  public.lembrete_status,
  text[]
);

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
