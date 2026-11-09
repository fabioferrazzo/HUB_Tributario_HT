// Testa as notificacoes do Pomodoro (localhost).
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext();
  await context.grantPermissions(["notifications"], { origin: BASE + "" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text() + " @ " + m.location().url); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()); });
  // registra as notificacoes criadas
  await page.addInitScript(() => {
    window.__notificacoes = [];
    const Original = window.Notification;
    class Captura extends Original {
      constructor(title, options) { super(title, options); window.__notificacoes.push({ title, body: options && options.body }); }
    }
    Object.defineProperty(Captura, "permission", { get: () => Original.permission });
    Captura.requestPermission = Original.requestPermission.bind(Original);
    window.Notification = Captura;
  });
  await page.goto(BASE + "/apps/pomodoro.html");
  await page.waitForTimeout(1500);
  await page.evaluate(() => triggerTimeUp());
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => ({
    notificacoes: window.__notificacoes,
    modal: document.getElementById("time-up-title").textContent,
    permissao: Notification.permission
  }));
  console.log(JSON.stringify(result));
  console.log(result.notificacoes.length === 1 && /Sess.o conclu.da/i.test(result.notificacoes[0].title) ? "OK    notificacao do fim do ciclo disparada" : "FALHA notificacao nao disparada");
  console.log(errors.length === 0 ? "OK    sem erros no console" : "FALHA erros: " + errors.join(" | "));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
