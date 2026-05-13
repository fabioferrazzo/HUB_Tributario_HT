# Guia de ativacao de e-mails reais

Este projeto ja possui uma fila de e-mails em `email_outbox` e uma Netlify Function para processar essa fila. A ativacao real depende apenas das variaveis no Netlify e de um provedor de e-mail.

## Provedor indicado

Use o Resend nesta primeira etapa, porque a funcao `netlify/functions/email-outbox.mjs` ja esta preparada para ele.

No Resend:

1. Crie a conta.
2. Adicione e verifique um dominio de envio.
3. Crie uma API key.
4. Defina um remetente no formato `HUB Depto Tributario <hub@seudominio.com.br>`.

## Variaveis no Netlify

Em Netlify > Project configuration > Environment variables, cadastre:

```txt
EMAIL_PROVIDER=resend
EMAIL_PROVIDER_API_KEY=sua_api_key_resend
EMAIL_FROM=HUB Depto Tributario <hub@seudominio.com.br>
EMAIL_REPLY_TO=fiscal10.heixeira@gmail.com
EMAIL_DISPATCH_TOKEN=crie_um_token_longo_e_aleatorio
EMAIL_DELIVERY_ENABLED=false
EMAIL_SCHEDULE_ENABLED=false
EMAIL_FORCE_TEST_TO=fiscal10.heixeira@gmail.com
```

Mantenha `EMAIL_DELIVERY_ENABLED=false` no primeiro deploy apos configurar as variaveis. Assim a funcao continua em modo dry-run e mostra quais e-mails seriam enviados sem disparar nada.

## Primeiro teste seguro

1. Confirme que a tabela `email_outbox` tem registros `queued`.
2. Faca deploy pelo GitHub/Netlify.
3. Abra:

```txt
https://hub-depto-tributario-ht.netlify.app/.netlify/functions/email-outbox?token=SEU_EMAIL_DISPATCH_TOKEN
```

O retorno deve indicar `deliveryEnabled: false` e listar uma previa mascarada dos e-mails pendentes.

## Teste real controlado

Depois do dry-run:

1. No Netlify, altere:

```txt
EMAIL_DELIVERY_ENABLED=true
EMAIL_FORCE_TEST_TO=fiscal10.heixeira@gmail.com
```

2. Rode a funcao manualmente pelo painel do Netlify ou por uma chamada POST autenticada.
3. Todos os e-mails serao enviados apenas para `EMAIL_FORCE_TEST_TO`, com assunto iniciado por `[TESTE HUB]`.
4. Confira no Supabase se os registros mudaram de `queued` para `sent`.

Tambem e possivel processar um item pelo navegador durante a homologacao:

```txt
https://hub-depto-tributario-ht.netlify.app/.netlify/functions/email-outbox?token=SEU_EMAIL_DISPATCH_TOKEN&action=process&limit=1
```

## Ativacao final

Quando o envio teste estiver validado:

```txt
EMAIL_DELIVERY_ENABLED=true
EMAIL_SCHEDULE_ENABLED=true
EMAIL_FORCE_TEST_TO=
```

Com isso:

- e-mails de criacao de lembrete saem quando estiverem na fila;
- e-mails de vencimento sao enfileirados diariamente pela funcao agendada;
- registros enviados ficam marcados como `sent` em `email_outbox`.

## Observacoes

- Nao coloque `SUPABASE_SERVICE_ROLE_KEY` no front-end. Ela deve ficar somente nas variaveis do Netlify.
- Se um e-mail falhar, a fila marca `failed` e grava `last_error`.
- A funcao usa `Idempotency-Key` com a `dedupe_key` da fila para reduzir risco de envio duplicado.
