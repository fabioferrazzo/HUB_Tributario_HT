// Apps do Escritório no visual premium: Controle de Apuração, Controle de Férias, Onboarding, Carteira de clientes e
// Informativos seguindo tema, tamanho e paleta do HUB (ponte hub-premium-app.js). Apuração e Férias têm modo escuro
// próprio, que acompanha o do HUB (hub-premium-tema.js) e volta à escolha do usuário ao desligar o premium.
// Contraste nos dois temas, esquema de cores igual ao do HUB, nada transbordando no ampliado (modo local, localhost).
// Dados "[TESTE]" servidos por rota interceptada: nada sai da máquina.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);
const SUPA = "https://demo-teste.supabase.co";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const JWT = `${b64({ alg: "HS256" })}.${b64({ sub: "00000000-0000-0000-0000-000000000001", exp: Math.floor(Date.now() / 1000) + 3600 })}.teste`;
const APPS = [
  { label: "Controle de Apuração", url: /\/apps\/apuracao\// },
  { label: "Controle de Férias", url: /\/apps\/ferias\// },
  { label: "Onboarding", url: /\/apps\/onboarding\// },
  { label: "Carteira de clientes", url: /\/apps\/carteira\// },
  { label: "Informativos", url: /\/apps\/informativos\// }
];

const ID = "00000000-0000-0000-0000-000000000001";
const responder = (route) => {
  const u = route.request().url();
  const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
  const agora = new Date().toISOString();
  const h = new Date(); const comp = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
  const hoje = agora.slice(0, 10);
  const user = { id: ID, username: "teste@hteixeira.local", email: "teste@hteixeira.local", display_name: "[TESTE] Administrador", role: "ADMIN", is_primary_admin: true, active: true, deleted: false, company_count: 2 };
  if (/rest\/v1\/profiles/.test(u)) return json([{ id: ID, email: "teste@hteixeira.local", nome: "[TESTE] Administrador", role: "admin", active: true }]);
  if (/rpc\/apur_me/.test(u)) return json(user);
  if (/rpc\/apur_bootstrap/.test(u)) {
    const emp = (n, nome, reg) => ({ id: `00000000-0000-0000-0000-00000000010${n}`, owner_user_id: "00000000-0000-0000-0000-000000000002", legal_name: nome, cnpj: "00.000.000/0001-0" + n, dominio_code: "10" + n, tax_regime: reg, envio: "E-mail", particularities: "", notes: "", checklist: [], display_order: n, deleted: false, created_at: agora, updated_at: agora });
    const itens = ["Saídas", "Entradas", "Simples", "ISS", "ICMS", "REINF", "Enviado"].map((l) => ({ id: l.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: l }));
    const empresas = [["1", "[TESTE] Comércio Alfa Ltda", "SIMPLES"], ["2", "[TESTE] Serviços Beta S/A", "PRESUMIDO"], ["3", "[TESTE] Indústria Gama", "REAL"]];
    const snaps = empresas.map(([n, nome, reg]) => ({ company_id: `00000000-0000-0000-0000-00000000010${n}`, competence: comp, owner_user_id: "00000000-0000-0000-0000-000000000002", legal_name: nome, cnpj: "00.000.000/0001-0" + n, dominio_code: "10" + n, tax_regime: reg, envio: "E-mail", particularities: "", notes: "", checklist: itens, display_order: +n }));
    const st = ["DONE", "PENDING", "ALERT", "NA"];
    const chks = []; snaps.forEach((sn, i) => itens.forEach((it, j) => { if ((i + j) % 3 !== 2) chks.push({ company_id: sn.company_id, competence: comp, item_id: it.id, status: st[(i + j) % 4], updated_at: agora, updated_by: ID }); }));
    const u2 = { id: "00000000-0000-0000-0000-000000000002", username: "colega", email: "colega@hteixeira.local", display_name: "[TESTE] Colega", role: "USER", is_primary_admin: false, active: true, deleted: false, company_count: 2 };
    return json({ user, scope_owner_user_id: u2.id, users: [user, u2], admin_users: [user], companies: [emp(1, "[TESTE] Comércio Alfa Ltda", "SIMPLES"), emp(2, "[TESTE] Serviços Beta S/A", "PRESUMIDO")], snapshots: snaps, checks: chks, monthly_notes: [], visual_marks: [], documents: [], admin_notes: [], periods: [{ owner_user_id: "00000000-0000-0000-0000-000000000002", competence: comp, status: "OPEN", source_competence: null, layout: {}, opened_at: agora }], alerts: [], security_warnings: [], password_reset_requests: [] });
  }
  if (/rpc\/fer_dados/.test(u)) return json({ me: { id: 1, nome: "[TESTE] Administrador", login: "teste@hteixeira.local", papel: "ADM", participa: true }, hoje,
    usuarios: [{ id: 1, nome: "[TESTE] Administrador", cor: "#1BBCBB", participa: true, ativo: true, modo: "corridos", dias_semestre: 15, login: "teste@hteixeira.local", papel: "ADM", inicio_semestre: `${h.getFullYear() - 1}-I`, saldo_inicial: 0, criado_em: hoje },
               { id: 2, nome: "[TESTE] Colega", cor: "#6D7FD8", participa: true, ativo: true, modo: "uteis", dias_semestre: 10, login: "colega@hteixeira.local", papel: "USUARIO", inicio_semestre: `${h.getFullYear() - 1}-V`, saldo_inicial: 0, criado_em: hoje }],
    ferias: [{ id: 1, usuario_id: 2, inicio: `${h.getFullYear()}-12-08`, fim: `${h.getFullYear()}-12-19`, motivo: "Férias regulares", observacao: "[TESTE]", criado_por: "[TESTE]", criado_em: hoje, atualizado_por: null, atualizado_em: null }],
    ausencias: [], inicios: [], feriados: [{ id: 1, data: `${h.getFullYear()}-12-25`, descricao: "Natal", ativo: true, origem: "nacional" }] });
  if (/rpc\/cart_sessao/.test(u)) return json({ ok: true, user: { username: "[TESTE] Administrador", display_name: "[TESTE] Administrador", role: "admin" } });
  if (/rpc\/cart_competencias/.test(u)) return json({ ok: true, periods: [{ period_key: comp, year: h.getFullYear(), month: h.getMonth() + 1, status: "open", source_period_key: null, created_at: agora, created_by: "[TESTE]", updated_at: agora }] });
  if (/rpc\/cart_registros_listar/.test(u)) {
    const reg = (i, emp, reg) => ({ id: i, period_id: 1, record_key: "k" + i, row_order: i, empresa: emp, cnpj: "00.000.000/0001-0" + i, dominio: "10" + i, responsavel_fiscal: "[TESTE] Fulano", responsavel_contabil: "[TESTE] Beltrano", responsavel_depto_pessoal: "", regime: reg, socios: "", fone: "(54) 0000-0000", email: "teste@exemplo.com", honorarios: "", situacao: "Ativa", obs: "", version: 1, created_at: agora, updated_at: agora, updated_by: "[TESTE]" });
    return json({ ok: true, period: { id: 1, period_key: comp, year: h.getFullYear(), month: h.getMonth() + 1, status: "open" }, total: 3, records: [reg(1, "[TESTE] Comércio Alfa Ltda", "Simples Nacional"), reg(2, "[TESTE] Serviços Beta S/A", "Lucro Presumido"), reg(3, "[TESTE] Indústria Gama", "Lucro Real")] });
  }
  if (/rpc\/inf_sessao/.test(u)) return json({ papel: "admin", nome: "[TESTE] Administrador", email: "teste@hteixeira.local" });
  if (/rpc\/inf_documentos_listar/.test(u)) {
    const doc = (i, t, st, pub, pend) => ({ id: "00000000-0000-0000-0000-00000000020" + i, title: t, status: st, has_published: pub, has_unpublished_changes: pend, document_number: "Informativo nº 0" + i + "/2026", document_date: "2" + i + "/11/2026", department: "Departamento Tributário", folder_name: i === 1 ? "[TESTE] Reforma" : "", source_type: "template", version_count: i + 1, source_revision_count: 1, updated_at: agora });
    return json([doc(1, "[TESTE] Split payment — o que muda em 2027", "published", true, false), doc(2, "[TESTE] DIFAL — novidades", "published", true, true), doc(3, "[TESTE] Rascunho sobre IBS/CBS", "draft", false, true)]);
  }
  if (/rpc\/inf_pastas_listar/.test(u)) return json([]);
  if (/rpc\/(cart_|apur_)/.test(u)) return json({ ok: true, items: [], records: [], alerts: [] });
  return json([]);
};

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
    if (el.closest("svg, .logo, .brand-mark, .hidden, [hidden], dialog:not([open]), .contract-workspace-panel:not(.is-active), .contract-workspace-panel > :not(.contract-panel-intro), .modal:not(.open), .toast-region")) continue;
    const bg = fundo(el), cor = mix(parse(cs.color), bg);
    const c = (Math.max(lum(cor), lum(bg)) + .05) / (Math.min(lum(cor), lum(bg)) + .05);
    if (c < 4.5) ruins.push(`${c.toFixed(2)} "${el.textContent.trim().slice(0, 24)}"`);
  }
  return ruins;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  await context.route(`${SUPA}/**`, responder);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/");
  await page.evaluate(([url, jwt]) => {
    ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta", "htferias-tema", "ht_theme"].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem("hub_supabase_public", JSON.stringify({ url, anonKey: "anon-teste" }));
    localStorage.setItem("sb-demo-teste-auth-token", JSON.stringify({ access_token: jwt }));
  }, [SUPA, JWT]);
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  const abrir = async (app) => {
    await page.locator(".sidebar button", { hasText: app.label }).first().click();
    await page.waitForTimeout(2600);
    const f = page.frames().find((x) => app.url.test(x.url()));
    if (f && app.label === "Controle de Apuração") {
      await f.evaluate(() => { const s = document.getElementById("ownerSelect"); if (s && s.options.length) { s.value = s.options[s.options.length - 1].value; s.dispatchEvent(new Event("change")); } });
      await page.waitForTimeout(700);
    }
    return f;
  };

  // Visual atual: nada muda.
  for (const app of APPS) {
    const f = await abrir(app);
    check(`${app.label}: visual atual sem o tema premium`, f && !(await f.evaluate(() => document.documentElement.className)).includes("ht-premium"));
  }
  let f = await abrir(APPS[0]);
  check("Apuração: visual atual no modo claro do próprio app", (await f.evaluate(() => document.documentElement.dataset.theme)) === "light");

  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", "escuro"); localStorage.setItem("hub_qp_tamanho", "compacto"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(900);
  check("Apuração: modo escuro do app acompanha o tema do HUB", (await f.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  check("Apuração: botão de modo escuro do app escondido", await f.evaluate(() => getComputedStyle(document.getElementById("themeBtn")).display === "none"));

  for (const [tema, tamanho] of [["escuro", "compacto"], ["claro", "compacto"], ["escuro", "ampliado"]]) {
    await page.evaluate(([t, z]) => { localStorage.setItem("hub_qp_tema", t); localStorage.setItem("hub_qp_tamanho", z); window.dispatchEvent(new Event("hub:visual-premium")); }, [tema, tamanho]);
    await page.waitForTimeout(600);
    for (const app of APPS) {
      f = await abrir(app);
      const est = await f.evaluate(() => ({ cls: document.documentElement.className, cs: getComputedStyle(document.documentElement).colorScheme, body: getComputedStyle(document.body).backgroundColor, larg: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      const molduraCs = await page.locator(".frame-page iframe").evaluate((el) => getComputedStyle(el).colorScheme);
      const ok = est.cls.includes(`ht-premium--${tema}`) && est.cls.includes(`ht-premium--${tamanho}`);
      if (tamanho === "compacto") {
        check(`${app.label} (${tema}): tema aplicado, mesmo esquema de cores do HUB e fundo transparente`, ok && est.cs === (tema === "escuro" ? "dark" : "light") && molduraCs === est.cs && est.body === "rgba(0, 0, 0, 0)", `${est.cs}/${molduraCs} ${est.body}`);
        const ruins = ok ? await f.evaluate(auditar, tema) : ["sem tema"];
        check(`${app.label} (${tema}): contraste mínimo 4,5:1`, ruins.length === 0, ruins.slice(0, 4).join(" | "));
      } else {
        check(`${app.label} (ampliado): nada transborda na largura`, ok && est.larg <= 1, `${est.larg}px`);
      }
    }
  }

  // Férias: tema do app acompanha e volta à escolha do usuário.
  await page.evaluate(() => { localStorage.setItem("hub_qp_tema", "escuro"); localStorage.setItem("hub_qp_tamanho", "compacto"); window.dispatchEvent(new Event("hub:visual-premium")); });
  f = await abrir(APPS[1]);
  check("Férias: tema do app acompanha o do HUB", (await f.evaluate(() => document.documentElement.getAttribute("data-tema"))) === "escuro");
  check("Férias: botão de tema do app escondido", await f.evaluate(() => [...document.querySelectorAll('[data-acao="tema"]')].every((b) => getComputedStyle(b).display === "none")));
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "0"); window.dispatchEvent(new Event("hub:visual-premium")); });
  await page.waitForTimeout(900);
  check("Férias: sem o premium, volta ao tema automático do app", !(await f.evaluate(() => document.documentElement.hasAttribute("data-tema"))) && !(await f.evaluate(() => document.documentElement.className)).includes("ht-premium"));
  f = await abrir(APPS[0]);
  check("Apuração: sem o premium, volta ao modo claro escolhido no app", (await f.evaluate(() => document.documentElement.dataset.theme)) === "light");

  check("sem erros de página", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => ["hub_qg_visual_premium", "hub_qp_tema", "hub_qp_tamanho", "ht_premium_paleta", "hub_supabase_public", "sb-demo-teste-auth-token"].forEach((k) => localStorage.removeItem(k)));
  await browser.close();
  console.log(results.join("\n"));
  const falhas = results.filter((r) => r.startsWith("FALHA")).length;
  console.log(`\n${results.length - falhas}/${results.length} verificações OK`);
  process.exit(falhas ? 1 : 0);
})();
