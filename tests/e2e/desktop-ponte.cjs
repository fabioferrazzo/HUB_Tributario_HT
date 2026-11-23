// HUB instalado no Windows: botão "Instalar no PC" no navegador e ponte window.hubDesktop no aplicativo.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

async function entrar(page) {
  await page.goto(BASE + "/#/home");
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1300);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const errors = [];

  // 1) Navegador comum: botão no menu e explicação com o link do instalador.
  const ctx1 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p1 = await ctx1.newPage();
  p1.on("pageerror", (e) => errors.push(e.message));
  await entrar(p1);
  const botao = p1.locator(".sidebar button.sign-out--instalar");
  check("navegador: botão 'Instalar no PC' no menu", (await botao.count()) === 1 && (await botao.isVisible()));
  await botao.click();
  const dialogo = p1.getByRole("dialog", { name: "HUB Tributário no computador" });
  check("navegador: abre a explicação", await dialogo.isVisible());
  const href = await dialogo.locator("a.instalar-desktop-baixar").getAttribute("href");
  check("navegador: link do instalador", href === "/desktop/HUB-Tributario-Instalador.exe", href || "");
  check("navegador: explica o aviso do Windows", /Executar assim mesmo/.test(await dialogo.innerText()));
  await p1.keyboard.press("Escape");
  check("navegador: Esc fecha", (await dialogo.count()) === 0);
  await ctx1.close();

  // 2) Dentro do aplicativo (ponte simulada): sem botão de instalar e contador enviado ao Windows.
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx2.addInitScript(() => {
    window.__ponte = [];
    window.hubDesktop = {
      desktop: true,
      versao: "teste",
      chamarAtencao: (t, x) => window.__ponte.push(["atencao", t, x]),
      naoLidas: (n) => window.__ponte.push(["naoLidas", n]),
      notificar: (t, x) => window.__ponte.push(["notificar", t, x])
    };
  });
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await entrar(p2);
  check("aplicativo: sem botão 'Instalar no PC'", (await p2.locator(".sidebar button.sign-out--instalar").count()) === 0);
  const chamadas = await p2.evaluate(() => window.__ponte);
  check("aplicativo: contador de não lidas enviado", chamadas.some((c) => c[0] === "naoLidas"), JSON.stringify(chamadas).slice(0, 120));
  await p2.locator('.topbar-actions button[aria-label^="Chat"]').click();
  await p2.waitForTimeout(400);
  check("aplicativo: chat sem pedir permissão de notificação", (await p2.locator(".chat-permissao").count()) === 0);
  await ctx2.close();

  check("sem erros de página", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  const falhas = results.filter((r) => r.startsWith("FALHA")).length;
  console.log(falhas ? `\n${falhas} falha(s)` : `\nTodas as ${results.length} verificações OK`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
