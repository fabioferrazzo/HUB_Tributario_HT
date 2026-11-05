# HUB Depto Tributario

App web/PWA interno para o Departamento Tributario, com login, home operacional, pautas, lembretes, tarefas, arquivos, agenda tributaria, pomodoro, links uteis e integracao gradual com apps HTML existentes.

## Como rodar localmente

```powershell
npm.cmd install
npm.cmd run dev -- --port 5173
```

URL local:

```text
http://127.0.0.1:5173
```

## Login de homologacao local

Sem `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, o app entra em modo demonstracao (dados salvos no navegador), disponivel somente em `npm run dev`. Os usuarios e a senha de demonstracao ficam em `src/lib/usersRepository.ts`.

No build de producao o modo demonstracao e desativado: sem Supabase configurado, o login fica bloqueado.

## Apps integrados

Os HTMLs fornecidos ficam em:

- `public/apps/calendar.html`
- `public/apps/agenda-tributaria.html`
- `public/apps/pomodoro.html`
- `public/apps/coord-tributaria.html`

## Pautas

O menu principal do HUB usa o modulo nativo de Pautas, com persistencia Supabase/local, anexos, destaques, conclusoes por usuario e notificacoes ao administrador.

A antiga integracao com Google Sheets foi retirada do fluxo ativo. O menu Pautas usa a base nativa do HUB; qualquer app externo futuro deve ser tratado como nova integracao.

Sheet ID historico:

```text
1rpAcGBQCmm5KlMX1TMBN-qBL1vaNgy6gn3j_ffjkVsg
```

GID configurado:

```text
1705398292
```

## CSV historico de pautas

O arquivo recebido foi copiado para:

```text
public/data/pautas-hub.csv
```

O CSV permanece no repositorio apenas como massa historica de apoio. O dashboard nao depende mais dele para a operacao principal.

## Build

```powershell
npm.cmd run build
```

## Supabase

O app ja possui preparacao para Supabase Auth, banco, RLS e storage de anexos.

Leia:

- `SUPABASE_SETUP.md`
- `supabase/schema.sql`

Enquanto `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` estiverem vazias, o login local de homologacao continua ativo.

## Arquivos de planejamento

- `PLANO_PROJETO_HUB_TRIBUTARIO.md`
- `CHECKLIST_INSUMOS_E_EXECUCAO.md`
- `INVENTARIO_APPS_E_INTEGRACOES.md`
- `MANUAL_OPERACIONAL_HUB.md`
