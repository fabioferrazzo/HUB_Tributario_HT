-- HUB Depto Tributario - Senhas definidas somente pelo administrador (05/11/2026)
--
-- Regra: apenas o admin define senhas (Configuracoes > Usuarios > Nova senha
-- provisoria). O app ja nao oferece troca de senha ao usuario; este patch
-- fecha a brecha tecnica (troca feita direto pela API do Supabase, como
-- "recuperar senha" ou updateUser).
--
-- Como funciona:
--   1. Ao redefinir uma senha, a funcao admin-users grava uma autorizacao
--      valida por 2 minutos em senha_autorizacoes.
--   2. Um gatilho em auth.users so aceita troca de senha com essa
--      autorizacao, ou quando o proprio usuario e administrador.
--   3. Sem autorizacao, a senha antiga e mantida, a tentativa fica em
--      senha_eventos e os administradores recebem alerta no sino e por e-mail.
--
-- Observacao: senhas definidas pelo painel do Supabase (fora do HUB) tambem
-- sao bloqueadas para nao administradores. Use sempre o HUB.
--
-- Seguro para executar mais de uma vez.

begin;

-- 1. Autorizacoes temporarias (gravadas so pelo servidor, com chave de servico)
create table if not exists public.senha_autorizacoes (
  user_id uuid primary key,
  autorizado_por uuid,
  expira_em timestamptz not null default (now() + interval '2 minutes'),
  created_at timestamptz not null default now()
);

alter table public.senha_autorizacoes enable row level security;
revoke all on public.senha_autorizacoes from anon, authenticated;

-- 2. Historico de trocas de senha
create table if not exists public.senha_eventos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text,
  resultado text not null check (resultado in ('definida_pelo_admin', 'propria_do_admin', 'bloqueada')),
  autorizado_por uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_senha_eventos_created_at on public.senha_eventos(created_at desc);

alter table public.senha_eventos enable row level security;
revoke all on public.senha_eventos from anon, authenticated;
grant select on public.senha_eventos to authenticated;

drop policy if exists "senha_eventos_select_admin" on public.senha_eventos;
create policy "senha_eventos_select_admin"
on public.senha_eventos for select
to authenticated
using (public.is_admin());

-- 3. Gatilho de protecao
create or replace function public.proteger_troca_de_senha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_autorizado_por uuid;
  v_admin record;
begin
  select exists (
    select 1
    from public.profiles p
    where p.id = new.id
      and (to_jsonb(p)->>'role') = 'admin'
      and coalesce((to_jsonb(p)->>'active')::boolean, true)
  ) into v_is_admin;

  if v_is_admin then
    insert into public.senha_eventos (user_id, email, resultado)
    values (new.id, new.email, 'propria_do_admin');
    return new;
  end if;

  delete from public.senha_autorizacoes
  where user_id = new.id
    and expira_em > now()
  returning autorizado_por into v_autorizado_por;

  if found then
    insert into public.senha_eventos (user_id, email, resultado, autorizado_por)
    values (new.id, new.email, 'definida_pelo_admin', v_autorizado_por);
    return new;
  end if;

  -- Sem autorizacao: mantem a senha antiga e avisa os administradores.
  new.encrypted_password := old.encrypted_password;

  insert into public.senha_eventos (user_id, email, resultado)
  values (new.id, new.email, 'bloqueada');

  for v_admin in
    select p.id, p.email
    from public.profiles p
    where (to_jsonb(p)->>'role') = 'admin'
      and coalesce((to_jsonb(p)->>'active')::boolean, true)
  loop
    begin
      insert into public.notificacoes (user_id, tipo, titulo, body, meta, dedupe_key, route, tone, active, created_at, updated_at)
      values (
        v_admin.id,
        'seguranca_senha',
        'Troca de senha bloqueada',
        'O usuario ' || coalesce(new.email, new.id::text) || ' tentou alterar a propria senha. A senha foi mantida.',
        jsonb_build_object('userId', new.id, 'email', new.email)::text,
        'senha_bloqueada:' || new.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text,
        'admin',
        'warning',
        true,
        now(),
        now()
      );
    exception when others then
      null;
    end;

    begin
      perform public.queue_email(
        v_admin.email,
        'HUB Depto Tributario - troca de senha bloqueada',
        '<p>O usuario <strong>' || coalesce(new.email, new.id::text) || '</strong> tentou alterar a propria senha.</p>' ||
          '<p>A senha anterior foi mantida. Se for necessario, defina uma nova senha em Configuracoes &gt; Usuarios.</p>',
        'O usuario ' || coalesce(new.email, new.id::text) || ' tentou alterar a propria senha. A senha anterior foi mantida.',
        'seguranca',
        'usuario',
        new.id::text,
        now(),
        'senha_bloqueada:' || new.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text || ':' || v_admin.id::text,
        null,
        null
      );
    exception when others then
      null;
    end;
  end loop;

  return new;
end;
$$;

revoke execute on function public.proteger_troca_de_senha() from public, anon, authenticated;

drop trigger if exists proteger_troca_de_senha on auth.users;
create trigger proteger_troca_de_senha
before update of encrypted_password on auth.users
for each row
when (old.encrypted_password is distinct from new.encrypted_password)
execute function public.proteger_troca_de_senha();

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
