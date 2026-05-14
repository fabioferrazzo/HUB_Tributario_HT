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

Enquanto Supabase/SSO nao estiver configurado, o app usa sessao local apenas para desenvolvimento.

```text
Admin: fiscal10.hteixeira@gmail.com
Gestor: gestor.tributario@hteixeira.local
Colaborador: colaborador@hteixeira.local
Senha: hub-demo-2026
```

Essas credenciais nao devem ser usadas em producao.

## Apps integrados

Os HTMLs fornecidos ficam em:

- `public/apps/calendar.html`
- `public/apps/agenda-tributaria.html`
- `public/apps/pomodoro.html`
- `public/apps/coord-tributaria.html`

## Planilha

Sheet ID configurado:

```text
1rpAcGBQCmm5KlMX1TMBN-qBL1vaNgy6gn3j_ffjkVsg
```

GID configurado:

```text
1705398292
```

O teste de leitura CSV retornou `401 Nao Autorizado`; para sincronizar pautas reais, liberar leitura por link ou configurar conta de servico Google.

## CSV local de pautas

O arquivo recebido foi copiado para:

```text
public/data/pautas-hub.csv
```

Enquanto a integracao autenticada com Google Sheets nao estiver configurada, o dashboard usa esse CSV como fonte local das pautas.

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
