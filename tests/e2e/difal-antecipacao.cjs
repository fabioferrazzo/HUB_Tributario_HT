// Calculadora de DIFAL e ICMS antecipado (RS): valores conferidos à mão em todas as abas de compra e venda.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + "/apps/simuladores/difal-antecipacao-rs/index.html");
  await p.waitForSelector("#vProd");
  const set = async (id, v) => { await p.fill("#" + id, String(v)); };
  const res = async () => p.evaluate(() => ({ lbl: document.getElementById("resLbl").textContent, val: document.getElementById("resVal").textContent }));
  const caso = async (nome, fn, esperado) => {
    await p.click("#btnLimpar");
    await fn();
    await p.waitForTimeout(80);
    const r = await res();
    const val = r.val.replace(/\s/g, " ");
    check(nome, esperado ? val.includes(esperado) : true, `${r.lbl} | ${val}${esperado ? " (esperado " + esperado + ")" : ""}`);
  };
  // compra
  await caso("DIFAL base dupla 12->17",async()=>{await p.click('#segOper button[data-v=compra]');await p.click('.tab[data-modo=difal]');await p.click('#segMetodo button[data-v=dupla]');await set("vProd","1.000,00");},"60,24");
  await caso("DIFAL base única",async()=>{await p.click('#segMetodo button[data-v=unica]');await set("vProd","1000");},"50,00");
  await p.click('#segMetodo button[data-v=dupla]');
  await caso("DIFAL dupla c/ IPI 100",async()=>{await set("vProd","1000");await set("vIPI","100");},"66,27");
  await caso("Antecipação 12->17 (5pp, não devida)",async()=>{await p.click('.tab[data-modo=antec]');await set("vProd","1000");},"0,00");
  await caso("Antecipação 4->17",async()=>{await p.selectOption("#aInter","4");await set("vProd","1000");},"130,00");
  await p.selectOption("#aInter","12");
  await caso("Antecipação 12->25",async()=>{await p.selectOption("#aIntSel","25");await set("vProd","1000");},"130,00");
  await p.selectOption("#aIntSel","17");
  await caso("ST MVA 40 ajustada",async()=>{await p.click('.tab[data-modo=st]');await set("vProd","1000");await set("mva","40");},"132,34");
  await caso("DIFAL-ST nada retido (dupla)",async()=>{await p.click('.tab[data-modo=difalST]');await set("vProd","1000");},"60,24");
  await caso("DIFAL-ST retido 50 (dupla)",async()=>{await set("vProd","1000");await set("stRet","50");},"10,24");
  // venda
  await p.click('#segOper button[data-v=venda]');
  await p.selectOption("#uf","SP");
  await caso("Venda NC SP geral",async()=>{await p.click('.tab[data-modo=vNC]');await p.click('#segAdq button[data-v=geral]');await set("vProd","1000");},"73,17");
  await p.selectOption("#uf","RJ");await p.dispatchEvent("#uf","change");
  await caso("Venda NC RJ c/ FCP 2",async()=>{await set("vProd","1000");},"128,21");
  await p.selectOption("#uf","BA");await p.dispatchEvent("#uf","change");
  await caso("Venda NC BA (7%, 20,5)",async()=>{await set("vProd","1000");},"169,81");
  await caso("Venda NC SN",async()=>{await p.click('#segAdq button[data-v=sn]');await set("vProd","1000");},"0,00");
  await caso("vRev geral BA",async()=>{await p.click('#segAdq button[data-v=geral]');await p.click('.tab[data-modo=vRev]');await set("vProd","1000");},"70,00");
  await caso("vST BA",async()=>{await p.click('.tab[data-modo=vST]');await set("vProd","1000");},"169,81");
  const fontes = await p.evaluate(() => getComputedStyle(document.querySelector("#btnAdd")).fontWeight);
  check("botões com a fonte do app (peso 600)", fontes === "600", fontes);
  await p.selectOption("#uf", "SP");
  await p.click("#btnAdd");
  check("item entra na lista de cálculos", (await p.locator("#listaBody tr").count()) >= 2);
  check("sem erros de página", errs.length === 0, errs.join(" | "));
  await b.close();
  console.log(results.join("\n"));
  const falhas = results.filter((r) => r.startsWith("FALHA")).length;
  console.log(falhas ? `\n${falhas} falha(s)` : `\nTodas as ${results.length} verificações OK`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
