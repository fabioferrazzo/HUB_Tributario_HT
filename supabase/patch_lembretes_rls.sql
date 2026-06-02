-- HUB Depto. Tributario - patch RLS de Lembretes
-- Execute uma vez no SQL Editor do Supabase.
--
-- Objetivo:
-- corrigir a leitura/gravar lembretes para colaboradores, evitando recursao
-- entre as policies de lembretes, usuarios marcados e anexos.

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
      and (
        l.created_by = auth.uid()
        or public.is_manager()
        or exists (
          select 1
          from public.lembrete_usuarios lu
          where lu.lembrete_id = target_lembrete_id
            and lu.user_id = auth.uid()
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
      and (l.created_by = auth.uid() or public.is_manager())
  );
$$;

drop policy if exists "lembretes_select_allowed" on public.lembretes;
create policy "lembretes_select_allowed"
on public.lembretes for select
to authenticated
using (public.can_read_lembrete(id));

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
