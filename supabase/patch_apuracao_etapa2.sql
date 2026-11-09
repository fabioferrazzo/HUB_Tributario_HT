-- HUB Depto Tributário: Controle de Apuração no HUB — Etapa 2: carga da tela (bootstrap) para a grade mensal.
-- Rode no SQL Editor do Supabase depois de patch_apuracao_etapa1.sql (pode rodar mais de uma vez).
-- Devolve os dados no mesmo formato do servidor antigo (/api/bootstrap), para a tela do app funcionar igual.

begin;

-- Usuário do HUB no formato do app antigo (ADM do HUB = ADMIN; demais = USER).
create or replace function public.apur_public_user(p public.profiles)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.email, 'email', p.email, 'display_name', p.nome,
    'role', case when p.role::text = 'admin' then 'ADMIN' else 'USER' end,
    'is_primary_admin', p.role::text = 'admin', 'active', p.active, 'deleted', false,
    'company_count', (select count(*) from public.apur_companies c where c.owner_user_id = p.id and not c.deleted)
  )
$$;

create or replace function public.apur_alert_status(a public.apur_alerts, p_today date default (now() at time zone 'America/Sao_Paulo')::date)
returns text language sql stable as $$
  select case
    when a.deleted then 'DELETED'
    when not a.active then 'INACTIVE'
    when a.starts_on is not null and a.starts_on > p_today then 'SCHEDULED'
    when a.ends_on is not null and a.ends_on < p_today then 'ENDED'
    else 'ACTIVE' end
$$;

-- Alertas gerais no formato do app (ADM recebe também os agendados, pausados e encerrados).
create or replace function public.apur_alert_records(p_include_history boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(x.item order by x.sev, x.created_at desc)
    from (
      select a.created_at,
             case a.severity when 'CRITICAL' then 1 when 'WARNING' then 2 else 3 end as sev,
             to_jsonb(a) - 'target_user_ids'
             || jsonb_build_object(
                  'target_user_ids', to_jsonb(a.target_user_ids),
                  'target_users', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.nome,
                        'role', case when p.role::text = 'admin' then 'ADMIN' else 'USER' end, 'active', p.active) order by lower(p.nome))
                      from public.profiles p where p.id = any(a.target_user_ids)), '[]'::jsonb),
                  'status', public.apur_alert_status(a),
                  'visible_now', public.apur_alert_status(a) = 'ACTIVE' and (a.target_all or v_uid = any(a.target_user_ids)),
                  'created_by_name', coalesce((select nome from public.profiles where id = a.created_by), ''),
                  'updated_by_name', coalesce((select nome from public.profiles where id = a.updated_by), ''),
                  'audience_label', case when a.target_all then 'Todos os usuários' else coalesce(
                      (select string_agg(p.nome, ', ' order by lower(p.nome)) from public.profiles p where p.id = any(a.target_user_ids)), 'Nenhum usuário ativo') end
                ) as item
      from public.apur_alerts a
      where not a.deleted
        and (p_include_history or (public.apur_alert_status(a) = 'ACTIVE' and (a.target_all or v_uid = any(a.target_user_ids))))
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Alertas gerais (atualização periódica da tela, equivalente a GET /api/alerts).
create or replace function public.apur_alerts_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.apur_require_user();
  return jsonb_build_object('alerts', public.apur_alert_records(public.is_admin()));
end;
$$;

-- Usuário atual no formato do app (a tela entra com o login do HUB).
create or replace function public.apur_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles;
begin
  perform public.apur_require_user();
  select * into me from public.profiles where id = auth.uid();
  return public.apur_public_user(me);
end;
$$;

