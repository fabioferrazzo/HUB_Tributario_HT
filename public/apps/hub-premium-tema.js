/*
 * Visual premium: para apps que têm modo claro/escuro próprio.
 * Com o premium do HUB ligado, o tema do app acompanha o do HUB (o botão de tema do app some pelo CSS do app);
 * ao desligar, volta ao tema que o usuário tinha escolhido no app.
 *
 * Inclua depois de /apps/hub-premium-app.js, por exemplo:
 *   <script src="/apps/hub-premium-tema.js" data-atributo="data-tema" data-escuro="escuro" data-claro="claro"
 *           data-chave="htferias-tema"></script>
 * data-atributo: atributo do <html> que o app usa para o tema
 * data-escuro / data-claro: valores desse atributo
 * data-chave: chave do localStorage onde o app guarda a escolha (o valor guardado é o próprio valor do atributo)
 * data-padrao: valor quando o app não tem escolha guardada (sem ele, o atributo é retirado = automático)
 */
(function () {
  "use strict";
  var s = document.currentScript;
  if (!s) return;
  var attr = s.getAttribute("data-atributo"), escuro = s.getAttribute("data-escuro"), claro = s.getAttribute("data-claro");
  var chave = s.getAttribute("data-chave"), padrao = s.getAttribute("data-padrao");
  if (!attr || !escuro || !claro) return;
  var raiz = document.documentElement;
  var forcado = false;

  function sinc() {
    if (raiz.classList.contains("ht-premium")) {
      forcado = true;
      var v = raiz.classList.contains("ht-premium--escuro") ? escuro : claro;
      if (raiz.getAttribute(attr) !== v) raiz.setAttribute(attr, v);
    } else if (forcado) {
      forcado = false;
      var guardado = null;
      try { guardado = chave ? localStorage.getItem(chave) : null; } catch (e) { guardado = null; }
      var volta = guardado === escuro || guardado === claro ? guardado : padrao;
      if (volta) raiz.setAttribute(attr, volta);
      else raiz.removeAttribute(attr);
    }
  }

  new MutationObserver(sinc).observe(raiz, { attributes: true, attributeFilter: ["class", attr] });
  window.addEventListener("ht-premium-change", sinc);
  sinc();
})();
