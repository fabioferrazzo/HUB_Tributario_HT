-- HUB Depto Tributario - ajuste REST/PostgREST para Pautas.
-- Rode no SQL Editor do MESMO projeto Supabase configurado no Netlify.
--
-- Uso:
-- 1. Execute este patch completo.
-- 2. Atualize/reabra o app.
-- 3. Se VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY foram alteradas no
--    Netlify depois do ultimo deploy, faca um novo deploy sem cache.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table public.pautas to authenticated;
grant select, insert, update, delete on table public.pauta_usuarios to authenticated;
grant select, insert, update, delete on table public.pauta_anexos to authenticated;
grant select, insert, update, delete on table public.pauta_conclusoes to authenticated;

grant select on table public.profiles to authenticated;

grant execute on function public.can_read_pauta(uuid) to authenticated;
grant execute on function public.can_manage_pauta(uuid) to authenticated;
grant execute on function public.can_complete_pauta(uuid) to authenticated;
grant execute on function public.notify_pauta_conclusion(uuid, uuid) to authenticated;
grant execute on function public.purge_old_notifications(integer) to authenticated;
grant execute on function public.uuid_or_null(text) to authenticated;
grant execute on function public.profile_is_active(public.profiles) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_active_user() to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

select
  to_regclass('public.pautas') as public_pautas,
  to_regclass('public.pauta_usuarios') as public_pauta_usuarios,
  to_regclass('public.pauta_anexos') as public_pauta_anexos,
  to_regclass('public.pauta_conclusoes') as public_pauta_conclusoes;
