# Visualizador de documentos em Arquivos

## Entrega atual

O modulo `Arquivos` recebeu um botao `Visualizar` para cada arquivo/link com URL disponivel.

Ao clicar, o HUB abre um painel grande com:

- visualizacao do documento em painel interno;
- zoom;
- controle de pagina para PDFs;
- campo de pesquisa, aproveitando o suporte do visualizador do navegador quando disponivel;
- botao `Grifar busca`;
- grifos amarelos salvos em painel lateral;
- comentarios salvos em painel lateral;
- abertura do arquivo em nova aba.

## Persistencia atual

Os grifos e comentarios desta primeira versao ficam no armazenamento local do navegador (`localStorage`) por arquivo.

Isso permite homologar a experiencia sem mexer no banco nem consumir deploys extras.

## Limites tecnicos desta primeira versao

- PDF: usa o visualizador nativo do navegador; busca, pagina e zoom dependem do suporte do Chrome/Edge.
- Imagens: exibidas diretamente com zoom visual.
- DOCX/XLSX: podem abrir em `iframe` quando a URL permitir, mas navegadores nem sempre renderizam esses formatos internamente.
- Grifos amarelos ficam registrados no painel de estudo; ainda nao sao desenhados diretamente sobre o texto do PDF.

## Proxima evolucao

1. Persistir grifos e comentarios em Supabase para sincronizar entre usuarios.
2. Criar tabelas `arquivo_anotacoes` ou equivalente com RLS por usuario/permissao.
3. Avaliar uso de PDF.js para grifo direto sobre PDFs e navegacao de paginas 100% controlada pelo HUB.
4. Definir comportamento para DOCX/XLSX: conversao previa, preview via Google/Office viewer ou download/abertura externa.
