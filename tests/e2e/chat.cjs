// Chat (modo local): conversa individual, formatação, anexo, tempo real entre abas, chamar atenção (3 seguidas e bloqueio),
// grupos, privacidade, minimizar/fechar, janela separada, backup e aviso antes da limpeza de 30 dias.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const os = require("os");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  const errors = [];
  const nova = async () => {
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.accept());
    return p;
  };
  const entrar = async (p, email) => {
    await p.goto(BASE + "/#/home");
    await p.waitForTimeout(500);
    if (await p.locator('input[type="password"]').count()) {
      if (email) await p.fill('input[type="email"]', email);
      await p.fill('input[type="password"]', "hub-demo-2026");
      await p.click('button[type="submit"]');
      await p.waitForTimeout(1300);
    }
  };
  const abrirChat = async (p) => {
    if (!(await p.locator(".chat--janela").count())) await p.locator('.topbar-actions button[aria-label^="Chat"]').click();
    await p.waitForTimeout(400);
    return p.locator(".chat--janela");
  };

  // --- A: administrador abre conversa com o Colaborador
  const A = await nova();
  await entrar(A, "");
  await A.evaluate(() => { localStorage.removeItem("hub_chat_local"); Object.keys(localStorage).filter((k) => k.startsWith("hub_chat_backup")).forEach((k) => localStorage.removeItem(k)); });
  const chatA = await abrirChat(A);
  check("chat abre pelo botão do topo", (await chatA.count()) === 1);
  await chatA.getByRole("button", { name: "Nova conversa" }).click();
  await chatA.locator(".chat-item", { hasText: "Colaborador" }).first().click();
  await A.waitForTimeout(400);
  const editorA = chatA.locator(".chat-composer [contenteditable='true']");
  await editorA.click();
  await A.keyboard.press("Control+B");
  await A.keyboard.type("Bom dia");
  await A.keyboard.press("Control+B");
  await A.keyboard.type(", tudo certo?");
  await A.keyboard.press("Enter");
  await A.waitForTimeout(600);
  const bolha = chatA.locator(".chat-msg--minha").last();
  check("Enter envia a mensagem", /Bom dia, tudo certo\?/.test(await bolha.innerText().catch(() => "")));
  check("negrito preservado", /<(strong|b)>Bom dia<\/(strong|b)>/.test(await bolha.locator(".chat-msg-texto").innerHTML().catch(() => "")));

  // --- B: colaborador em outra aba
  const B = await nova();
  await B.goto(BASE + "/#/home");
  await B.evaluate(() => localStorage.removeItem("hub_tributario_session"));
  await B.reload();
  await entrar(B, "colaborador@hteixeira.local");
  await B.waitForTimeout(800);
  const badge = await B.locator('.topbar-actions button[aria-label^="Chat: 1 mensagem"]').count();
  check("não lida aparece no botão do topo", badge === 1);
  const chatB = await abrirChat(B);
  const itemB = chatB.locator(".chat-item", { hasText: "Administrador" }).first();
  check("conversa aparece para o destinatário", (await itemB.count()) === 1);
  await itemB.click();
  await B.waitForTimeout(500);
  check("destinatário lê a mensagem", /Bom dia, tudo certo\?/.test(await chatB.locator(".chat-mensagens").innerText()));

  // resposta com anexo
  const arquivo = path.join(os.tmpdir(), "teste-chat.txt");
  fs.writeFileSync(arquivo, "conteúdo do anexo");
  await chatB.locator('input[type="file"]').setInputFiles(arquivo);
  await chatB.locator(".chat-composer [contenteditable='true']").click();
  await B.keyboard.type("Segue o arquivo");
  await chatB.getByRole("button", { name: "Enviar" }).click();
  await B.waitForTimeout(600);
  check("resposta com anexo enviada", /teste-chat\.txt/.test(await chatB.locator(".chat-mensagens").innerText()));
  await A.waitForTimeout(1500);
  check("resposta chega na outra aba em tempo real", /Segue o arquivo/.test(await chatA.locator(".chat-mensagens").innerText()));

  // --- chamar atenção: 3 seguidas e depois bloqueio
  await A.evaluate(() => {
    window.__tremeu = 0;
    new MutationObserver(() => { if (document.querySelector(".chat--tremer, .hub-tremer")) window.__tremeu++; }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  await chatA.getByRole("button", { name: /Fechar o chat/ }).click();
  await A.waitForTimeout(300);
  for (let i = 0; i < 3; i++) {
    await chatB.getByRole("button", { name: "Chamar atenção" }).click();
    await B.waitForTimeout(500);
  }
  await A.waitForTimeout(1200);
  check("chamar atenção reabre o chat do destinatário", (await A.locator(".chat--janela").count()) === 1);
  check("chamar atenção chacoalha a tela do destinatário", (await A.evaluate(() => window.__tremeu)) > 0);
  check("quarta chamada fica bloqueada", (await chatB.getByRole("button", { name: "Chamar atenção" }).isDisabled()) === true);
  check("aviso de bloqueio de 30 minutos", /30 minutos|Liberado novamente/.test(await chatB.innerText()));

  // --- minimizar e restaurar
  await A.locator(".chat--janela").getByRole("button", { name: "Minimizar o chat" }).click();
  await A.waitForTimeout(300);
  check("minimizar vira botão flutuante", (await A.locator(".chat-minimizado").count()) === 1 && (await A.locator(".chat--janela").count()) === 0);
  await A.locator(".chat-minimizado").click();
  await A.waitForTimeout(300);
  check("restaurar a janela", (await A.locator(".chat--janela").count()) === 1);

  // --- grupo
  const chatA2 = A.locator(".chat--janela");
  await chatA2.getByRole("button", { name: "Voltar para as conversas" }).click().catch(() => {});
  await chatA2.getByRole("button", { name: "Novo grupo" }).click();
  await chatA2.locator(".chat-campo input").fill("[TESTE] Equipe fiscal");
  await chatA2.locator(".chat-membros label", { hasText: "Colaborador" }).locator("input").check();
  await chatA2.getByRole("button", { name: "Criar grupo" }).click();
  await A.waitForTimeout(600);
  check("grupo criado e aberto", /Equipe fiscal/.test(await chatA2.locator(".chat-subtopo").innerText()));
  await chatA2.locator(".chat-composer [contenteditable='true']").click();
  await A.keyboard.type("Mensagem ao grupo");
  await A.keyboard.press("Enter");
  await A.waitForTimeout(1500);
  await chatB.getByRole("button", { name: "Voltar para as conversas" }).click();
  await B.waitForTimeout(500);
  check("membro vê o grupo", (await chatB.locator(".chat-item", { hasText: "Equipe fiscal" }).count()) === 1);

  // --- privacidade: gestor não vê a conversa individual nem o grupo
  const C = await nova();
  await C.goto(BASE + "/#/home");
  await C.evaluate(() => localStorage.removeItem("hub_tributario_session"));
  await C.reload();
  await entrar(C, "gestor.tributario@hteixeira.local");
  const chatC = await abrirChat(C);
  check("quem não participa não vê as conversas", (await chatC.locator(".chat-item").count()) === 0, String(await chatC.locator(".chat-item").count()));
  await C.close();

  // --- janela separada
  const [popup] = await Promise.all([A.waitForEvent("popup"), A.locator(".chat--janela").getByRole("button", { name: "Abrir em janela separada" }).click()]);
  await popup.waitForTimeout(1500);
  check("janela separada abre o chat", /#\/chat/.test(popup.url()) && (await popup.locator(".chat--pagina").count()) === 1);
  await popup.close();

  // --- backup e aviso antes da limpeza
  await A.evaluate(() => {
    const dados = JSON.parse(localStorage.getItem("hub_chat_local"));
    const m = dados.mensagens.find((x) => x.tipo === "texto");
    dados.mensagens.push({ ...m, id: "antiga", conteudo: "<p>Mensagem antiga</p>", createdAt: new Date(Date.now() - 28.5 * 864e5).toISOString() });
    localStorage.setItem("hub_chat_local", JSON.stringify(dados));
  });
  // outras abas trocaram a sessão (mesmo navegador): volta a entrar como administrador
  await A.evaluate(() => localStorage.removeItem("hub_tributario_session"));
  await A.reload();
  await entrar(A, "fiscal10.hteixeira@gmail.com");
  await A.waitForTimeout(1200);
  const chatA3 = await abrirChat(A);
  check("pergunta de backup antes da limpeza", /serão apagadas automaticamente/.test(await chatA3.innerText()));
  const [download] = await Promise.all([A.waitForEvent("download"), chatA3.getByRole("button", { name: "Baixar backup" }).first().click()]);
  const caminho = await download.path();
  const conteudo = fs.readFileSync(caminho, "utf8");
  check("backup em HTML com as conversas", /\.html$/.test(download.suggestedFilename()) && /Bom dia/.test(conteudo) && /Equipe fiscal/.test(conteudo));
  await A.waitForTimeout(300);
  check("pergunta some depois de responder", !/serão apagadas automaticamente/.test(await chatA3.innerText()));

  // --- página Chat no menu
  await A.goto(BASE + "/#/chat"); await A.waitForTimeout(1200);
  check("menu Chat abre a página do chat", (await A.locator(".chat--pagina").count()) === 1 && (await A.locator(".chat--janela").count()) === 0);

  check("sem erros de página", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((e) => { console.log(results.join("\n")); console.error(e); process.exit(1); });
