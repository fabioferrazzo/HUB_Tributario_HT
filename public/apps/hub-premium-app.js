/*
 * Ponte do visual premium (padrão H. Teixeira Premium) para os apps do HUB.
 * Inclua no <head> do app:  <script src="/apps/hub-premium-app.js"></script>
 *
 * - Dentro do HUB (iframe): segue o HUB. Só liga quando o HUB está com o visual premium
 *   (padrão para toda a equipe), e acompanha tema, tamanho e paleta na hora.
 * - Aberto sozinho: liga se o visual premium foi ativado neste navegador.
 * - Coloca no <html> as classes  ht-premium  ht-premium--escuro|claro  ht-premium--compacto|ampliado
 *   e as variáveis da paleta (--ht-h, --ht-s, --ht-l-acento, --ht-l-texto, --ht-luz...).
 *   Cada app estiliza a partir de  html.ht-premium  (sem a classe, o app fica como sempre foi).
 * - Avisa mudanças com o evento  "ht-premium-change"  no window do app.
 */
(function () {
  "use strict";
  if (window.__htPremiumApp) return;
  window.__htPremiumApp = true;

  var raiz = document.documentElement;
  var embutido = window.parent && window.parent !== window;
  var FONTES =
    "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=Nunito:wght@200;300;600;700;800&display=swap";
  var VARIAVEIS = ["--ht-h", "--ht-s", "--ht-l-acento", "--ht-l-texto", "--ht-luz", "--ht-degrade", "--ht-vidro-k", "--ht-sombra-k", "--ht-raio", "--ht-angulo"];
  var ultimo = "";

  function ler(chave) {
    try {
      return localStorage.getItem(chave) || "";
    } catch (e) {
      return "";
    }
  }

  function estadoDoHub() {
    try {
      var doc = window.parent.document;
      var tema = doc.body && doc.body.getAttribute("data-hub-premium");
      if (!tema) return { ativo: false };
      var casca = doc.querySelector(".app-shell.hub-premium");
      var vars = {};
      if (casca) {
        for (var i = 0; i < VARIAVEIS.length; i++) {
          var v = casca.style.getPropertyValue(VARIAVEIS[i]);
          if (v) vars[VARIAVEIS[i]] = v.trim();
        }
      }
      return {
        ativo: true,
        tema: tema === "claro" ? "claro" : "escuro",
        tamanho: casca && casca.classList.contains("hub-premium--ampliado") ? "ampliado" : "compacto",
        vars: vars
      };
    } catch (e) {
      return { ativo: false };
    }
  }

  function estadoLocal() {
    if (ler("hub_qg_visual_premium") === "0") return { ativo: false }; // padrão: ligado (só "0" = visual clássico)
    var vars = {};
    try {
      var p = JSON.parse(ler("ht_premium_paleta") || "null");
      if (p && typeof p === "object") {
        if (p.h != null) vars["--ht-h"] = String(p.h);
        if (p.s != null) vars["--ht-s"] = p.s + "%";
        if (p.luz != null) vars["--ht-luz"] = String(p.luz / 100);
        if (p.degrade != null) vars["--ht-degrade"] = String(p.degrade / 100);
        if (p.vidro != null) vars["--ht-vidro-k"] = String(p.vidro / 100);
        if (p.sombra != null) vars["--ht-sombra-k"] = String(p.sombra / 100);
        if (p.raio != null) vars["--ht-raio"] = p.raio + "px";
        if (p.angulo != null) vars["--ht-angulo"] = p.angulo + "deg";
      }
    } catch (e) {
      /* paleta inválida: fica o padrão */
    }
    return {
      ativo: true,
      tema: ler("hub_qp_tema") === "claro" ? "claro" : "escuro",
      tamanho: ler("hub_qp_tamanho") === "ampliado" ? "ampliado" : "compacto",
      vars: vars
    };
  }

  // Aberto sozinho (janela própria), o app não tem o fundo do HUB atrás: a ponte coloca o fundo do tema.
  function fundoAvulso() {
    if (embutido || document.getElementById("ht-premium-avulso")) return;
    var estilo = document.createElement("style");
    estilo.id = "ht-premium-avulso";
    estilo.textContent =
      "html.ht-premium--escuro{background:linear-gradient(180deg,#070B1A 0%,#0B1227 58%,#121C36 78%,#182640 100%) fixed!important}" +
      "html.ht-premium--claro{background:linear-gradient(160deg,#F3F4F6 0%,#F7F5F0 38%,#F2F1ED 68%,#EEF1F4 100%) fixed!important}";
    (document.head || raiz).appendChild(estilo);
  }

  function carregarFontes() {
    if (document.getElementById("ht-premium-fontes")) return;
    var link = document.createElement("link");
    link.id = "ht-premium-fontes";
    link.rel = "stylesheet";
    link.href = FONTES;
    (document.head || raiz).appendChild(link);
  }

  function aplicar() {
    var e = embutido ? estadoDoHub() : estadoLocal();
    var assinatura = JSON.stringify(e);
    if (assinatura === ultimo) return;
    ultimo = assinatura;
    var classes = ["ht-premium", "ht-premium--escuro", "ht-premium--claro", "ht-premium--compacto", "ht-premium--ampliado"];
    for (var i = 0; i < classes.length; i++) raiz.classList.remove(classes[i]);
    for (var j = 0; j < VARIAVEIS.length; j++) raiz.style.removeProperty(VARIAVEIS[j]);
    if (e.ativo) {
      raiz.classList.add("ht-premium", "ht-premium--" + e.tema, "ht-premium--" + e.tamanho);
      for (var k in e.vars) raiz.style.setProperty(k, e.vars[k]);
      carregarFontes();
      fundoAvulso();
    }
    try {
      window.dispatchEvent(new CustomEvent("ht-premium-change", { detail: e }));
    } catch (err) {
      /* navegador antigo: sem aviso */
    }
  }

  aplicar();
  window.addEventListener("storage", aplicar);

  if (embutido) {
    try {
      var doc = window.parent.document;
      var observador = new MutationObserver(aplicar);
      observador.observe(doc.body, { attributes: true, attributeFilter: ["data-hub-premium"] });
      var casca = doc.querySelector(".app-shell");
      if (casca) observador.observe(casca, { attributes: true, attributeFilter: ["class", "style"] });
    } catch (e) {
      /* HUB em outra origem: fica no visual normal */
    }
  }
})();
