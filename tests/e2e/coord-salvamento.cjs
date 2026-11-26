// Coordenação: duas alterações seguidas, com a primeira gravação ainda em andamento, não podem perder a segunda.
// (Antes, a segunda era descartada enquanto a primeira gravava.) Servidor simulado e lento; dados "[TESTE]".
const { BASE, CHROME } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

const agora = new Date().toISOString();
const item = (id, titulo) => ({ id, title: titulo, description: "", type: "colaborador", collaboratorId: "c1", due: "2026-12-01T10:00", priority: "media", recurrence: "nenhuma", status: "aberto", pinned: false, attachments: [], calendarSync: false, deletedAt: "", completedAt: "", createdAt: agora, updatedAt: agora });
const ESTADO = {
  collaborators: [{ id: "c1", name: "[TESTE] Colaborador", email: "colaborador@teste.local", role: "", active: true, createdAt: agora, updatedAt: agora }],
  reminders: [item("r-1", "[TESTE] Lembrete um"), item("r-2", "[TESTE] Lembrete dois")]
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const puts = [];
  await page.route("**/.netlify/functions/coord-data", async (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      const corpo = JSON.parse(req.postData() || "{}");
      puts.push(corpo.state);
      await new Promise((r) => setTimeout(r, 1500)); // servidor lento: a 2ª alteração chega no meio da 1ª gravação
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, source: "supabase", state: corpo.state, envios: [], conclusoes: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, source: "supabase", state: ESTADO }) });
  });
  await page.goto(BASE + "/apps/coord-tributaria.html");
  await page.evaluate(() => localStorage.setItem("sb-teste-auth-token", JSON.stringify({ access_token: "token-teste-coord" })));
  await page.reload();
  await page.waitForTimeout(1800);
  check("Coordenação carrega do servidor simulado", (await page.locator("#syncStatus").innerText()) === "supabase");
  await page.evaluate(() => (window.confirm = () => true));
  await page.locator('button[data-action="delete"][data-id="r-1"]').first().click();
  await page.waitForTimeout(900); // a 1ª gravação já começou
  await page.locator('button[data-action="delete"][data-id="r-2"]').first().click();
  await page.waitForTimeout(4500);
  const ultimo = puts.at(-1) || { reminders: [] };
  const excluidos = ultimo.reminders.filter((r) => r.deletedAt).map((r) => r.id);
  check("a 2ª exclusão também é gravada", puts.length >= 2 && excluidos.includes("r-1") && excluidos.includes("r-2"), `${puts.length} gravações; excluídos: ${excluidos.join(",")}`);
  check("situação final: supabase", (await page.locator("#syncStatus").innerText()) === "supabase");
  check("sem erros de página", errors.length === 0, errors.join(" | "));
  await page.evaluate(() => localStorage.removeItem("sb-teste-auth-token"));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})();
