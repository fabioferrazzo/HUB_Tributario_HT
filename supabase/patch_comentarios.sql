-- HUB Depto Tributário — Comentários em avisos do quadro e em pautas.
-- Pode ser executado mais de uma vez. Não apaga dados.
--
-- Regras:
--   • Comenta quem enxerga o item: avisos do Quadro geral (todos), avisos particulares
--     (os escolhidos, o autor e os administradores) e pautas (quem a pauta alcança).
--   • O autor do comentário pode excluí-lo; o administrador exclui qualquer comentário.
--   • O administrador pode bloquear (e desbloquear) os comentários de um aviso ou pauta.
--     Com o bloqueio, só administradores continuam comentando.
--   • Cada comentário avisa no sino: o autor do item, os administradores e quem já comentou nele.
--   • Ao excluir o aviso ou a pauta, os comentários vão junto.

begin;

create table if not exists public.hub_comentarios (
  id uuid primary key default gen_random_uuid(),
  pauta_id uuid references public.pautas(id) on delete cascade,
  aviso_id uuid references public.quadro_avisos(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  autor_nome text not null default '',
  texto text not null check (char_length(texto) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint hub_comentarios_um_alvo check (num_nonnulls(pauta_id, aviso_id) = 1)
);

create index if not exists hub_comentarios_pauta_idx on public.hub_comentarios (pauta_id, created_at);
create index if not exists hub_comentarios_aviso_idx on public.hub_comentarios (aviso_id, created_at);

create table if not exists public.hub_comentarios_bloqueios (
  id uuid primary key default gen_random_uuid(),
  pauta_id uuid references public.pautas(id) on delete cascade,
  aviso_id uuid references public.quadro_avisos(id) on delete cascade,
  bloqueado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hub_comentarios_bloqueios_um_alvo check (num_nonnulls(pauta_id, aviso_id) = 1)
);

create unique index if not exists hub_comentarios_bloqueios_pauta_uq on public.hub_comentarios_bloqueios (pauta_id) where pauta_id is not null;
create unique index if not exists hub_comentarios_bloqueios_aviso_uq on public.hub_comentarios_bloqueios (aviso_id) where aviso_id is not null;

alter table public.hub_comentarios enable row level security;
alter table public.hub_comentarios_bloqueios enable row level security;

-- Leitura: quem enxerga o item. Gravação: só pelas funções abaixo.
revoke all on public.hub_comentarios from public, anon, authenticated;
revoke all on public.hub_comentarios_bloqueios from public, anon, authenticated;
grant select on public.hub_comentarios to authenticated;
grant select on public.hub_comentarios_bloqueios to authenticated;
grant all on public.hub_comentarios to service_role;
grant all on public.hub_comentarios_bloqueios to service_role;

drop policy if exists hub_comentarios_select on public.hub_comentarios;
create policy hub_comentarios_select on public.hub_comentarios
  for select to authenticated
  using (
    public.is_active_user()
    and (
      (pauta_id is not null and public.can_read_pauta(pauta_id))
      or (aviso_id is not null and public.can_read_quadro_aviso(aviso_id))
    )
  );

drop policy if exists hub_comentarios_bloqueios_select on public.hub_comentarios_bloqueios;
create policy hub_comentarios_bloqueios_select on public.hub_comentarios_bloqueios
  for select to authenticated
  using (
    public.is_active_user()
    and (
      (pauta_id is not null and public.can_read_pauta(pauta_id))
      or (aviso_id is not null and public.can_read_quadro_aviso(aviso_id))
    )
  );

-- Comentar ---------------------------------------------------------------------------------------
create or replace function public.hub_comentar(p_tipo text, p_alvo uuid, p_texto text)
returns public.hub_comentarios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_texto text := trim(coalesce(p_texto, ''));
  v_nome text;
  v_row public.hub_comentarios;
  v_titulo text;
  v_autor_item uuid;
  v_rotulo text;
  v_particular boolean := false;
  p record;
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  if p_tipo not in ('pauta', 'aviso') then
    raise exception 'Tipo de item inválido.';
  end if;
  if v_texto = '' then
    raise exception 'Escreva o comentário.';
  end if;
  if char_length(v_texto) > 2000 then
    raise exception 'O comentário pode ter até 2.000 caracteres.';
  end if;

  if p_tipo = 'pauta' then
    if not public.can_read_pauta(p_alvo) then
      raise exception 'Sem acesso a esta pauta.' using errcode = '42501';
    end if;
    if not public.is_admin() and exists (select 1 from public.hub_comentarios_bloqueios b where b.pauta_id = p_alvo) then
      raise exception 'Os comentários desta pauta foram bloqueados pela coordenação.';
    end if;
    select coalesce(nullif(trim(titulo), ''), 'Pauta'), created_by into v_titulo, v_autor_item
    from public.pautas where id = p_alvo;
    v_rotulo := 'pauta';
  else
    if not public.can_read_quadro_aviso(p_alvo) then
      raise exception 'Sem acesso a este aviso.' using errcode = '42501';
    end if;
    if not public.is_admin() and exists (select 1 from public.hub_comentarios_bloqueios b where b.aviso_id = p_alvo) then
      raise exception 'Os comentários deste aviso foram bloqueados pela coordenação.';
    end if;
    select coalesce(nullif(trim(title), ''), 'Aviso'), created_by, coalesce(visibility, 'geral') = 'particular'
      into v_titulo, v_autor_item, v_particular
    from public.quadro_avisos where id = p_alvo;
    v_rotulo := case when v_particular then 'aviso particular' else 'aviso do Quadro geral' end;
  end if;

  select coalesce(nullif(trim(pr.nome), ''), split_part(pr.email, '@', 1)) into v_nome
  from public.profiles pr where pr.id = v_uid;

  insert into public.hub_comentarios (pauta_id, aviso_id, autor_id, autor_nome, texto)
  values (
    case when p_tipo = 'pauta' then p_alvo end,
    case when p_tipo = 'aviso' then p_alvo end,
    v_uid,
    coalesce(v_nome, ''),
    v_texto
  )
  returning * into v_row;

  -- Sino: autor do item, administradores e quem já comentou (menos quem comentou agora).
  for p in
    select distinct pr.id
    from public.profiles pr
    where public.profile_is_active(pr)
      and pr.id <> v_uid
      and (
        pr.id = v_autor_item
        or (to_jsonb(pr)->>'role') = 'admin'
        or pr.id in (
          select c.autor_id from public.hub_comentarios c
          where c.id <> v_row.id
            and ((p_tipo = 'pauta' and c.pauta_id = p_alvo) or (p_tipo = 'aviso' and c.aviso_id = p_alvo))
        )
      )
  loop
    perform public.hub_notif_gravar(
      p.id,
      'comentario',
      'Novo comentário: ' || v_titulo,
      left(v_texto, 160),
      'Por ' || coalesce(v_nome, 'alguém') || ' · ' || v_rotulo,
      case when p_tipo = 'pauta' then 'pauta' else 'quadro_aviso' end,
      p_alvo,
      'comentario:' || v_row.id::text || ':' || p.id::text,
      'pautas'
    );
  end loop;

  return v_row;
end;
$$;

-- Excluir comentário (autor ou administrador) ---------------------------------------------------
create or replace function public.hub_comentario_excluir(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_autor uuid;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select autor_id into v_autor from public.hub_comentarios where id = p_id;
  if not found then
    return;
  end if;
  if not public.is_admin() and v_autor is distinct from v_uid then
    raise exception 'Só o autor ou um administrador pode excluir este comentário.' using errcode = '42501';
  end if;

  delete from public.hub_comentarios where id = p_id;

  update public.notificacoes
     set active = false, updated_at = now()
   where dedupe_key like 'comentario:' || p_id::text || ':%'
     and active = true;
end;
$$;

-- Bloquear / desbloquear comentários (administrador) -------------------------------------------
create or replace function public.hub_comentarios_bloquear(p_tipo text, p_alvo uuid, p_bloquear boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Só administradores podem bloquear comentários.' using errcode = '42501';
  end if;
  if p_tipo not in ('pauta', 'aviso') then
    raise exception 'Tipo de item inválido.';
  end if;

  if coalesce(p_bloquear, false) then
    if not exists (
      select 1 from public.hub_comentarios_bloqueios b
      where (p_tipo = 'pauta' and b.pauta_id = p_alvo) or (p_tipo = 'aviso' and b.aviso_id = p_alvo)
    ) then
      insert into public.hub_comentarios_bloqueios (pauta_id, aviso_id, bloqueado_por)
      values (case when p_tipo = 'pauta' then p_alvo end, case when p_tipo = 'aviso' then p_alvo end, auth.uid());
    end if;
  else
    delete from public.hub_comentarios_bloqueios b
    where (p_tipo = 'pauta' and b.pauta_id = p_alvo) or (p_tipo = 'aviso' and b.aviso_id = p_alvo);
  end if;

  return coalesce(p_bloquear, false);
end;
$$;

revoke all on function public.hub_comentar(text, uuid, text) from public, anon;
revoke all on function public.hub_comentario_excluir(uuid) from public, anon;
revoke all on function public.hub_comentarios_bloquear(text, uuid, boolean) from public, anon;
grant execute on function public.hub_comentar(text, uuid, text) to authenticated, service_role;
grant execute on function public.hub_comentario_excluir(uuid) to authenticated, service_role;
grant execute on function public.hub_comentarios_bloquear(text, uuid, boolean) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;

-- Conferência: deve listar as 2 tabelas e as 3 funções.
select 'tabela' as tipo, tablename::text as nome from pg_tables where schemaname = 'public' and tablename like 'hub_comentarios%'
union all
select 'função', proname::text from pg_proc where proname in ('hub_comentar', 'hub_comentario_excluir', 'hub_comentarios_bloquear')
order by 1, 2;
