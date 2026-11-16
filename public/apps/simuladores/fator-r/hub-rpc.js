/* Fator R — acesso ao banco do HUB pelo login do HUB (mesma ponte do Controle de Apuração).
   O token vem da janela do HUB (postMessage) ou da sessão guardada neste navegador; nada fica embutido no arquivo. */
(function (root) {
  "use strict";
  var CFG_KEY = "hub_supabase_public";
  var auth = { token: "", exp: 0, url: "", anonKey: "" };
  var esperando = [];
  var hub = null;
  try { hub = window.top !== window ? window.parent : (window.opener && !window.opener.closed ? window.opener : null); } catch (e) { hub = null; }

  function payload(t) { try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { return {}; } }
  function exp(t) { return Number(payload(t).exp || 0) * 1000; }
  function lerConfig() {
    try {
      var c = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      if (c && c.url && c.anonKey) { auth.url = auth.url || c.url; auth.anonKey = auth.anonKey || c.anonKey; }
    } catch (e) { /* sem configuração */ }
  }
  function lerSessao() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(k || "")) continue;
        var d = JSON.parse(localStorage.getItem(k) || "null"), s = d && (d.currentSession || d);
        if (s && s.access_token) return s.access_token;
      }
    } catch (e) { /* sem sessão */ }
    return "";
  }
  window.addEventListener("message", function (ev) {
    if (ev.origin !== location.origin || !ev.data || ev.data.type !== "hub-auth-token" || !ev.data.token) return;
    auth.token = ev.data.token; auth.exp = exp(ev.data.token);
    if (ev.data.supabaseUrl) auth.url = ev.data.supabaseUrl;
    if (ev.data.supabaseAnonKey) auth.anonKey = ev.data.supabaseAnonKey;
    var l = esperando; esperando = []; l.forEach(function (fn) { fn(); });
  });
  function pedirAoHub(ms) {
    return new Promise(function (resolve) {
      if (!hub) return resolve(false);
      var feito = false;
      esperando.push(function () { if (!feito) { feito = true; resolve(true); } });
      try { hub.postMessage({ type: "hub:auth-request" }, location.origin); } catch (e) { /* HUB indisponível */ }
      setTimeout(function () { if (!feito) { feito = true; resolve(false); } }, ms || 2500);
    });
  }
  async function token() {
    lerConfig();
    if (auth.token && auth.exp - Date.now() > 90000) return auth.token;
    await pedirAoHub(2500);
    if (!auth.token || auth.exp - Date.now() < 30000) {
      var s = lerSessao();
      if (s && exp(s) - Date.now() > 30000) { auth.token = s; auth.exp = exp(s); }
    }
    if (!auth.url || !auth.anonKey) {
      try {
        var r = await fetch("/apps/hub-config.json", { cache: "no-store" });
        if (r.ok) { var c = await r.json(); if (c && c.url && c.anonKey) { auth.url = auth.url || c.url; auth.anonKey = auth.anonKey || c.anonKey; } }
      } catch (e) { /* sem configuração pública */ }
    }
    return auth.token;
  }
  function SemSessao(msg) { var e = new Error(msg); e.semSessao = true; return e; }

  async function rpc(fn, args) {
    var t = await token();
    if (!t || !auth.url || !auth.anonKey) throw SemSessao("Sessão do HUB não encontrada. Entre no HUB e abra o simulador pelo menu Simuladores.");
    var resp;
    try {
      resp = await fetch(auth.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: { apikey: auth.anonKey, Authorization: "Bearer " + t, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(args || {})
      });
    } catch (e) { throw new Error("Sem conexão com o HUB. Verifique a internet e tente de novo."); }
    var dados = null;
    try { dados = await resp.json(); } catch (e) { dados = null; }
    if (resp.status === 401) { auth.token = ""; throw SemSessao("Sessão do HUB expirada. Entre no HUB novamente e reabra o simulador."); }
    if (resp.status === 404 && dados && /function|schema cache/i.test(String(dados.message || ""))) {
      throw new Error("O banco do HUB ainda não tem o Monitoramento do Fator R (falta rodar o patch_fator_r.sql no Supabase).");
    }
    if (!resp.ok) throw new Error((dados && (dados.message || dados.error_description || dados.error)) || "Erro " + resp.status + " no HUB.");
    return dados;
  }
  root.HubRPC = { rpc: rpc, usuario: function () { return auth.token ? payload(auth.token).sub || "" : ""; } };
})(this);
