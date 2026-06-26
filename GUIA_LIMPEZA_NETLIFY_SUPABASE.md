# Guia de limpeza Netlify/Supabase - HUB Depto Tributario

Use este guia antes do proximo deploy de marco para garantir que o HUB publicado aponta para o projeto correto e nao depende mais do antigo fluxo Sheets/CSV.

## Projeto Supabase correto

O HUB Depto Tributario deve usar:

```text
https://kgorlrpparhcrprwamlc.supabase.co
```

O projeto abaixo pertence ao app substituto do Sheets e nao deve ser usado pelo HUB Depto Tributario:

```text
https://mvsurpsqpgjozvfgfqew.supabase.co
```

## Variaveis que devem permanecer no Netlify

Em `Site configuration > Environment variables`, mantenha:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_ADMIN_EMAIL
APP_BASE_URL
EMAIL_DELIVERY_ENABLED
EMAIL_SCHEDULE_ENABLED
EMAIL_PROVIDER
EMAIL_PROVIDER_API_KEY
EMAIL_FROM
EMAIL_REPLY_TO
EMAIL_DISPATCH_TOKEN
COORD_EMAIL_TOKEN
AGENDA_SYNC_TOKEN
EMAIL_FORCE_TEST_TO
```

Tambem podem permanecer variaveis locais de OCR se estiverem sendo usadas em ambiente de desenvolvimento:

```text
ARQUIVOS_PROCESS_LIMIT
ARQUIVOS_PROCESS_LANGUAGE
ARQUIVOS_AGENT_HOST
ARQUIVOS_AGENT_PORT
ARQUIVOS_AGENT_ALLOWED_ORIGINS
LIBREOFFICE_BIN
OCRMYPDF_BIN
TESSERACT_BIN
```

## Variaveis antigas que podem ser removidas

Remova do Netlify, se ainda existirem:

```text
VITE_SHEETS_ID
VITE_SHEETS_HUB_GID
SHEETS_ID
SHEETS_HUB_GID
GOOGLE_SHEETS_ID
GOOGLE_SHEETS_GID
```

Essas variaveis pertenciam ao fluxo antigo de integracao com Google Sheets/CSV. O menu `Pautas` agora usa tabelas nativas do Supabase.

## Function antiga que nao deve existir

Confirme que nao ha Function publicada ou arquivo no GitHub chamado:

```text
netlify/functions/sheets-pautas.mjs
```

No projeto atual, as Functions esperadas sao:

```text
admin-users.mjs
agenda-tributaria.mjs
coord-data.mjs
coord-email.mjs
email-outbox.mjs
pautas-admin.mjs
refresh-updates.mjs
rfb-agenda.mjs
```

## Conferencia antes do deploy

1. Rode localmente:

```powershell
npm.cmd run preflight
npm.cmd run build
```

2. Rode no Supabase correto:

```text
supabase/check_hub_status.sql
```

3. No HUB publicado, abra `Configuracoes > Saude operacional do HUB`.

O item `Projeto Supabase` deve indicar:

```text
kgorlrpparhcrprwamlc.supabase.co
```

Se indicar outro host, revise `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` no Netlify antes de testar Pautas, Tarefas, Arquivos e Coordenacao.
