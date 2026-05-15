# Visualizador de documentos em Arquivos

## Entrega atual

O modulo `Arquivos` recebeu um botao `Visualizar` para cada arquivo/link com URL disponivel.

Ao clicar, o HUB abre um painel grande com:

- visualizacao do documento em painel interno;
- botao `Fechar`, tecla `Esc` e clique fora do painel para encerrar o visualizador;
- modo `Tela cheia HUB`, que amplia o painel sem perder busca, grifos e comentarios;
- zoom;
- controle de pagina para PDFs;
- campo de pesquisa com botao `Pesquisar` e suporte a Enter;
- navegacao entre resultados da busca, com botoes de voltar/avancar e contador;
- grifo verde temporario para resultados da busca;
- grifos amarelos salvos em painel lateral;
- remocao de grifo amarelo pelo trecho selecionado;
- comentarios salvos em painel lateral;
- exportacao dos grifos/comentarios em arquivo Markdown (`.md`);
- abertura do arquivo em nova aba.

## Previa de arquivos

O visualizador trata os tipos assim:

- imagens: exibicao direta no painel;
- PDF: renderizacao interna com PDF.js, camada de texto, selecao de trechos e grifos visuais quando o PDF possuir texto pesquisavel;
- DOCX: conversao interna para HTML com Mammoth, selecao de trechos e grifos visuais no conteudo convertido;
- Excel e PowerPoint: tentativa de exibicao pelo visualizador online do Office;
- Google Docs, Sheets, Slides e arquivos do Drive: tentativa de exibicao em modo preview;
- pastas do Google Drive ou links que bloqueiam iframe: aviso claro no painel com acao `Abrir em nova aba`.

Alguns provedores, como Google Drive e sites externos, podem bloquear visualizacao embutida por permissao, login ou politica de seguranca. Nesses casos, o painel mantem o estudo/anotacoes e orienta abrir o documento em nova aba.

## Grifos sobre o texto original

Nesta versao, o grifo amarelo fica registrado como anotacao vinculada ao documento e a pagina informada, no painel lateral.

Para PDF e DOCX, o HUB tambem tenta aplicar o grifo visual diretamente no conteudo renderizado:

- PDF: o grifo aparece na camada de texto quando o PDF possui texto pesquisavel;
- DOCX: o grifo aparece no HTML convertido internamente;
- PPTX/XLSX/Google/links externos: o grifo permanece como anotacao lateral, pois esses previews rodam em `iframe` externo e sao isolados por seguranca.

Os resultados de busca aparecem em verde e nao sao salvos como anotacao. O grifo manual salvo pelo usuario aparece em amarelo. Para remover um grifo amarelo, selecione ou cole o mesmo trecho no campo `Grifo amarelo` e acione `Remover grifo selecionado`.

Para PPTX, o caminho recomendado para estudo com grifos precisos e converter o arquivo para PDF pesquisavel antes do upload, ou implementar uma etapa futura de conversao/OCR.

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

## Limites tecnicos

- PDF: PDFs escaneados ou compostos apenas por imagem nao possuem camada de texto; nesses casos, e necessario OCR.
- Imagens: exibidas diretamente com zoom visual.
- DOCX: a conversao interna pode simplificar alguns estilos complexos do Word.
- XLSX/PPTX: usam tentativa de preview via Office Online, desde que a URL esteja acessivel ao servico externo.
- Pastas do Google Drive: devem ser abertas em nova aba quando o Google bloquear a visualizacao embutida.
- Grifos continuam registrados no painel de estudo para auditoria/exportacao, mesmo quando tambem aparecem sobre o conteudo.

## Proxima evolucao

1. Melhorar a persistencia de grifos por coordenada em PDF, alem da correspondencia textual.
2. Avaliar conversao previa de XLSX/PPTX para PDF/HTML quando a empresa quiser preview 100% interno, sem dependencia do Office/Google.
3. Avaliar exportacao consolidada por pasta, reunindo anotacoes de varios documentos em um unico relatorio.
