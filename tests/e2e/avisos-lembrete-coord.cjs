// Quadro de Avisos particular: avisos criados por lembrete da Coordenação.
// Ficam 30 dias; concluído pela coordenação aparece esmaecido com o selo por 5 dias; vencido some.
// Modo local (localhost). Itens de teste marcados com [TESTE].
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/");
  await page.evaluate(() => {
    const dia = 24 * 60 * 60 * 1000;
    const iso = (ms) => new Date(Date.now() + ms).toISOString();
    const marca = (id, criado, expira, concluido) => `<!--hub:coord-lembrete id=${id} criado=${criado} expira=${expira}${concluido ? ` concluido=${concluido}` : ""}-->`;
    const base = { cell: 1, kind: "texto", visibility: "particular", color: "#ffffff", selectedUsers: ["colab@teste.com"], createdBy: "", createdByEmail: "fiscal10.hteixeira@gmail.com", createdAt: iso(0), updatedAt: iso(0) };
    const avisos = [
      { ...base, id: "teste-av-aberto", title: "Lembrete de avaliação: [TESTE] Aberto", content: "<strong>[TESTE] Lembrete aberto</strong><br>Prazo: 26/11/2026" + marca("r-aberto", iso(0), iso(30 * dia)) },
      { ...base, id: "teste-av-concluido", title: "Lembrete de avaliação: [TESTE] Concluído", content: "<strong>[TESTE] Lembrete concluído</strong><br>Prazo: 20/11/2026" + marca("r-concl", iso(-10 * dia), iso(5 * dia), iso(0)) },
      { ...base, id: "teste-av-vencido", title: "Lembrete de avaliação: [TESTE] Vencido", content: "<strong>[TESTE] Lembrete vencido</strong>" + marca("r-venc", iso(-31 * dia), iso(-dia)) },
      { ...base, id: "teste-av-comum", title: "[TESTE] Aviso comum", content: "[TESTE] Aviso particular comum" }
    ];
    localStorage.setItem("hub_quadro_avisos_app", JSON.stringify(avisos));
    localStorage.setItem("hub_qg_visual_premium", "1");
    localStorage.setItem("hub_qp_tema", "escuro");
  });
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.click(".side-nav button[title='Pautas']");
  await page.waitForTimeout(800);
  await page.click(".pautas-page button:has-text('Quadro de Avisos')");
  await page.waitForTimeout(500);
  await page.click(".pautas-page button:has-text('Quadro particular')");
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".aviso-card")];
    const achar = (t) => cards.find((c) => c.textContent.includes(t));
    const concl = achar("Lembrete concluído");
    const aberto = achar("Lembrete aberto");
    return {
      vencido: Boolean(achar("Lembrete vencido")),
      comum: Boolean(achar("Aviso particular comum")),
      abertoOpacidade: aberto ? +getComputedStyle(aberto).opacity : -1,
      abertoValidade: aberto?.querySelector(".aviso-card__validade")?.textContent || "",
      conclClasse: concl?.classList.contains("aviso-card--concluido") || false,
      conclOpacidade: concl ? +getComputedStyle(concl).opacity : -1,
      conclSelo: concl?.querySelector(".aviso-card__concluido")?.textContent || "",
      conclValidade: concl?.querySelector(".aviso-card__validade")?.textContent || "",
      marcaVisivel: document.body.innerText.includes("hub:coord-lembrete")
    };
  });
  check("aviso vencido não aparece", !info.vencido);
  check("aviso comum segue aparecendo", info.comum);
  check("lembrete aberto: aparência normal", info.abertoOpacidade === 1, String(info.abertoOpacidade));
  check("lembrete aberto: mostra até quando fica no quadro", /^No quadro até \d{2}\/\d{2}$/.test(info.abertoValidade), info.abertoValidade);
  check("lembrete concluído: esmaecido", info.conclClasse && info.conclOpacidade < 0.7, String(info.conclOpacidade));
  check("lembrete concluído: selo \"Concluído pela coordenação\"", /^Concluído pela coordenação em \d{2}\/\d{2}$/.test(info.conclSelo.trim()), info.conclSelo);
  check("lembrete concluído: some em 5 dias", info.conclValidade.length > 0, info.conclValidade);
  check("marca oculta não aparece na tela", !info.marcaVisivel);
  await page.screenshot({ path: path.join(OUT, "avisos-lembrete-coord.png") });
  check("sem erros no console", errors.length === 0, errors.join(" | "));

  await page.evaluate(() => localStorage.removeItem("hub_quadro_avisos_app"));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})();
