-- HUB Depto Tributário: Controle de Apuração no HUB — Etapa 5: documentos e exportação XLSX.
-- Rode no SQL Editor do Supabase depois das etapas 1, 2 e 4 (pode rodar mais de uma vez).
--
-- Documentos: arquivos no Storage do Supabase (pasta privada "apuracao-docs", até 25 MB cada).
--   O envio tem duas fases: o banco registra o documento (ainda invisível), a tela envia o arquivo
--   e o banco confirma. Só quem pode ver a empresa naquela competência baixa o arquivo.
-- Exportação: o banco monta os dados da competência; a planilha é gerada no navegador.

begin;

-- ---------------------------------------------------------------------------------------------
-- Pasta privada dos documentos
insert into storage.buckets (id, name, public, file_size_limit)
values ('apuracao-docs', 'apuracao-docs', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

alter table public.apur_documents add column if not exists pending boolean not null default false;

create or replace function public.apur_document_ext_ok(p_name text)
returns boolean language sql immutable as $$
  select lower(coalesce(substring(p_name from '(\.[^./\\]+)$'), '')) = any (array[
    '.pdf', '.xls', '.xlsx', '.doc', '.docx', '.xml', '.csv', '.txt', '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff',
    '.zip', '.rar', '.ods', '.odt', '.rtf', '.eml', '.msg', '.p7s', '.json'])
$$;

-- Mesma regra do servidor antigo (document_accessible_for_user).
create or replace function public.apur_document_can_read(d public.apur_documents)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_snap uuid; v_master uuid;
begin
  if auth.uid() is null or not public.is_active_user() then return false; end if;
  if public.is_admin() then return true; end if;
  select owner_user_id into v_master from public.apur_companies where id = d.company_id;
  if not found then return false; end if;
  if coalesce(d.competence, '') <> '' then
    select owner_user_id into v_snap from public.apur_snapshots where company_id = d.company_id and competence = d.competence;
    if found then return v_snap = auth.uid(); end if;
  end if;
  return v_master = auth.uid();
end;
$$;

-- Storage: enviar só para um documento pendente do próprio usuário; ler só documento ativo permitido;
-- apagar só o arquivo de um documento que o próprio usuário acabou de excluir.
create or replace function public.apur_storage_can_upload(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.apur_documents d
                 where d.storage_path = p_name and d.pending and d.uploaded_by = auth.uid() and d.created_at > now() - interval '2 hours')
$$;

create or replace function public.apur_storage_can_read(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.apur_documents d
                 where d.storage_path = p_name and ((not d.deleted and public.apur_document_can_read(d))
                    or (d.pending and d.uploaded_by = auth.uid())
                    -- quem acabou de excluir enxerga o arquivo só para concluir a exclusão no Storage
                    or (d.deleted and d.deleted_by = auth.uid() and d.deleted_at > now() - interval '1 hour')))
$$;

create or replace function public.apur_storage_can_delete(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.apur_documents d
                 where d.storage_path = p_name and d.deleted and (d.deleted_by = auth.uid() or (d.pending and d.uploaded_by = auth.uid())))
$$;

drop policy if exists "apur_docs_insert" on storage.objects;
create policy "apur_docs_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'apuracao-docs' and owner = auth.uid() and public.apur_storage_can_upload(name));

drop policy if exists "apur_docs_select" on storage.objects;
create policy "apur_docs_select" on storage.objects for select to authenticated
using (bucket_id = 'apuracao-docs' and public.apur_storage_can_read(name));

drop policy if exists "apur_docs_delete" on storage.objects;
create policy "apur_docs_delete" on storage.objects for delete to authenticated
using (bucket_id = 'apuracao-docs' and public.apur_storage_can_delete(name));

-- 1ª fase do envio: valida e reserva o documento (invisível até a confirmação).
create or replace function public.apur_document_begin(p_company uuid, p_competence text, p_filename text, p_mime text, p_size bigint, p_sha256 text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_comp text := nullif(public.apur_txt(p_competence), '');
  v_name text := left(btrim(regexp_replace(regexp_replace(coalesce(p_filename, ''), '^.*[\\/]', ''), '\s+', ' ', 'g')), 180);
  v_ext text;
  v_id uuid := gen_random_uuid();
  v_path text;
  ctx record;
begin
  if v_name = '' then raise exception 'Nome do arquivo invalido.'; end if;
  if not public.apur_document_ext_ok(v_name) then raise exception 'Formato de arquivo nao permitido para a biblioteca.'; end if;
  if v_comp is not null and not public.apur_valid_comp(v_comp) then raise exception 'Competencia invalida. Use AAAA-MM.'; end if;
  if coalesce(p_size, 0) <= 0 then raise exception 'Arquivo vazio.'; end if;
  if p_size > 25 * 1024 * 1024 then raise exception 'Cada documento pode ter no maximo 25 MB.'; end if;
  begin
    select * into ctx from public.apur_company_context(p_company, v_comp);
  exception when others then
    if sqlerrm = 'Sem permissão.' then raise exception 'Sem permissao.'; end if;
    raise exception 'Empresa nao encontrada.';
  end;
  if v_comp is not null then perform public.apur_assert_mutable(ctx.o_owner, v_comp); end if;
  v_ext := lower(substring(v_name from '(\.[^.]+)$'));
  v_path := p_company::text || '/' || v_id::text || v_ext;
  -- limpa reservas antigas que nunca receberam o arquivo
  delete from public.apur_documents where pending and created_at < now() - interval '1 day';
  insert into public.apur_documents (id, company_id, competence, original_name, storage_path, mime_type, size_bytes, sha256, note, uploaded_by, deleted, pending)
  values (v_id, p_company, v_comp, v_name, v_path, coalesce(nullif(left(public.apur_txt(p_mime), 120), ''), 'application/octet-stream'),
          p_size, lower(coalesce(p_sha256, '')), public.apur_multiline(p_note, 500), v_uid, true, true);
  return jsonb_build_object('id', v_id, 'storage_path', v_path, 'filename', v_name);
end;
$$;

-- 2ª fase: confere o arquivo recebido e ativa o documento.
create or replace function public.apur_document_commit(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  d public.apur_documents;
  v_size bigint;
begin
  select * into d from public.apur_documents where id = p_id and pending and uploaded_by = v_uid;
  if not found then raise exception 'Documento nao encontrado.'; end if;
  select coalesce((o.metadata->>'size')::bigint, -1) into v_size from storage.objects o where o.bucket_id = 'apuracao-docs' and o.name = d.storage_path;
  if not found then raise exception 'O arquivo não chegou ao armazenamento. Tente enviar de novo.'; end if;
  if v_size >= 0 and v_size <> d.size_bytes then raise exception 'O arquivo chegou incompleto ao armazenamento. Tente enviar de novo.'; end if;
  update public.apur_documents set pending = false, deleted = false, created_at = now() where id = p_id;
  perform public.apur_audit_log('UPLOAD', 'company_document', p_id::text, jsonb_build_object('company_id', d.company_id, 'filename', d.original_name,
    'competence', d.competence, 'size_bytes', d.size_bytes, 'sha256', d.sha256));
  return jsonb_build_object('ok', true, 'id', p_id, 'filename', d.original_name, 'size_bytes', d.size_bytes, 'sha256', d.sha256);
end;
$$;

-- Download: confere a permissão e devolve onde está o arquivo.
create or replace function public.apur_document_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d public.apur_documents;
begin
  perform public.apur_require_user();
  select * into d from public.apur_documents where id = p_id and not deleted;
  if not found then raise exception 'Documento nao encontrado.'; end if;
  if not public.apur_document_can_read(d) then raise exception 'Sem permissao.'; end if;
  return jsonb_build_object('storage_path', d.storage_path, 'original_name', d.original_name, 'mime_type', d.mime_type);
end;
$$;

-- Exclusão (como no servidor antigo: some da biblioteca e o arquivo é apagado).
create or replace function public.apur_document_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  d public.apur_documents;
  ctx record;
begin
  select * into d from public.apur_documents where id = p_id and not deleted;
  if not found then raise exception 'Documento nao encontrado.'; end if;
  if not public.apur_document_can_read(d) then raise exception 'Sem permissao.'; end if;
  if coalesce(d.competence, '') <> '' then
    select * into ctx from public.apur_company_context(d.company_id, d.competence);
    perform public.apur_assert_mutable(ctx.o_owner, d.competence);
  end if;
  update public.apur_documents set deleted = true, deleted_at = now(), deleted_by = v_uid where id = p_id;
  perform public.apur_audit_log('DELETE', 'company_document', p_id::text, jsonb_build_object('company_id', d.company_id, 'filename', d.original_name));
  return jsonb_build_object('ok', true, 'storage_path', d.storage_path);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Progresso com o mesmo arredondamento do servidor antigo (Python: metade vai para o par).
create or replace function public.apur_round_half_even(p numeric)
returns integer language sql immutable as $$
  select case when p - floor(p) = 0.5 then (case when (floor(p)::bigint % 2) = 0 then floor(p) else floor(p) + 1 end)::int
              else round(p)::int end
$$;

create or replace function public.apur_company_metrics(p_company uuid, p_comp text, p_checklist jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_statuses text[];
  v_applicable int; v_done int; v_total int;
  v_progress int;
  v_pending boolean := false; v_obs boolean := false;
  v_alert boolean; v_all_done boolean; v_started boolean; v_notes int;
  v_overall text;
begin
  select array_agg(coalesce(mc.status, 'PENDING') order by x.o)
    into v_statuses
  from jsonb_array_elements(coalesce(p_checklist, '[]'::jsonb)) with ordinality as x(item, o)
  left join public.apur_checks mc on mc.company_id = p_company and mc.competence = p_comp and mc.item_id = x.item->>'id'
  where coalesce(x.item->>'id', '') <> '';
  v_statuses := coalesce(v_statuses, '{}');
  v_total := cardinality(v_statuses);
  select count(*) filter (where s <> 'NA'), count(*) filter (where s = 'DONE') into v_applicable, v_done from unnest(v_statuses) s;
  v_progress := case when v_applicable > 0 then public.apur_round_half_even(v_done::numeric * 100 / v_applicable) when v_total > 0 then 100 else 0 end;
  select coalesce(is_pending, false), public.apur_txt(note) <> '' into v_pending, v_obs
  from public.apur_monthly_notes where company_id = p_company and competence = p_comp;
  v_pending := coalesce(v_pending, false); v_obs := coalesce(v_obs, false);
  v_alert := 'ALERT' = any(v_statuses);
  v_all_done := v_total > 0 and not exists (select 1 from unnest(v_statuses) s where s not in ('DONE', 'NA'));
  v_overall := case when v_pending or v_alert then 'ALERT' when v_all_done then 'DONE' else 'PENDING' end;
  v_started := exists (select 1 from public.apur_snapshots where company_id = p_company and competence = p_comp)
            or exists (select 1 from public.apur_checks where company_id = p_company and competence = p_comp)
            or exists (select 1 from public.apur_monthly_notes where company_id = p_company and competence = p_comp)
            or exists (select 1 from public.apur_admin_notes where company_id = p_company and competence = p_comp);
  select count(*) into v_notes from public.apur_admin_notes where company_id = p_company and competence = p_comp and active;
  return jsonb_build_object('overall', v_overall, 'progress', v_progress, 'started', v_started, 'has_pending', v_pending,
    'has_obs', v_obs, 'has_check_alert', v_alert, 'admin_notes', v_notes);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Dados da exportação XLSX (equivalente a build_monthly_export_xlsx do servidor antigo).
create or replace function public.apur_export_data(p_competence text, p_owner uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.apur_require_user();
  v_owner uuid := case when public.is_admin() then p_owner else v_uid end;
  v_comp text := public.apur_txt(p_competence);
  v_owner_name text;
  v_rows jsonb;
  v_ids uuid[];
  v_has_period boolean;
begin
  if not public.apur_valid_comp(v_comp) then raise exception 'Competencia invalida. Use AAAA-MM.'; end if;
  if v_owner is not null then
    select nome into v_owner_name from public.profiles where id = v_owner;
    if not found then raise exception 'Responsavel nao encontrado.'; end if;
    if not public.apur_active_owner(v_owner) then raise exception 'Responsavel nao encontrado ou inativo.'; end if;
  end if;

  -- Empresas: fotografia do mês quando a competência existe; senão, o cadastro atual.
  with comp_rows as (
    select s.company_id as id, s.owner_user_id, s.legal_name, s.cnpj, s.dominio_code, s.tax_regime, s.envio, s.particularities, s.notes,
           s.checklist, s.display_order, s.updated_at
    from public.apur_snapshots s
    where s.competence = v_comp
      and exists (select 1 from public.apur_periods p where p.owner_user_id = s.owner_user_id and p.competence = v_comp)
      and (v_owner is null or s.owner_user_id = v_owner)
    union all
    select c.id, c.owner_user_id, c.legal_name, c.cnpj, c.dominio_code, c.tax_regime, c.envio, c.particularities, c.notes,
           c.checklist, c.display_order, c.updated_at
    from public.apur_companies c
    where not c.deleted and (v_owner is null or c.owner_user_id = v_owner)
      and not exists (select 1 from public.apur_periods p where p.owner_user_id = c.owner_user_id and p.competence = v_comp)
  )
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
           'owner_name', coalesce(u.nome, r.owner_user_id::text),
           'metrics', public.apur_company_metrics(r.id, v_comp, r.checklist))
         order by r.owner_user_id::text, r.display_order, lower(r.legal_name)), '[]'::jsonb),
         array_agg(r.id)
    into v_rows, v_ids
  from comp_rows r left join public.profiles u on u.id = r.owner_user_id;

  if jsonb_array_length(v_rows) = 0 then raise exception 'Nao ha empresas para exportar neste escopo.'; end if;

  return jsonb_build_object(
    'competence', v_comp,
    'owner_label', case when v_owner is not null then v_owner_name else 'Todos os usuários' end,
    'scoped', v_owner is not null,
    'exported_by', (select nome from public.profiles where id = v_uid),
    'is_admin', public.is_admin(),
    'companies', v_rows,
    'checks', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('updated_by_name', coalesce(u.nome, '')))
                        from public.apur_checks x left join public.profiles u on u.id = x.updated_by
                        where x.competence = v_comp and x.company_id = any(v_ids)), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(to_jsonb(x)) from public.apur_monthly_notes x where x.competence = v_comp and x.company_id = any(v_ids)), '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(to_jsonb(x)) from public.apur_visual_marks x where x.competence = v_comp and x.company_id = any(v_ids)), '[]'::jsonb),
    'admin_notes', coalesce((select jsonb_agg(to_jsonb(n) || jsonb_build_object('company_name', co.legal_name, 'owner_name', ow.nome,
                               'created_by_name', cr.nome, 'archived_by_name', ar.nome) order by n.created_at)
                        from public.apur_admin_notes n join public.apur_companies co on co.id = n.company_id
                        left join public.profiles ow on ow.id = co.owner_user_id left join public.profiles cr on cr.id = n.created_by
                        left join public.profiles ar on ar.id = n.archived_by
                        where n.competence = v_comp and n.company_id = any(v_ids)), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('company_name', co.legal_name, 'owner_name', ow.nome, 'uploaded_by_name', u.nome)
                               order by lower(co.legal_name), d.created_at)
                        from public.apur_documents d join public.apur_companies co on co.id = d.company_id
                        left join public.profiles ow on ow.id = co.owner_user_id left join public.profiles u on u.id = d.uploaded_by
                        where not d.deleted and d.company_id = any(v_ids) and (coalesce(d.competence, '') = '' or d.competence = v_comp)), '[]'::jsonb),
    -- como no servidor antigo: todos os alertas em vigor, sem filtro de público
    'alerts', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(public.apur_alert_records(true)) with ordinality as t(x, o)
                        where x->>'status' = 'ACTIVE'), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
revoke all on function public.apur_document_ext_ok(text) from public, anon, authenticated;
revoke all on function public.apur_document_can_read(public.apur_documents) from public, anon, authenticated;
revoke all on function public.apur_round_half_even(numeric) from public, anon, authenticated;
revoke all on function public.apur_company_metrics(uuid, text, jsonb) from public, anon, authenticated;
-- usadas pelas regras do Storage (precisam ser executáveis por usuários logados)
revoke all on function public.apur_storage_can_upload(text) from public, anon;
revoke all on function public.apur_storage_can_read(text) from public, anon;
revoke all on function public.apur_storage_can_delete(text) from public, anon;
grant execute on function public.apur_storage_can_upload(text) to authenticated;
grant execute on function public.apur_storage_can_read(text) to authenticated;
grant execute on function public.apur_storage_can_delete(text) to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'apur_document_begin(uuid, text, text, text, bigint, text, text)', 'apur_document_commit(uuid)', 'apur_document_get(uuid)',
    'apur_document_delete(uuid)', 'apur_export_data(text, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
