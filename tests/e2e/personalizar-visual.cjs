// Painel "Personalizar visual" (padrão H. Teixeira Premium): cor de destaque, nuances, temas,
// guarda de contraste, restaurar padrão e gravação no navegador (modo local, localhost).
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

function rgb(texto) {
  const m = String(texto).match(/[\d.]+/g) || [];
  return m.slice(0, 3).map(Number);
}
function luminancia([r, g, b]) {
  const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function matiz([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.location().url + m.text())) errors.push(m.text()); });

  await page.goto(BASE + "/");
  await page.evaluate(() => {
    localStorage.setItem("hub_qg_visual_premium", "1");
    localStorage.setItem("hub_qp_tema", "escuro");
    localStorage.setItem("hub_qp_tamanho", "compacto");
    localStorage.removeItem("ht_premium_paleta");
  });
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".qp", { timeout: 10000 });
  await page.waitForTimeout(600);

  const corIcone = async () => rgb(await page.locator(".side-nav button.active .side-nav-icon").first().evaluate((el) => getComputedStyle(el).color));
  const padrao = await corIcone();
  check("destaque padrão turquesa H. Teixeira", Math.abs(matiz(padrao) - 179) <= 3, JSON.stringify(padrao));

  // Abre pelo menu lateral.
  const botaoMenu = page.locator(".sidebar button:has-text('Personalizar visual')");
  check("botão Personalizar visual no menu lateral", (await botaoMenu.count()) === 1);
  await botaoMenu.click();
  await page.waitForSelector(".hp-paleta[role='dialog']");
  check("gaveta abre como diálogo", (await page.locator(".hp-paleta[aria-modal='true']").count()) === 1);
  check("restaurar desabilitado com a paleta padrão", await page.locator(".hp-paleta-restaurar").isDisabled());
  await page.screenshot({ path: path.join(OUT, "paleta-escuro.png") });

  // Cor de destaque: Azul.
  await page.click(".hp-paleta-amostra[aria-label='Azul']");
  await page.waitForTimeout(300);
  const azul = await corIcone();
  check("trocar para Azul muda o destaque do app", Math.abs(matiz(azul) - 215) <= 6, JSON.stringify(azul));
  const gravado = await page.evaluate(() => JSON.parse(localStorage.getItem("ht_premium_paleta") || "{}"));
  check("paleta gravada no navegador", gravado.base === 215 && gravado.h === 215, JSON.stringify(gravado));
  check("guarda de contraste avisa quando ajusta o tom", (await page.locator(".hp-paleta-aviso").count()) === 1);

  // Matiz fino +20.
  await page.locator(".hp-paleta-controle", { hasText: "Matiz fino" }).locator("input").fill("235");
  await page.waitForTimeout(200);
  check("matiz fino até +20°", (await page.evaluate(() => JSON.parse(localStorage.getItem("ht_premium_paleta")).h)) === 235);

  // Luzes de fundo 0.
  await page.locator(".hp-paleta-controle", { hasText: "Luzes de fundo" }).locator("input").fill("0");
  await page.waitForTimeout(200);
  const opOrbe = await page.locator(".hp-orbe--1").evaluate((el) => getComputedStyle(el).opacity);
  check("luzes em 0 apagam as luzes de fundo", Number(opOrbe) === 0, opOrbe);

  // Cantos 12px.
  await page.locator(".hp-paleta-controle", { hasText: "Cantos" }).locator("input").fill("12");
  await page.waitForTimeout(200);
  const raio = await page.locator(".qp-B").evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  check("cantos dos cartões seguem o controle", raio === "12px", raio);

  // Sombra 0.
  await page.locator(".hp-paleta-controle", { hasText: "Sombra" }).locator("input").fill("0");
  await page.waitForTimeout(200);
  const sombra = await page.locator(".qp-B").evaluate((el) => getComputedStyle(el).boxShadow);
  check("sombra em 0 tira a sombra projetada", /0px 0px 0px -30px/.test(sombra) || !/24px 60px/.test(sombra), sombra.slice(0, 90));

  // Degradê 0: fundo chapado.
  const fundoAntes = await page.locator(".hp-fundo").evaluate((el) => getComputedStyle(el).backgroundImage);
  await page.locator(".hp-paleta-controle", { hasText: "Degradê do fundo" }).locator("input").fill("0");
  await page.waitForTimeout(200);
  const fundoDepois = await page.locator(".hp-fundo").evaluate((el) => getComputedStyle(el).backgroundImage);
  check("degradê em 0 deixa o fundo chapado", fundoAntes !== fundoDepois && !/rgb\(24, 38, 64\)/.test(fundoDepois), fundoDepois.slice(0, 120));

  // Coral de atraso não muda com a paleta.
  const coral = await page.locator(".qp .qp-rotulo--urgente").first().evaluate((el) => getComputedStyle(el).color);
  check("coral de atenção não muda com a paleta", coral === "rgb(255, 122, 107)", coral);

  // Recarregar mantém.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("Esc fecha a gaveta", (await page.locator(".hp-paleta").count()) === 0);
  await page.reload();
  await page.waitForSelector(".qp", { timeout: 10000 });
  await page.waitForTimeout(400);
  check("recarregar mantém a paleta", Math.abs(matiz(await corIcone()) - 235) <= 6);

  // Tema claro pelo botão do Quadro + intensidade máxima: contraste do texto branco sobre o destaque.
  await page.click(".qp button[aria-label='Personalizar visual']");
  await page.waitForSelector(".hp-paleta");
  await page.click(".hp-paleta-alternar button:has-text('Claro')");
  await page.waitForTimeout(300);
  check("tema claro aplicado pelo painel", (await page.locator(".app-shell.hub-premium--claro").count()) === 1);
  check("sem lilás no tema claro", (await page.locator(".hp-paleta-amostra[aria-label='Lilás']").count()) === 0);
  await page.click(".hp-paleta-amostra[aria-label='Verde']");
  await page.locator(".hp-paleta-controle", { hasText: "Intensidade da cor" }).locator("input").fill("100");
  await page.waitForTimeout(300);
  const botaoAtivo = page.locator(".hp-paleta-alternar button[aria-pressed='true']").first();
  const par = await botaoAtivo.evaluate((el) => ({ fundo: getComputedStyle(el).backgroundColor, texto: getComputedStyle(el).color }));
  const c = contraste(rgb(par.fundo), rgb(par.texto));
  check("contraste do texto sobre o destaque ≥ 4,5:1", c >= 4.5, `${c.toFixed(2)} ${JSON.stringify(par)}`);
  await page.screenshot({ path: path.join(OUT, "paleta-claro.png") });

  // Restaurar padrão.
  await page.click(".hp-paleta-restaurar");
  await page.waitForTimeout(300);
  const restaurado = await page.evaluate(() => JSON.parse(localStorage.getItem("ht_premium_paleta")));
  check("restaurar padrão H. Teixeira", restaurado.base === 179 && restaurado.luz === 100 && restaurado.raio === 24, JSON.stringify(restaurado));
  check("restaurar fica desabilitado depois", await page.locator(".hp-paleta-restaurar").isDisabled());
  await page.keyboard.press("Escape");

  // Celular: gaveta cabe na tela.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click(".qp button[aria-label='Personalizar visual']");
  await page.waitForTimeout(300);
  const caixa = await page.locator(".hp-paleta").boundingBox();
  check("gaveta cabe no celular", caixa && caixa.x >= 0 && caixa.x + caixa.width <= 390, JSON.stringify(caixa));

  check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => {
    ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta"].forEach((k) => localStorage.removeItem(k));
  });
  await browser.close();
  console.log(results.join("\n"));
})().catch((e) => {
  console.log(results.join("\n"));
  console.log("ERRO " + e.message);
  process.exit(1);
});
