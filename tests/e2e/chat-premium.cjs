// Chat no visual premium: janela flutuante e página em vidro, bolhas, composição (campo em folha clara),
// "Chamar atenção" em âmbar, contraste em todos os textos e visual atual intacto (modo local, localhost).
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g|Notification/.test(m.location().url + m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());

  await page.goto(BASE + "/");
  await page.evaluate(() => { ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta", "hub_chat_local"].forEach((k) => localStorage.removeItem(k)); });
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1300);

  // Visual atual: janela do chat branca.
  await page.locator('.topbar-actions button[aria-label^="Chat"]').click();
  await page.waitForSelector(".chat--janela");
  const janelaAtual = await page.locator(".chat--janela").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("visual atual: janela do chat continua branca", janelaAtual === "rgb(255, 255, 255)", janelaAtual);
  // Conversa com mensagem para os testes.
  const chat = page.locator(".chat--janela");
  await chat.getByRole("button", { name: "Nova conversa" }).click();
  await chat.locator(".chat-item", { hasText: "Colaborador" }).first().click();
  await page.waitForTimeout(400);
  await chat.locator(".chat-composer [contenteditable='true']").click();
  await page.keyboard.type("[TESTE] mensagem do visual premium");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);

  for (const tema of ["escuro", "claro"]) {
    await page.evaluate((t) => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", t); window.dispatchEvent(new Event("hub:visual-premium")); }, tema);
    await page.waitForTimeout(600);
    const janela = await page.locator(".chat--janela").evaluate((el) => ({ fundo: getComputedStyle(el).backgroundColor, raio: getComputedStyle(el).borderTopLeftRadius }));
    check(`${tema}: janela do chat em vidro arredondado`, janela.fundo !== "rgb(255, 255, 255)" && janela.raio === "24px", JSON.stringify(janela));
    const bolha = await page.locator(".chat--janela .chat-msg--minha").last().evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`${tema}: minha mensagem na cor de destaque`, bolha !== "rgb(232, 240, 251)", bolha);
    const campo = await page.locator(".chat--janela .chat-composer .rich-editor-field").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`${tema}: campo de escrever em folha clara`, campo === "rgb(255, 255, 255)", campo);
    const atencao = page.locator(".chat--janela .chat-atencao");
    if (await atencao.count()) {
      const cor = await atencao.first().evaluate((el) => getComputedStyle(el).color);
      check(`${tema}: "Chamar atenção" em âmbar`, cor === (tema === "escuro" ? "rgb(240, 196, 106)" : "rgb(138, 83, 0)"), cor);
    }
    const ruinsJanela = await page.evaluate(auditar, [tema, ".chat--janela"]);
    check(`${tema}: janela do chat legível (≥ 4,5:1)`, ruinsJanela.length === 0, ruinsJanela.slice(0, 4).join(" | "));
    await page.screenshot({ path: path.join(OUT, `chat-janela-${tema}.png`) });
  }

  // Página do Chat.
  await page.evaluate(() => { localStorage.setItem("hub_qp_tema", "escuro"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.click(".side-nav button[title='Chat']");
  await page.waitForSelector(".chat--pagina");
  await page.waitForTimeout(500);
  const pagina = await page.locator(".chat--pagina").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("página do Chat em vidro (fora da folha clara)", pagina !== "rgb(255, 255, 255)" && (await page.locator(".workspace-body").evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgba(0, 0, 0, 0)", pagina);
  await page.locator(".chat--pagina .chat-item").first().click().catch(() => {});
  await page.waitForTimeout(500);
  const ruinsPagina = await page.evaluate(auditar, ["escuro", ".chat--pagina"]);
  check("página do Chat legível (≥ 4,5:1)", ruinsPagina.length === 0, ruinsPagina.slice(0, 4).join(" | "));
  await page.screenshot({ path: path.join(OUT, "chat-pagina-escuro.png") });

  // Ampliado: texto das mensagens maior.
  const antes = parseFloat(await page.locator(".chat--pagina .chat-msg-texto").last().evaluate((el) => getComputedStyle(el).fontSize).catch(() => "0"));
  await page.evaluate(() => { localStorage.setItem("hub_qp_tamanho", "ampliado"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(400);
  const depois = parseFloat(await page.locator(".chat--pagina .chat-msg-texto").last().evaluate((el) => getComputedStyle(el).fontSize).catch(() => "0"));
  check("ampliado aumenta o texto das mensagens", antes > 0 && depois / antes >= 1.12, `${antes} -> ${depois}`);

  check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => { ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "hub_chat_local"].forEach((k) => localStorage.removeItem(k)); });
  await browser.close();
  console.log(results.join("\n"));
})().catch((e) => {
  console.log(results.join("\n"));
  console.log("ERRO " + e.message);
  process.exit(1);
});
