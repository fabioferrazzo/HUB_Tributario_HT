// Avaliações no visual premium: painel da coordenação em vidro (colunas, cartões, situações), avaliação aberta
// com as seções da planilha em folha clara, médias em vidro, contraste e visual atual intacto (modo local).
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

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.location().url + m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  const entrar = async (email) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(400);
    if (email) await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    await page.locator(".sidebar button", { hasText: "Avaliações" }).first().click();
    await page.waitForTimeout(800);
  };
  const botao = (nome) => page.getByRole("button", { name: nome, exact: true });

  // Uma autoavaliação enviada pelo colaborador (dados [TESTE] locais).
  await page.goto(BASE + "/");
  await page.evaluate(() => { ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta"].forEach((k) => localStorage.removeItem(k)); });
  await entrar("colaborador@hteixeira.local");
  const notas = page.locator('input[aria-label^="Nota do colaborador"]');
  for (let i = 0; i < 7; i++) {
    await notas.nth(i).fill("9");
    await page.locator('textarea[aria-label^="Justificativa do colaborador"]').nth(i).fill(`[TESTE] Justificativa ${i + 1}`);
  }
  await botao("Salvar para a coordenação").click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Sair/ }).first().click();
  await page.waitForTimeout(600);

  // Coordenação: visual atual intacto.
  await entrar();
  const colunaAtual = await page.locator(".avd-coluna").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check("visual atual: colunas da coordenação claras", colunaAtual === "rgb(251, 252, 251)", colunaAtual);

  for (const tema of ["escuro", "claro"]) {
    await page.evaluate((t) => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", t); window.dispatchEvent(new Event("hub:visual-premium")); }, tema);
    await page.waitForTimeout(600);
    const folha = await page.locator(".workspace-body").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`${tema}: Avaliações fora da folha clara provisória`, folha === "rgba(0, 0, 0, 0)", folha);
    const coluna = await page.locator(".avd-coluna").first().evaluate((el) => ({ fundo: getComputedStyle(el).backgroundColor, raio: getComputedStyle(el).borderTopLeftRadius }));
    check(`${tema}: colunas em vidro arredondado`, coluna.fundo !== "rgb(251, 252, 251)" && coluna.raio === "16px", JSON.stringify(coluna));
    const enviada = await page.locator(".avd-coluna .avd-pill--enviada").first().evaluate((el) => getComputedStyle(el).color);
    check(`${tema}: "Aguardando correção" em âmbar`, enviada === (tema === "escuro" ? "rgb(240, 196, 106)" : "rgb(138, 83, 0)"), enviada);
    const ruinsPainel = await page.evaluate(auditar, [tema, ".workspace-body"]);
    check(`${tema}: painel da coordenação legível (≥ 4,5:1)`, ruinsPainel.length === 0, ruinsPainel.slice(0, 4).join(" | "));
    await page.screenshot({ path: path.join(OUT, `avaliacoes-painel-${tema}.png`) });

    // Avaliação aberta.
    await page.locator(".avd-card").first().click();
    await page.waitForSelector(".avd-sec");
    await page.waitForTimeout(500);
    const secao = await page.locator(".avd-sec").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`${tema}: seções da planilha em folha clara`, secao === "rgb(255, 255, 255)", secao);
    const media = await page.locator(".avd-media").first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "sem médias");
    check(`${tema}: médias em vidro`, media !== "rgb(223, 233, 245)", media);
    const ruinsForm = await page.evaluate(auditar, [tema, ".workspace-body"]);
    check(`${tema}: avaliação aberta legível (≥ 4,5:1)`, ruinsForm.length === 0, ruinsForm.slice(0, 4).join(" | "));
    await page.screenshot({ path: path.join(OUT, `avaliacoes-aberta-${tema}.png`), fullPage: true });
    await page.locator(".avd-topo .avd-btn").first().click();
    await page.waitForSelector(".avd-painel");
    await page.waitForTimeout(400);
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
