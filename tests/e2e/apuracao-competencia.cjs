// Controle de Apuração: a competência aparece em português mesmo com o navegador em inglês
// (o seletor de mês do navegador escreveria "November 2026"). Dados "[TESTE]" por rota interceptada.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);
const SUPA = "https://demo-teste.supabase.co";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const JWT = `${b64({ alg: "HS256" })}.${b64({ sub: "00000000-0000-0000-0000-000000000001", exp: Math.floor(Date.now() / 1000) + 3600 })}.teste`;
const ID = "00000000-0000-0000-0000-000000000001";
const DONO = "00000000-0000-0000-0000-000000000002";
const EMPRESA = "00000000-0000-0000-0000-000000000101";
const chamadas = [];

const responder = async (route) => {
  const u = route.request().url();
  const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
  const agora = new Date().toISOString();
  const h = new Date();
  const comp = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
  const user = { id: ID, username: "teste@hteixeira.local", email: "teste@hteixeira.local", display_name: "[TESTE] Administrador", role: "ADMIN", is_primary_admin: true, active: true, deleted: false, company_count: 1 };
  const rpc = (u.match(/rpc\/([a-z_]+)/) || [])[1];
  if (rpc && route.request().method() === "POST") chamadas.push({ rpc, body: JSON.parse(route.request().postData() || "{}") });
  if (/rest\/v1\/profiles/.test(u)) return json([{ id: ID, email: "teste@hteixeira.local", nome: "[TESTE] Administrador", role: "admin", active: true }]);
  if (rpc === "apur_me") return json(user);
  if (rpc === "apur_bootstrap") {
    const itens = ["Saídas", "Entradas", "Simples"].map((l) => ({ id: l.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(), label: l }));
    const empresa = { id: EMPRESA, owner_user_id: DONO, legal_name: "[TESTE] Comércio Alfa Ltda", cnpj: "11222333000181", dominio_code: "101", tax_regime: "SIMPLES NACIONAL", envio: "E-mail", particularities: "", notes: "", checklist: itens, display_order: 1, deleted: false, contatos: { telefone1: "(54) 3244-1234", telefone2: "", email1: "contato@alfa.com.br", email2: "" }, created_at: agora, updated_at: agora };
    const snap = { company_id: EMPRESA, competence: comp, owner_user_id: DONO, legal_name: empresa.legal_name, cnpj: empresa.cnpj, dominio_code: "101", tax_regime: "SIMPLES NACIONAL", envio: "E-mail", particularities: "", notes: "", checklist: itens, display_order: 1 };
    const u2 = { id: DONO, username: "colega", email: "colega@hteixeira.local", display_name: "[TESTE] Colega", role: "USER", is_primary_admin: false, active: true, deleted: false, company_count: 1 };
    return json({ user, scope_owner_user_id: DONO, users: [user, u2], admin_users: [user], companies: [empresa], snapshots: [snap], checks: [], monthly_notes: [], visual_marks: [], documents: [], admin_notes: [], periods: [{ owner_user_id: DONO, competence: comp, status: "OPEN", source_competence: null, layout: {}, opened_at: agora }], alerts: [], security_warnings: [], password_reset_requests: [] });
  }
  if (rpc === "apur_company_create") return json({ ok: true, id: chamadas.at(-1).body.p.id, competence: comp });
  if (rpc === "apur_company_update" || rpc === "apur_company_set_contacts") return json({ ok: true });
  if (rpc) return json({ ok: true, items: [], records: [], alerts: [] });
  return json([]);
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US", timezoneId: "America/Sao_Paulo" });
  await context.route(`${SUPA}/**`, responder);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/");
  await page.evaluate(([url, jwt]) => {
    localStorage.setItem("hub_supabase_public", JSON.stringify({ url, anonKey: "anon-teste" }));
    localStorage.setItem("sb-demo-teste-auth-token", JSON.stringify({ access_token: jwt }));
  }, [SUPA, JWT]);
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.locator(".sidebar button", { hasText: "Controle de Apuração" }).first().click();
  await page.waitForTimeout(2600);
  const f = page.frames().find((x) => /\/apps\/apuracao\//.test(x.url()));
  check("Controle de Apuração abre", Boolean(f));
  await f.waitForFunction(() => /^\d{4}-\d{2}$/.test(document.getElementById("competenceInput")?.value || ""), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const ler = () =>
    f.evaluate(() => {
      const campo = document.getElementById("competenceInput");
      const rotulo = document.querySelector(".competencia-ptbr__texto");
      const r = rotulo.getBoundingClientRect();
      const c = campo.getBoundingClientRect();
      return {
        valor: campo.value,
        texto: rotulo.textContent,
        visivel: getComputedStyle(rotulo).display !== "none",
        campoTransparente: getComputedStyle(campo).color === "rgba(0, 0, 0, 0)",
        cabe: rotulo.scrollWidth <= rotulo.clientWidth + 1 && r.left >= c.left && r.right <= c.right,
        rotuloCor: getComputedStyle(rotulo).color,
        larguras: [".month-nav", ".competencia-ptbr", "#competenceInput", ".compact-field"].map((q) => Math.round(document.querySelector(q)?.getBoundingClientRect().width || 0)).join("/"),
        janela: innerWidth
      };
    });
  const esperado = (valor) => { const [a, m] = valor.split("-").map(Number); return `${MESES[m - 1]} de ${a}`; };
  let e = await ler();
  check("competência em português com o navegador em inglês", e.texto === esperado(e.valor) && e.visivel && e.campoTransparente, JSON.stringify(e));
  check("texto cabe no campo, sem corte", e.cabe, JSON.stringify(e));
  check("texto com a cor do campo (legível)", e.rotuloCor !== "rgba(0, 0, 0, 0)", e.rotuloCor);
  await f.click("#nextMonthBtn");
  await page.waitForTimeout(700);
  const depois = await ler();
  check("seta › troca o mês e o texto acompanha", depois.valor !== e.valor && depois.texto === esperado(depois.valor), JSON.stringify(depois));
  await f.click("#prevMonthBtn");
  await page.waitForTimeout(700);
  e = await ler();
  check("seta ‹ volta e o texto acompanha", e.texto === esperado(e.valor), e.texto);
  await f.focus("#competenceInput");
  const foco = await f.evaluate(() => ({ rotulo: getComputedStyle(document.querySelector(".competencia-ptbr__texto")).display, cor: getComputedStyle(document.getElementById("competenceInput")).color }));
  check("ao digitar no campo, mostra o texto do próprio campo", foco.rotulo === "none" && foco.cor !== "rgba(0, 0, 0, 0)", JSON.stringify(foco));
  await f.evaluate(() => document.activeElement.blur());
  await page.setViewportSize({ width: 420, height: 860 });
  await page.waitForTimeout(600);
  e = await ler();
  const [ano, mes] = e.valor.split("-");
  const curtos = [`${MESES[Number(mes) - 1].slice(0, 3)}/${ano}`, `${mes}/${ano}`];
  check("tela estreita: versão curta em português, sem corte", (e.texto === esperado(e.valor) || curtos.includes(e.texto)) && e.cabe && !/[A-Z][a-z]+ \d{4}$/.test(e.texto.replace(/ de /, "")), JSON.stringify(e));
  await page.screenshot({ path: require("path").join(require("./_config.cjs").OUT, "apuracao-competencia-en.png") });
  check("sem erros de script", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((err) => {
  console.error("ERRO", err);
  process.exit(1);
});
