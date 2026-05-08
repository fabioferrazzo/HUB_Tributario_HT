# Deploy no Netlify - HUB Depto Tributario

## Opcao recomendada: projeto completo

Use esta opcao para manter:

- login Supabase;
- Netlify Functions;
- criacao de usuarios no Supabase Auth pelo Admin;
- leitura server-side da planilha quando configurada.

No Netlify, conecte o repositorio/pasta do projeto e use:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
```

O arquivo `netlify.toml` ja esta pronto na raiz do projeto com essas configuracoes.

## Variaveis no Netlify

Cadastre no painel do Netlify:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_ADMIN_EMAIL
VITE_SHEETS_ID
VITE_SHEETS_HUB_GID
APP_BASE_URL
```

Nao coloque `SUPABASE_SERVICE_ROLE_KEY` dentro de arquivos publicos.

## Opcao rapida: upload manual estatico

Para um teste visual simples, voce pode enviar o conteudo da pasta `dist` ao Netlify.

Limite dessa opcao:

- a tela abre;
- os apps e dados locais funcionam;
- as Netlify Functions nao ficam completas;
- a criacao real de usuarios no Supabase Auth pelo Admin nao deve ser homologada por esse caminho.

Arquivo gerado para teste estatico:

```text
deploy/HUB_Depto_Tributario_NETLIFY_DROP_v5_pautas.zip
```

Ao usar Netlify Drop, envie esse ZIP ou a pasta `dist`. Nao envie a pasta inteira do projeto, pois o `index.html` da raiz e apenas o arquivo de desenvolvimento do Vite.

O ZIP v5 foi gerado com caminhos internos no padrao web (`assets/...`, `apps/...`, `data/...`) e inclui o ajuste visual das Pautas. Isso evita o problema de publicar apenas o `index.html` e deixar os assets em 404.
