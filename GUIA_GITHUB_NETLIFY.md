# Guia rapido - GitHub para Netlify

## 1. Criar repositorio no GitHub

1. Acesse GitHub.
2. Clique em `New repository`.
3. Nome sugerido:

```text
hub-depto-tributario-hteix
```

4. Deixe como `Private`, se o HUB for interno.
5. Nao marque para criar README, `.gitignore` ou license, pois o projeto ja tem esses arquivos.

## 2. Enviar os arquivos do projeto

Opcao simples pelo navegador:

1. Abra o repositorio criado.
2. Clique em `uploading an existing file`.
3. Envie o conteudo do ZIP:

```text
deploy/HUB_Depto_Tributario_SOURCE_GITHUB_NETLIFY.zip
```

Importante: envie os arquivos/pastas de dentro do ZIP, nao o ZIP fechado como arquivo unico dentro do repositorio.

O repositorio deve conter na raiz:

- `src`
- `public`
- `netlify`
- `supabase`
- `package.json`
- `package-lock.json`
- `netlify.toml`
- `vite.config.ts`
- `index.html`

Nao envie:

- `node_modules`
- `dist`
- `deploy`
- `.env`
- `.env.local`

## 3. Conectar no Netlify

1. No Netlify, acesse `Add new site`.
2. Escolha `Import an existing project`.
3. Conecte ao GitHub.
4. Selecione o repositorio `hub-depto-tributario-hteix`.

As configuracoes devem ser detectadas pelo `netlify.toml`:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
Node version: 20
```

## 4. Primeiro deploy completo

Antes do Supabase, o app ainda sobe em modo local de homologacao.

Depois do deploy completo, validar:

- URL abre;
- login local funciona com `hub-demo-2026`;
- Netlify mostra a aba `Functions`;
- funcoes `admin-users` e `sheets-pautas` aparecem no painel.

## 5. Proxima etapa

Depois que o deploy completo estiver ativo, siga para:

```text
SUPABASE_SETUP.md
```
