-- HUB Depto. Tributario - patch de criador dos lembretes
-- Execute uma vez no SQL Editor do Supabase.
--
-- Objetivo:
-- garantir que qualquer usuario ativo possa criar lembretes e que o campo
-- created_by seja sempre o usuario autenticado real da sessao Supabase.

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

drop trigger if exists lembretes_set_created_by on public.lembretes;
create trigger lembretes_set_created_by
before insert on public.lembretes
for each row execute function public.set_lembrete_created_by();

drop policy if exists "lembretes_insert_authenticated" on public.lembretes;
create policy "lembretes_insert_authenticated"
on public.lembretes for insert
to authenticated
with check (public.is_active_user());
