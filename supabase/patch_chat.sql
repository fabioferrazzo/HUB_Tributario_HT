-- HUB Depto Tributário — Chat entre usuários (conversas individuais e grupos).
-- Pode ser executado mais de uma vez. Não apaga dados.
--
-- Regras:
--   • Cada pessoa (inclusive administradores) só vê as conversas de que participa.
--   • Conversa individual: uma por par de usuários. Grupo: qualquer usuário cria; quem criou
--     adiciona/remove membros e renomeia; qualquer membro pode sair.
--   • Mensagens com texto formatado e anexos (até 10 MB cada, no bucket privado hub-anexos/chat/).
--   • "Chamar atenção": no máximo 3 seguidas por pessoa em cada conversa; depois, 30 minutos bloqueado.
--   • As mensagens ficam guardadas por 30 dias (a limpeza diária roda na Netlify: chat-limpeza).
--   • Gravação só pelas funções abaixo; leitura direta só do que a pessoa participa.

begin;

-- Tabelas -----------------------------------------------------------------------------------------
create table if not exists public.chat_conversas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('direta', 'grupo')),
  nome text not null default '',
  chave_direta text unique,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  ultima_mensagem_em timestamptz not null default now()
);

create table if not exists public.chat_participantes (
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  papel text not null default 'membro' check (papel in ('membro', 'dono')),
  lido_ate timestamptz not null default now(),
  entrou_em timestamptz not null default now(),
  primary key (conversa_id, user_id)
);

create index if not exists chat_participantes_user_idx on public.chat_participantes (user_id);

create table if not exists public.chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  autor_nome text not null default '',
  conteudo text not null default '' check (char_length(conteudo) <= 20000),
  anexos jsonb not null default '[]'::jsonb,
  tipo text not null default 'texto' check (tipo in ('texto', 'sistema', 'atencao')),
  created_at timestamptz not null default now()
);

create index if not exists chat_mensagens_conversa_idx on public.chat_mensagens (conversa_id, created_at);
create index if not exists chat_mensagens_created_idx on public.chat_mensagens (created_at);

