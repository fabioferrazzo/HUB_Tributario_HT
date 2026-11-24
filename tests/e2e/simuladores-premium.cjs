// Simuladores no visual premium: moldura transparente, cada simulador seguindo tema, tamanho e paleta
// pela ponte hub-premium-app.js, contraste nos dois temas, valores dentro dos cartões, impressão e
// visual atual intacto (modo local, localhost).
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

const SIMULADORES = [
  "Mapa de alíquotas ICMS",
  "DIFAL e antecipação RS",
  "Alíquota IBS/CBS no Simples",
  "Alíquota efetiva do Simples",
  "Fator R",
  "Retenções em NFS-e",
  "CBS/IBS Imobiliário",
  "CBS/IBS Rural"
];

function auditar(tema) {
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
  for (const el of document.body.querySelectorAll("*")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || +cs.opacity === 0 || cs.display === "none") continue;
    if (el.closest("svg, .dlg")) continue;
    const bg = fundo(el), cor = mix(parse(cs.color), bg);
    const c = (Math.max(lum(cor), lum(bg)) + .05) / (Math.min(lum(cor), lum(bg)) + .05);
    if (c < 4.5) ruins.push(`${c.toFixed(2)} "${el.textContent.trim().slice(0, 24)}"`);
  }
  return ruins;
}

