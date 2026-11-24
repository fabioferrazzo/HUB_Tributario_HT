// Lembretes, Histórico e Configurações (administração) no visual premium: fora da folha clara provisória,
// painéis em vidro e contraste em todos os textos nos dois temas; visual atual intacto (modo local).
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

function auditar([tema, seletor]) {
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
  const raiz = document.querySelector(seletor);
  if (!raiz) return ["sem " + seletor];
  const ruins = [];
  for (const el of raiz.querySelectorAll("*")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    if (el.closest("input, textarea, select, [contenteditable]")) continue;
    const bg = fundo(el), cor = mix(parse(cs.color), bg);
    const c = (Math.max(lum(cor), lum(bg)) + .05) / (Math.min(lum(cor), lum(bg)) + .05);
    if (c < 4.5) ruins.push(`${c.toFixed(2)} "${el.textContent.trim().slice(0, 24)}" .${String(el.className).split(" ").join(".")}`);
  }
  return ruins;
}

const TELAS = [
  { nome: "Lembretes", abrir: (p) => p.evaluate(() => { location.hash = "#/lembretes"; }), raiz: ".lembretes-page" },
  { nome: "Histórico", abrir: (p) => p.click(".side-nav button[title='Histórico']"), raiz: ".historico-page" },
  { nome: "Configurações", abrir: (p) => p.click(".side-nav button[title='Configurações']"), raiz: ".admin-page" }
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.location().url + m.text())) errors.push(m.text()); });

  await page.goto(BASE + "/");
  await page.evaluate(() => { ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta"].forEach((k) => localStorage.removeItem(k)); });
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await TELAS[2].abrir(page);
  await page.waitForSelector(".admin-page");
  const atual = await page.locator(".admin-page .admin-user").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check("visual atual: usuários em cartões brancos", atual === "rgb(255, 255, 255)", atual);

  for (const tema of ["escuro", "claro"]) {
    await page.evaluate((t) => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", t); window.dispatchEvent(new Event("hub:visual-premium")); }, tema);
    await page.waitForTimeout(500);
    for (const tela of TELAS) {
      await tela.abrir(page);
      await page.waitForSelector(`${tela.raiz}.hp-migrada`);
      await page.waitForTimeout(600);
      const folha = await page.locator(".workspace-body").evaluate((el) => getComputedStyle(el).backgroundColor);
      const painel = await page.locator(`${tela.raiz} .panel`).first().evaluate((el) => ({ fundo: getComputedStyle(el).backgroundColor, raio: getComputedStyle(el).borderTopLeftRadius }));
      check(`${tema}: ${tela.nome} em vidro, fora da folha clara`, folha === "rgba(0, 0, 0, 0)" && painel.fundo !== "rgb(255, 255, 255)" && painel.raio === "24px", JSON.stringify(painel));
      const ruins = await page.evaluate(auditar, [tema, ".workspace-body"]);
      check(`${tema}: ${tela.nome} legível (≥ 4,5:1)`, ruins.length === 0, ruins.slice(0, 4).join(" | "));
      await page.screenshot({ path: path.join(OUT, `escritorio-${tela.nome.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}-${tema}.png`) });
    }
  }

  check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => { ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho"].forEach((k) => localStorage.removeItem(k)); });
  await browser.close();
  console.log(results.join("\n"));
})().catch((e) => {
  console.log(results.join("\n"));
  console.log("ERRO " + e.message);
  process.exit(1);
});
