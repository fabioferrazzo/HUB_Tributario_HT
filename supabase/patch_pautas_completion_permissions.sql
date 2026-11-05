begin;

create or replace function public.can_complete_pauta(p_pauta_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pautas pa
    where pa.id = p_pauta_id
      and (
        public.is_admin()
        or exists (
          select 1
          from public.pauta_usuarios pu
          join public.profiles pr
            on (
              pr.id = pu.user_id
              or lower(pr.email) = lower(coalesce(pu.email, ''))
            )
          where pu.pauta_id = pa.id
            and pr.id = auth.uid()
            and coalesce(pr.active, true) = true
        )
      )
  );
$$;

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

grant execute on function public.can_complete_pauta(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