create table if not exists public.chat_chamados (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  remetente_id uuid references public.profiles(id) on delete cascade,
  remetente_nome text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists chat_chamados_idx on public.chat_chamados (conversa_id, remetente_id, created_at desc);

-- Participação (usada nas regras de leitura) -------------------------------------------------------
create or replace function public.chat_participa(p_conversa uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_participantes cp
    where cp.conversa_id = p_conversa and cp.user_id = auth.uid()
  );
$$;

create or replace function public.chat_participa_texto(p_conversa text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.chat_participa(p_conversa::uuid);
exception when others then
  return false;
end;
$$;

revoke all on function public.chat_participa(uuid) from public, anon;
revoke all on function public.chat_participa_texto(text) from public, anon;
grant execute on function public.chat_participa(uuid) to authenticated, service_role;
grant execute on function public.chat_participa_texto(text) to authenticated, service_role;

alter table public.chat_conversas enable row level security;
alter table public.chat_participantes enable row level security;
alter table public.chat_mensagens enable row level security;
alter table public.chat_chamados enable row level security;

revoke all on public.chat_conversas, public.chat_participantes, public.chat_mensagens, public.chat_chamados from public, anon, authenticated;
grant select on public.chat_conversas, public.chat_participantes, public.chat_mensagens, public.chat_chamados to authenticated;
grant all on public.chat_conversas, public.chat_participantes, public.chat_mensagens, public.chat_chamados to service_role;

drop policy if exists chat_conversas_select on public.chat_conversas;
create policy chat_conversas_select on public.chat_conversas for select to authenticated
  using (public.chat_participa(id));

drop policy if exists chat_participantes_select on public.chat_participantes;
create policy chat_participantes_select on public.chat_participantes for select to authenticated
  using (public.chat_participa(conversa_id));

drop policy if exists chat_mensagens_select on public.chat_mensagens;
create policy chat_mensagens_select on public.chat_mensagens for select to authenticated
  using (public.chat_participa(conversa_id));

drop policy if exists chat_chamados_select on public.chat_chamados;
create policy chat_chamados_select on public.chat_chamados for select to authenticated
  using (public.chat_participa(conversa_id));

-- Auxiliares ------------------------------------------------------------------------------------
create or replace function public.chat_nome_usuario(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(p.nome), ''), split_part(p.email, '@', 1), 'Usuário')
  from public.profiles p where p.id = p_user;
$$;

revoke all on function public.chat_nome_usuario(uuid) from public, anon, authenticated;

create or replace function public.chat_exigir_usuario()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

revoke all on function public.chat_exigir_usuario() from public, anon, authenticated;

create or replace function public.chat_exigir_participante(p_conversa uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.chat_participa(p_conversa) then
    raise exception 'Você não participa desta conversa.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.chat_exigir_participante(uuid) from public, anon, authenticated;

create or replace function public.chat_mensagem_sistema(p_conversa uuid, p_texto text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.chat_mensagens (conversa_id, autor_id, autor_nome, conteudo, tipo)
  values (p_conversa, null, '', p_texto, 'sistema');
$$;

revoke all on function public.chat_mensagem_sistema(uuid, text) from public, anon, authenticated;

-- Conversa individual (abre a existente ou cria) ------------------------------------------------
create or replace function public.chat_abrir_direta(p_outro uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu uuid := public.chat_exigir_usuario();
  v_chave text;
  v_id uuid;
begin
  if p_outro is null or p_outro = v_eu then
    raise exception 'Escolha outra pessoa para conversar.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_outro and public.profile_is_active(p)) then
    raise exception 'Usuário não encontrado ou desativado.';
  end if;

  v_chave := least(v_eu::text, p_outro::text) || ':' || greatest(v_eu::text, p_outro::text);
  select id into v_id from public.chat_conversas where chave_direta = v_chave;

  if v_id is null then
    insert into public.chat_conversas (tipo, chave_direta, criado_por)
    values ('direta', v_chave, v_eu)
    on conflict (chave_direta) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.chat_conversas where chave_direta = v_chave;
    end if;
  end if;

  insert into public.chat_participantes (conversa_id, user_id, papel)
  values (v_id, v_eu, 'membro'), (v_id, p_outro, 'membro')
  on conflict (conversa_id, user_id) do nothing;

  return v_id;
end;
$$;

-- Grupos ----------------------------------------------------------------------------------------
create or replace function public.chat_criar_grupo(p_nome text, p_membros uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu uuid := public.chat_exigir_usuario();
  v_nome text := trim(coalesce(p_nome, ''));
  v_id uuid;
begin
  if v_nome = '' then
    raise exception 'Dê um nome ao grupo.';
  end if;
  if char_length(v_nome) > 80 then
    raise exception 'O nome do grupo pode ter até 80 caracteres.';
  end if;

  insert into public.chat_conversas (tipo, nome, criado_por) values ('grupo', v_nome, v_eu) returning id into v_id;
  insert into public.chat_participantes (conversa_id, user_id, papel) values (v_id, v_eu, 'dono');
  insert into public.chat_participantes (conversa_id, user_id, papel)
  select v_id, p.id, 'membro'
  from public.profiles p
  where p.id = any(coalesce(p_membros, '{}')) and p.id <> v_eu and public.profile_is_active(p)
  on conflict do nothing;

  perform public.chat_mensagem_sistema(v_id, public.chat_nome_usuario(v_eu) || ' criou o grupo "' || v_nome || '".');
  return v_id;
end;
$$;

create or replace function public.chat_grupo_alterar(p_conversa uuid, p_nome text, p_adicionar uuid[], p_remover uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu uuid := public.chat_exigir_usuario();
  v_nome text := trim(coalesce(p_nome, ''));
  v_atual text;
  r record;
begin
  if not exists (
    select 1 from public.chat_participantes cp
    join public.chat_conversas c on c.id = cp.conversa_id
    where cp.conversa_id = p_conversa and cp.user_id = v_eu and cp.papel = 'dono' and c.tipo = 'grupo'
  ) then
    raise exception 'Só quem criou o grupo pode alterá-lo.' using errcode = '42501';
  end if;

  select nome into v_atual from public.chat_conversas where id = p_conversa;
  if v_nome <> '' and v_nome <> v_atual then
    if char_length(v_nome) > 80 then
      raise exception 'O nome do grupo pode ter até 80 caracteres.';
    end if;
    update public.chat_conversas set nome = v_nome where id = p_conversa;
    perform public.chat_mensagem_sistema(p_conversa, public.chat_nome_usuario(v_eu) || ' renomeou o grupo para "' || v_nome || '".');
  end if;

  for r in
    select p.id from public.profiles p
    where p.id = any(coalesce(p_adicionar, '{}')) and public.profile_is_active(p)
      and not exists (select 1 from public.chat_participantes cp where cp.conversa_id = p_conversa and cp.user_id = p.id)
  loop
    insert into public.chat_participantes (conversa_id, user_id, papel) values (p_conversa, r.id, 'membro');
    perform public.chat_mensagem_sistema(p_conversa, public.chat_nome_usuario(v_eu) || ' adicionou ' || public.chat_nome_usuario(r.id) || '.');
  end loop;

  for r in
    select cp.user_id from public.chat_participantes cp
    where cp.conversa_id = p_conversa and cp.user_id = any(coalesce(p_remover, '{}')) and cp.user_id <> v_eu
  loop
    delete from public.chat_participantes where conversa_id = p_conversa and user_id = r.user_id;
    perform public.chat_mensagem_sistema(p_conversa, public.chat_nome_usuario(v_eu) || ' removeu ' || public.chat_nome_usuario(r.user_id) || '.');
  end loop;
end;
$$;

create or replace function public.chat_sair_grupo(p_conversa uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu uuid := public.chat_exigir_usuario();
  v_era_dono boolean;
  v_novo uuid;
begin
  select cp.papel = 'dono' into v_era_dono
  from public.chat_participantes cp join public.chat_conversas c on c.id = cp.conversa_id
  where cp.conversa_id = p_conversa and cp.user_id = v_eu and c.tipo = 'grupo';
  if v_era_dono is null then
    raise exception 'Você não participa deste grupo.';
  end if;

  delete from public.chat_participantes where conversa_id = p_conversa and user_id = v_eu;
  perform public.chat_mensagem_sistema(p_conversa, public.chat_nome_usuario(v_eu) || ' saiu do grupo.');

  -- Grupo sem dono passa para o membro mais antigo; grupo vazio é apagado.
  if v_era_dono then
    select user_id into v_novo from public.chat_participantes where conversa_id = p_conversa order by entrou_em limit 1;
    if v_novo is null then
      delete from public.chat_conversas where id = p_conversa;
    else
      update public.chat_participantes set papel = 'dono' where conversa_id = p_conversa and user_id = v_novo;
    end if;
  end if;
end;
$$;

-- Mensagens -------------------------------------------------------------------------------------
create or replace function public.chat_enviar(p_conversa uuid, p_conteudo text, p_anexos jsonb default '[]'::jsonb)
returns public.chat_mensagens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu uuid := public.chat_exigir_usuario();
  v_texto text := coalesce(p_conteudo, '');
  v_anexos jsonb := coalesce(p_anexos, '[]'::jsonb);
  v_row public.chat_mensagens;
  a jsonb;
begin
  perform public.chat_exigir_participante(p_conversa);
  if jsonb_typeof(v_anexos) <> 'array' or jsonb_array_length(v_anexos) > 10 then
    raise exception 'Anexos inválidos (máximo de 10 por mensagem).';
  end if;
  for a in select * from jsonb_array_elements(v_anexos) loop
    if coalesce(a->>'path', '') not like 'chat/' || p_conversa::text || '/%' then
      raise exception 'Anexo fora desta conversa.';
    end if;
  end loop;
  if btrim(regexp_replace(v_texto, '<[^>]*>|&nbsp;', '', 'g')) = '' and jsonb_array_length(v_anexos) = 0 then
    raise exception 'Escreva a mensagem ou anexe um arquivo.';
  end if;
  if char_length(v_texto) > 20000 then
    raise exception 'A mensagem é longa demais.';
  end if;

  insert into public.chat_mensagens (conversa_id, autor_id, autor_nome, conteudo, anexos)
  values (p_conversa, v_eu, public.chat_nome_usuario(v_eu), v_texto, v_anexos)
  returning * into v_row;

  update public.chat_conversas set ultima_mensagem_em = v_row.created_at where id = p_conversa;
  update public.chat_participantes set lido_ate = v_row.created_at where conversa_id = p_conversa and user_id = v_eu;
  return v_row;
end;
$$;

create or replace function public.chat_excluir_mensagem(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu uuid := public.chat_exigir_usuario();
  v_row public.chat_mensagens;
begin
  select * into v_row from public.chat_mensagens where id = p_id;
  if not found then
    return '[]'::jsonb;
  end if;
  if v_row.autor_id is distinct from v_eu then
    raise exception 'Só quem escreveu pode apagar a mensagem.' using errcode = '42501';
  end if;
  delete from public.chat_mensagens where id = p_id;
  -- Devolve os anexos para o aplicativo apagar os arquivos.
  return v_row.anexos;
end;
$$;

create or replace function public.chat_marcar_lido(p_conversa uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.chat_exigir_usuario();
  update public.chat_participantes set lido_ate = now()
  where conversa_id = p_conversa and user_id = auth.uid();
end;
$$;

-- Chamar atenção: 3 seguidas e depois 30 minutos bloqueado ---------------------------------------
create or replace function public.chat_chamar_atencao(p_conversa uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu uuid := public.chat_exigir_usuario();
  v_ultimas timestamptz[];
  v_liberado timestamptz;
begin
  perform public.chat_exigir_participante(p_conversa);

  select array_agg(created_at order by created_at desc) into v_ultimas
  from (
    select created_at from public.chat_chamados
    where conversa_id = p_conversa and remetente_id = v_eu
    order by created_at desc limit 3
  ) t;

  -- Três chamadas seguidas (todas dentro de 30 minutos) bloqueiam por 30 minutos a partir da terceira.
  if coalesce(array_length(v_ultimas, 1), 0) = 3
     and v_ultimas[1] - v_ultimas[3] <= interval '30 minutes'
     and v_ultimas[1] > now() - interval '30 minutes' then
    v_liberado := v_ultimas[1] + interval '30 minutes';
    return jsonb_build_object('ok', false, 'liberadoEm', v_liberado, 'restantes', 0);
  end if;

  insert into public.chat_chamados (conversa_id, remetente_id, remetente_nome)
  values (p_conversa, v_eu, public.chat_nome_usuario(v_eu));
  insert into public.chat_mensagens (conversa_id, autor_id, autor_nome, conteudo, tipo)
  values (p_conversa, v_eu, public.chat_nome_usuario(v_eu), public.chat_nome_usuario(v_eu) || ' chamou a atenção.', 'atencao');
  update public.chat_conversas set ultima_mensagem_em = now() where id = p_conversa;

  return jsonb_build_object(
    'ok', true,
    'restantes', greatest(0, 3 - (
      select count(*) from public.chat_chamados
      where conversa_id = p_conversa and remetente_id = v_eu and created_at > now() - interval '30 minutes'
    ))
  );
end;
$$;

-- Lista de conversas com nomes, prévia e não lidas -----------------------------------------------
create or replace function public.chat_minhas_conversas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eu uuid := public.chat_exigir_usuario();
begin
  return coalesce((
    select jsonb_agg(item order by (item->>'ultimaMensagemEm') desc)
    from (
      select jsonb_build_object(
        'id', c.id,
        'tipo', c.tipo,
        'nome', c.nome,
        'criadoPor', c.criado_por,
        'ultimaMensagemEm', c.ultima_mensagem_em,
        'papel', eu.papel,
        'lidoAte', eu.lido_ate,
        'participantes', (
          select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', public.chat_nome_usuario(p.id), 'email', p.email, 'papel', cp.papel) order by public.chat_nome_usuario(p.id)), '[]'::jsonb)
          from public.chat_participantes cp join public.profiles p on p.id = cp.user_id
          where cp.conversa_id = c.id
        ),
        'naoLidas', (
          select count(*) from public.chat_mensagens m
          where m.conversa_id = c.id and m.created_at > eu.lido_ate and m.autor_id is distinct from v_eu and m.tipo <> 'sistema'
        ),
        'ultima', (
          select jsonb_build_object('autor', m.autor_nome, 'conteudo', left(regexp_replace(m.conteudo, '<[^>]*>', ' ', 'g'), 140), 'tipo', m.tipo, 'anexos', jsonb_array_length(m.anexos), 'em', m.created_at)
          from public.chat_mensagens m where m.conversa_id = c.id order by m.created_at desc limit 1
        )
      ) as item
      from public.chat_participantes eu
      join public.chat_conversas c on c.id = eu.conversa_id
      where eu.user_id = v_eu
    ) t
  ), '[]'::jsonb);
end;
$$;

-- Limpeza de 30 dias (só o servidor) -------------------------------------------------------------
create or replace function public.chat_limpar_antigas(p_dias integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corte timestamptz := now() - make_interval(days => greatest(coalesce(p_dias, 30), 1));
  v_paths jsonb;
  v_qtd integer;
begin
  select coalesce(jsonb_agg(a->>'path'), '[]'::jsonb) into v_paths
  from public.chat_mensagens m, jsonb_array_elements(m.anexos) a
  where m.created_at < v_corte and coalesce(a->>'path', '') <> '';

  delete from public.chat_mensagens where created_at < v_corte;
  get diagnostics v_qtd = row_count;
  delete from public.chat_chamados where created_at < v_corte;

  return jsonb_build_object('mensagens', v_qtd, 'anexos', v_paths);
end;
$$;

revoke all on function public.chat_limpar_antigas(integer) from public, anon, authenticated;
grant execute on function public.chat_limpar_antigas(integer) to service_role;

-- Permissões das funções ------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.chat_abrir_direta(uuid)',
    'public.chat_criar_grupo(text, uuid[])',
    'public.chat_grupo_alterar(uuid, text, uuid[], uuid[])',
    'public.chat_sair_grupo(uuid)',
    'public.chat_enviar(uuid, text, jsonb)',
    'public.chat_excluir_mensagem(uuid)',
    'public.chat_marcar_lido(uuid)',
    'public.chat_chamar_atencao(uuid)',
    'public.chat_minhas_conversas()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Anexos: bucket privado hub-anexos, pasta chat/<conversa>/ (só participantes) -------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Storage não encontrado neste banco: regras de anexos não aplicadas.';
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('hub-anexos', 'hub-anexos', false)
  on conflict (id) do update set public = false;

  execute 'drop policy if exists chat_storage_select on storage.objects';
  execute $p$create policy chat_storage_select on storage.objects for select to authenticated
    using (bucket_id = 'hub-anexos' and (storage.foldername(name))[1] = 'chat' and public.chat_participa_texto((storage.foldername(name))[2]))$p$;

  execute 'drop policy if exists chat_storage_insert on storage.objects';
  execute $p$create policy chat_storage_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'hub-anexos' and (storage.foldername(name))[1] = 'chat' and public.chat_participa_texto((storage.foldername(name))[2]))$p$;

  execute 'drop policy if exists chat_storage_delete on storage.objects';
  execute $p$create policy chat_storage_delete on storage.objects for delete to authenticated
    using (bucket_id = 'hub-anexos' and (storage.foldername(name))[1] = 'chat' and owner = auth.uid())$p$;
end $$;

-- Tempo real: avisa os participantes na hora (respeitando as regras de leitura) ------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publicação supabase_realtime não encontrada: o chat usará atualização periódica.';
    return;
  end if;
  foreach t in array array['chat_mensagens', 'chat_chamados', 'chat_participantes'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');

commit;

-- Conferência: deve listar as 4 tabelas do chat.
select tablename as tabela, rowsecurity as regras_ativas
from pg_tables where schemaname = 'public' and tablename like 'chat_%' order by 1;