// Valores dos indicadores não podem passar da borda do cartão.
function vazamentos() {
  const fora = [];
  for (const el of document.querySelectorAll(".kpi .val, .kpi .value, .stat strong, .res-top .val, .tax .rate, .cartao-op .val")) {
    const pai = el.closest(".kpi, .stat, .res-top, .tax, .cartao-op");
    if (!pai || !el.getBoundingClientRect().width) continue;
    if (el.scrollWidth > pai.clientWidth + 1) fora.push(el.textContent.trim());
  }
  return fora;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g|Failed to load resource/.test(m.location().url + m.text())) errors.push(m.text()); });

  await page.goto(BASE + "/");
  await page.evaluate(() => ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta"].forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  const abrir = async (label) => {
    await page.locator(".sidebar button", { hasText: label }).first().click();
    await page.waitForTimeout(1600);
    return page.frames().find((f) => /\/apps\/simuladores\//.test(f.url()));
  };

  // Visual atual: nada muda.
  let quadro = await abrir("Fator R");
  check("visual atual: simulador sem o tema premium", (await quadro.evaluate(() => document.documentElement.className)) === "");
  check("visual atual: moldura branca", (await page.locator(".frame-page").evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgb(255, 255, 255)");
  check("visual atual: painel do simulador branco", (await quadro.evaluate(() => getComputedStyle(document.querySelector(".painel")).backgroundColor)) === "rgb(255, 255, 255)");

  // Liga o premium sem recarregar: o simulador acompanha na hora.
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", "escuro"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(900);
  check("premium: simulador recebe o tema escuro na hora", (await quadro.evaluate(() => document.documentElement.className)).includes("ht-premium--escuro"));
  const moldura = await page.locator(".frame-page").evaluate((el) => ({ cls: el.className, bg: getComputedStyle(el).backgroundColor, cs: getComputedStyle(el.querySelector("iframe")).colorScheme }));
  check("premium: moldura transparente e migrada", /frame-page--premium/.test(moldura.cls) && /hp-migrada/.test(moldura.cls) && moldura.bg === "rgba(0, 0, 0, 0)", JSON.stringify(moldura));
  check("premium: iframe com o mesmo esquema de cores (fundo transparente)", moldura.cs === "dark", moldura.cs);
  check("premium: fora da folha clara", (await page.locator(".workspace-body").evaluate((el) => getComputedStyle(el).backgroundColor)) !== "rgb(244, 241, 234)");
  const estilo = await quadro.evaluate(() => {
    const p = getComputedStyle(document.querySelector(".painel"));
    const campo = getComputedStyle(document.querySelector("input.num"));
    return { body: getComputedStyle(document.body).backgroundColor, painel: p.backgroundColor, fonte: getComputedStyle(document.body).fontFamily, campo: campo.backgroundColor, campoCor: campo.color, destaque: getComputedStyle(document.querySelector(".kpi.destaque")).backgroundImage };
  });
  check("premium: fundo do simulador transparente", estilo.body === "rgba(0, 0, 0, 0)", estilo.body);
  check("premium: painéis de vidro", /^rgba\(255, 255, 255, 0\.0/.test(estilo.painel), estilo.painel);
  check("premium: fonte DM Sans", /DM Sans/.test(estilo.fonte), estilo.fonte);
  check("premium: campos em folha branca com texto escuro", estilo.campo === "rgb(255, 255, 255)" && estilo.campoCor === "rgb(26, 32, 51)", estilo.campo + " " + estilo.campoCor);
  check("premium: destaque sem o degradê azul-marinho antigo", !/18, 58, 99/.test(estilo.destaque), estilo.destaque.slice(0, 60));

  // Paleta: o acento muda junto com o HUB.
  const acentoAntes = await quadro.evaluate(() => getComputedStyle(document.querySelector(".abas button.ativo")).backgroundColor);
  await page.evaluate(() => { localStorage.setItem("ht_premium_paleta", JSON.stringify({ base: "azul", h: 215, s: 75, luz: 100, degrade: 100, angulo: null, vidro: 100, sombra: 100, raio: 24, versao: 1 })); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(900);
  const acentoDepois = await quadro.evaluate(() => getComputedStyle(document.querySelector(".abas button.ativo")).backgroundColor);
  check("paleta: acento do simulador acompanha a do HUB", acentoAntes !== acentoDepois, `${acentoAntes} -> ${acentoDepois}`);
  await page.evaluate(() => { localStorage.removeItem("ht_premium_paleta"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(600);

  // Impressão: volta ao visual original (fundo branco, texto escuro).
  await page.emulateMedia({ media: "print" });
  const corImp = await quadro.evaluate(() => getComputedStyle(document.querySelector(".painel")).backgroundColor);
  check("impressão: painel volta ao branco", corImp === "rgb(255, 255, 255)", corImp);
  await page.emulateMedia({ media: "screen" });

  // Todos os simuladores, nos dois temas e nos dois tamanhos.
  for (const [tema, tamanho] of [["escuro", "compacto"], ["claro", "compacto"], ["escuro", "ampliado"], ["claro", "ampliado"]]) {
    await page.evaluate(([t, z]) => { localStorage.setItem("hub_qp_tema", t); localStorage.setItem("hub_qp_tamanho", z); window.dispatchEvent(new Event("hub:visual-premium")); }, [tema, tamanho]);
    await page.waitForTimeout(500);
    for (const label of SIMULADORES) {
      quadro = await abrir(label);
      const cls = quadro ? await quadro.evaluate(() => document.documentElement.className) : "";
      const ok = cls.includes(`ht-premium--${tema}`) && cls.includes(`ht-premium--${tamanho}`);
      const ruins = ok ? await quadro.evaluate(auditar, tema) : ["sem tema"];
      const fora = ok ? await quadro.evaluate(vazamentos) : [];
      check(`${label} (${tema}, ${tamanho}): contraste mínimo 4,5:1`, ruins.length === 0, ruins.slice(0, 4).join(" | "));
      if (tema === "escuro") check(`${label} (${tamanho}): valores dentro dos cartões`, fora.length === 0, fora.join(" | "));
    }
  }

  // Título do app numa linha só no cabeçalho (ampliado, 1440 px).
  const titulo = await page.locator(".topbar h1").evaluate((el) => ({ h: el.getBoundingClientRect().height, ws: getComputedStyle(el).whiteSpace }));
  check("cabeçalho: título do app em uma linha", titulo.ws === "nowrap" && titulo.h < 48, JSON.stringify(titulo));
  const marca = await page.locator(".topbar-brand-strip span").evaluate((el) => { const r = el.getBoundingClientRect(); const p = el.parentElement.getBoundingClientRect(); return getComputedStyle(el).display === "none" || r.right <= p.right + 1; });
  check("cabeçalho: assinatura nunca aparece cortada", marca);

  check("sem erros de página", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta"].forEach((k) => localStorage.removeItem(k)));
  await browser.close();
  console.log(results.join("\n"));
  const falhas = results.filter((r) => r.startsWith("FALHA")).length;
  console.log(`\n${results.length - falhas}/${results.length} verificações OK`);
  process.exit(falhas ? 1 : 0);
})();
