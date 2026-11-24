// Quadro geral no visual premium (beta, só administrador): blocos, temas escuro/claro, texto compacto/ampliado,
// dados reais (pautas, tarefas, agenda) e volta ao visual atual (modo local, localhost).
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.location().url + m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());

  await page.goto(BASE + "/");
  await page.evaluate(() => {
    localStorage.removeItem("hub_qg_visual_premium");
    localStorage.removeItem("hub_qp_tema");
    localStorage.removeItem("hub_qp_tamanho");
    const hoje = new Date();
    const chave = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    const dados = {};
    dados[chave] = { source: "Teste", updated: "hoje", dates: { [String(hoje.getDate())]: [{ cat: "pj-fed", title: "<strong>[TESTE]</strong> DARF premium", periodo: "mês anterior" }] } };
    // Um vencimento no sábado desta semana (seis quadros de data na faixa), se cair no mesmo mês.
    const sabado = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - ((hoje.getDay() + 6) % 7) + 5);
    if (sabado.getMonth() === hoje.getMonth() && sabado.getDate() !== hoje.getDate()) dados[chave].dates[String(sabado.getDate())] = [{ cat: "simples", title: "[TESTE] Sábado", periodo: "" }];
    localStorage.setItem("agenda-tributaria-rfb-v1", JSON.stringify(dados));
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const segunda = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - ((hoje.getDay() + 6) % 7));
    const antiga = new Date(segunda);
    antiga.setDate(antiga.getDate() - 10);
    const eventos = [
      { id: "teste-qp-1", title: "[TESTE] Premium atrasada", date: iso(antiga), hub: { status: "aberta", responsaveis: ["Fulano Teste"] } },
      { id: "teste-qp-2", title: "[TESTE] Premium de hoje", date: `${iso(hoje)}T14:00`, hub: { status: "aberta", responsaveis: ["Beltrano Teste"] } }
    ];
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("CalAppDB", 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("events")) req.result.createObjectStore("events", { keyPath: "id" }); };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction("events", "readwrite");
        eventos.forEach((e) => tx.objectStore("events").put(e));
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  check("visual atual continua sendo o padrão", (await page.locator(".qg-colunas").count()) === 1 && (await page.locator(".qp").count()) === 0);
  const botao = page.locator("button.qg-visual-premium");
  check("administrador vê a opção Visual premium (beta)", (await botao.count()) === 1);
  await botao.click();
  await page.waitForSelector(".qp", { timeout: 8000 });
  await page.waitForTimeout(800);

  check("abre o visual premium no tema escuro e compacto", (await page.locator(".qp.qp--escuro.qp--compacto").count()) === 1);
  // Menu lateral, cabeçalho e rodapé no tema novo.
  check("app inteiro no visual premium escuro", (await page.locator(".app-shell.hub-premium.hub-premium--escuro").count()) === 1);
  const menuFundo = await page.locator(".sidebar").evaluate((el) => getComputedStyle(el).backgroundImage);
  check("menu lateral em vidro (sem o degradê azul antigo)", menuFundo === "none", menuFundo.slice(0, 80));
  const menuRaio = await page.locator(".sidebar").evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  check("menu lateral flutuante com cantos arredondados", menuRaio === "24px", menuRaio);
  const ativoCor = await page.locator(".side-nav button.active .side-nav-icon").first().evaluate((el) => getComputedStyle(el).color);
  const [ar, ag, ab] = (ativoCor.match(/[\d.]+/g) || []).map(Number);
  check("item ativo do menu com ícone turquesa", ag > 200 && ab > 200 && ar < 110 && Math.abs(ag - ab) < 8, ativoCor);
  const topoFundo = await page.evaluate(() => getComputedStyle(document.querySelector(".topbar"), "::before").backgroundColor);
  check("cabeçalho em vidro escuro", /rgba\(255, 255, 255, 0\.04/.test(topoFundo), topoFundo);
  const tituloCor = await page.locator(".topbar h1").evaluate((el) => getComputedStyle(el).color);
  check("título do cabeçalho claro no tema escuro", tituloCor === "rgb(255, 255, 255)", tituloCor);
  const rodape = await page.locator(".news-band").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check("rodapé de notícias em vidro", /rgba\(255, 255, 255, 0\.04/.test(rodape), rodape);
  await page.screenshot({ path: path.join(OUT, "hp-app-escuro.png") });

  // Outra tela (ainda no visual atual) fica numa folha clara dentro do tema escuro.
  await page.click(".side-nav button[title='Avaliações']");
  await page.waitForTimeout(900);
  const folha = await page.locator(".workspace-body").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("telas ainda não migradas ficam em folha clara", folha === "rgb(244, 241, 234)", folha);
  await page.screenshot({ path: path.join(OUT, "hp-pautas-escuro.png") });
  await page.click(".side-nav button[title='Quadro geral']");
  await page.waitForSelector(".qp", { timeout: 8000 });
  await page.waitForTimeout(500);
  const blocos = await page.evaluate(() => ["A", "B", "C", "D", "E", "F", "G"].filter((l) => document.querySelector(`.qp-${l}`)));
  check("os sete blocos estão na grade", blocos.length === 7, blocos.join(","));
  const saudacao = await page.locator(".qp h1").innerText();
  check("saudação com o nome", /^(Bom dia|Boa tarde|Boa noite), \S+/.test(saudacao), saudacao);
  const numero = await page.locator(".qp-numero-gigante").innerText();
  check("número de pautas abertas é um número", /^\d+$/.test(numero.trim()), numero);
  const agendaTexto = (await page.locator(".qp-B").innerText()).replace(/\s+/g, " ");
  check("agenda mostra o vencimento de hoje sem HTML", agendaTexto.includes("[TESTE] DARF premium") && !agendaTexto.includes("<strong>"), agendaTexto.slice(0, 200));
  check("dia de hoje destacado na faixa da agenda", (await page.locator(".qp-dia--hoje").count()) === 1);
  const tarefasTexto = (await page.locator(".qp-E").innerText()).replace(/\s+/g, " ");
  check("tarefas: atrasada e de hoje, com responsáveis", tarefasTexto.includes("[TESTE] Premium atrasada") && tarefasTexto.includes("[TESTE] Premium de hoje") && tarefasTexto.includes("Beltrano Teste"), tarefasTexto.slice(0, 260));
  check("tarefa atrasada marcada como atrasada", (await page.locator(".qp-E .qp-linha--atrasada", { hasText: "Premium atrasada" }).count()) === 1);
  const numeros = (await page.locator(".qp-F").innerText()).replace(/\s+/g, " ");
  check("semana em números traz atrasadas, semana e vencimentos", /Tarefas atrasadas \d+/i.test(numeros) && /Tarefas na semana \d+/i.test(numeros) && /Vencimentos na agenda \d+/i.test(numeros), numeros);
  check("Aviso da Coordenação dentro da grade", (await page.locator(".qp-C .qg-aviso").count()) === 1);

  // Fundo escuro nunca chega ao preto no fim da página.
  const fundo = await page.locator(".hp-fundo").evaluate((el) => getComputedStyle(el).backgroundImage);
  // Última parada do degradê: azul-acinzentado #182640 (aceita rgb() ou color(srgb ...)).
  const ultima = fundo.slice(fundo.lastIndexOf("100%") - 60, fundo.lastIndexOf("100%"));
  check("tema escuro: fundo termina em azul-acinzentado (não preto)", /rgb\(24, 38, 64\)|0\.0941\d* 0\.149\d* 0\.25/.test(ultima), ultima);
  await page.screenshot({ path: path.join(OUT, "qp-escuro-compacto.png"), fullPage: true });

  // Ações aparecem ao passar o mouse.
  const linha = page.locator(".qp-E .qp-linha").first();
  const opAntes = await linha.locator(".qp-acoes").evaluate((el) => getComputedStyle(el).opacity).catch(() => "sem ações");
  await linha.hover();
  await page.waitForTimeout(400);
  const opDepois = await linha.locator(".qp-acoes").evaluate((el) => getComputedStyle(el).opacity).catch(() => "sem ações");
  check("ações da linha aparecem ao passar o mouse", opAntes === "0" && opDepois === "1", `${opAntes} -> ${opDepois}`);

  // Texto ampliado: bem maior que o compacto.
  const tamanho = async () => parseFloat(await page.locator(".qp-E .qp-linha-titulo").first().evaluate((el) => getComputedStyle(el).fontSize));
  const compacto = await tamanho();
  await page.click(".qp button[aria-label='Aumentar o texto']");
  await page.waitForTimeout(300);
  const ampliado = await tamanho();
  check("ampliado aumenta o texto em pelo menos 25%", ampliado / compacto >= 1.25, `${compacto}px -> ${ampliado}px`);
  check("ampliado muda a grade (Pautas mais largo)", (await page.locator(".qp-A").evaluate((el) => getComputedStyle(el).gridColumnEnd)) === "span 5");
  await page.screenshot({ path: path.join(OUT, "qp-escuro-ampliado.png"), fullPage: true });

  // Tema claro.
  await page.click(".qp button[aria-label='Mudar para o tema claro']");
  await page.waitForTimeout(300);
  check("tema claro ativado", (await page.locator(".qp.qp--claro").count()) === 1);
  const cartaoPautas = await page.locator(".qp-A").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("tema claro: cartão de Pautas em branco", cartaoPautas === "rgb(255, 255, 255)", cartaoPautas);
  await page.screenshot({ path: path.join(OUT, "qp-claro-ampliado.png"), fullPage: true });
  await page.click(".qp button[aria-label='Usar texto compacto']");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "qp-claro-compacto.png"), fullPage: true });

  // Preferências guardadas ao recarregar.
  await page.reload();
  await page.waitForSelector(".qp", { timeout: 8000 });
  check("recarregar mantém premium, tema claro e texto compacto", (await page.locator(".qp.qp--claro.qp--compacto").count()) === 1);

  // Celular: blocos empilhados, sem rolagem lateral.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const largura = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: window.innerWidth }));
  check("celular sem rolagem lateral", largura.doc <= largura.tela + 1, JSON.stringify(largura));
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Tela menor (notebook) com texto ampliado: sem títulos espremidos nem botões quebrando linha.
  for (const largura of [1280, 1100]) {
    await page.setViewportSize({ width: largura, height: 800 });
    const aumentar = page.locator(".qp button[aria-label='Aumentar o texto']");
    if (await aumentar.count()) await aumentar.click();
    await page.waitForTimeout(400);
    const medida = await page.evaluate(() => {
      const titulos = [...document.querySelectorAll(".qp .qp-linha-titulo")].map((el) => Math.round(el.getBoundingClientRect().width));
      const botoes = [...document.querySelectorAll(".qp .qg-aviso .btn-mini")].map((el) => Math.round(el.getBoundingClientRect().height));
      const sobrepostos = [...document.querySelectorAll(".qp .qp-linha")].filter((linha) => {
        const filhos = [...linha.children].filter((f) => getComputedStyle(f).position !== "absolute" && f.getBoundingClientRect().width > 0);
        for (let i = 0; i < filhos.length; i++) for (let j = i + 1; j < filhos.length; j++) {
          const a = filhos[i].getBoundingClientRect(), b = filhos[j].getBoundingClientRect();
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return true;
        }
        return false;
      }).length;
      const diasApertados = [...document.querySelectorAll(".qp .qp-dia")].filter((dia) => {
        const caixa = dia.getBoundingClientRect();
        return [...dia.querySelectorAll(".qp-dia-numero, .qp-dia-semana")].some((t) => {
          const r = document.createRange();
          r.selectNodeContents(t);
          const tx = r.getBoundingClientRect();
          return tx.right > caixa.right - 4 || tx.left < caixa.left + 4;
        });
      }).length;
      return { menorTitulo: Math.min(...titulos), maiorBotao: Math.max(0, ...botoes), sobrepostos, diasApertados };
    });
    check(`${largura}px ampliado: títulos com espaço (>= 140px)`, medida.menorTitulo >= 140, JSON.stringify(medida));
    check(`${largura}px ampliado: botões do aviso em uma linha`, medida.maiorBotao <= 48, JSON.stringify(medida));
    check(`${largura}px ampliado: nada sobreposto nas linhas`, medida.sobrepostos === 0, JSON.stringify(medida));
    check(`${largura}px ampliado: datas da agenda com folga dentro dos quadros`, medida.diasApertados === 0, JSON.stringify(medida));
    await page.screenshot({ path: path.join(OUT, `qp-ampliado-${largura}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Voltar ao visual atual.
  await page.click(".qp button:has-text('Visual atual')");
  await page.waitForTimeout(500);
  check("Visual atual volta às três colunas", (await page.locator(".qg-colunas").count()) === 1 && (await page.locator(".qp").count()) === 0);
  check("Visual atual tira o tema do menu e do cabeçalho", (await page.locator(".app-shell.hub-premium").count()) === 0);

  check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => localStorage.removeItem("hub_qg_visual_premium"));
  await browser.close();
  console.log(results.join("\n"));
})().catch((e) => {
  console.log(results.join("\n"));
  console.log("ERRO " + e.message);
  process.exit(1);
});
