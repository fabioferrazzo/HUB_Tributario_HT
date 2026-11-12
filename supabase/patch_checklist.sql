-- HUB Depto Tributário: Checklist no HUB (pessoal, com opção de compartilhar)
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez).
-- Regras:
--   - Cada usuário vê os próprios checklists. Ninguém mais vê, nem administradores.
--   - O dono pode compartilhar um checklist com colegas escolhidos ou com toda a equipe;
--     quem recebe pode editar as tarefas, marcar, anexar e excluir tarefas.
--   - Só o dono renomeia o compartilhamento, arquiva/reabre e exclui o checklist.
--   - Anexos ficam no bucket privado "hub-checklist", na pasta do checklist.
-- As tabelas não são acessadas diretamente: tudo passa pelas funções chk_* abaixo.

begin;

-- ---------------------------------------------------------------------------------------------
-- Tabelas

create table if not exists public.chk_listas (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{4,80}$'),
  dono uuid not null references public.profiles(id),
  titulo text not null default 'Sem título' check (length(titulo) <= 180),
  dados jsonb not null default '{}'::jsonb,
  compartilhar_todos boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles(id),
  arquivado_em timestamptz,
  versao integer not null default 1
);
create index if not exists chk_listas_dono_idx on public.chk_listas (dono);

create table if not exists public.chk_compartilhamentos (
  lista_id text not null references public.chk_listas(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  criado_em timestamptz not null default now(),
  primary key (lista_id, user_id)
);
create index if not exists chk_compartilhamentos_user_idx on public.chk_compartilhamentos (user_id);

create table if not exists public.chk_anexos (
  id text primary key check (id ~ '^[A-Za-z0-9_:.-]{4,200}$'),
  lista_id text not null references public.chk_listas(id) on delete cascade,
  item_id text not null,
  tipo_anexo text not null default 'arquivo' check (tipo_anexo in ('arquivo', 'print')),
  slot integer check (slot is null or slot between 1 and 4),
  nome text not null,
  tipo text not null default '',
  tamanho bigint not null default 0,
  caminho text not null unique,
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now()
);
create index if not exists chk_anexos_lista_idx on public.chk_anexos (lista_id);

do $$
declare t text;
begin
  foreach t in array array['chk_listas', 'chk_compartilhamentos', 'chk_anexos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Utilidades

-- Quem está chamando (exige usuário ativo no HUB).
create or replace function public.chk_eu()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Sessão inválida ou usuário inativo.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- O usuário logado pode ver/editar o checklist? (dono, compartilhado com ele ou com a equipe)
create or replace function public.chk_pode_ver(p_lista text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.is_active_user() and exists (
    select 1 from public.chk_listas l
    where l.id = p_lista
      and (l.dono = auth.uid()
           or l.compartilhar_todos
           or exists (select 1 from public.chk_compartilhamentos c where c.lista_id = l.id and c.user_id = auth.uid()))
  )
$$;

-- Para as regras do armazenamento: o primeiro trecho do caminho é o id do checklist.
create or replace function public.chk_storage_pode(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.chk_pode_ver(split_part(coalesce(p_nome, ''), '/', 1))
$$;

create or replace function public.chk_exigir_acesso(p_lista text)
returns public.chk_listas language plpgsql security definer set search_path = public as $$
declare v public.chk_listas;
begin
  perform public.chk_eu();
  select * into v from public.chk_listas where id = p_lista;
  if v.id is null or not public.chk_pode_ver(p_lista) then
    raise exception 'Checklist não encontrado ou sem acesso.' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function public.chk_exigir_dono(p_lista text)
returns public.chk_listas language plpgsql security definer set search_path = public as $$
declare v public.chk_listas := public.chk_exigir_acesso(p_lista);
begin
  if v.dono <> auth.uid() then
    raise exception 'Somente quem criou o checklist pode fazer isso.' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function public.chk_nome(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nome from public.profiles where id = p), '')
$$;

create or replace function public.chk_lista_json(l public.chk_listas)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'titulo', l.titulo, 'dados', l.dados, 'versao', l.versao,
    'criado_em', l.criado_em, 'atualizado_em', l.atualizado_em, 'arquivado_em', l.arquivado_em,
    'atualizado_por', public.chk_nome(l.atualizado_por),
    'dono', jsonb_build_object('id', l.dono, 'nome', public.chk_nome(l.dono)),
    'sou_dono', l.dono = auth.uid(),
    'compartilhar_todos', l.compartilhar_todos,
    'compartilhado_com', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.user_id, 'nome', public.chk_nome(c.user_id)) order by public.chk_nome(c.user_id))
      from public.chk_compartilhamentos c where c.lista_id = l.id), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Leitura

