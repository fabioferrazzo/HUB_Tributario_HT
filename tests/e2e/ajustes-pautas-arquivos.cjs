// Ajustes de nov/2026 (visual premium): título da pauta com tamanho e negrito, grifo amarelo, destaque dourado,
// tamanhos por trecho proporcionais, nome dos arquivos sempre inteiro, relógio no cabeçalho e sem a aba Pautas (app).
// Modo local (localhost). Itens de teste marcados com [TESTE].
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/");
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", "escuro"); localStorage.setItem("hub_qp_tamanho", "compacto"); });
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  // Cabeçalho e menu.
  const hora = (await page.locator(".top-chip--relogio time").textContent() || "").trim();
  check("cabeçalho: relógio HH:MM", /^\d{2}:\d{2}$/.test(hora), hora);
  check("cabeçalho: sem o atalho Pautas HUB app", (await page.locator(".topbar", { hasText: "Pautas HUB" }).count()) === 0);
  check("menu: sem a aba Pautas (app)", (await page.locator(".sidebar button", { hasText: "Pautas (app)" }).count()) === 0);

  // Pauta com título muito grande + negrito, grifo e destaque.
  await page.click(".side-nav button[title='Pautas']");
  await page.waitForTimeout(1000);
  await page.click(".pautas-page button:has-text('Nova pauta')");
  await page.waitForTimeout(300);
  await page.fill(".pauta-titulo-campo input", "[TESTE] Título da pauta formatado");
  await page.click(".pauta-titulo-formato button[title='Título muito grande']");
  await page.click(".pauta-titulo-formato button[title='Título em negrito']");
  const editor = page.locator(".pauta-editor-panel [contenteditable='true']").first();
  await editor.click();
  await page.keyboard.type("Texto [TESTE] grifado");
  await page.keyboard.press("Control+A");
  await page.locator(".pauta-editor-panel button[title*='rifo'], .pauta-editor-panel button[aria-label*='rifo']").first().click();
  const destaque = page.locator(".pauta-editor-panel label", { hasText: "Destacar pauta" }).locator("input[type=checkbox]");
  if (await destaque.count()) await destaque.check();
  await page.click(".pauta-editor-panel button[type=submit]");
  await page.waitForTimeout(1200);
  const pauta = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".list-row--pauta")].find((x) => x.textContent.includes("Título da pauta formatado"));
    if (!row) return null;
    const t = row.querySelector(".pauta-content > strong");
    const normal = [...document.querySelectorAll(".list-row--pauta:not(.list-row--pauta-featured) .pauta-content > strong")][0];
    const m = row.querySelector(".pauta-description mark");
    return {
      featured: row.classList.contains("list-row--pauta-featured"),
      tam: parseFloat(getComputedStyle(t).fontSize), peso: +getComputedStyle(t).fontWeight, cor: getComputedStyle(t).color,
      tamNormal: normal ? parseFloat(getComputedStyle(normal).fontSize) : 0,
      borda: getComputedStyle(row).borderLeftWidth,
      grifo: m ? getComputedStyle(m).backgroundColor : "sem grifo",
      selo: getComputedStyle(row.querySelector(".status-pill--destaque") || row).backgroundColor
    };
  });
  check("pauta salva com o título formatado", Boolean(pauta));
  if (pauta) {
    check("título muito grande (maior que o normal)", pauta.tam > pauta.tamNormal * 1.3, `${pauta.tam} x ${pauta.tamNormal}`);
    check("título em negrito", pauta.peso >= 800, String(pauta.peso));
    check("grifo amarelo no premium", pauta.grifo === "rgb(255, 243, 163)", pauta.grifo);
    check("destaque: faixa dourada à esquerda e título dourado", pauta.featured && pauta.borda === "5px" && pauta.cor === "rgb(255, 227, 163)", `${pauta.borda} ${pauta.cor}`);
    check("destaque: selo dourado", pauta.selo === "rgb(240, 196, 106)", pauta.selo);
  }
  // Tamanhos por trecho proporcionais e negrito na linha.
  const trechos = await page.evaluate(() => {
    const d = document.querySelector(".list-row--pauta .pauta-description");
    d.innerHTML = 'base <span class="pauta-text-large">grande</span> <span class="pauta-text-title">título</span> <strong>negrito</strong>';
    const base = parseFloat(getComputedStyle(d).fontSize);
    return { base, grande: parseFloat(getComputedStyle(d.querySelector(".pauta-text-large")).fontSize), titulo: parseFloat(getComputedStyle(d.querySelector(".pauta-text-title")).fontSize), neg: getComputedStyle(d.querySelector("strong")).display };
  });
  check("trecho grande ~20% maior e título ~80% maior que o texto", trechos.grande >= trechos.base * 1.18 && trechos.titulo >= trechos.base * 1.7, JSON.stringify(trechos));
  check("negrito no meio do texto fica na linha", trechos.neg === "inline", trechos.neg);

  // Arquivos: nome inteiro.
  await page.click(".side-nav button[title='Arquivos']");
  await page.waitForTimeout(1000);
  const form = page.locator(".arquivos-form-panel");
  await form.locator("input").nth(0).fill("APRESENTAÇÃO [TESTE] — Reforma Tributária no Agronegócio — versão completa para clientes");
  await form.locator("input").nth(1).fill("https://example.com/teste");
  await form.locator("button:has-text('Salvar arquivo')").click();
  await page.waitForTimeout(1000);
  const nome = await page.evaluate(() => { const s = [...document.querySelectorAll(".file-resource strong")].find((x) => x.textContent.includes("APRESENTAÇÃO [TESTE]")); return s ? { ws: getComputedStyle(s).whiteSpace, cabe: s.scrollWidth <= s.clientWidth + 1 } : null; });
  check("Arquivos: nome do arquivo inteiro (sem reticências)", nome && nome.ws === "normal" && nome.cabe, JSON.stringify(nome));

  check("sem erros de página", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho"].forEach((k) => localStorage.removeItem(k)));
  await browser.close();
  console.log(results.join("\n"));
  const falhas = results.filter((r) => r.startsWith("FALHA")).length;
  console.log(`\n${results.length - falhas}/${results.length} verificações OK`);
  process.exit(falhas ? 1 : 0);
})();
