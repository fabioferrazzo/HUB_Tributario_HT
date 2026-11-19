// Acessibilidade básica: todo botão, link e campo visível precisa de nome acessível,
// em todas as telas do menu (inclusive apps em moldura), no computador e no celular.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");

const varrer = () => {
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const nome = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const ref = el.getAttribute("aria-labelledby");
    if (ref) {
      const t = ref.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
      if (t) return t;
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && lab.textContent.trim()) return lab.textContent.trim();
    }
    const envolvente = el.closest("label");
    if (envolvente && envolvente.textContent.trim()) return envolvente.textContent.trim();
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
      if (el.type === "hidden") return "oculto";
      if (["submit", "button", "reset"].includes(el.type) && el.value) return el.value;
      return (el.getAttribute("title") || el.getAttribute("placeholder") || "").trim();
    }
    const texto = (el.textContent || "").trim();
    if (texto) return texto;
    const img = el.querySelector("img[alt]");
    if (img && img.alt.trim()) return img.alt.trim();
    const svgTitle = el.querySelector("svg title");
    if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim();
    return (el.getAttribute("title") || "").trim();
  };
  const faltando = [];
  document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab]").forEach((el) => {
    if (!visivel(el) || el.closest("[aria-hidden='true']")) return;
    if (el.tagName === "INPUT" && el.type === "hidden") return;
    if (!nome(el)) {
      const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(" ").slice(0, 2).join(".");
      faltando.push(`${el.tagName.toLowerCase()}${el.type ? "[" + el.type + "]" : ""}${cls ? "." + cls : ""}${el.id ? "#" + el.id : ""}`);
    }
  });
  return faltando;
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  let falhas = 0;
  let total = 0;
  let rotas = [];
  for (const [rotulo, viewport] of [["computador", { width: 1440, height: 950 }], ["celular", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE + "/");
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
    if (!rotas.length) {
      // Abre os submenus e anota a rota de cada item do menu lateral.
      for (const t of await page.locator(".side-nav-submenu-toggle[aria-expanded=false]").all()) await t.click();
      const itens = await page.locator(".side-nav-group button").all();
      for (const b of itens) {
        const titulo = (await b.getAttribute("title")) || (await b.innerText()).trim();
        await b.click();
        await page.waitForTimeout(250);
        const hash = await page.evaluate(() => location.hash);
        if (hash && !rotas.some((r) => r.hash === hash)) rotas.push({ titulo, hash });
      }
    }
    for (const { titulo, hash } of rotas) {
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.waitForTimeout(1800);
      const achados = [];
      for (const frame of page.frames()) {
        try {
          const r = await frame.evaluate(varrer);
          const origem = frame === page.mainFrame() ? "" : ` [moldura ${new URL(frame.url()).pathname.split("/").pop()}]`;
          r.forEach((x) => achados.push(x + origem));
        } catch { /* moldura de outra origem */ }
      }
      total++;
      const unicos = [...new Set(achados)];
      if (unicos.length) {
        falhas++;
        console.log(`FALHA ${rotulo} | ${titulo}: ${unicos.length} sem nome -> ${unicos.slice(0, 15).join(", ")}`);
      } else {
        console.log(`OK    ${rotulo} | ${titulo}`);
      }
    }
    await page.close();
  }
  await browser.close();
  console.log(falhas ? `\n${falhas} tela(s) com elementos sem nome acessível (de ${total}).` : `\nTodas as ${total} telas OK.`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
