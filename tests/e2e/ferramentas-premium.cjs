// Ferramentas no visual premium: Agenda tributária, Pomodoro, Checklist e Consultor CT-e/MDF-e seguindo tema,
// tamanho e paleta do HUB (ponte hub-premium-app.js). Contraste nos dois temas, esquema de cores do iframe igual ao
// do HUB (sem fundo pintado), nada transbordando no ampliado e visual atual intacto (modo local, localhost).
// Dados de teste: agenda "[TESTE]" no navegador; checklists "[TESTE]" servidos por rota interceptada (nada sai da máquina).
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

const SUPA = "https://demo-teste.supabase.co";
const ID = "00000000-0000-0000-0000-0000000000bb";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const JWT = `${b64({ alg: "HS256" })}.${b64({ sub: ID, exp: Math.floor(Date.now() / 1000) + 3600 })}.teste`;
const APPS = [
  { label: "Agenda tributária", url: /\/apps\/agenda-tributaria/ },
  { label: "Pomodoro", url: /\/apps\/pomodoro/ },
  { label: "Checklist", url: /\/apps\/checklist\// },
  { label: "Consultor CT-e/MDF-e", url: /\/apps\/consultor-cte/ }
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
    // marcas com fundo em degradê (logotipo "HT") e folhas de documento (ficha do relatório) ficam de fora
    if (el.closest("svg, .topbar-mark, .brand-mark, .report-preview, .hidden, [hidden], .modal-backdrop:not(.open), #time-up-modal, #trigger-reminder-modal")) continue;
    const bg = fundo(el), cor = mix(parse(cs.color), bg);
    const c = (Math.max(lum(cor), lum(bg)) + .05) / (Math.min(lum(cor), lum(bg)) + .05);
    if (c < 4.5) ruins.push(`${c.toFixed(2)} "${el.textContent.trim().slice(0, 24)}"`);
  }
  return ruins;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  await context.route(`${SUPA}/**`, (route) => {
    const u = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
    if (/rest\/v1\/profiles/.test(u)) return json([{ id: ID, email: "teste@hteixeira.local", nome: "[TESTE] Administrador", role: "admin", active: true }]);
    const agora = new Date().toISOString();
    const lista = (id, titulo, itens) => ({ id, titulo, versao: 1, criado_em: agora, atualizado_em: agora, arquivado_em: null, atualizado_por: "[TESTE] Administrador", dono: { id: ID, nome: "[TESTE] Administrador" }, sou_dono: true, compartilhar_todos: false, compartilhado_com: [], dados: { items: itens, observacoes: "" } });
    if (/rpc\/chk_dados/.test(u)) return json({ me: { id: ID, nome: "[TESTE] Administrador" }, usuarios: [], versoes: {}, anexos: [],
      listas: [lista("teste-fp-1", "[TESTE] Fechamento mensal", [{ id: "i1", html: "Conferir DCTFWeb", done: true }, { id: "i2", html: "Apurar ICMS", done: false }])] });
    return json({});
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(BASE + "/");
  await page.evaluate(([url, jwt]) => {
    ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta", "ht_checklist_ui_prefs_v15"].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem("hub_supabase_public", JSON.stringify({ url, anonKey: "anon-teste" }));
    localStorage.setItem("sb-demo-teste-auth-token", JSON.stringify({ access_token: jwt }));
    const h = new Date(); const k = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
    const dates = {};
    ["pf", "pj-fed", "pj-aces", "serv", "ret", "simples", "estadual", "municipal"].forEach((c, i) => { const d = String(((h.getDate() + i * 2) % 27) + 1); (dates[d] = dates[d] || []).push({ cat: c, title: `<strong>[TESTE]</strong> Obrigação ${c}`, periodo: "mês anterior", doc: "DARF", base: "IN [TESTE]" }); });
    const o = {}; o[k] = { source: "Teste", updated: "hoje", critical: { day: h.getDate(), text: "O dia <strong>[TESTE]</strong> concentra vencimentos." }, dates };
    localStorage.setItem("agenda-tributaria-rfb-v1", JSON.stringify(o));
  }, [SUPA, JWT]);
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  const abrir = async (app) => {
    await page.locator(".sidebar button", { hasText: app.label }).first().click();
    await page.waitForTimeout(2200);
    return page.frames().find((f) => app.url.test(f.url()));
  };
  const preparar = async (app, f) => {
    if (app.label === "Checklist") { await f.waitForSelector(".list-card", { timeout: 15000 }); await f.evaluate(() => document.querySelector(".list-card").click()); await page.waitForTimeout(500); }
    if (app.label === "Consultor CT-e/MDF-e") { await f.waitForSelector("#exampleBtn", { state: "attached", timeout: 15000 }).catch(() => {}); await f.evaluate(() => { const b = document.getElementById("exampleBtn"); if (b) b.click(); }); await page.waitForTimeout(800); }
  };

  // Visual atual: nada muda.
  for (const app of APPS) {
    const f = await abrir(app);
    check(`${app.label}: visual atual sem o tema premium`, f && !(await f.evaluate(() => document.documentElement.className)).includes("ht-premium"));
  }
  let f = await abrir(APPS[2]);
  await f.waitForSelector(".list-card", { timeout: 15000 });
  check("Checklist: visual atual no modo claro (preferência do Checklist)", !(await f.evaluate(() => document.body.classList.contains("theme-dark"))));

  // Liga o premium (escuro) sem recarregar.
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", "escuro"); localStorage.setItem("hub_qp_tamanho", "compacto"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(900);
  check("Checklist: modo escuro do app acompanha o tema do HUB", await f.evaluate(() => document.body.classList.contains("theme-dark")));
  check("Checklist: botão de lua do app escondido no premium", await f.evaluate(() => getComputedStyle(document.getElementById("themeToggleBtn")).display === "none"));

  for (const [tema, tamanho] of [["escuro", "compacto"], ["claro", "compacto"], ["escuro", "ampliado"], ["claro", "ampliado"]]) {
    await page.evaluate(([t, z]) => { localStorage.setItem("hub_qp_tema", t); localStorage.setItem("hub_qp_tamanho", z); window.dispatchEvent(new Event("hub:visual-premium")); }, [tema, tamanho]);
    await page.waitForTimeout(600);
    for (const app of APPS) {
      f = await abrir(app);
      await preparar(app, f);
      const est = await f.evaluate(() => ({ cls: document.documentElement.className, cs: getComputedStyle(document.documentElement).colorScheme, body: getComputedStyle(document.body).backgroundColor, larg: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      const molduraCs = await page.locator(".frame-page iframe").evaluate((el) => getComputedStyle(el).colorScheme);
      const ok = est.cls.includes(`ht-premium--${tema}`) && est.cls.includes(`ht-premium--${tamanho}`);
      if (tamanho === "compacto") {
        check(`${app.label} (${tema}): tema aplicado, mesmo esquema de cores do HUB e fundo transparente`, ok && est.cs === (tema === "escuro" ? "dark" : "light") && molduraCs === est.cs && est.body === "rgba(0, 0, 0, 0)", `${est.cs}/${molduraCs} ${est.body}`);
        const ruins = ok ? await f.evaluate(auditar, tema) : ["sem tema"];
        check(`${app.label} (${tema}): contraste mínimo 4,5:1`, ruins.length === 0, ruins.slice(0, 4).join(" | "));
      } else {
        check(`${app.label} (${tema}, ampliado): nada transborda na largura`, ok && est.larg <= 1, `${est.larg}px`);
      }
    }
  }

  // Detalhes de cada ferramenta.
  await page.evaluate(() => { localStorage.setItem("hub_qp_tema", "escuro"); localStorage.setItem("hub_qp_tamanho", "compacto"); window.dispatchEvent(new Event("hub:visual-premium")); });
  f = await abrir(APPS[1]);
  const pomo = await f.evaluate(() => ({ seletores: [...document.querySelectorAll("#main-card header input[type=color]")].every((i) => !i.offsetParent), botao: getComputedStyle(document.getElementById("main-btn")).backgroundColor, cartao: getComputedStyle(document.getElementById("main-card")).backgroundColor }));
  check("Pomodoro: seletores de cor do app saem (a paleta vem do HUB)", pomo.seletores);
  check("Pomodoro: cartão de vidro e botão Iniciar no acento", /^rgba\(255, 255, 255, 0\.0/.test(pomo.cartao) && !/18, 58, 99/.test(pomo.botao), `${pomo.cartao} ${pomo.botao}`);
  f = await abrir(APPS[0]);
  const faixa = await f.evaluate(() => { const el = document.querySelector(".critical-strip"); return el ? getComputedStyle(el).borderTopColor : ""; });
  const quente = (() => { const m = (faixa.match(/[\d.]+/g) || []).map(Number); const k = /^color\(/.test(faixa) ? 255 : 1; return m.length >= 3 && m[0] * k > 170 && m[0] * k > m[2] * k + 50; })();
  check("Agenda: faixa do dia crítico em tom quente (coral)", quente, faixa);
  f = await abrir(APPS[3]);
  await preparar(APPS[3], f);
  await f.evaluate(() => document.querySelector("[data-view=reportView]").click());
  await page.waitForTimeout(600);
  const ficha = await f.evaluate(() => { const d = document.querySelector(".report-preview .rpt-document"); return d ? getComputedStyle(d).backgroundColor : "sem ficha"; });
  check("Consultor: ficha do relatório continua folha branca", ficha === "rgb(255, 255, 255)", ficha);

  // Impressão: volta ao visual original.
  await page.emulateMedia({ media: "print" });
  const imp = await f.evaluate(() => getComputedStyle(document.querySelector(".topbar")).backgroundColor);
  check("impressão: Consultor sem o vidro do premium", imp === "rgb(255, 255, 255)", imp);
  await page.emulateMedia({ media: "screen" });

  // Desliga o premium: o Checklist volta à preferência dele (claro).
  f = await abrir(APPS[2]);
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "0"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(900);
  check("Checklist: sem o premium, volta ao modo do próprio app", !(await f.evaluate(() => document.body.classList.contains("theme-dark"))) && !(await f.evaluate(() => document.documentElement.className)).includes("ht-premium"));

  check("sem erros de página", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta", "hub_supabase_public", "sb-demo-teste-auth-token", "agenda-tributaria-rfb-v1"].forEach((k) => localStorage.removeItem(k)));
  await browser.close();
  console.log(results.join("\n"));
  const falhas = results.filter((r) => r.startsWith("FALHA")).length;
  console.log(`\n${results.length - falhas}/${results.length} verificações OK`);
  process.exit(falhas ? 1 : 0);
})();
