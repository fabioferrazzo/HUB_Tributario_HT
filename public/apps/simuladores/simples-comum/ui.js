/* Utilidades de tela dos simuladores (números no padrão brasileiro). */
(function (root) {
  "use strict";
  function parseBR(valor) {
    var s = String(valor == null ? "" : valor).trim().replace(/\s/g, "").replace(/R\$/gi, "").replace(/%/g, "");
    if (!s) return NaN;
    if (s.indexOf(",") >= 0) return Number(s.replace(/\./g, "").replace(",", "."));
    if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
    return Number(s);
  }
  var fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  function moeda(v) { return Number.isFinite(v) ? fmtMoeda.format(v) : "—"; }
  function numero(v, casas) { return Number.isFinite(v) ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v) : "—"; }
  function pct(v, casas) { return Number.isFinite(v) ? numero(v, casas == null ? 4 : casas) + "%" : "—"; }
  function valorCampo(el) { var v = parseBR(el.value); return Number.isFinite(v) ? v : NaN; }
  function formatarCampoMoeda(el) {
    var v = parseBR(el.value);
    if (Number.isFinite(v) && v >= 0) el.value = numero(Math.round(v * 100) / 100, 2);
  }
  function prepararCamposMoeda(scope) {
    Array.prototype.forEach.call((scope || document).querySelectorAll("input.moeda"), function (el) {
      el.addEventListener("blur", function () { formatarCampoMoeda(el); });
      el.setAttribute("inputmode", "decimal");
      el.setAttribute("autocomplete", "off");
    });
  }
  function copiar(texto, botao) {
    var ok = function () { if (botao) { var t = botao.textContent; botao.textContent = "Copiado"; setTimeout(function () { botao.textContent = t; }, 1400); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(ok, function () { fallback(); });
    else fallback();
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) { /* sem cópia */ }
      ta.remove();
    }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  root.SimUI = { parseBR: parseBR, moeda: moeda, numero: numero, pct: pct, valorCampo: valorCampo, prepararCamposMoeda: prepararCamposMoeda, copiar: copiar, esc: esc };
})(this);
