-- HUB Depto Tributário: Onboarding no HUB — ambiente contratual (Contrato, Adendo, matriz, itens, checklist e declaração).
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez).
-- O conteúdo contratual vem com o app (texto da versão 1.4 do Adendo). Aqui fica só a ordem geral do checklist,
-- que todos os usuários ativos leem e somente administradores alteram. Clientes, portal e pacotes continuam no
-- Onboarding do servidor do escritório (HTSERVER).

begin;

create table if not exists public.onb_config (
  chave text primary key check (length(chave) between 1 and 80),
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles(id) on delete set null
);
alter table public.onb_config enable row level security;
revoke all on table public.onb_config from anon, authenticated;

-- Papel no Onboarding: 'admin' (administrador do HUB) ou 'leitor' (demais usuários ativos).
create or replace function public.onb_papel()
returns text language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null or not public.is_active_user() then return null; end if;
  select to_jsonb(p)->>'role' into v_role from public.profiles p where p.id = auth.uid();
  return case when v_role = 'admin' then 'admin' else 'leitor' end;
end;
$$;

-- Sessão: papel, nome, e-mail e a ordem do checklist salva pelo escritório ({} = ordem padrão).
create or replace function public.onb_sessao()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_papel text := public.onb_papel(); v_nome text; v_email text;
begin
  if v_papel is null then raise exception 'Sessão inválida ou usuário inativo.' using errcode = '42501'; end if;
  select p.nome, p.email into v_nome, v_email from public.profiles p where p.id = auth.uid();
  return jsonb_build_object('id', auth.uid(), 'papel', v_papel, 'nome', coalesce(v_nome, ''), 'email', coalesce(v_email, ''),
    'checklist_order', coalesce((select valor from public.onb_config where chave = 'contract_checklist_order'), '{}'::jsonb));
end;
$$;

-- Nova ordem geral do checklist (como save_contract_checklist_order do Onboarding): só administradores.
-- p: {"important": [ids...], "other": [ids...]}
create or replace function public.onb_checklist_ordem_salvar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_papel text := public.onb_papel();
  g text;
  x jsonb;
  v_id text;
  v_vistos text[] := '{}';
  v_saida jsonb := '{}'::jsonb;
  v_lista jsonb;
begin
  if v_papel is null then raise exception 'Sessão inválida ou usuário inativo.' using errcode = '42501'; end if;
  if v_papel <> 'admin' then raise exception 'Somente o administrador pode reorganizar o checklist.' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'A ordem do checklist é inválida.'; end if;
  foreach g in array array['important', 'other'] loop
    if jsonb_typeof(p->g) is distinct from 'array' then
      raise exception 'A ordem deve informar os grupos importantes e demais itens.';
    end if;
    v_lista := '[]'::jsonb;
    for x in select * from jsonb_array_elements(p->g) loop
      v_id := btrim(coalesce(x #>> '{}', ''));
      if v_id = '' or length(v_id) > 100 or v_id !~ '^[A-Za-z0-9._:-]+$' then
        raise exception 'A ordem contém um identificador de item inválido.';
      end if;
      if v_id = any(v_vistos) then raise exception 'A ordem do checklist contém itens duplicados.'; end if;
      v_vistos := v_vistos || v_id;
      v_lista := v_lista || to_jsonb(v_id);
    end loop;
    v_saida := v_saida || jsonb_build_object(g, v_lista);
  end loop;
  if coalesce(array_length(v_vistos, 1), 0) > 500 then raise exception 'A ordem do checklist excede o limite permitido.'; end if;
  insert into public.onb_config (chave, valor, atualizado_em, atualizado_por)
  values ('contract_checklist_order', v_saida, now(), auth.uid())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por;
  if to_regprocedure('public.hub_hist_registrar(text,text,text,text,jsonb)') is not null then
    perform public.hub_hist_registrar('Onboarding', 'Reorganizou o checklist', 'contract_checklist', 'Checklist do Adendo',
      jsonb_build_object('itens_importantes', jsonb_array_length(v_saida->'important'), 'demais_itens', jsonb_array_length(v_saida->'other')));
  end if;
  return jsonb_build_object('checklist_order', v_saida);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'onb\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

grant execute on function public.onb_sessao() to authenticated;
grant execute on function public.onb_checklist_ordem_salvar(jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
