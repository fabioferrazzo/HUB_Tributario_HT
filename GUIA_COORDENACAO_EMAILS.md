# E-mails manuais da Coordenacao Tributaria

## Objetivo

Ativar os envios manuais do app `Coordenacao Tributaria` usando a infraestrutura de e-mails do HUB.

## O que foi integrado

O app HTML `public/apps/coord-tributaria.html` passou a usar, por padrao, o endpoint interno:

`/.netlify/functions/coord-email`

Esse endpoint recebe os envios manuais do app de coordenacao e usa a fila `email_outbox`.

## Botoes atendidos

- `Enviar pautas por e-mail`, na aba de pautas.
- `Enviar resumo`, na aba de avaliacoes/resumo do periodo.
- `Enviar lembrete` individual de avaliacoes/orientacoes do colaborador.

## Permissao

O envio e permitido quando:

- o usuario esta logado no HUB como `admin` ou `gestor`; ou
- o campo `Token de seguranca` recebe o valor configurado em `COORD_EMAIL_TOKEN` ou `EMAIL_DISPATCH_TOKEN`.

Na operacao normal dentro do HUB, a sessao Supabase do usuario ja deve bastar.

## Variaveis Netlify

Ja utilizadas pela base de e-mails:

- `EMAIL_DELIVERY_ENABLED`
- `EMAIL_PROVIDER`
- `EMAIL_PROVIDER_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`
- `EMAIL_FORCE_TEST_TO`
- `EMAIL_DISPATCH_TOKEN`

Opcional para separar o token da Coordenacao:

- `COORD_EMAIL_TOKEN`

Se `COORD_EMAIL_TOKEN` estiver vazio, a funcao aceita `EMAIL_DISPATCH_TOKEN` como token alternativo.

## Enquanto o dominio Resend nao estiver verificado

Mantenha:

`EMAIL_FORCE_TEST_TO=fiscal10.hteixeira@gmail.com`

Assim, os testes continuam indo para o e-mail homologado, mesmo quando o destinatario informado no app for outro.

## Teste no proximo deploy de marco

1. Entrar como admin ou gestor.
2. Abrir `Coordenacao`.
3. Abrir a aba `Pautas`.
4. Criar uma pauta simples.
5. Clicar em `Enviar pautas por e-mail`.
6. Informar o e-mail de destino.
7. Confirmar se a tabela `email_outbox` recebeu categoria `coord_pautas`.
8. Confirmar se o e-mail foi enviado/recebido em modo teste.
9. Repetir na aba de avaliacoes usando o envio de resumo ou envio individual.
