# Processamento de documentos para estudo

## Objetivo

Preparar o modulo `Arquivos` para trabalhar com uma versao pesquisavel dos documentos anexados.

O arquivo original continua salvo no Supabase Storage. Quando houver OCR/conversao, o worker externo grava uma segunda versao em PDF pesquisavel e atualiza o registro em `arquivo_recursos`.

## Campos criados

Execute antes o patch:

- `supabase/patch_arquivo_processamento.sql`

Ele adiciona em `public.arquivo_recursos`:

- `processing_status`: `none`, `pending`, `processing`, `ready` ou `error`;
- `processing_message`: mensagem visivel para o usuario;
- `processed_file_name`: nome do arquivo pesquisavel;
- `processed_storage_path`: caminho da versao pesquisavel no bucket `hub-arquivos`;
- `processed_mime_type`: normalmente `application/pdf`;
- `processed_size_bytes`: tamanho da versao processada;
- `processed_at`: data/hora de conclusao.

## Fluxo recomendado

1. Usuario anexa PDF, PPTX, imagem ou outro documento no HUB.
2. O HUB salva o original e marca `processing_status = pending`.
3. Worker externo consulta os pendentes.
4. Worker baixa o original no Supabase Storage.
5. Worker converte para PDF pesquisavel:
   - PDF imagem: OCR;
   - PPTX: conversao para PDF e, se necessario, OCR;
   - imagem: OCR para PDF;
   - DOCX/XLSX: conversao para PDF se a empresa quiser padronizar estudo.
6. Worker envia o PDF pesquisavel para o mesmo bucket.
7. Worker atualiza o registro com `processing_status = ready` e `processed_storage_path`.
8. O HUB passa a abrir automaticamente a versao processada no visualizador.

## Por que nao fazer no navegador

OCR e conversao de PPTX/PDF podem ser pesados, lentos e instaveis no navegador. Tambem exporiam processamento em cada maquina do usuario.

O caminho mais confiavel e um worker local/servidor:

- mantem o HUB leve;
- evita gastar builds do Netlify;
- permite usar ferramentas como LibreOffice, OCRmyPDF, Tesseract ou APIs dedicadas;
- processa em fila, sem travar o upload.

## Implementacao futura do worker

O worker pode ser:

- script local em uma maquina do escritorio;
- servico interno no servidor da empresa;
- job agendado em ambiente cloud;
- edge/background function apenas se os limites de tempo/custo forem suficientes.

Recomendacao inicial para a empresa: worker local/servidor com Supabase Service Role, pois permite converter PPTX/DOCX com LibreOffice e aplicar OCR com ferramentas nativas.

## Teste apos patch

Depois de rodar o SQL:

1. Anexe um PDF ou PPTX no HUB.
2. Confira se aparece o selo `OCR/conversao pendente`.
3. O arquivo ainda abre pelo visualizador atual.
4. Quando o worker preencher a versao processada, o selo muda para `PDF pesquisavel pronto`.
5. O botao `Visualizar` abre automaticamente a versao processada.

