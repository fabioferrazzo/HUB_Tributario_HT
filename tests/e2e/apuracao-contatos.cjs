// Controle de Apuração: telefones e e-mails no cadastro da empresa.
// Mostra os contatos salvos, grava pela função apur_company_set_contacts (sem mexer nas funções do app)
// e só chama a função quando os contatos mudam. Dados "[TESTE]" por rota interceptada: nada sai da máquina.
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
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
  await f.evaluate((dono) => { const s = document.getElementById("ownerSelect"); s.value = dono; s.dispatchEvent(new Event("change")); }, DONO);
  await page.waitForTimeout(900);

  // Editar empresa existente: contatos aparecem e só a mudança chama a função nova.
  await f.evaluate((id) => openCompany(id), EMPRESA);
  await page.waitForTimeout(400);
  const valores = await f.evaluate(() => ["companyTelefone1", "companyTelefone2", "companyEmail1", "companyEmail2"].map((id) => document.getElementById(id).value));
  check("formulário mostra telefones e e-mails da empresa", JSON.stringify(valores) === JSON.stringify(["(54) 3244-1234", "", "contato@alfa.com.br", ""]), JSON.stringify(valores));
  const rotulos = await f.evaluate(() => [...document.querySelectorAll("#companyForm label")].map((l) => l.childNodes[0]?.textContent?.trim()).filter(Boolean));
  check("campos Telefone 1/2 e E-mail 1/2 no cadastro", ["Telefone 1", "Telefone 2", "E-mail 1", "E-mail 2"].every((r) => rotulos.includes(r)), rotulos.join(", "));

  chamadas.length = 0;
  await f.fill("#companyEmail2", "não é e-mail");
  await f.click("#saveCompanyBtn");
  await page.waitForTimeout(400);
  check("e-mail inválido é recusado no formulário", /E-mail inválido/.test(await f.locator("#companyValidation").innerText()) && !chamadas.some((c) => c.rpc === "apur_company_update"));
  await f.fill("#companyEmail2", "[TESTE]financeiro@alfa.com.br".replace("[TESTE]", ""));
  await f.fill("#companyTelefone2", "(54) 99999-0000");
  await f.click("#saveCompanyBtn");
  await page.waitForTimeout(1500);
  const upd = chamadas.findIndex((c) => c.rpc === "apur_company_update");
  const cont = chamadas.findIndex((c) => c.rpc === "apur_company_set_contacts");
  check("salva a empresa e depois os contatos", upd >= 0 && cont > upd, chamadas.map((c) => c.rpc).join(","));
  const corpo = chamadas[cont]?.body;
  check("contatos enviados à função nova", corpo?.p_id === EMPRESA && corpo.p.telefone2 === "(54) 99999-0000" && corpo.p.email2 === "financeiro@alfa.com.br" && corpo.p.telefone1 === "(54) 3244-1234", JSON.stringify(corpo));
  check("dados do cadastro seguem pela função de sempre", chamadas[upd]?.body?.p?.legal_name === "[TESTE] Comércio Alfa Ltda" && !("contatos" in (chamadas[upd]?.body?.p || {})));

  // Salvar sem mexer nos contatos: não chama a função de contatos.
  chamadas.length = 0;
  await f.evaluate((id) => openCompany(id), EMPRESA);
  await page.waitForTimeout(400);
  await f.fill("#companyNotes", "[TESTE] observação");
  await f.click("#saveCompanyBtn");
  await page.waitForTimeout(1500);
  check("sem mudança nos contatos, só a atualização da empresa", chamadas.some((c) => c.rpc === "apur_company_update") && !chamadas.some((c) => c.rpc === "apur_company_set_contacts"), chamadas.map((c) => c.rpc).join(","));

  // Empresa nova com contatos.
  chamadas.length = 0;
  await f.evaluate(() => openCompany());
  await page.waitForTimeout(400);
  await f.fill("#companyName", "[TESTE] Empresa Nova Contatos");
  await f.fill("#companyTelefone1", "(54) 3000-0000");
  await f.fill("#companyEmail1", "Nova@Empresa.com.br");
  await f.click("#saveCompanyBtn");
  await page.waitForTimeout(1500);
  const criar = chamadas.findIndex((c) => c.rpc === "apur_company_create");
  const cont2 = chamadas.findIndex((c) => c.rpc === "apur_company_set_contacts");
  check("empresa nova: cria e grava os contatos na sequência", criar >= 0 && cont2 > criar && chamadas[cont2].body.p_id === chamadas[criar].body.p.id && chamadas[cont2].body.p.email1 === "nova@empresa.com.br", chamadas.map((c) => c.rpc).join(","));

  check("sem erros de página", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => ["hub_supabase_public", "sb-demo-teste-auth-token"].forEach((k) => localStorage.removeItem(k)));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})();
