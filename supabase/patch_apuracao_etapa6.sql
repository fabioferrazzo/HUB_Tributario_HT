-- HUB Depto Tributário: Controle de Apuração no HUB — Etapa 6 (parte 1): administração.
-- Rode no SQL Editor do Supabase depois das etapas anteriores (pode rodar mais de uma vez).
-- Alertas gerais (criar, editar, pausar, excluir) com as mesmas regras do servidor antigo e consulta da auditoria.

begin;

create or replace function public.apur_bool(p jsonb, p_default boolean)
returns boolean language sql immutable as $$
  select case
    when p is null or jsonb_typeof(p) = 'null' then p_default
    when jsonb_typeof(p) = 'boolean' then p::text::boolean
    when jsonb_typeof(p) = 'number' then (p::text)::numeric <> 0
    else lower(btrim(regexp_replace(p #>> '{}', '\s+', ' ', 'g'))) in ('1', 'true', 'sim', 'yes', 'on')
  end
$$;

-- Criar (p_id nulo ou novo) ou editar (p_id existente) um alerta geral.
create or replace function public.apur_alert_save(p_id uuid, p jsonb, p_is_update boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_title text := public.apur_txt(p->>'title');
  v_message text := public.apur_multiline(p->>'message', 2000);
  v_severity text := upper(coalesce(nullif(public.apur_txt(p->>'severity'), ''), 'INFO'));
  v_start text := nullif(public.apur_txt(p->>'starts_on'), '');
  v_end text := nullif(public.apur_txt(p->>'ends_on'), '');
  v_font_raw text := nullif(public.apur_txt(p->>'font_size'), '');
  v_font integer;
  v_all boolean := public.apur_bool(p->'target_all', true);
  v_targets uuid[] := '{}';
  v_item text;
  v_active boolean := public.apur_bool(p->'active', true);
  v_bold boolean := public.apur_bool(p->'is_bold', false);
  v_yellow boolean := public.apur_bool(p->'highlight_yellow', false);
  v_out jsonb;
begin
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  if p_is_update and not exists (select 1 from public.apur_alerts where id = v_id and not deleted) then raise exception 'Alerta não encontrado.'; end if;
  if v_title = '' then raise exception 'Título do alerta é obrigatório.'; end if;
  if length(v_title) > 140 then raise exception 'O título do alerta deve ter no máximo 140 caracteres.'; end if;
  if v_severity not in ('INFO', 'WARNING', 'CRITICAL') then raise exception 'Severidade de alerta inválida.'; end if;
  begin
    if v_start is not null then perform v_start::date; end if;
    if v_end is not null then perform v_end::date; end if;
    if (v_start is not null and v_start !~ '^\d{4}-\d{2}-\d{2}$') or (v_end is not null and v_end !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'x'; end if;
  exception when others then
    raise exception 'Data do alerta inválida. Use AAAA-MM-DD.';
  end;
  if v_start is not null and v_end is not null and v_end < v_start then raise exception 'A data final do alerta não pode ser anterior à data inicial.'; end if;
  begin
    v_font := coalesce(v_font_raw::numeric::integer, 15);
    if v_font_raw is not null and v_font_raw::numeric <> trunc(v_font_raw::numeric) then raise exception 'x'; end if;
  exception when others then
    raise exception 'Tamanho da fonte do alerta inválido.';
  end;
  if v_font < 12 or v_font > 28 then raise exception 'A fonte do alerta deve ficar entre 12 e 28 px.'; end if;
  if not v_all then
    if jsonb_typeof(p->'target_user_ids') = 'array' then
      for v_item in select distinct on (public.apur_txt(x)) public.apur_txt(x) from jsonb_array_elements_text(p->'target_user_ids') x where public.apur_txt(x) <> '' loop
        begin
          v_targets := v_targets || v_item::uuid;
        exception when others then
          raise exception 'Um ou mais usuários selecionados não existem ou estão inativos.';
        end;
      end loop;
    end if;
    if cardinality(v_targets) = 0 then raise exception 'Selecione ao menos um usuário ou marque Todos os usuários.'; end if;
    if exists (select 1 from unnest(v_targets) t where not exists (select 1 from public.profiles pr where pr.id = t and pr.active)) then
      raise exception 'Um ou mais usuários selecionados não existem ou estão inativos.';
    end if;
  end if;

  if p_is_update then
    update public.apur_alerts set title = v_title, message = v_message, severity = v_severity, active = v_active,
      starts_on = v_start::date, ends_on = v_end::date, target_all = v_all, target_user_ids = v_targets, font_size = v_font,
      is_bold = v_bold, highlight_yellow = v_yellow, updated_at = now(), updated_by = v_uid
    where id = v_id;
    perform public.apur_audit_log('UPDATE', 'alert', v_id::text, jsonb_build_object('title', v_title, 'target_all', v_all, 'target_user_ids', to_jsonb(v_targets),
      'starts_on', v_start, 'ends_on', v_end, 'active', v_active));
  else
    insert into public.apur_alerts (id, title, message, severity, active, starts_on, ends_on, target_all, target_user_ids, font_size, is_bold, highlight_yellow,
      deleted, created_by, created_at, updated_at, updated_by)
    values (v_id, v_title, v_message, v_severity, v_active, v_start::date, v_end::date, v_all, v_targets, v_font, v_bold, v_yellow, false, v_uid, now(), now(), v_uid);
    perform public.apur_audit_log('CREATE', 'alert', v_id::text, jsonb_build_object('title', v_title, 'target_all', v_all, 'target_user_ids', to_jsonb(v_targets),
      'starts_on', v_start, 'ends_on', v_end));
  end if;
  select x into v_out from jsonb_array_elements(public.apur_alert_records(true)) x where x->>'id' = v_id::text;
  return jsonb_build_object('ok', true, 'id', v_id, 'alert', v_out);
end;
$$;

create or replace function public.apur_alert_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.apur_require_user();
begin
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  update public.apur_alerts set active = false, deleted = true, deleted_at = now(), deleted_by = v_uid, updated_at = now(), updated_by = v_uid
  where id = p_id and not deleted;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  perform public.apur_audit_log('DELETE', 'alert', p_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Auditoria: últimos 300 registros (somente ADM), com o nome de quem fez.
create or replace function public.apur_audit_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.apur_require_user();
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  return jsonb_build_object('audit', coalesce((
    select jsonb_agg(to_jsonb(a) || jsonb_build_object('details_json', a.details::text, 'user_name', coalesce(u.nome, '')) order by a.id desc)
    from (select * from public.apur_audit order by id desc limit 300) a left join public.profiles u on u.id = a.user_id), '[]'::jsonb));
end;
$$;

revoke all on function public.apur_bool(jsonb, boolean) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['apur_alert_save(uuid, jsonb, boolean)', 'apur_alert_delete(uuid)', 'apur_audit_list()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
