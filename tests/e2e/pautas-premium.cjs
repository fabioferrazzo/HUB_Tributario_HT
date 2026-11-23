// Pautas e Quadro de Avisos no visual premium: vidro, abas, filtros, etiquetas, editores em folha clara,
// contraste em todos os textos (temas escuro e claro) e visual atual intacto (modo local, localhost).
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

// Conta textos com contraste abaixo de 4,5:1 dentro da área de trabalho.
async function textosIlegiveis(page, tema) {
  return page.evaluate((tema) => {
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
    const ruins = [];
    for (const el of document.querySelectorAll(".workspace-body *")) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden" || +cs.opacity === 0) continue;
      if (el.closest("input, textarea, select, [contenteditable], .aviso-card--postit")) continue;
      const bg = fundo(el), cor = mix(parse(cs.color), bg);
      const c = (Math.max(lum(cor), lum(bg)) + .05) / (Math.min(lum(cor), lum(bg)) + .05);
      if (c < 4.5) ruins.push(`${c.toFixed(2)} "${el.textContent.trim().slice(0, 24)}" .${String(el.className).split(" ").join(".")}`);
    }
    return ruins;
  }, tema);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.location().url + m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());

  // Visual atual (premium desligado): nada muda.
  await page.goto(BASE + "/");
  await page.evaluate(() => { ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta"].forEach((k) => localStorage.removeItem(k)); });
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.click(".side-nav button[title='Pautas']");
  await page.waitForSelector(".pautas-page");
  await page.waitForTimeout(600);
  const painelAtual = await page.locator(".panel--pautas").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("visual atual: painel de Pautas continua branco", painelAtual === "rgb(255, 255, 255)", painelAtual);
  const mes = await page.locator(".pautas-monthbar strong").evaluate((el) => ({ texto: el.textContent, transformacao: getComputedStyle(el).textTransform }));
  check("mês com só a inicial maiúscula (\"Novembro de 2026\")", mes.transformacao === "none" && / de \d{4}$/.test(mes.texto), JSON.stringify(mes));

  for (const tema of ["escuro", "claro"]) {
    await page.evaluate((t) => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", t); localStorage.setItem("hub_qp_tamanho", "compacto"); }, tema);
    await page.reload();
    await page.waitForSelector(".hub-premium");
    await page.click(".side-nav button[title='Pautas']");
    await page.waitForSelector(".pautas-page.hp-migrada");
    await page.waitForTimeout(700);

    const folha = await page.locator(".workspace-body").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`${tema}: Pautas fora da folha clara provisória`, folha === "rgba(0, 0, 0, 0)", folha);
    const painel = await page.locator(".panel--pautas").evaluate((el) => ({ fundo: getComputedStyle(el).backgroundColor, raio: getComputedStyle(el).borderTopLeftRadius }));
    check(`${tema}: painel de Pautas em vidro arredondado`, painel.fundo !== "rgb(255, 255, 255)" && painel.raio === "24px", JSON.stringify(painel));
    const abaAtiva = await page.locator(".pautas-subtabs button.active").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`${tema}: aba ativa na cor de destaque`, /^rgb\(\d+, \d+, \d+\)$/.test(abaAtiva) && abaAtiva !== "rgb(30, 58, 95)", abaAtiva);
    const alta = await page.locator(".pauta-row-badges .status-pill--danger").first().evaluate((el) => getComputedStyle(el).color);
    check(`${tema}: etiqueta "alta" em coral`, alta === (tema === "escuro" ? "rgb(255, 122, 107)" : "rgb(185, 62, 14)"), alta);
    const destaque = await page.locator(".list-row--pauta-featured").first().evaluate((el) => getComputedStyle(el).borderTopColor);
    check(`${tema}: pauta em destaque sem o amarelo antigo`, destaque !== "rgb(229, 215, 164)", destaque);
    const ruinsPautas = await textosIlegiveis(page, tema);
    check(`${tema}: todos os textos de Pautas com contraste ≥ 4,5:1`, ruinsPautas.length === 0, ruinsPautas.slice(0, 4).join(" | "));
    await page.screenshot({ path: path.join(OUT, `pautas-premium-${tema}.png`) });

    // Editor de pauta: folha clara.
    await page.click(".pautas-page button:has-text('Nova pauta')");
    await page.waitForSelector(".pauta-editor-panel");
    const editor = await page.locator(".pauta-editor-panel").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`${tema}: editor de pauta em folha clara`, editor === "rgb(255, 255, 255)", editor);
    const ruinsEditor = await textosIlegiveis(page, tema);
    check(`${tema}: editor de pauta legível`, ruinsEditor.length === 0, ruinsEditor.slice(0, 4).join(" | "));
    await page.click(".pauta-editor-panel button:has-text('Cancelar')");
    await page.waitForTimeout(400);

    // Quadro de Avisos + painel de novo aviso.
    await page.click(".pautas-subtabs button:has-text('Quadro de Avisos')");
    await page.waitForSelector(".avisos-grid");
    await page.waitForTimeout(400);
    const celula = await page.locator(".aviso-cell").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`${tema}: espaços do quadro em vidro`, celula !== "rgb(255, 255, 255)" && celula !== "rgb(253, 252, 248)", celula);
    await page.click(".avisos-new");
    await page.waitForSelector(".avisos-editor-panel");
    const lateral = await page.locator(".avisos-editor-panel").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`${tema}: painel de novo aviso em folha clara`, lateral === "rgb(255, 255, 255)", lateral);
    const ruinsAvisos = await textosIlegiveis(page, tema);
    check(`${tema}: Quadro de Avisos legível`, ruinsAvisos.length === 0, ruinsAvisos.slice(0, 4).join(" | "));
    await page.screenshot({ path: path.join(OUT, `avisos-premium-${tema}.png`) });
    await page.click(".pautas-subtabs button:has-text('Pautas')");
  }

  // Ampliado: texto do título da pauta maior.
  const tituloCompacto = parseFloat(await page.locator(".list-row--pauta .pauta-content strong").first().evaluate((el) => getComputedStyle(el).fontSize));
  await page.evaluate(() => localStorage.setItem("hub_qp_tamanho", "ampliado"));
  await page.reload();
  await page.click(".side-nav button[title='Pautas']");
  await page.waitForSelector(".pautas-page.hp-migrada");
  await page.waitForTimeout(500);
  const tituloAmpliado = parseFloat(await page.locator(".list-row--pauta .pauta-content strong").first().evaluate((el) => getComputedStyle(el).fontSize));
  check("ampliado aumenta os títulos das pautas", tituloAmpliado / tituloCompacto >= 1.12, `${tituloCompacto} -> ${tituloAmpliado}`);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(300);
  const largura = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: window.innerWidth }));
  check("1100px ampliado sem rolagem lateral", largura.doc <= largura.tela + 1, JSON.stringify(largura));

  check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => { ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho"].forEach((k) => localStorage.removeItem(k)); });
  await browser.close();
  console.log(results.join("\n"));
})().catch((e) => {
  console.log(results.join("\n"));
  console.log("ERRO " + e.message);
  process.exit(1);
});
