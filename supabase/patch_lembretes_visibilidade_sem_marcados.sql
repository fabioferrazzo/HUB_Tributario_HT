-- HUB Depto. Tributario - ajuste pontual de visibilidade dos lembretes
-- Execute no SQL Editor do Supabase.
--
-- Regra:
-- - Admin ve todos.
-- - Criador ve o proprio lembrete.
-- - Lembrete sem usuarios marcados fica visivel apenas para criador e admin.
-- - Lembrete nao confidencial com usuarios marcados fica visivel para todos.
-- - Lembrete confidencial com usuarios marcados fica visivel apenas para criador, admin e marcados.

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
