# Testes em navegador do HUB

Rodar antes de cada publicação:

```
npm.cmd run test:e2e
```

- Sobe o HUB em modo demonstração (dados locais, sem Supabase) na porta 5199, roda os testes no Chrome sem abrir janela e encerra o servidor.
- Para rodar só alguns: `npm.cmd run test:e2e -- funcional quadro-avisos`.
- Capturas de tela ficam em `tests/e2e/.saida` (fora do Git).
- `contraste` é um relatório: lista textos com contraste abaixo de 4,5:1 e não reprova a execução. Os itens do menu lateral escuro aparecem como falso positivo.

| Teste | O que confere |
|---|---|
| funcional | Criar, editar e excluir (com confirmação) em Pautas, Links, Arquivos e Tarefas |
| pautas-editor | Editor de texto das Pautas: tamanhos, negrito, grifo liga/desliga, listas |
| quadro-avisos | Quadro de Avisos: formatação, cor do post-it, edição, arquivo anexo |
| escrita | Acentos e quebras de linha no Quadro; grifo nas anotações do Pomodoro |
| arquivos-permissoes | Colaborador publica para todos; gestor só lê; admin gerencia |
| arquivos-envio | Envio de arquivos digitalizados sem OCR, download e exclusão |
| pomodoro | Notificação de fim de ciclo |
| varredura | Abre todas as seções e acusa erros de página |
| apps-internos | Agenda, Coordenação, Pomodoro e Calendário abrem sem erro e sem mojibake |
| contraste | Relatório de contraste de textos |
