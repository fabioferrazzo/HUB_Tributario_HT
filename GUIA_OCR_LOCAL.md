# OCR local no menu Arquivos

## O que foi criado

O HUB tem um botao `Rodar OCR` no menu `Arquivos`. Esse botao nao executa OCR dentro do Netlify. Ele aciona este computador local, que usa LibreOffice, OCRmyPDF e Tesseract para converter documentos em versoes pesquisaveis.

## Modo 1 - Agente local aberto

1. Abra a pasta do projeto:

```text
C:\Users\PC\Desktop\-\GPT codex\HUB Depto Tributário
```

2. De duplo clique no arquivo:

```text
INICIAR_OCR_HUB.cmd
```

3. Deixe a janela aberta.
4. Acesse o HUB no Chrome.
5. Entre no menu `Arquivos`.
6. Clique em `Rodar OCR`.

## Modo 2 - Protocolo hubocr://rodar

Este modo permite clicar em `Rodar OCR` sem abrir PowerShell antes. O Chrome chama o Windows pelo protocolo `hubocr://rodar`, e o Windows abre o processador local.

### Registrar uma vez no Windows

No CMD ou PowerShell, rode:

```powershell
cd "C:\Users\PC\Desktop\-\GPT codex\HUB Depto Tributário"
powershell -ExecutionPolicy Bypass -File scripts\registrar-protocolo-ocr.ps1
```

Depois disso, ao clicar em `Rodar OCR`, se o agente local nao estiver aberto, o HUB tentara abrir `hubocr://rodar`.

Se o Chrome perguntar se pode abrir o aplicativo externo, confirme.

### Remover o protocolo

```powershell
cd "C:\Users\PC\Desktop\-\GPT codex\HUB Depto Tributário"
powershell -ExecutionPolicy Bypass -File scripts\registrar-protocolo-ocr.ps1 -Remove
```

## Teste rapido

Abra no Chrome:

```text
hubocr://rodar
```

Se estiver registrado corretamente, o Windows abrira a janela `HUB Depto Tributario - Rodar OCR`.

## Observacoes importantes

- O arquivo `.env.local` continua apenas local e nao deve subir ao GitHub.
- O OCR processa a fila de arquivos com `processing_status = pending`.
- Nao e necessario excluir e reenviar arquivos ja anexados; basta rodar OCR novamente.
- Se o protocolo ainda nao estiver registrado, o botao pode mostrar erro ou o Chrome pode nao abrir nada.
- O modo protocolo nao retorna o resultado em tempo real para o HUB. Quando a janela terminar, atualize a lista de Arquivos se necessario.
