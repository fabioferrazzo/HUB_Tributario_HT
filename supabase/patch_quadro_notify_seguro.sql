-- HUB Depto Tributario - Notificacao de aviso particular protegida (05/11/2026)
--
-- Antes: qualquer usuario logado podia chamar notify_quadro_aviso_particular
-- para qualquer aviso, reenviando a notificacao aos marcados e marcando-a
-- novamente como "nao lida".
-- Agora: so o autor do aviso ou um administrador pode disparar a notificacao.
-- O restante da funcao e identico ao patch_quadro_avisos_v2.sql.
--
-- Ordem: executar DEPOIS de patch_quadro_avisos_v2.sql.
-- Seguro para executar mais de uma vez.

begin;

create or replace function public.notify_quadro_aviso_particular(p_aviso_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_title text;
  v_content text;
begin
  if not public.can_manage_quadro_aviso(p_aviso_id) then
    raise exception 'Sem permissao para notificar este aviso.' using errcode = '42501';
  end if;

  select created_by, coalesce(nullif(title, ''), 'Quadro de Avisos'), coalesce(content, '')
    into v_creator, v_title, v_content
  from public.quadro_avisos
  where id = p_aviso_id
    and visibility = 'particular';

  if not found then
    return;
  end if;

  insert into public.notificacoes (
    user_id,
    tipo,
    titulo,
    body,
    meta,
    target_type,
    target_id,
    target_ref,
    dedupe_key,
    route,
    tone,
    active,
    created_at,
    updated_at
  )
  select distinct
    coalesce(qau.user_id, p.id) as user_id,
    'quadro_aviso',
    'Novo aviso particular',
    'Voce recebeu um aviso particular no Quadro de Avisos: ' || v_title,
    jsonb_build_object(
      'avisoId', p_aviso_id,
      'route', 'pautas',
      'tab', 'avisos',
      'title', v_title,
      'content', left(v_content, 240)
    )::text,
    'quadro_aviso',
    p_aviso_id,
    p_aviso_id::text,
    'quadro_aviso:' || p_aviso_id::text || ':' || coalesce(qau.user_id, p.id)::text,
    'pautas',
    'info',
    true,
    now(),
    now()
  from public.quadro_aviso_usuarios qau
  left join public.profiles p on lower(p.email) = lower(qau.email)
  where qau.aviso_id = p_aviso_id
    and coalesce(qau.user_id, p.id) is not null
    and coalesce(qau.user_id, p.id) <> coalesce(v_creator, '00000000-0000-0000-0000-000000000000'::uuid)
  on conflict (user_id, dedupe_key) do update
    set titulo = excluded.titulo,
        body = excluded.body,
        meta = excluded.meta,
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        target_ref = excluded.target_ref,
        route = excluded.route,
        tone = excluded.tone,
        active = true,
        read_at = null,
        updated_at = now();
end;
$$;

-- Funcoes no Postgres podem ser executadas por PUBLIC por padrao:
-- restringe a usuarios autenticados.
revoke execute on function public.notify_quadro_aviso_particular(uuid) from public;
revoke execute on function public.notify_quadro_aviso_particular(uuid) from anon;
grant execute on function public.notify_quadro_aviso_particular(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
