/*
 * Carteira de Clientes no HUB — ponte entre a tela da V2 (app.js 2.1.0, mantida) e o banco do HUB (Supabase).
 *
 * A tela continua chamando os endereços "/api/..." do servidor da V2; aqui essas chamadas são atendidas pelas
 * funções cart_* do Supabase, com o login do HUB. Nada vai para o HTSERVER.
 * - Login: sessão do HUB (administrador do HUB = ADM; demais usuários ativos consultam; o ADM pode mudar).
 * - XLSX: exportação e leitura da importação feitas aqui no navegador (cart-xlsx.js, mesmas regras do servidor).
 * - Base da V2: o ADM importa um backup .sqlite3 da V2 (lido aqui com sql.js) para o banco do HUB.
 */
(function () {
  "use strict";

  var APP_VERSION = "2.1.0";
  var CFG_KEY = "hub_supabase_public";
  var realFetch = window.fetch.bind(window);

  // A tela da V2 pede login a cada aba nova; no HUB a sessão já é a do HUB.
  try { sessionStorage.setItem("HTCarteiraClientesV2:tab-authenticated", "1"); } catch (e) { /* sem sessionStorage */ }

  // ------------------------------------------------------------------ sessão do HUB
  var hubWindow = null;
  try { hubWindow = window.top !== window ? window.parent : (window.opener && !window.opener.closed ? window.opener : null); } catch (e) { hubWindow = null; }
  var auth = { token: "", exp: 0, url: "", anonKey: "" };
  var waiting = [];
  var papel = "";

  function jwtExp(token) {
    try { return Number(JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp || 0) * 1000; } catch (e) { return 0; }
  }
  function readStoredConfig() {
    try {
      var cfg = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      if (cfg && cfg.url && cfg.anonKey) { auth.url = auth.url || cfg.url; auth.anonKey = auth.anonKey || cfg.anonKey; }
    } catch (e) { /* sem configuração */ }
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
    } catch (e) { /* sem sessão */ }
    return "";
  }
  window.addEventListener("message", function (event) {
    if (event.origin !== location.origin || !event.data || event.data.type !== "hub-auth-token" || !event.data.token) return;
    auth.token = event.data.token; auth.exp = jwtExp(event.data.token);
    if (event.data.supabaseUrl) auth.url = event.data.supabaseUrl;
    if (event.data.supabaseAnonKey) auth.anonKey = event.data.supabaseAnonKey;
    var list = waiting; waiting = []; list.forEach(function (fn) { fn(); });
  });
  function askHub(ms) {
    return new Promise(function (resolve) {
      if (!hubWindow) return resolve(false);
      var done = false;
      waiting.push(function () { if (!done) { done = true; resolve(true); } });
      try { hubWindow.postMessage({ type: "hub:auth-request" }, location.origin); } catch (e) { /* HUB indisponível */ }
      setTimeout(function () { if (!done) { done = true; resolve(false); } }, ms || 2500);
    });
  }
  var pedindo = null;
  async function getToken(force) {
    readStoredConfig();
    if (!force && auth.token && auth.exp - Date.now() > 90000) return auth.token;
    if (!pedindo) pedindo = askHub(2500).finally(function () { pedindo = null; });
    await pedindo;
    if (!auth.token || auth.exp - Date.now() < 30000) {
      var stored = readStoredSession();
      if (stored && jwtExp(stored) - Date.now() > 30000) { auth.token = stored; auth.exp = jwtExp(stored); }
    }
    return auth.token;
  }

  function fail(status, message, details) { var e = new Error(message); e.status = status; e.details = details || null; return e; }

  async function rpc(fn, args, retried) {
    var token = await getToken(false);
    if (!auth.url || !auth.anonKey || !token) throw fail(401, "Sessão do HUB não encontrada. Entre no HUB e abra a Carteira pelo menu.");
    var response;
    try {
      response = await realFetch(auth.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: { apikey: auth.anonKey, Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
        body: typeof args === "string" ? args : JSON.stringify(args || {})
      });
    } catch (e) {
      throw fail(503, "Sem conexão com o HUB. Verifique a internet e tente de novo.");
    }
    var text = await response.text(), data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (response.ok) return data;
    if ((response.status === 401 || (data && data.code === "PGRST301")) && !retried) { await getToken(true); return rpc(fn, args, true); }
    var code = (data && data.code) || "";
    if (code === "PGRST202") throw fail(503, "A Carteira de Clientes ainda não foi ativada no banco do HUB (falta rodar o SQL da Carteira no Supabase).");
    var m = /^HT(\d{3})$/.exec(code);
    var details = data && data.details;
    if (typeof details === "string" && details) { try { details = JSON.parse(details); } catch (e) { /* texto */ } }
    if (m) throw fail(Number(m[1]), data.message, details || null);
    if (response.status === 401) throw fail(401, "Sessão do HUB expirada. Recarregue a página.");
    throw fail(response.status >= 400 ? response.status : 500, (data && (data.message || data.error)) || "Erro " + response.status);
  }

  // ------------------------------------------------------------------ rotas "/api/..." da V2
  function json(status, payload, headers) {
    return new Response(JSON.stringify(payload), { status: status, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers || {}) });
  }
  function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"); }
  function periodFrom(path, suffix) { return decodeURIComponent(path.slice("/api/periods/".length, path.length - suffix.length)).replace(/^\/+|\/+$/g, ""); }

  function showBlocked(message) {
    var form = document.getElementById("loginForm");
    if (!form) return;
    Array.prototype.forEach.call(form.querySelectorAll(".field, button"), function (el) { el.classList.add("hidden"); });
    var p = form.querySelector("p"); if (p) p.textContent = "Carteira de Clientes no HUB";
    var err = document.getElementById("loginError");
    if (err) { err.textContent = message; err.classList.remove("hidden"); }
    setTimeout(function () { var e2 = document.getElementById("loginError"); if (e2) { e2.textContent = message; e2.classList.remove("hidden"); } }, 50);
  }

  async function route(method, url, body) {
    var path = url.pathname;
    if (method === "GET" && path === "/api/health") {
      return json(200, { ok: true, app: "H Teixeira Carteira de Clientes V2 (HUB)", version: APP_VERSION, server_time: nowIso(), journal_mode: "supabase", database: "HUB" });
    }
    if (method === "GET" && path === "/api/me") {
      try {
        var me = await rpc("cart_sessao", {});
        papel = me.user.role;
        document.documentElement.classList.add(papel === "admin" ? "cart-papel-admin" : "cart-papel-consulta");
        return json(200, me);
      } catch (e) {
        showBlocked(e.message);
        return json(401, { ok: false, error: e.message });
      }
    }
    if (method === "POST" && path === "/api/login") return json(401, { ok: false, error: "No HUB a Carteira usa o login do HUB. Entre no HUB e abra a Carteira pelo menu." });
    if (method === "POST" && path === "/api/logout") return json(200, { ok: true });
    if (method === "POST" && path === "/api/me/password") return json(400, { ok: false, error: "A senha é a do HUB. Altere-a no próprio HUB." });
    if (method === "POST" && path === "/api/admin/users") return json(400, { ok: false, error: "Os usuários vêm do HUB. Cadastre a pessoa no HUB (Configurações)." });

    if (method === "GET" && path === "/api/periods") return json(200, await rpc("cart_competencias", {}));
    if (method === "POST" && path === "/api/periods") {
      var b = body ? JSON.parse(body) : {};
      return json(201, await rpc("cart_competencia_criar", { p_period: String(b.period_key || ""), p_source: String(b.source_period_key || "") }));
    }
    if (method === "GET" && /^\/api\/periods\/.+\/records$/.test(path)) {
      return json(200, await rpc("cart_registros_listar", { p_period: periodFrom(path, "/records") }));
    }
    if (method === "GET" && /^\/api\/periods\/.+\/audit$/.test(path)) {
      var rid = url.searchParams.get("record_id");
      return json(200, await rpc("cart_auditoria_listar", { p_period: periodFrom(path, "/audit"), p_record_id: rid ? Number(rid) : null }));
    }
    if (method === "POST" && /^\/api\/periods\/.+\/save$/.test(path)) {
      // o lote vai como texto, na mesma ordem de campos que a tela montou (a auditoria segue essa ordem)
      var changes = body ? JSON.parse(body).changes : null;
      return json(200, await rpc("cart_salvar", '{"p_period":' + JSON.stringify(periodFrom(path, "/save")) + ',"p_changes":' + JSON.stringify(changes === undefined ? null : changes) + "}"));
    }
    if (method === "GET" && /^\/api\/periods\/.+\/export-xlsx$/.test(path)) {
      if (papel !== "admin") throw fail(403, "Operação exclusiva de ADM.");
      var key = periodFrom(path, "/export-xlsx");
      var data = await rpc("cart_registros_listar", { p_period: key });
      var bytes = await window.CartXlsx.buildPeriodXlsx(window.JSZip, data.records || [], key);
      return new Response(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
        status: 200, headers: { "Content-Disposition": 'attachment; filename="Carteira_Clientes_' + key + '.xlsx"' }
      });
    }
    if (method === "POST" && /^\/api\/periods\/.+\/import-xlsx$/.test(path)) {
      if (papel !== "admin") throw fail(403, "Operação exclusiva de ADM.");
      var ib = body ? JSON.parse(body) : {};
      var filename = String(ib.filename || "importacao.xlsx").replace(/^.*[\\/]/, "");
      if (!/\.xlsx$/i.test(filename)) throw fail(400, "Selecione um arquivo .xlsx.");
      var raw;
      try { raw = Uint8Array.from(atob(String(ib.data_base64 || "")), function (c) { return c.charCodeAt(0); }); } catch (e) { throw fail(400, "Conteúdo XLSX inválido."); }
      var records = await window.CartXlsx.parseXlsxRecords(window.JSZip, window.DOMParser, raw);
      return json(200, await rpc("cart_importar_xlsx", { p_period: periodFrom(path, "/import-xlsx"), p_records: records, p_filename: filename }));
    }
    if (method === "GET" && path === "/api/migration/status") return json(200, await rpc("cart_migracao_status", {}));
    if (method === "GET" && path === "/api/admin/users") return json(200, await rpc("cart_usuarios", {}));
    if (method === "PATCH" && /^\/api\/admin\/users\/.+/.test(path)) {
      var pb = body ? JSON.parse(body) : {};
      return json(200, await rpc("cart_usuario_salvar", { p_user: decodeURIComponent(path.slice("/api/admin/users/".length)), p_papel: String(pb.papel || "") }));
    }
    if (method === "GET" && path === "/api/stats") return json(200, { ok: true, stats: {} });
    return json(404, { ok: false, error: "Endpoint não encontrado." });
  }

  window.fetch = async function (input, init) {
    var url;
    try { url = new URL(typeof input === "string" ? input : input.url, location.href); } catch (e) { return realFetch(input, init); }
    if (url.origin !== location.origin || url.pathname.indexOf("/api/") !== 0) return realFetch(input, init);
    var method = String((init && init.method) || "GET").toUpperCase();
    try {
      return await route(method, url, init && init.body);
    } catch (e) {
      var status = e.status || 500;
      return json(status, { ok: false, error: e.message || "Falha ao falar com o HUB.", details: e.details || null });
    }
  };

  // ------------------------------------------------------------------ importação da base da V2 (backup .sqlite3)
  var sqlPromise = null;
  function loadSqlJs() {
    if (!sqlPromise) {
      sqlPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "vendor/sql-wasm.js";
        s.onload = function () { window.initSqlJs({ locateFile: function (f) { return "vendor/" + f; } }).then(resolve, reject); };
        s.onerror = function () { reject(new Error("Não foi possível carregar o leitor de SQLite.")); };
        document.head.appendChild(s);
      }).catch(function (e) { sqlPromise = null; throw e; });
    }
    return sqlPromise;
  }
  function rows(db, sql) {
    var out = [], st = db.prepare(sql);
    try { while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
    return out;
  }
  async function sha256Hex(bytes) {
    var digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  async function importarBaseV2(file, opcoes) {
    opcoes = opcoes || {};
    var progresso = opcoes.progresso || function () {};
    if (papel !== "admin") throw fail(403, "Operação exclusiva de ADM.");
    if (!file) throw fail(400, "Selecione o backup da Carteira V2 (.sqlite3).");
    if (file.size > 200 * 1024 * 1024) throw fail(400, "Arquivo grande demais para um backup da Carteira.");
    progresso("Lendo o arquivo…");
    var bytes = new Uint8Array(await file.arrayBuffer());
    var hash = await sha256Hex(bytes);
    var copia = bytes.slice();
    if (copia.length > 20 && copia[18] === 2 && copia[19] === 2) { copia[18] = 1; copia[19] = 1; } // base em WAL: abre como arquivo único
    var SQL = await loadSqlJs();
    var db;
    try { db = new SQL.Database(copia); } catch (e) { throw fail(400, "O arquivo não é um banco SQLite válido."); }
    var periodos, registros, auditoria, seq = {};
    try {
      var tabelas = rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map(function (r) { return r.name; });
      ["periods", "records", "audit_log"].forEach(function (t) {
        if (tabelas.indexOf(t) < 0) throw fail(400, "Este arquivo não é um backup da Carteira de Clientes V2 (falta a tabela " + t + ").");
      });
      var integ = rows(db, "PRAGMA integrity_check")[0];
      if (!integ || String(integ.integrity_check) !== "ok") throw fail(400, "O backup está corrompido (integrity_check).");
      periodos = rows(db, "SELECT id,period_key,year,month,status,source_period_key,created_at,created_by,updated_at FROM periods ORDER BY id");
      registros = rows(db, "SELECT * FROM records ORDER BY id");
      auditoria = rows(db, "SELECT * FROM audit_log ORDER BY id");
      if (tabelas.indexOf("sqlite_sequence") >= 0) rows(db, "SELECT name,seq FROM sqlite_sequence").forEach(function (r) { seq[r.name] = Number(r.seq) || 0; });
      var meta = {};
      if (tabelas.indexOf("app_meta") >= 0) rows(db, "SELECT key,value FROM app_meta").forEach(function (r) { if (/^(app_version|server_schema|migration_completed|migration_source_exported_at)$/.test(r.key)) meta[r.key] = r.value; });
      var origem = { meta: meta, usuarios: tabelas.indexOf("users") >= 0 ? rows(db, "SELECT COUNT(*) AS n FROM users")[0].n : 0 };
    } finally { db.close(); }
    if (!periodos.length) throw fail(400, "O backup não tem competências.");

    progresso("Preparando o banco do HUB…");
    await rpc("cart_migrar_iniciar", { p_substituir: !!opcoes.substituir });
    async function enviar(tipo, lista, tam, rotulo) {
      for (var i = 0; i < lista.length; i += tam) {
        progresso(rotulo + " " + Math.min(i + tam, lista.length) + " de " + lista.length + "…");
        await rpc("cart_migrar_lote", { p_tipo: tipo, p_itens: lista.slice(i, i + tam) });
      }
    }
    await enviar("periodos", periodos, 500, "Competências");
    await enviar("registros", registros, 400, "Empresas");
    await enviar("auditoria", auditoria, 800, "Auditoria");
    progresso("Conferindo…");
    var fim = await rpc("cart_migrar_concluir", { p_resumo: {
      arquivo: file.name, sha256: hash, origem: origem,
      counts: { periods: periodos.length, records: registros.length, audit: auditoria.length,
        seq_periods: seq.periods || 0, seq_records: seq.records || 0, seq_audit: seq.audit_log || 0 }
    } });
    return fim.counts;
  }

  window.HubCarteira = { importarBaseV2: importarBaseV2 };
})();
