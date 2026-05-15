# Visualizador de documentos em Arquivos

## Entrega atual

O modulo `Arquivos` recebeu um botao `Visualizar` para cada arquivo/link com URL disponivel.

Ao clicar, o HUB abre um painel grande com:

- visualizacao do documento em painel interno;
- botao `Fechar`, tecla `Esc` e clique fora do painel para encerrar o visualizador;
- zoom;
- controle de pagina para PDFs;
- campo de pesquisa, aproveitando o suporte do visualizador do navegador quando disponivel;
- botao `Grifar busca`;
- grifos amarelos salvos em painel lateral;
- comentarios salvos em painel lateral;
- exportacao dos grifos/comentarios em arquivo Markdown (`.md`);
- abertura do arquivo em nova aba.

## Previa de arquivos

O visualizador trata os tipos assim:

- imagens: exibicao direta no painel;
- PDF: exibicao direta no painel com pagina, zoom e busca do navegador;
- Word, Excel e PowerPoint: tentativa de exibicao pelo visualizador online do Office;
- Google Docs, Sheets, Slides e arquivos do Drive: tentativa de exibicao em modo preview;
- pastas do Google Drive ou links que bloqueiam iframe: aviso claro no painel com acao `Abrir em nova aba`.

Alguns provedores, como Google Drive e sites externos, podem bloquear visualizacao embutida por permissao, login ou politica de seguranca. Nesses casos, o painel mantem o estudo/anotacoes e orienta abrir o documento em nova aba.

## Persistencia atual

Os grifos e comentarios agora usam a mesma origem ativa do modulo `Arquivos`:

- com Supabase configurado, ficam salvos na tabela `arquivo_anotacoes`;
- sem Supabase configurado, continuam no armazenamento local do navegador (`localStorage`), para homologacao local.

Antes de testar a persistencia multiusuario, execute no Supabase SQL Editor:

1. `supabase/patch_arquivos_biblioteca.sql`, caso ainda nao tenha sido executado.
2. `supabase/patch_arquivo_anotacoes.sql`.

As anotacoes seguem a permissao do arquivo:

- quem consegue ver o arquivo consegue ver os grifos/comentarios daquele arquivo;
- cada usuario remove suas proprias anotacoes;
- administradores podem remover qualquer anotacao.

## Exportacao para estudo

No painel lateral do visualizador, o botao `Exportar notas` gera um arquivo `.md` com:

- titulo do documento;
- nome do arquivo, categoria e URL;
- data/hora da exportacao;
- grifos e comentarios ordenados por pagina e data de criacao;
- autor e data de cada anotacao.

Use esse arquivo para estudo, revisao interna ou compartilhamento fora do HUB quando necessario.

## Limites tecnicos desta primeira versao

- PDF: usa o visualizador nativo do navegador; busca, pagina e zoom dependem do suporte do Chrome/Edge.
- Imagens: exibidas diretamente com zoom visual.
- DOCX/XLSX/PPTX: usam tentativa de preview via Office Online, desde que a URL esteja acessivel ao servico externo.
- Pastas do Google Drive: devem ser abertas em nova aba quando o Google bloquear a visualizacao embutida.
- Grifos amarelos ficam registrados no painel de estudo; ainda nao sao desenhados diretamente sobre o texto do PDF.

## Proxima evolucao

1. Avaliar uso de PDF.js para grifo direto sobre PDFs e navegacao de paginas 100% controlada pelo HUB.
2. Avaliar conversao previa de DOCX/XLSX/PPTX para PDF quando a empresa quiser preview 100% interno, sem dependencia do Office/Google.
3. Avaliar exportacao consolidada por pasta, reunindo anotacoes de varios documentos em um unico relatorio.