create or replace function public.chk_dados()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_eu uuid := public.chk_eu();
begin
  return jsonb_build_object(
    'me', jsonb_build_object('id', v_eu, 'nome', public.chk_nome(v_eu)),
    'usuarios', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome) order by lower(p.nome), p.id)
      from public.profiles p where public.profile_is_active(p) and p.id <> v_eu), '[]'::jsonb),
    'listas', coalesce((
      select jsonb_agg(public.chk_lista_json(l) order by l.atualizado_em desc)
      from public.chk_listas l where public.chk_pode_ver(l.id)), '[]'::jsonb),
    'anexos', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'lista_id', a.lista_id, 'item_id', a.item_id, 'tipo_anexo', a.tipo_anexo,
               'slot', a.slot, 'nome', a.nome, 'tipo', a.tipo, 'tamanho', a.tamanho, 'caminho', a.caminho, 'criado_em', a.criado_em) order by a.criado_em)
      from public.chk_anexos a where public.chk_pode_ver(a.lista_id)), '[]'::jsonb),
    'versoes', public.chk_versoes()
  );
end;
$$;

-- Versões atuais (para a tela saber se alguém alterou algo, sem baixar tudo).
create or replace function public.chk_versoes()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_eu uuid := public.chk_eu();
begin
  return coalesce((
    select jsonb_object_agg(l.id, l.versao::text
                                  || ':' || (select count(*)::text || '/' || coalesce(max(extract(epoch from a.criado_em))::text, '')
                                             from public.chk_anexos a where a.lista_id = l.id)
                                  || ':' || l.compartilhar_todos::text
                                  || ':' || coalesce((select string_agg(c.user_id::text, ',' order by c.user_id) from public.chk_compartilhamentos c where c.lista_id = l.id), ''))
    from public.chk_listas l where public.chk_pode_ver(l.id)), '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Gravação

-- p: {id, titulo, dados, versao (a que a tela tinha; null para checklist novo), arquivado (true/false)}
-- Se a versão não for a atual (outra pessoa gravou antes), devolve {conflito: true} sem gravar.
create or replace function public.chk_lista_salvar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := public.chk_eu();
  v_id text := coalesce(p->>'id', '');
  v_titulo text := left(coalesce(nullif(trim(p->>'titulo'), ''), 'Sem título'), 180);
  v_dados jsonb := coalesce(p->'dados', '{}'::jsonb);
  v_atual public.chk_listas;
  v_arquivar boolean := case when p ? 'arquivado' then coalesce((p->>'arquivado')::boolean, false) else null end;
begin
  if v_id !~ '^[A-Za-z0-9_-]{4,80}$' then raise exception 'Identificador de checklist inválido.'; end if;
  if jsonb_typeof(v_dados) <> 'object' then raise exception 'Dados do checklist inválidos.'; end if;
  if jsonb_typeof(coalesce(v_dados->'items', '[]'::jsonb)) <> 'array' then raise exception 'Tarefas do checklist inválidas.'; end if;
  if jsonb_array_length(coalesce(v_dados->'items', '[]'::jsonb)) > 1000 then raise exception 'O checklist passou do limite de 1000 tarefas.'; end if;
  if octet_length(v_dados::text) > 2000000 then raise exception 'O checklist ficou grande demais (limite de 2 MB de texto).'; end if;

  select * into v_atual from public.chk_listas where id = v_id for update;

  if v_atual.id is null then
    insert into public.chk_listas (id, dono, titulo, dados, atualizado_por, arquivado_em)
    values (v_id, v_eu, v_titulo, v_dados, v_eu, case when v_arquivar then now() end)
    returning * into v_atual;
    return public.chk_lista_json(v_atual);
  end if;

  if not public.chk_pode_ver(v_id) then
    raise exception 'Checklist não encontrado ou sem acesso.' using errcode = '42501';
  end if;
  if p->>'versao' is not null and (p->>'versao')::int <> v_atual.versao then
    -- Alguém gravou antes: a tela junta as alterações e tenta de novo.
    return jsonb_build_object('conflito', true, 'versao', v_atual.versao);
  end if;
  if v_arquivar is not null and v_arquivar <> (v_atual.arquivado_em is not null) and v_atual.dono <> v_eu then
    raise exception 'Somente quem criou o checklist pode arquivar ou reabrir.' using errcode = '42501';
  end if;

  update public.chk_listas set
    titulo = v_titulo,
    dados = v_dados,
    arquivado_em = case
      when v_arquivar is null then arquivado_em
      when v_arquivar then coalesce(arquivado_em, now())
      else null end,
    atualizado_em = now(),
    atualizado_por = v_eu,
    versao = versao + 1
  where id = v_id
  returning * into v_atual;
  return public.chk_lista_json(v_atual);
end;
$$;

-- Exclui o checklist (só o dono). Devolve os caminhos dos anexos para a tela apagar os arquivos.
create or replace function public.chk_lista_excluir(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.chk_listas := public.chk_exigir_dono(p_id);
  v_caminhos jsonb;
begin
  select coalesce(jsonb_agg(caminho), '[]'::jsonb) into v_caminhos from public.chk_anexos where lista_id = p_id;
  delete from public.chk_listas where id = p_id;
  return jsonb_build_object('ok', true, 'caminhos', v_caminhos);
end;
$$;

-- Compartilhamento (só o dono): toda a equipe e/ou colegas escolhidos.
create or replace function public.chk_compartilhar(p_id text, p_todos boolean, p_usuarios uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.chk_listas := public.chk_exigir_dono(p_id);
begin
  update public.chk_listas set compartilhar_todos = coalesce(p_todos, false) where id = p_id;
  delete from public.chk_compartilhamentos where lista_id = p_id;
  insert into public.chk_compartilhamentos (lista_id, user_id)
  select p_id, u from (select distinct unnest(coalesce(p_usuarios, '{}'::uuid[])) as u) x
  where u <> v.dono and exists (select 1 from public.profiles p where p.id = x.u and public.profile_is_active(p));
  select * into v from public.chk_listas where id = p_id;
  return public.chk_lista_json(v);
end;
$$;

-- Quem recebeu um checklist pode sair do compartilhamento.
create or replace function public.chk_sair(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.chk_listas := public.chk_exigir_acesso(p_id);
begin
  if v.dono = auth.uid() then raise exception 'Você é quem criou este checklist; para tirá-lo da lista, exclua-o.'; end if;
  if v.compartilhar_todos then raise exception 'Este checklist está compartilhado com toda a equipe; só quem o criou pode mudar isso.'; end if;
  delete from public.chk_compartilhamentos where lista_id = p_id and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- Anexos: a tela envia o arquivo ao armazenamento e registra aqui.
-- Se já houver um anexo com o mesmo id (print substituído), devolve o caminho antigo para apagar.
create or replace function public.chk_anexo_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lista text := coalesce(p->>'lista_id', '');
  v public.chk_listas := public.chk_exigir_acesso(v_lista);
  v_id text := coalesce(p->>'id', '');
  v_caminho text := coalesce(p->>'caminho', '');
  v_tipo_anexo text := coalesce(nullif(p->>'tipo_anexo', ''), 'arquivo');
  v_antigo text;
begin
  if v_id !~ '^[A-Za-z0-9_:.-]{4,200}$' then raise exception 'Identificador de anexo inválido.'; end if;
  if left(v_caminho, length(v_lista) + 1) <> v_lista || '/' or v_caminho like '%..%' then raise exception 'Caminho de anexo inválido.'; end if;
  if v_tipo_anexo not in ('arquivo', 'print') then raise exception 'Tipo de anexo inválido.'; end if;
  select caminho into v_antigo from public.chk_anexos where id = v_id;
  if v_antigo is not null and not exists (select 1 from public.chk_anexos where id = v_id and lista_id = v_lista) then
    raise exception 'Identificador de anexo já usado em outro checklist.';
  end if;
  insert into public.chk_anexos (id, lista_id, item_id, tipo_anexo, slot, nome, tipo, tamanho, caminho, criado_por)
  values (v_id, v_lista, left(coalesce(p->>'item_id', ''), 200), v_tipo_anexo, nullif(p->>'slot', '')::int,
          left(coalesce(nullif(p->>'nome', ''), 'arquivo'), 200), left(coalesce(p->>'tipo', ''), 120),
          greatest(coalesce((p->>'tamanho')::bigint, 0), 0), v_caminho, auth.uid())
  on conflict (id) do update set
    item_id = excluded.item_id, tipo_anexo = excluded.tipo_anexo, slot = excluded.slot, nome = excluded.nome,
    tipo = excluded.tipo, tamanho = excluded.tamanho, caminho = excluded.caminho, criado_por = excluded.criado_por, criado_em = now();
  return jsonb_build_object('ok', true, 'caminho_antigo', case when v_antigo is distinct from v_caminho then v_antigo end);
end;
$$;

-- Exclui anexos por id e/ou todos os de uma tarefa. Devolve os caminhos para a tela apagar os arquivos.
create or replace function public.chk_anexos_excluir(p_lista text, p_ids text[], p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.chk_listas := public.chk_exigir_acesso(p_lista);
  v_caminhos jsonb;
begin
  with apagados as (
    delete from public.chk_anexos
    where lista_id = p_lista
      and ((p_ids is not null and id = any(p_ids)) or (p_item is not null and item_id = p_item))
    returning caminho
  )
  select coalesce(jsonb_agg(caminho), '[]'::jsonb) into v_caminhos from apagados;
  return jsonb_build_object('ok', true, 'caminhos', v_caminhos);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Armazenamento dos anexos (bucket privado, 15 MB por arquivo)

insert into storage.buckets (id, name, public, file_size_limit)
values ('hub-checklist', 'hub-checklist', false, 15728640)
on conflict (id) do update set public = false, file_size_limit = 15728640;

drop policy if exists "hub_checklist_select" on storage.objects;
create policy "hub_checklist_select"
on storage.objects for select
to authenticated
using (bucket_id = 'hub-checklist' and public.chk_storage_pode(name));

drop policy if exists "hub_checklist_insert" on storage.objects;
create policy "hub_checklist_insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'hub-checklist' and owner = auth.uid() and public.chk_storage_pode(name));

drop policy if exists "hub_checklist_delete" on storage.objects;
create policy "hub_checklist_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'hub-checklist' and (owner = auth.uid() or public.chk_storage_pode(name)));

-- ---------------------------------------------------------------------------------------------
-- Permissões: só as funções chamadas pela tela (e as das regras do armazenamento) ficam abertas.

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'chk\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'chk_dados()', 'chk_versoes()', 'chk_lista_salvar(jsonb)', 'chk_lista_excluir(text)', 'chk_compartilhar(text, boolean, uuid[])',
    'chk_sair(text)', 'chk_anexo_registrar(jsonb)', 'chk_anexos_excluir(text, text[], text)',
    'chk_pode_ver(text)', 'chk_storage_pode(text)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
