-- HUB Depto Tributario - Senhas v2 (27/11/2026)
--
-- Nova regra:
--   * O proprio usuario pode trocar a senha pelo HUB (menu "Trocar senha"), confirmando a senha atual,
--     exceto se o administrador bloquear a troca para ele.
--   * Senha provisoria: o HUB exige uma senha nova no primeiro acesso.
--   * O administrador define a senha de qualquer usuario e pode bloquear a troca por usuario.
--
-- Toda troca continua passando pelo servidor do HUB (funcao admin-users), que confere quem pode trocar e
-- grava a autorizacao de 2 minutos; trocas feitas por fora (API do Supabase) seguem bloqueadas pelo
-- gatilho de patch_senhas_somente_admin.sql (execute aquele antes, se ainda nao executou).
--
-- Seguro para executar mais de uma vez.

begin;

-- 1. Marcas no perfil
alter table public.profiles add column if not exists senha_provisoria boolean not null default false;
alter table public.profiles add column if not exists senha_troca_bloqueada boolean not null default false;

-- 2. So o administrador (ou o servidor do HUB) muda essas marcas; o proprio usuario nao.
create or replace function public.proteger_marcas_de_senha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.senha_provisoria is distinct from old.senha_provisoria
      or new.senha_troca_bloqueada is distinct from old.senha_troca_bloqueada)
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.is_admin() then
    new.senha_provisoria := old.senha_provisoria;
    new.senha_troca_bloqueada := old.senha_troca_bloqueada;
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_marcas_de_senha() from public, anon, authenticated;

drop trigger if exists proteger_marcas_de_senha on public.profiles;
create trigger proteger_marcas_de_senha
before update on public.profiles
for each row
execute function public.proteger_marcas_de_senha();

-- 3. Historico: novo tipo "propria_do_usuario"
alter table public.senha_eventos drop constraint if exists senha_eventos_resultado_check;
alter table public.senha_eventos
  add constraint senha_eventos_resultado_check
  check (resultado in ('definida_pelo_admin', 'propria_do_admin', 'bloqueada', 'propria_do_usuario'));

-- 4. Gatilho de protecao: registra a troca feita pelo proprio usuario
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
    -- Autorização do próprio usuário (troca pelo HUB, conferida no servidor) ou do administrador.
    insert into public.senha_eventos (user_id, email, resultado, autorizado_por)
    values (
      new.id,
      new.email,
      case when v_autorizado_por = new.id then 'propria_do_usuario' else 'definida_pelo_admin' end,
      v_autorizado_por
    );
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

select pg_notify('pgrst', 'reload schema') as postgrest_schema_reload_requested;

commit;
