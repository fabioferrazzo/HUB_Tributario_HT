# Homologacao pre-deploy sem gastar creditos Netlify

## Objetivo

Concentrar a revisao do HUB antes de liberar um deploy de marco.

Enquanto os builds automaticos do Netlify estiverem pausados, suba os arquivos no GitHub normalmente e use validacoes locais.

## Painel no HUB

Em `Configuracoes`, abaixo da lista de usuarios, existe o painel `Saude operacional do HUB`.

Ele indica:

- origem de Usuarios e perfis;
- origem de Lembretes;
- origem de Arquivos e anotacoes do visualizador;
- origem de Links uteis;
- modo atual de Tarefas;
- status esperado para E-mails, Rodapes e Netlify.

Esse painel nao executa deploy, nao chama automacoes e nao consome creditos.

## Checklist final

O roteiro completo de fechamento esta em:

```text
CHECKLIST_HOMOLOGACAO_FINAL.md
```

Use esse checklist para validar login, perfis, lembretes, tarefas, arquivos, links, rodapes, notificacoes, e-mails e Coordenacao Tributaria antes de liberar um deploy de marco.

## Antes de liberar deploy de marco

1. Rodar localmente `npm.cmd run preflight`.
2. Quando quiser validar build completo local, rodar `npm.cmd run preflight:build`.
3. Verificar se o painel `Saude operacional do HUB` nao mostra alertas inesperados.
4. Rodar `supabase/check_hub_status.sql` no Supabase SQL Editor.
5. Percorrer `CHECKLIST_HOMOLOGACAO_FINAL.md`.
6. So entao reativar build/deploy no Netlify para publicar a rodada.

## Patches pendentes desta fase

- Sem patch novo pendente nesta rodada, desde que `supabase/check_hub_status.sql` retorne todos os itens essenciais como `OK`.

## Observacao

Os checks de E-mails e Rodapes dependem das Netlify Functions publicadas. Em fase de economia de creditos, valide localmente o que for possivel e deixe a confirmacao final para o deploy de marco.
