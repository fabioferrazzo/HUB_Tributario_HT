# Deploy de marco - HUB Depto Tributario

## Quando usar

Use este roteiro somente quando formos publicar um conjunto fechado de mudancas no Netlify.

Durante o desenvolvimento normal, mantenha os builds automaticos pausados para economizar creditos.

## Antes de reativar o Netlify

No computador, dentro da pasta do projeto, rode:

```powershell
npm.cmd run preflight
```

Para uma checagem mais completa:

```powershell
npm.cmd run preflight:build
```

O esperado e terminar com:

```text
OK. Preflight local aprovado.
```

## Conferencia do Supabase

No Supabase SQL Editor, rode:

```text
supabase/check_hub_status.sql
```

Todos os itens essenciais devem aparecer como `OK`.

Se algum item aparecer como `PENDENTE`, execute o patch correspondente antes do deploy.

## Ordem dos patches Supabase

Se precisar reconstruir ou revisar o banco, use esta ordem:

1. `supabase/schema.sql`
2. `supabase/patch_profiles_read_active.sql`
3. `supabase/patch_lembretes_rls.sql`
4. `supabase/patch_lembretes_insert_owner.sql`
5. `supabase/patch_create_lembrete_rpc.sql`
6. `supabase/patch_lembretes_confidencial.sql`
7. `supabase/patch_lembretes_visibilidade_sem_marcados.sql`
8. `supabase/patch_arquivos_biblioteca.sql`
9. `supabase/patch_arquivo_anotacoes.sql`
10. `supabase/patch_links_uteis.sql`
11. `supabase/patch_updates_automaticos.sql`
12. `supabase/patch_updates_legislacao_cleanup.sql`
13. `supabase/patch_notificacoes_persistentes.sql`
14. `supabase/patch_email_outbox.sql`
15. `supabase/patch_email_outbox_events.sql`
16. `supabase/patch_tarefas.sql`

## Netlify

Quando o preflight local e a conferencia do Supabase estiverem OK:

1. Abra o projeto `hub-depto-tributario-ht` no Netlify.
2. Em Build settings, altere de `Stopped builds` para `Active builds`, se estiver pausado.
3. Rode um deploy de marco.
4. Depois do deploy, volte para `Stopped builds` se ainda estivermos em desenvolvimento.

## Testes apos o deploy

Valide nesta ordem:

1. Login admin.
2. Painel `Configuracoes > Saude operacional do HUB`.
3. Criacao/edicao de usuario.
4. Criacao, edicao, conclusao e exclusao de lembrete.
5. Lembrete confidencial com e sem usuarios marcados.
6. Upload e visualizacao de arquivo.
7. Grifo/comentario no visualizador de Arquivos.
8. Links uteis global e pessoal.
9. Rodapes de noticias e legislacoes.
10. Sino de notificacoes.
11. Envio de e-mail de teste.
12. App Coordenacao: envio manual de pautas e avaliacoes.

## Criterio de pronto

O deploy de marco so deve ser considerado pronto quando:

- o site abre sem erro;
- login e logout funcionam;
- dados persistem no Supabase;
- e-mails ficam pelo menos enfileirados em `email_outbox`;
- nao ha erro vermelho nos fluxos principais.
