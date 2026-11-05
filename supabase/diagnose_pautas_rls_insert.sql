-- HUB Depto Tributario - diagnostico de RLS para INSERT em public.pautas.
-- Rode no SQL Editor do Supabase correto do HUB.
--
-- Este script simula a sessao autenticada do admin fiscal10.hteixeira@gmail.com
-- e tenta inserir uma pauta dentro de uma transacao com ROLLBACK.
-- Se passar aqui e falhar no app, o problema esta na sessao/token do navegador.

create or replace function public.auth_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(
    auth.jwt()->>'email',
    (
      select u.email
      from auth.users u
      where u.id = auth.uid()
      limit 1
    ),
    ''
  ));
$$;

grant execute on function public.auth_email() to authenticated;

select
  u.id as auth_id,
  u.email as auth_email,
  p.id as profile_id,
  p.email as profile_email,
  p.role,
  p.active,
  u.id = p.id as ids_batem
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = 'fiscal10.hteixeira@gmail.com'
   or lower(p.email) = 'fiscal10.hteixeira@gmail.com';

begin;

select set_config('request.jwt.claim.sub', '94f9ed55-28e0-42b3-8895-6697d189e73f', true);
select set_config('request.jwt.claim.email', 'fiscal10.hteixeira@gmail.com', true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '94f9ed55-28e0-42b3-8895-6697d189e73f',
    'email', 'fiscal10.hteixeira@gmail.com',
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

select
  auth.uid() as simulated_uid,
  public.auth_email() as simulated_email,
  public.is_active_user() as is_active_user,
  public.is_admin() as is_admin,
  public.is_manager() as is_manager;

insert into public.pautas (
  titulo,
  descricao,
  prazo,
  prioridade,
  status,
  scope,
  destaque,
  created_by,
  created_by_email
)
values (
  'Diagnostico RLS pauta',
  'Registro temporario de teste. Deve ser revertido por rollback.',
  now() + interval '1 day',
  'normal',
  'aberta',
  'todos',
  false,
  '94f9ed55-28e0-42b3-8895-6697d189e73f',
  'fiscal10.hteixeira@gmail.com'
)
returning id, titulo, created_by, created_by_email;

rollback;