-- Nota ADM: aceita o id gerado pela tela (o app antigo envia o id; reenvio não duplica).
drop function if exists public.apur_admin_note_create(uuid, text, text, text, text);
create or replace function public.apur_admin_note_create(p_company uuid, p_competence text, p_item_id text, p_note_type text, p_note text, p_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_item text := coalesce(nullif(public.apur_txt(p_item_id), ''), '__ROW__');
  v_type text := upper(coalesce(nullif(public.apur_txt(p_note_type), ''), 'MESSAGE'));
  v_note text := public.apur_multiline(p_note, 4000);
  v_label text := 'Empresa / competência';
  v_checklist jsonb;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  ctx record;
begin
  if not public.is_admin() then raise exception 'Apenas administrador.'; end if;
  -- Reenvio da mesma nota (fila do app): não duplica.
  if p_id is not null and exists (select 1 from public.apur_admin_notes where id = p_id) then
    return jsonb_build_object('ok', true, 'id', p_id, 'duplicate', true);
  end if;
  if v_note = '' then raise exception 'Informe o texto da nota.'; end if;
  if v_type not in ('MESSAGE', 'DIRECTIVE', 'RECORD') then raise exception 'Tipo de nota inválido.'; end if;
  if not public.apur_valid_comp(p_competence) then raise exception 'Competência inválida. Use AAAA-MM.'; end if;
  select * into ctx from public.apur_company_context(p_company, p_competence);
  perform public.apur_assert_mutable(ctx.o_owner, p_competence);
  perform public.apur_ensure_snapshot(p_company, p_competence);
  if v_item <> '__ROW__' then
    select checklist into v_checklist from public.apur_snapshots where company_id = p_company and competence = p_competence;
    select public.apur_txt(e->>'label') into v_label from jsonb_array_elements(coalesce(v_checklist, '[]'::jsonb)) e where public.apur_txt(e->>'id') = v_item limit 1;
    if v_label is null then raise exception 'Item do checklist não encontrado.'; end if;
  end if;
  insert into public.apur_admin_notes (id, company_id, competence, item_id, item_label, note_type, note, active, created_by)
  values (v_id, p_company, p_competence, v_item, v_label, v_type, v_note, true, v_uid);
  perform public.apur_audit_log('CREATE', 'admin_note', v_id::text, jsonb_build_object('company_id', p_company, 'owner_user_id', ctx.o_owner, 'competence', p_competence, 'item_id', v_item, 'note_type', v_type));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Carga completa da tela (equivalente a /api/bootstrap?owner_user_id=…).
create or replace function public.apur_bootstrap(p_owner uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_admin boolean := public.is_admin();
  v_owner uuid;
  me public.profiles;
  r jsonb := '{}'::jsonb;
begin
  select * into me from public.profiles where id = v_uid;
  v_owner := case when v_admin then p_owner else v_uid end;

  r := jsonb_build_object(
    'user', public.apur_public_user(me),
    'scope_owner_user_id', v_owner,
    'users', case when v_admin then coalesce((select jsonb_agg(public.apur_public_user(p) order by p.active desc, lower(p.nome)) from public.profiles p where p.active), '[]'::jsonb)
                  else jsonb_build_array(public.apur_public_user(me)) end,
    'admin_users', case when v_admin then coalesce((select jsonb_agg(public.apur_public_user(p) order by p.active desc, lower(p.nome)) from public.profiles p), '[]'::jsonb)
                        else '[]'::jsonb end,
    'companies', coalesce((select jsonb_agg(to_jsonb(c) order by c.owner_user_id, c.display_order, lower(c.legal_name))
                  from public.apur_companies c where not c.deleted and (v_owner is null or c.owner_user_id = v_owner)), '[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(s) order by s.owner_user_id, s.competence, s.display_order, lower(s.legal_name))
                  from public.apur_snapshots s where v_owner is null or s.owner_user_id = v_owner), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(to_jsonb(x)) from public.apur_checks x
                  where exists (select 1 from public.apur_snapshots s where s.company_id = x.company_id and s.competence = x.competence and (v_owner is null or s.owner_user_id = v_owner))
                     or exists (select 1 from public.apur_companies c where c.id = x.company_id and not c.deleted and (v_owner is null or c.owner_user_id = v_owner))), '[]'::jsonb),
    'monthly_notes', coalesce((select jsonb_agg(to_jsonb(x)) from public.apur_monthly_notes x
                  where exists (select 1 from public.apur_snapshots s where s.company_id = x.company_id and s.competence = x.competence and (v_owner is null or s.owner_user_id = v_owner))
                     or exists (select 1 from public.apur_companies c where c.id = x.company_id and not c.deleted and (v_owner is null or c.owner_user_id = v_owner))), '[]'::jsonb),
    'visual_marks', coalesce((select jsonb_agg(to_jsonb(x)) from public.apur_visual_marks x
                  where exists (select 1 from public.apur_snapshots s where s.company_id = x.company_id and s.competence = x.competence and (v_owner is null or s.owner_user_id = v_owner))
                     or exists (select 1 from public.apur_companies c where c.id = x.company_id and not c.deleted and (v_owner is null or c.owner_user_id = v_owner))), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('uploaded_by_name', coalesce(u.nome, ''), 'stored_name', d.storage_path) order by d.created_at desc)
                  from public.apur_documents d join public.apur_companies co on co.id = d.company_id left join public.profiles u on u.id = d.uploaded_by
                  where not d.deleted and (v_owner is null
                    or (d.competence is null and co.owner_user_id = v_owner)
                    or (d.competence is not null and (
                          exists (select 1 from public.apur_snapshots s where s.company_id = d.company_id and s.competence = d.competence and s.owner_user_id = v_owner)
                       or (not exists (select 1 from public.apur_snapshots s0 where s0.company_id = d.company_id and s0.competence = d.competence) and co.owner_user_id = v_owner))))), '[]'::jsonb),
    'admin_notes', coalesce((select jsonb_agg(to_jsonb(n) || jsonb_build_object(
                      'owner_user_id', coalesce(cs.owner_user_id, co.owner_user_id), 'company_name', coalesce(cs.legal_name, co.legal_name),
                      'owner_name', ow.nome, 'created_by_name', cr.nome) order by n.created_at desc)
                  from public.apur_admin_notes n join public.apur_companies co on co.id = n.company_id
                  left join public.apur_snapshots cs on cs.company_id = n.company_id and cs.competence = n.competence
                  left join public.profiles ow on ow.id = coalesce(cs.owner_user_id, co.owner_user_id)
                  left join public.profiles cr on cr.id = n.created_by
                  where v_owner is null or coalesce(cs.owner_user_id, co.owner_user_id) = v_owner), '[]'::jsonb),
    'periods', coalesce((select jsonb_agg(to_jsonb(p) order by p.owner_user_id, p.competence)
                  from public.apur_periods p where v_owner is null or p.owner_user_id = v_owner), '[]'::jsonb),
    'alerts', public.apur_alert_records(v_admin),
    'security_warnings', '[]'::jsonb,
    'password_reset_requests', '[]'::jsonb
  );
  return r;
end;
$$;

revoke all on function public.apur_public_user(public.profiles) from public, anon, authenticated;
revoke all on function public.apur_alert_status(public.apur_alerts, date) from public, anon, authenticated;
revoke all on function public.apur_alert_records(boolean) from public, anon, authenticated;
revoke all on function public.apur_bootstrap(uuid) from public, anon;
grant execute on function public.apur_bootstrap(uuid) to authenticated;
revoke all on function public.apur_alerts_list() from public, anon;
grant execute on function public.apur_alerts_list() to authenticated;
revoke all on function public.apur_me() from public, anon;
grant execute on function public.apur_me() to authenticated;
revoke all on function public.apur_admin_note_create(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.apur_admin_note_create(uuid, text, text, text, text, uuid) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
