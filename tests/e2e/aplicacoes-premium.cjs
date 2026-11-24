// Analista de Aplicações Financeiras no visual premium: menu e cabeçalho do app em vidro, campos brancos,
// diálogos em folha clara, contraste nas páginas nos dois temas, ampliado sem botões fora da tela,
// impressão e visual atual intactos, fontes liberadas na política de segurança (modo local, localhost).
// O login do HUB é simulado: perfil "[TESTE] Administrador" servido por rota interceptada (nada sai da máquina).
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

const PAGINAS = ["dashboard", "positions", "events", "imports", "analysis", "fiscal", "reconciliation", "closures", "reviews", "templates", "homologation", "pilot", "observability", "projects", "backup"];
const SUPA = "https://demo-teste.supabase.co";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const JWT = `${b64({ alg: "HS256" })}.${b64({ sub: "00000000-0000-0000-0000-0000000000aa", exp: Math.floor(Date.now() / 1000) + 3600 })}.teste`;

function auditar(arg) {
  const tema = typeof arg === "string" ? arg : arg.tema;
  const raiz = (typeof arg === "string" ? null : document.querySelector(arg.raiz)) || document.body;
  const parse = (c) => { const m = c.match(/[\d.]+/g) || []; const k = /^color\(/.test(c) ? 255 : 1; return { r: +m[0] * k, g: +m[1] * k, b: +m[2] * k, a: m[3] === undefined ? 1 : +m[3] }; };
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
  const ruins = [];
  for (const el of raiz.querySelectorAll("*")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || +cs.opacity === 0 || cs.display === "none") continue;
    if (el.closest("svg, dialog:not([open]), .busy-overlay.hidden")) continue;
    const bg = fundo(el), cor = mix(parse(cs.color), bg);
    const c = (Math.max(lum(cor), lum(bg)) + .05) / (Math.min(lum(cor), lum(bg)) + .05);
    if (c < 4.5) ruins.push(`${c.toFixed(2)} "${el.textContent.trim().slice(0, 24)}"`);
  }
  return ruins;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  await context.route(`${SUPA}/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "00000000-0000-0000-0000-0000000000aa", email: "teste@hteixeira.local", nome: "[TESTE] Administrador", role: "admin", active: true }]) }));
  const page = await context.newPage();
  const errors = [];
  const csp = [];
  const ouvir = (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/i.test(m.text())) csp.push(m.text().slice(0, 140)); });
  };
  ouvir(page);

  await page.goto(BASE + "/");
  await page.evaluate(([url, jwt]) => {
    ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta"].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem("hub_supabase_public", JSON.stringify({ url, anonKey: "anon-teste" }));
    localStorage.setItem("sb-demo-teste-auth-token", JSON.stringify({ access_token: jwt }));
  }, [SUPA, JWT]);
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.locator(".sidebar button", { hasText: "Aplicações financeiras" }).first().click();
  const app = () => page.frames().find((f) => /\/apps\/simuladores\/aplicacoes-financeiras\//.test(f.url()));
  await page.waitForTimeout(1500);
  await app().waitForSelector("body:not(.auth-locked) .nav button.active", { timeout: 20000 });
  await page.waitForTimeout(800);

  // Visual atual: nada muda.
  const atual = await app().evaluate(() => ({ cls: document.documentElement.className, menu: getComputedStyle(document.querySelector(".sidebar")).backgroundColor }));
  check("visual atual: app sem o tema premium", !/ht-premium/.test(atual.cls), atual.cls);
  check("visual atual: menu do app na cor original", atual.menu === "rgb(255, 255, 255)", atual.menu);

  // Liga o premium (escuro) sem recarregar.
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", "escuro"); localStorage.setItem("hub_qp_tamanho", "compacto"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(900);
  const prem = await app().evaluate(() => {
    const q = (s) => getComputedStyle(document.querySelector(s));
    return { cls: document.documentElement.className, html: q("html").backgroundColor, menu: q(".sidebar").backgroundColor, ativo: q(".nav button.active").backgroundColor, botao: q("#exportButton").backgroundColor, campo: q("#projectSelect").backgroundColor, campoFonte: q("#projectSelect").fontFamily, kpi: q(".kpi").backgroundColor, fonte: q("body").fontFamily };
  });
  check("premium: app recebe o tema escuro na hora", /ht-premium--escuro/.test(prem.cls), prem.cls);
  check("premium: fundo transparente (segue o fundo do HUB)", prem.html === "rgba(0, 0, 0, 0)", prem.html);
  check("premium: menu do app em vidro", /^rgba\(255, 255, 255, 0\.0/.test(prem.menu), prem.menu);
  check("premium: item ativo com brilho do acento", /^hsla|^rgba|^color/.test(prem.ativo) && prem.ativo !== "rgba(0, 0, 0, 0)", prem.ativo);
  check("premium: botão principal na cor do acento", !/10, 89, 97/.test(prem.botao), prem.botao);
  check("premium: campos em folha branca com DM Sans", prem.campo === "rgb(255, 255, 255)" && /DM Sans/.test(prem.campoFonte), prem.campo + " " + prem.campoFonte);
  check("premium: indicadores em vidro", /^rgba\(255, 255, 255, 0\.0/.test(prem.kpi), prem.kpi);
  check("premium: fonte DM Sans", /DM Sans/.test(prem.fonte), prem.fonte);
  const moldura = await page.locator(".frame-page").evaluate((el) => el.className);
  check("premium: moldura do HUB transparente (premium: true no cadastro)", /frame-page--premium/.test(moldura), moldura);

  // Diálogo: folha clara, legível no tema escuro.
  await app().evaluate(() => document.getElementById("backupDialog").showModal());
  await page.waitForTimeout(300);
  const dlg = await app().evaluate(() => ({ bg: getComputedStyle(document.getElementById("backupDialog")).backgroundColor, cor: getComputedStyle(document.querySelector("#backupDialog h2")).color }));
  check("diálogo: folha branca com título escuro", dlg.bg === "rgb(255, 255, 255)" && dlg.cor === "rgb(17, 24, 48)", JSON.stringify(dlg));
  const ruinsDlg = await app().evaluate(auditar, { tema: "claro", raiz: "#backupDialog" });
  check("diálogo: contraste mínimo 4,5:1", ruinsDlg.length === 0, ruinsDlg.slice(0, 3).join(" | "));
  await app().evaluate(() => document.getElementById("backupDialog").close());

  // Impressão: volta ao visual original.
  await page.emulateMedia({ media: "print" });
  const impMenu = await app().evaluate(() => getComputedStyle(document.querySelector(".sidebar")).backgroundColor);
  check("impressão: sem o vidro do premium", !/^rgba\(255, 255, 255, 0\.0/.test(impMenu), impMenu);
  await page.emulateMedia({ media: "screen" });

  // Todas as páginas, nos dois temas; no ampliado, os botões do cabeçalho cabem na tela.
  for (const [tema, tamanho] of [["escuro", "compacto"], ["claro", "compacto"], ["escuro", "ampliado"]]) {
    await page.evaluate(([t, z]) => { localStorage.setItem("hub_qp_tema", t); localStorage.setItem("hub_qp_tamanho", z); window.dispatchEvent(new Event("hub:visual-premium")); }, [tema, tamanho]);
    await page.waitForTimeout(700);
    const ruinsTodas = [];
    for (const pg of PAGINAS) {
      await app().click(`.nav button[data-page="${pg}"]`);
      await page.waitForTimeout(350);
      const r = await app().evaluate(auditar, tema);
      if (r.length) ruinsTodas.push(`${pg}: ${r.slice(0, 2).join(", ")}`);
    }
    check(`${tema}, ${tamanho}: contraste mínimo 4,5:1 nas ${PAGINAS.length} páginas`, ruinsTodas.length === 0, ruinsTodas.slice(0, 4).join(" | "));
    if (tamanho === "ampliado") {
      await app().click('.nav button[data-page="dashboard"]');
      const fora = await app().evaluate(() => [...document.querySelectorAll(".topbar .button:not(.hidden)")].filter((b) => b.offsetParent && b.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map((b) => b.textContent.trim()));
      check("ampliado: botões do cabeçalho dentro da tela", fora.length === 0, fora.join(", "));
      const zoom = await app().evaluate(() => getComputedStyle(document.body).zoom);
      check("ampliado: app maior por inteiro", Number(zoom) > 1.1, zoom);
    }
  }

  // Aberto sozinho (nova janela): mesmo visual, com o fundo do tema.
  const solo = await context.newPage();
  ouvir(solo);
  await solo.goto(BASE + "/apps/simuladores/aplicacoes-financeiras/index.html");
  await solo.waitForSelector("body:not(.auth-locked) .nav button.active", { timeout: 20000 });
  const fundoSolo = await solo.evaluate(() => ({ cls: document.documentElement.className, img: getComputedStyle(document.documentElement).backgroundImage }));
  check("janela própria: tema premium com fundo do tema", /ht-premium--escuro/.test(fundoSolo.cls) && /gradient/.test(fundoSolo.img), fundoSolo.cls);
  await solo.close();

  check("política de segurança: fontes do padrão liberadas (sem bloqueio)", csp.length === 0, csp.slice(0, 2).join(" | "));
  check("sem erros de página", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta", "hub_supabase_public", "sb-demo-teste-auth-token"].forEach((k) => localStorage.removeItem(k)));
  await browser.close();
  console.log(results.join("\n"));
  const falhas = results.filter((r) => r.startsWith("FALHA")).length;
  console.log(`\n${results.length - falhas}/${results.length} verificações OK`);
  process.exit(falhas ? 1 : 0);
})();
