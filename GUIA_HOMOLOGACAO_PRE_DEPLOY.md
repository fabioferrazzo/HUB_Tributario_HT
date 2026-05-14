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

## Antes de liberar deploy de marco

1. Rodar localmente `npm.cmd run typecheck`.
2. Rodar localmente `npm.cmd run build`.
3. Verificar se o painel `Saude operacional do HUB` nao mostra alertas inesperados.
4. Confirmar quais patches SQL novos ja foram executados no Supabase.
5. So entao reativar build/deploy no Netlify para publicar a rodada.

## Patches pendentes desta fase

- `supabase/patch_arquivo_anotacoes.sql`, para persistir grifos e comentarios do visualizador de Arquivos.

## Observacao

Os checks de E-mails e Rodapes dependem das Netlify Functions publicadas, por isso devem ser homologados somente no proximo deploy de marco.
