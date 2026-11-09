/*
 * Controle de Apuração no HUB — ponte entre a tela do app (app.js, mantida como no servidor antigo)
 * e o banco do HUB (Supabase).
 *
 * A tela continua chamando os mesmos endereços "/api/..." do servidor antigo; aqui essas chamadas
 * são atendidas pelas funções apur_* do Supabase, com o login do HUB. Nada sai para o HTSERVER.
 *
 * - Login: usa a sessão do HUB (o HUB envia o token; fora do HUB, lê a sessão salva no navegador).
 * - Usuários: ADM do HUB = ADMIN do app; demais usuários ativos = donos de carteira (USER).
 * - Endereços ainda não atendidos respondem com aviso claro (entram nas etapas seguintes).
 */
(function () {
  "use strict";

  var APP_BUILD = "0.11.8.13";
  var FEATURES = {
    company_order: true, company_order_aliases: true, sidebar_font_embedded: true, fix03_endpoint_sync: true,
    regime_filter: true, fix04_regime_filter: true, general_alerts_v2: true, alert_targeting: true, alert_ticker: true,
    user_admin_v2: true, user_soft_delete: true, portfolio_transfer: true, competence_lifecycle_v2: true,
    separate_close_v1: true, competence_snapshots_immutable: true, period_company_membership_v1: true,
    admin_backup_restore_v1: true, admin_backup_restore_v2: true, admin_period_override_v1: true,
    user_delete_transfer_v1: true, company_order_snapshots_v2: true, admin_historical_reopen_v2: true,
    historical_consistency_v1: true, period_completion_gate_v1: true
  };
  var META = { app: "ht-controle-fiscal", server_build: APP_BUILD, api_version: 1, schema_version: 1, data_epoch: "hub-supabase", last_restore_at: null, features: FEATURES };
  var CFG_KEY = "hub_supabase_public";
  var realFetch = window.fetch.bind(window);

  // -------------------------------------------------------------------------------------------
  // Sessão do HUB

  var hubWindow = null;
  try {
    hubWindow = window.top !== window ? window.parent : window.opener && !window.opener.closed ? window.opener : null;
  } catch (e) {
    hubWindow = null;
  }

  var auth = { token: "", exp: 0, url: "", anonKey: "" };
  var waiting = [];

  function jwtExp(token) {
    try {
      var payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return Number(payload.exp || 0) * 1000;
    } catch (e) {
      return 0;
    }
  }

  function readStoredConfig() {
    try {
      var cfg = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      if (cfg && cfg.url && cfg.anonKey) {
        auth.url = auth.url || cfg.url;
        auth.anonKey = auth.anonKey || cfg.anonKey;
      }
    } catch (e) {}
  }

  function readStoredSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(key || "")) continue;
        var data = JSON.parse(localStorage.getItem(key) || "null");
        var session = data && (data.currentSession || data);
        if (session && session.access_token) return session.access_token;
      }
    } catch (e) {}
    return "";
  }

  function acceptToken(data) {
    if (!data || !data.token) return;
    auth.token = data.token;
    auth.exp = jwtExp(data.token);
    if (data.supabaseUrl) auth.url = data.supabaseUrl;
    if (data.supabaseAnonKey) auth.anonKey = data.supabaseAnonKey;
    var list = waiting;
    waiting = [];
    list.forEach(function (fn) { fn(); });
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== location.origin) return;
    var type = event.data && event.data.type;
    if (type === "hub-auth-token") acceptToken(event.data);
    // Janelas abertas por este app (janela flutuante, painel da empresa) pedem o login a ele.
    if (type === "hub:auth-request" && event.source && event.source !== window) {
      getToken().then(function (token) {
        if (token) event.source.postMessage({ type: "hub-auth-token", token: token, supabaseUrl: auth.url, supabaseAnonKey: auth.anonKey }, location.origin);
      });
    }
  });

  function askHub(timeoutMs) {
    return new Promise(function (resolve) {
      if (!hubWindow) return resolve(false);
      var done = false;
      waiting.push(function () { if (!done) { done = true; resolve(true); } });
      try {
        hubWindow.postMessage({ type: "hub:auth-request" }, location.origin);
      } catch (e) {}
      setTimeout(function () { if (!done) { done = true; resolve(false); } }, timeoutMs || 2500);
    });
  }

  async function getToken(force) {
    readStoredConfig();
    if (!force && auth.token && auth.exp - Date.now() > 90000) return auth.token;
    await askHub(2500);
    if (!auth.token || auth.exp - Date.now() < 30000) {
      var stored = readStoredSession();
      if (stored && jwtExp(stored) - Date.now() > 30000) { auth.token = stored; auth.exp = jwtExp(stored); }
    }
    return auth.token;
  }

  // -------------------------------------------------------------------------------------------
  // Supabase (funções apur_*)

  function httpError(message, status) {
    var e = new Error(message);
    e.status = status;
    return e;
  }

  async function rpc(fn, args, retried) {
    var token = await getToken(false);
    if (!auth.url || !auth.anonKey) throw httpError("Configuração do HUB não encontrada. Abra o Controle de Apuração pelo HUB.", 401);
    if (!token) throw httpError("Sessão do HUB não encontrada. Entre no HUB e abra o Controle de Apuração por ele.", 401);
    var response = await realFetch(auth.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: auth.anonKey, Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args || {})
    });
    var text = await response.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (response.ok) return data;
    if ((response.status === 401 || (data && data.code === "PGRST301")) && !retried) {
      await getToken(true);
      return rpc(fn, args, true);
    }
    var message = (data && (data.message || data.error)) || "Erro " + response.status;
    var status = response.status;
    if (data && data.code === "42501") status = 403;
    else if (data && /^P000[12]$/.test(data.code || "")) status = 400;
    else if (data && data.code === "PGRST202") message = "Função do banco não encontrada (" + fn + "). Rode o SQL da etapa no Supabase.";
    throw httpError(message, status);
  }

  // -------------------------------------------------------------------------------------------
  // Rotas do app antigo -> Supabase

  function notYet(name) {
    throw httpError(name + " ainda não está disponível nesta versão do HUB (entra numa próxima etapa).", 400);
  }

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function uuidOrNull(v) {
    v = String(v || "").trim();
    return UUID_RE.test(v) ? v : null;
  }

  async function route(method, url, body) {
    var path = url.pathname.replace(/\/+$/, "");
    var q = url.searchParams;
    var m;

    if (path === "/api/health") return META;
    if (path === "/api/bootstrap") {
      var data = await rpc("apur_bootstrap", { p_owner: uuidOrNull(q.get("owner_user_id")) });
      return Object.assign({}, META, data);
    }
    if (path === "/api/logout") return { ok: true };
    if (path === "/api/login" || path === "/api/change-password" || path === "/api/password-reset/request")
      throw httpError("Login e senha são os do HUB. Use o HUB para entrar ou trocar a senha.", 400);

    if (path === "/api/companies" && method === "POST") return rpc("apur_company_create", { p: body });
    if ((m = path.match(/^\/api\/companies\/([^/]+)$/))) {
      if (method === "PUT") return rpc("apur_company_update", { p_id: decodeURIComponent(m[1]), p: body });
      if (method === "DELETE") return rpc("apur_company_delete", { p_id: decodeURIComponent(m[1]), p_competence: q.get("competence") || null });
    }
    if (["/api/company-order", "/api/companies/reorder", "/api/companies/order", "/api/reorder-companies"].indexOf(path) >= 0)
      return rpc("apur_reorder", { p_owner: uuidOrNull(body.owner_user_id), p_company_ids: body.company_ids || [], p_competence: body.competence || null });

    if (path === "/api/checks")
      return rpc("apur_set_check", { p_company: body.company_id, p_competence: body.competence, p_item_id: body.item_id, p_item_label: body.item_label || "", p_status: body.status });
    if (path === "/api/check-notes")
      return rpc("apur_set_check_note", { p_company: body.company_id, p_competence: body.competence, p_item_id: body.item_id, p_item_label: body.item_label || "", p_note: body.note || "" });
    if (path === "/api/monthly-notes")
      return rpc("apur_set_monthly_note", { p_company: body.company_id, p_competence: body.competence, p_note: body.note || "", p_is_pending: !!body.is_pending });
    if (path === "/api/visual-marks")
      return rpc("apur_set_visual_mark", { p_company: body.company_id, p_competence: body.competence, p_item_id: body.item_id || "__ROW__", p_color: body.color || "NONE" });

    if (path === "/api/admin-notes" && method === "POST")
      return rpc("apur_admin_note_create", { p_company: body.company_id, p_competence: body.competence, p_item_id: body.item_id || "__ROW__", p_note_type: body.note_type || "MESSAGE", p_note: body.note || "", p_id: uuidOrNull(body.id) });
    if ((m = path.match(/^\/api\/admin-notes\/([^/]+)$/)) && method === "DELETE")
      return rpc("apur_admin_note_archive", { p_id: decodeURIComponent(m[1]) });

    if (path === "/api/checklist-columns")
      return rpc("apur_column_add", { p_owner: uuidOrNull(body.owner_user_id), p_item_id: body.id, p_label: body.label, p_competence: body.competence || null });
    if (path === "/api/checklist-columns/rename")
      return rpc("apur_column_rename", { p_owner: uuidOrNull(body.owner_user_id), p_item_id: body.id, p_label: body.label, p_competence: body.competence || null });

    if (path === "/api/competences/save")
      return rpc("apur_competence_action", { p_action: "save", p_owner: uuidOrNull(body.owner_user_id), p_competence: body.competence, p_layout: body.layout || null });
    if (path === "/api/competences/save-progress")
      return rpc("apur_competence_action", { p_action: "save_progress", p_owner: uuidOrNull(body.owner_user_id), p_competence: body.competence, p_layout: null });
    if (path === "/api/competences/reopen")
      return rpc("apur_competence_action", { p_action: "reopen", p_owner: uuidOrNull(body.owner_user_id), p_competence: body.competence, p_layout: null });
    if (path === "/api/competences/generate-next")
      return rpc("apur_competence_action", { p_action: "generate_next", p_owner: uuidOrNull(body.owner_user_id), p_competence: body.source_competence || body.competence, p_layout: null });
    if (path === "/api/competences/prepare") return { ok: true };

    if (path === "/api/admin/dashboard") return rpc("apur_admin_dashboard", { p_competence: q.get("competence") || "" });
    if (path === "/api/admin/history") return rpc("apur_admin_history", { p_owner: uuidOrNull(q.get("owner_user_id")) });
    if (path === "/api/admin/companies/delete-all")
      return rpc("apur_delete_all", { p_owner: uuidOrNull(body.owner_user_id), p_competence: body.competence || null, p_confirm: body.confirm || "" });
    if ((m = path.match(/^\/api\/users\/([^/]+)\/transfer-portfolio$/)))
      return rpc("apur_transfer_portfolio", { p_from: decodeURIComponent(m[1]), p_to: uuidOrNull(body.target_user_id) });
    if (path === "/api/users" || /^\/api\/users\//.test(path))
      throw httpError("Os usuários são cadastrados no HUB (Configurações > Usuários).", 400);

    if (path === "/api/import-companies")
      return rpc("apur_import_companies", { p_owner: uuidOrNull(body.owner_user_id), p_competence: body.competence || null, p_rows: body.companies || [] });
    if (path === "/api/parse-excel") return parseExcel(body);
    if (/^\/api\/export\//.test(path)) return notYet("A exportação XLSX");
    if (/^\/api\/documents/.test(path)) return notYet("A biblioteca de documentos");
    if (path === "/api/alerts" && method === "GET") return Object.assign({}, META, await rpc("apur_alerts_list", {}));
    if (/^\/api\/alerts/.test(path)) return notYet("O cadastro de alertas gerais");
    if (/^\/api\/(admin\/)?backup/.test(path)) return notYet("O backup");
    if (path === "/api/audit") return notYet("A auditoria");

    throw httpError("Endpoint não encontrado. [" + method + " " + path + "]", 404);
  }

  // -------------------------------------------------------------------------------------------
  // Importação de planilha: lida aqui no navegador (mesmo importador do servidor antigo);
  // as duplicidades com a carteira são conferidas pelo banco.

  var MAX_IMPORT_BYTES = 8 * 1024 * 1024;
  var scriptsLoading = {};
  function loadScript(src) {
    if (!scriptsLoading[src]) {
      scriptsLoading[src] = new Promise(function (resolve, reject) {
        var el = document.createElement("script");
        el.src = src;
        el.onload = function () { resolve(); };
        el.onerror = function () { delete scriptsLoading[src]; reject(httpError("Não foi possível carregar o leitor de planilhas. Verifique a conexão e tente de novo.", 400)); };
        document.head.appendChild(el);
      });
    }
    return scriptsLoading[src];
  }

  async function parseExcel(body) {
    var filename = String(body.filename || "").trim();
    var bytes;
    try {
      var bin = atob(String(body.content_base64 || ""));
      bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (e) {
      throw httpError("Conteúdo da planilha inválido.", 400);
    }
    if (bytes.length > MAX_IMPORT_BYTES) throw httpError("Arquivo maior que 8 MB.", 400);
    await loadScript("vendor/xlsx.full.min.js?v=0.20.3");
    await loadScript("importador.js?v=" + APP_BUILD + "-hub3");
    var result;
    try {
      result = window.HubApuracaoImport.parse(window.XLSX, filename, bytes);
    } catch (e) {
      throw httpError(/Formato não suportado/.test(e.message) ? e.message : "Não foi possível ler a planilha: " + e.message, 400);
    }
    var rows = window.HubApuracaoImport.sheetDuplicates(result.companies);
    var send = rows.map(function (r) { var x = Object.assign({}, r); delete x._sheet_reason; return x; });
    var checked = send.length ? await rpc("apur_import_preview", { p_owner: uuidOrNull(body.owner_user_id), p_rows: send }) : [];
    var companies = rows.map(function (r, k) {
      var db = checked[k] || {};
      var item = Object.assign({}, r);
      var reason = r._sheet_reason || db.duplicate_reason || "";
      delete item._sheet_reason;
      item.importable = !reason;
      item.duplicate_reason = reason;
      return item;
    });
    var importable = companies.filter(function (c) { return c.importable; }).length;
    var recognized = companies.length;
    // Linhas que não viraram empresa aparecem na prévia com o motivo (nunca são importadas).
    result.ignored.forEach(function (row) {
      companies.push({ legal_name: row.text, cnpj: "", dominio_code: "", tax_regime: "", envio: "", importable: false, ignored_line: true,
        duplicate_reason: row.reason + " · " + row.source_sheet + ", linha " + row.source_row });
    });
    return { companies: companies, warnings: result.warnings.concat(result.info), count: recognized, importable: importable, skipped: companies.length - importable };
  }

  window.fetch = async function (input, init) {
    var href = typeof input === "string" ? input : input && input.url;
    var url;
    try { url = new URL(href, location.href); } catch (e) { return realFetch(input, init); }
    if (url.origin !== location.origin || url.pathname.indexOf("/api/") !== 0) return realFetch(input, init);
    init = init || {};
    var method = String(init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    var body = {};
    if (typeof init.body === "string" && init.body) {
      try { body = JSON.parse(init.body); } catch (e) { body = {}; }
    }
    try {
      var result = await route(method, url, body);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result === undefined ? { ok: true } : result), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || "Erro inesperado." }), { status: e.status || 500, headers: { "Content-Type": "application/json" } });
    }
  };

  // Sem service worker do app antigo dentro do HUB.
  try {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: function () { return Promise.resolve(null); } } });
  } catch (e) {}

  // -------------------------------------------------------------------------------------------
  // Início: entra com o usuário do HUB e só então carrega a tela do app.

  function showBlocker(message) {
    var box = document.getElementById("hubApuracaoBlocker");
    if (!box) return;
    box.querySelector("p").textContent = message;
    box.hidden = false;
  }

  async function start() {
    try {
      var me = await rpc("apur_me", {});
      var previous = null;
      try { previous = JSON.parse(localStorage.getItem("ht_user") || "null"); } catch (e) {}
      if (previous && previous.id && previous.id !== me.id) {
        // Outro usuário do HUB neste navegador: descarta o cache local do anterior.
        await new Promise(function (resolve) {
          var req = indexedDB.deleteDatabase("ht-controle-fiscal");
          req.onsuccess = req.onerror = req.onblocked = function () { resolve(); };
          setTimeout(resolve, 1500);
        });
        localStorage.removeItem("ht_competence");
      }
      localStorage.setItem("ht_token", "hub");
      localStorage.setItem("ht_user", JSON.stringify(me));
      localStorage.setItem("ht_data_epoch", META.data_epoch);
      document.body.classList.add("hub-embedded");
      // Se a tela pedir novo login (sessão vencida), mostra o aviso do HUB em vez da tela de senha antiga.
      var login = document.getElementById("loginView");
      if (login && window.MutationObserver) {
        new MutationObserver(function () {
          if (!login.classList.contains("hidden")) showBlocker("A sessão do HUB expirou. Entre novamente no HUB e reabra o Controle de Apuração.");
        }).observe(login, { attributes: true, attributeFilter: ["class"] });
      }
      var script = document.createElement("script");
      script.src = "app.js?v=" + APP_BUILD + "-hub3";
      document.body.appendChild(script);
    } catch (e) {
      showBlocker(e.message || "Não foi possível entrar com o usuário do HUB.");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
