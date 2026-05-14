# Preflight local antes do deploy de marco

## Objetivo

Rodar uma checagem local antes de gastar creditos do Netlify com um novo deploy.

## Comando principal

No terminal, dentro da pasta do projeto:

```powershell
npm.cmd run preflight
```

Esse comando valida:

- arquivos essenciais do HUB;
- TypeScript;
- sintaxe das Netlify Functions principais.

## Checagem com build local

Quando quiser uma revisao mais completa, rode:

```powershell
npm.cmd run preflight:build
```

Esse comando tambem executa o build local do Vite. Ele nao publica nada e nao consome creditos do Netlify.

## Quando usar

Use antes de:

- reativar builds no Netlify;
- clicar em deploy manual;
- liberar uma rodada grande para os usuarios.

## Resultado esperado

O final deve indicar:

```text
OK. Preflight local aprovado.
```

Se aparecer `Falhou`, corrija as pendencias antes de publicar.
