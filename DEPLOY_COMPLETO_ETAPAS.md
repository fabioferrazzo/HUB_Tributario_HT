# Deploy completo - etapas

Este roteiro substitui o Netlify Drop quando o HUB for sair do modo visual/local e entrar em homologacao real com Supabase e Netlify Functions.

## Etapa 3.1 - Preparar repositorio

Arquivos que devem ir para Git:

- `src/`
- `public/`
- `netlify/`
- `supabase/`
- `package.json`
- `package-lock.json`
- `netlify.toml`
- `vite.config.ts`
- `tsconfig.json`
- `tsconfig.app.json`
- `tsconfig.node.json`
- `.env.example`
- documentos `.md`

Arquivos/pastas que nao devem ir:

- `node_modules/`
- `dist/`
- `deploy/`
- `.env`
- `.env.local`
- `.netlify/`
- `vite-dev*.log`

Status: preparado em `.gitignore`.

## Etapa 3.2 - Conectar Netlify ao Git

No Netlify, criar/importar o site a partir do repositorio.

Configuracao esperada:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
Node: 20
```

Status: preparado em `netlify.toml`.

Guia operacional:

```text
GUIA_GITHUB_NETLIFY.md
```

## Etapa 3.3 - Criar Supabase

No Supabase:

1. Criar o projeto.
2. Copiar `Project URL`.
3. Copiar `anon public key`.
4. Copiar `service_role key`.
5. Executar `supabase/schema.sql` no SQL Editor.

## Etapa 3.4 - Configurar variaveis

No Netlify, cadastrar:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_ADMIN_EMAIL
VITE_SHEETS_ID
VITE_SHEETS_HUB_GID
APP_BASE_URL
```

Localmente, criar `.env.local` a partir de `.env.example`.

## Etapa 3.5 - Criar administrador inicial

Antes do Admin do HUB criar usuarios, precisa existir pelo menos um admin.

Fluxo:

1. Criar o usuario admin no Supabase Auth.
2. Copiar o ID desse usuario.
3. Inserir o perfil correspondente em `profiles`.

Modelo:

```sql
insert into public.profiles (id, email, nome, role, active)
values ('UUID_DO_AUTH_USER', 'fiscal10.hteixeira@gmail.com', 'Fabio', 'admin', true);
```

## Etapa 3.6 - Homologar

Checklist:

- login real do admin;
- criar usuario pelo Admin do HUB;
- login do usuario criado;
- criar lembrete;
- marcar usuario;
- anexar arquivo;
- confirmar upload no bucket `hub-anexos`;
- abrir notificacoes;
- validar rotas dos apps integrados.
