-- HUB Depto. Tributario - patch de leitura de usuarios ativos
-- Execute uma vez no SQL Editor do Supabase.
--
-- Objetivo:
-- permitir que usuarios ativos visualizem a lista basica de usuarios ativos,
-- para marcacao de responsaveis em lembretes, sem liberar edicao/admin.

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

drop policy if exists "profiles_select_own_or_manager" on public.profiles;
create policy "profiles_select_own_or_manager"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or public.is_manager()
  or (active and public.is_active_user())
);
