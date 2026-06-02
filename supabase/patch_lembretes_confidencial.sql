-- HUB Depto. Tributario - Lembretes confidenciais e permissao de edicao
-- Execute uma vez no SQL Editor do Supabase.
--
-- Regras:
-- 1. Lembretes nao confidenciais com usuarios marcados ficam visiveis para todos os usuarios ativos.
-- 2. Lembretes sem usuarios marcados ficam visiveis apenas para criador e admin.
-- 3. Lembretes confidenciais ficam visiveis apenas para criador, admin e usuarios marcados.
-- 4. Admin pode editar/concluir/excluir todos os lembretes.
-- 5. Colaboradores editam/concluem/excluem apenas lembretes que eles criaram.
-- 6. Apenas admin pode criar/alterar um lembrete como confidencial.

alter table public.lembretes
add column if not exists confidencial boolean not null default false;

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

drop trigger if exists lembretes_normalize_confidencial on public.lembretes;
create trigger lembretes_normalize_confidencial
before insert or update on public.lembretes
for each row execute function public.normalize_lembrete_confidencial();

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

drop policy if exists "lembretes_select_allowed" on public.lembretes;
create policy "lembretes_select_allowed"
on public.lembretes for select
to authenticated
using (public.can_read_lembrete(id));

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
