# Configuracao Supabase - HUB Depto. Tributario

## Objetivo

Ativar login real, banco de dados, permissoes por usuario e storage de anexos.

Enquanto as variaveis Supabase estiverem vazias, o HUB continua usando o login local de homologacao.

## 1. Criar projeto

1. Acesse o Supabase.
2. Crie um novo projeto.
3. Copie:
   - Project URL.
   - anon public key.
   - service role key, somente para funcoes server-side futuras.

## 2. Configurar variaveis

Crie um arquivo `.env.local` na raiz do projeto com:

```env
VITE_SUPABASE_URL="https://SEU-PROJETO.supabase.co"
VITE_SUPABASE_ANON_KEY="SUA_ANON_KEY"
SUPABASE_SERVICE_ROLE_KEY="SUA_SERVICE_ROLE_KEY"
```

No Netlify/Vercel, cadastre as mesmas variaveis no painel do ambiente.

## 3. Executar schema

No SQL Editor do Supabase, execute o arquivo:

```text
supabase/schema.sql
```

Esse script cria:

- `profiles`;
- `lembretes`;
- `lembrete_usuarios`;
- `lembrete_anexos`;
- `notificacoes`;
- `links_uteis`;
- `noticias`;
- `audit_logs`;
- bucket privado `hub-anexos`;
- RLS e policies de acesso.

## 4. Criar usuarios

No Supabase Auth, crie os usuarios iniciais.

Depois, para cada usuario criado, insira uma linha em `profiles` com o mesmo `id` do usuario do Auth.

Exemplo:

```sql
insert into public.profiles (id, email, nome, role, active)
values
  ('UUID_DO_AUTH_USER', 'fiscal10.hteixeira@gmail.com', 'Fabio', 'admin', true);
```

Perfis permitidos:

- `admin`
- `gestor`
- `colaborador`

## 5. Regra de seguranca

O admin nao visualiza senhas de usuarios. O admin gerencia usuarios, perfis e reset de senha pelo Supabase/Auth.

## 6. Como o app decide entre local e Supabase

Arquivos:

- `src/lib/supabase.ts`
- `src/lib/auth.ts`
- `src/lib/usersRepository.ts`

Regra:

- se `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` estiverem preenchidas, usa Supabase Auth;
- se estiverem vazias, usa login local de homologacao.

## 7. Usuarios e perfis

O modulo Admin usa:

- `src/lib/usersRepository.ts`
- `netlify/functions/admin-users.mjs`
- modo local com `localStorage`;
- modo Supabase com a tabela `profiles`.

No modo local, usuarios ativos cadastrados no Admin conseguem entrar com a senha de homologacao:

```text
hub-demo-2026
```

No modo Supabase, o Admin pode criar um usuario novo informando nome, e-mail, perfil e senha inicial. A criacao do Auth acontece na funcao server-side `admin-users`, que usa `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor.

Para editar um usuario existente, o Admin atualiza `profiles`.

O `supabase/schema.sql` inclui policies para:

- selecionar perfis pelo proprio usuario, gestor ou admin;
- inserir perfis como admin;
- atualizar perfis como admin.

Importante:

- no Vite puro (`npm run dev`), a rota `/.netlify/functions/admin-users` nao existe;
- para testar criacao real de usuario Auth localmente, use Netlify Functions, por exemplo `netlify dev`;
- em producao, configure as variaveis no painel da hospedagem.

## 8. Lembretes

Local atual:

- `src/lib/lembretes.ts`
- usa `localStorage`.

Repositorio unificado usado pelo app:

- `src/lib/lembretesRepository.ts`
- escolhe automaticamente entre local e Supabase;
- usa Supabase quando `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e sessao real existirem;
- usa `localStorage` quando as variaveis estiverem vazias.

Repositorio Supabase:

- `src/lib/lembretesRemote.ts`
- lista lembretes;
- salva lembretes;
- exclui lembretes;
- envia anexos ao bucket `hub-anexos`;
- grava metadados em `lembrete_anexos`.

Proxima etapa tecnica apos criar o projeto Supabase:

- criar usuarios no Auth;
- inserir os mesmos usuarios em `profiles`;
- preencher `.env.local`;
- rodar o app e validar login, criacao, edicao, anexo, marcacao de usuarios e exclusao.
