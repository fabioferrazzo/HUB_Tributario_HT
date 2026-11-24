// Calendário de Tarefas no visual premium: barra lateral em vidro, calendário (iframe) seguindo tema,
// tamanho e paleta pela ponte hub-premium-app.js, contraste, formulário em folha clara (modo local, localhost).
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

function auditar(tema) {
  const parse = (c) => { const m = c.match(/[\d.]+/g) || []; return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const base = tema === "escuro" ? { r: 11, g: 18, b: 39, a: 1 } : { r: 244, g: 243, b: 239, a: 1 };
  const mix = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const fundo = (el) => {
    const camadas = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c.a > 0) camadas.push(c);
      if (c.a >= 0.99) break;
    }
    return camadas.reverse().reduce((acc, c) => mix(c, acc), base);
  };
  const raiz = document.querySelector(".workspace-body") || document.body;
  const ruins = [];
  for (const el of raiz.querySelectorAll("*")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || +cs.opacity === 0 || cs.display === "none") continue;
    if (el.closest("input, textarea, select, .ev-chip, .ev-badge, #panel-screen, #reminder-popup, .task-sidebar--form")) continue;
    const bg = fundo(el), cor = mix(parse(cs.color), bg);
    const c = (Math.max(lum(cor), lum(bg)) + .05) / (Math.min(lum(cor), lum(bg)) + .05);
    if (c < 4.5) ruins.push(`${c.toFixed(2)} "${el.textContent.trim().slice(0, 24)}"`);
  }
  return ruins;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.location().url + m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());

  await page.goto(BASE + "/");
  await page.evaluate(() => {
    ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta"].forEach((k) => localStorage.removeItem(k));
    const hoje = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const eventos = [
      { id: "teste-tp-1", title: "[TESTE] Tarefa premium", date: `${iso(hoje)}T10:00`, category: "work", hub: { status: "aberta", responsaveis: ["Beltrano Teste"], destaque: true } },
      { id: "teste-tp-2", title: "[TESTE] Urgente premium", date: `${iso(hoje)}T15:00`, category: "important", hub: { status: "aberta", responsaveis: ["Fulano Teste"], prioridade: "alta" } }
    ];
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("CalAppDB", 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("events")) req.result.createObjectStore("events", { keyPath: "id" }); };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { const tx = req.result.transaction("events", "readwrite"); eventos.forEach((e) => tx.objectStore("events").put(e)); tx.oncomplete = () => { req.result.close(); resolve(); }; };
    });
  });
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.click(".side-nav button[title='Calendário de Tarefas']");
  await page.waitForSelector(".calendar-shell iframe");
  await page.waitForTimeout(1500);
  const quadro = () => page.frames().find((f) => /calendar\.html/.test(f.url()));

  // Visual atual intacto.
  const molduraAtual = await page.locator(".calendar-shell").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("visual atual: moldura do calendário branca", molduraAtual === "rgb(255, 255, 255)", molduraAtual);
  check("visual atual: calendário sem o tema premium", (await quadro().evaluate(() => document.documentElement.className)) === "");
  check("texto do calendário em português (\"+ nova\" e \"barra lateral\")", await quadro().evaluate(() => !document.body.innerHTML.includes("+ add") && !/na sidebar/.test(document.body.innerText)));

  // Liga o visual premium pelo Quadro geral (sem recarregar): o calendário acompanha na hora.
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", "escuro"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(800);
  const classes = await quadro().evaluate(() => document.documentElement.className);
  check("calendário entra no tema escuro junto com o HUB", /ht-premium ht-premium--escuro ht-premium--compacto/.test(classes), classes);
  const fundoIframe = await quadro().evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("fundo do calendário transparente (vidro do HUB por trás)", fundoIframe === "rgba(0, 0, 0, 0)", fundoIframe);
  const moldura = await page.locator(".calendar-shell").evaluate((el) => ({ fundo: getComputedStyle(el).backgroundColor, raio: getComputedStyle(el).borderTopLeftRadius }));
  check("moldura e barra lateral em vidro arredondado", moldura.fundo !== "rgb(255, 255, 255)" && moldura.raio === "24px", JSON.stringify(moldura));
  const hoje = await quadro().evaluate(() => getComputedStyle(document.querySelector(".day-num.today")).backgroundColor);
  check("dia de hoje na cor de destaque", hoje !== "rgb(127, 119, 221)", hoje);
  const destaque = await page.locator(".task-item--featured").first().evaluate((el) => getComputedStyle(el).borderTopColor).catch(() => "sem destaque");
  check("tarefa em destaque sem o amarelo antigo", destaque !== "rgb(216, 173, 67)", destaque);
  const ruinsHub = await page.evaluate(auditar, "escuro");
  const ruinsCal = await quadro().evaluate(auditar, "escuro");
  check("escuro: barra lateral legível (≥ 4,5:1)", ruinsHub.length === 0, ruinsHub.slice(0, 4).join(" | "));
  check("escuro: calendário legível (≥ 4,5:1)", ruinsCal.length === 0, ruinsCal.slice(0, 4).join(" | "));
  await page.screenshot({ path: path.join(OUT, "tarefas-premium-escuro.png") });
  await quadro().click("#vbtn-reminders");
  await page.waitForTimeout(400);
  const ruinsLista = await quadro().evaluate(auditar, "escuro");
  check("escuro: visão Lista legível", ruinsLista.length === 0, ruinsLista.slice(0, 4).join(" | "));
  await quadro().click("#vbtn-month");

  // Paleta: Azul chega ao calendário.
  await page.click(".sidebar button:has-text('Personalizar visual')");
  await page.click(".hp-paleta-amostra[aria-label='Azul']");
  await page.waitForTimeout(500);
  const matiz = await quadro().evaluate(() => document.documentElement.style.getPropertyValue("--ht-h"));
  check("paleta Azul chega ao calendário", matiz.trim() === "215", matiz);
  // Tema claro e ampliado pelo painel.
  await page.click(".hp-paleta-alternar button:has-text('Claro')");
  await page.click(".hp-paleta-alternar button:has-text('Ampliado')");
  await page.click(".hp-paleta-restaurar");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const classesClaro = await quadro().evaluate(() => document.documentElement.className);
  check("calendário segue o tema claro e o texto ampliado", /ht-premium--claro/.test(classesClaro) && /ht-premium--ampliado/.test(classesClaro), classesClaro);
  const ruinsHubC = await page.evaluate(auditar, "claro");
  const ruinsCalC = await quadro().evaluate(auditar, "claro");
  check("claro: barra lateral legível", ruinsHubC.length === 0, ruinsHubC.slice(0, 4).join(" | "));
  check("claro: calendário legível", ruinsCalC.length === 0, ruinsCalC.slice(0, 4).join(" | "));
  await page.screenshot({ path: path.join(OUT, "tarefas-premium-claro-ampliado.png") });

  // Formulário de tarefa: folha clara.
  await page.click(".task-new-button");
  await page.waitForSelector(".task-sidebar--form");
  const formulario = await page.locator(".task-sidebar--form").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("formulário de tarefa em folha clara", formulario === "rgb(255, 255, 255)", formulario);
  await page.locator(".task-sidebar--form button", { hasText: /Cancelar|Voltar|Fechar/ }).first().click().catch(() => {});

  // Desligar o premium: o calendário volta ao normal na hora.
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "0"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(800);
  check("desligar o premium volta o calendário ao normal", (await quadro().evaluate(() => document.documentElement.className)) === "");

  check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => { ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta"].forEach((k) => localStorage.removeItem(k)); });
  await browser.close();
  console.log(results.join("\n"));
})().catch((e) => {
  console.log(results.join("\n"));
  console.log("ERRO " + e.message);
  process.exit(1);
});
