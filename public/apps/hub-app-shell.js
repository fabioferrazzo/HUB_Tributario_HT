/*
 * Componente comum dos apps do HUB Depto Tributário.
 * Inclua antes de </body>:  <script src="/apps/hub-app-shell.js" defer></script>
 *
 * - Fora do HUB (página ou janela separada): mostra um botão discreto de tela cheia.
 * - Dentro do HUB: a moldura do HUB já tem o botão; aqui só fica o canal de mensagens.
 * - Canal reservado "hub:*": window.hubApp.send(tipo, dados) envia ao HUB (integrações futuras).
 *   Em janela aberta pelo HUB, pede o login da sessão ("hub:auth-request"); a resposta chega
 *   como { type: "hub-auth-token", token }, o mesmo formato já usado pelos apps.
 */
(function () {
  "use strict";
  if (window.__hubAppShell) return;
  window.__hubAppShell = true;

  var embedded = window.top !== window;
  var hub = null;
  try {
    hub = embedded ? window.parent : window.opener && !window.opener.closed ? window.opener : null;
  } catch (e) {
    hub = null;
  }

  function send(type, data) {
    if (!hub) return false;
    try {
      var message = { type: type };
      for (var key in data || {}) message[key] = data[key];
      hub.postMessage(message, window.location.origin);
      return true;
    } catch (e) {
      return false;
    }
  }

  window.hubApp = { send: send, embedded: embedded };

  if (hub && !embedded) send("hub:auth-request");
  if (embedded) return;

  var ICON_EXPAND =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
  var ICON_SHRINK =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>';

  function mount() {
    if (!document.body || !document.documentElement.requestFullscreen) return;
    var style = document.createElement("style");
    style.textContent =
      ".hub-fs-btn{position:fixed;right:14px;bottom:14px;z-index:2147483000;width:34px;height:34px;display:grid;place-items:center;" +
      "border:1px solid rgba(27,54,93,.22);border-radius:8px;background:rgba(255,255,255,.92);color:#1b365d;cursor:pointer;" +
      "opacity:.55;box-shadow:0 2px 8px rgba(15,23,42,.12);transition:opacity .15s,border-color .15s}" +
      ".hub-fs-btn:hover,.hub-fs-btn:focus-visible{opacity:1;border-color:#1b365d;outline:none}" +
      "@media print{.hub-fs-btn{display:none}}";
    document.head.appendChild(style);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "hub-fs-btn";

    function refresh() {
      var on = Boolean(document.fullscreenElement);
      button.innerHTML = on ? ICON_SHRINK : ICON_EXPAND;
      button.title = on ? "Sair da tela cheia (Esc)" : "Tela cheia";
      button.setAttribute("aria-label", button.title);
    }

    button.addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      else document.documentElement.requestFullscreen().catch(function () {});
    });
    document.addEventListener("fullscreenchange", refresh);
    refresh();
    document.body.appendChild(button);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
