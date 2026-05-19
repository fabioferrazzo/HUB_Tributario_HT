# OCR local no menu Arquivos

## O que foi criado

O HUB agora pode ter um botao `Rodar OCR` no menu `Arquivos`. Esse botao nao executa OCR dentro do Netlify. Ele chama um agente local rodando no Windows, que usa LibreOffice, OCRmyPDF e Tesseract instalados neste computador.

## Uso manual recomendado

1. Abra a pasta do projeto:

```text
C:\Users\PC\Desktop\-\GPT codex\HUB Depto Tributário
```

2. Dê duplo clique no arquivo:

```text
INICIAR_OCR_HUB.cmd
```

3. Deixe a janela aberta.
4. Acesse o HUB no Chrome.
5. Entre no menu `Arquivos`.
6. Clique em `Rodar OCR`.

Quando o processamento terminar, a lista de arquivos sera atualizada e os documentos processados exibirao `Versao pesquisavel pronta`.

## Uso por comando

Se preferir pelo CMD:

```bat
cd "C:\Users\PC\Desktop\-\GPT codex\HUB Depto Tributário"
npm run arquivos:agent
```

## Agendamento opcional ao entrar no Windows

Se quiser que o agente OCR abra automaticamente ao fazer login no Windows, rode o PowerShell como usuario normal e execute:

```powershell
cd "C:\Users\PC\Desktop\-\GPT codex\HUB Depto Tributário"
powershell -ExecutionPolicy Bypass -File scripts\registrar-agente-ocr-login.ps1
```

Para remover esse agendamento:

```powershell
cd "C:\Users\PC\Desktop\-\GPT codex\HUB Depto Tributário"
powershell -ExecutionPolicy Bypass -File scripts\registrar-agente-ocr-login.ps1 -Remove
```

## Observacoes importantes

- O arquivo `.env.local` continua apenas local e nao deve subir ao GitHub.
- O agente precisa estar aberto para o botao `Rodar OCR` funcionar.
- O OCR processa a fila de arquivos com `processing_status = pending`.
- Nao e necessario excluir e reenviar arquivos ja anexados; basta rodar OCR novamente.
- Se o botao mostrar erro de conexao, abra ou reinicie o `INICIAR_OCR_HUB.cmd`.
