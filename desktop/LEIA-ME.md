# HUB Tributário para Windows

Janela própria do HUB (motor WebView2 do Edge, que já vem no Windows 10/11), com:

- ícone perto do relógio (abrir, iniciar com o Windows, comportamento do X, procurar atualização, sair);
- "Fechar" ou "Fechar, mas manter em segundo plano", com "lembrar minha escolha";
- "chamar atenção" do chat: janela por cima de tudo, chacoalha, pisca na barra de tarefas e mostra aviso;
- contador de mensagens não lidas no ícone e no título;
- links externos abrem no navegador do computador;
- atualização automática: confere `/desktop/versao.json` ao abrir e a cada 6 horas.

O conteúdo é sempre o site publicado; só a "casca" tem versão própria (`Versao` em `HUBTributario.cs`).

## Gerar uma nova versão

1. Aumente `Versao` em `HUBTributario.cs` (ex.: 1.0.0 → 1.0.1).
2. Na raiz do repositório: `powershell -ExecutionPolicy Bypass -File desktop\build.ps1`.
3. Faça commit de `public/desktop/HUB-Tributario-Instalador.exe` e `public/desktop/versao.json` e publique.
   As cópias instaladas se atualizam sozinhas.

## Onde fica no computador

- Programa: `%LOCALAPPDATA%\Programs\HUB Tributario` (sem precisar de administrador).
- Dados (login, preferências): `%LOCALAPPDATA%\HUB Tributario`.
- Remover: Configurações → Aplicativos → HUB Tributário → Desinstalar.

## Ponte com o site

O aplicativo injeta `window.hubDesktop` só na origem do HUB (`src/lib/desktop.ts`):
`chamarAtencao(titulo, texto)`, `naoLidas(total)` e `notificar(titulo, texto)`.
