/*
 * Carteira de Clientes — ponte entre a tela da V2 (app.js 2.1.0, mantida) e o banco do HUB (Supabase).
 *
 * A tela continua chamando os endereços "/api/..." do servidor da V2; aqui essas chamadas são atendidas pelas
 * funções cart_* do Supabase. Nada vai para o HTSERVER. Dois modos, mesma base:
 * - app individual (/apps/carteira/): login com e-mail e senha do HUB; o ADM inclui, edita, importa e exporta;
 * - consulta no HUB (?modo=consulta, menu do HUB): espelho somente leitura, sempre com os dados atuais.
 * - Perfis: administrador do HUB = ADM; demais usuários ativos consultam; o ADM pode mudar (Usuários).
 * - XLSX: exportação e leitura da importação feitas aqui no navegador (cart-xlsx.js, mesmas regras do servidor).
 * - Base da V2: o ADM importa um backup .sqlite3 da V2 (lido aqui com sql.js) para o banco do HUB.
 */
(function () {
  "use strict";

  var APP_VERSION = "2.1.0";
  var CFG_KEY = "hub_supabase_public";
  var realFetch = window.fetch.bind(window);

  var MODO = new URLSearchParams(location.search).get("modo") === "consulta" ? "consulta" : "app";
  var CONSULTA = MODO === "consulta";
  var SESSAO_KEY = "ht_carteira_sessao";
  document.documentElement.dataset.cartModo = MODO;
  document.documentElement.classList.add(CONSULTA ? "cart-consulta" : "cart-app");
  var MSG_CONSULTA = "No HUB a Carteira é só para consulta. Inclusões e alterações são feitas no app Carteira de Clientes.";

  function lerSessao() { try { return JSON.parse(localStorage.getItem(SESSAO_KEY) || "null"); } catch (e) { return null; } }
  function gravarSessao(s) { try { if (s) localStorage.setItem(SESSAO_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSAO_KEY); } catch (e) { /* sem armazenamento */ } }
  function marcarAba(sim) { try { if (sim) sessionStorage.setItem("HTCarteiraClientesV2:tab-authenticated", "1"); else sessionStorage.removeItem("HTCarteiraClientesV2:tab-authenticated"); } catch (e) { /* sem sessionStorage */ } }
  // Consulta no HUB: a sessão é a do HUB. App individual: entra direto se já houver sessão própria guardada.
  marcarAba(CONSULTA || !!(lerSessao() && lerSessao().refresh_token));

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
  async function carregarConfig() {
    readStoredConfig();
    if (auth.url && auth.anonKey) return;
    try {
      var r = await realFetch("/apps/hub-config.json", { cache: "no-store" });
      var cfg = r.ok ? await r.json() : null;
      if (cfg && cfg.url && cfg.anonKey) { auth.url = cfg.url; auth.anonKey = cfg.anonKey; }
    } catch (e) { /* sem configuração publicada */ }
  }
  async function authFetch(path, body, token) {
    await carregarConfig();
    if (!auth.url || !auth.anonKey) throw fail(503, "Configuração do HUB não encontrada.");
    var headers = { apikey: auth.anonKey, "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    var r;
    try { r = await realFetch(auth.url.replace(/\/+$/, "") + "/auth/v1/" + path, { method: "POST", headers: headers, body: JSON.stringify(body || {}) }); }
    catch (e) { throw fail(503, "Sem conexão com o HUB. Verifique a internet e tente de novo."); }
    var data = null; try { data = await r.json(); } catch (e) { data = null; }
    return { ok: r.ok, status: r.status, data: data };
  }
  function guardarLogin(data) {
    var s = { access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: data.expires_at ? data.expires_at * 1000 : jwtExp(data.access_token), email: (data.user && data.user.email) || "" };
    gravarSessao(s);
    auth.token = s.access_token; auth.exp = jwtExp(s.access_token) || s.expires_at;
  }
  var renovando = null;
  async function tokenProprio(force) {
    var s = lerSessao();
    if (!s || !s.refresh_token) return "";
    var exp = jwtExp(s.access_token);
    if (!force && s.access_token && exp - Date.now() > 90000) { auth.token = s.access_token; auth.exp = exp; return s.access_token; }
    if (!renovando) {
      renovando = authFetch("token?grant_type=refresh_token", { refresh_token: s.refresh_token }).then(function (r) {
        if (r.ok && r.data && r.data.access_token) { guardarLogin(r.data); return r.data.access_token; }
        if (r.status >= 400 && r.status < 500) gravarSessao(null);
        return "";
      }).finally(function () { renovando = null; });
    }
    return renovando;
  }
  var pedindo = null;
  async function getToken(force) {
    await carregarConfig();
    if (!CONSULTA) return tokenProprio(force);
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
    if (!auth.url || !auth.anonKey || !token) {
      throw fail(401, CONSULTA ? "Sessão do HUB não encontrada. Entre no HUB e abra a Carteira pelo menu." : "Sessão encerrada. Entre novamente com o e-mail e a senha do HUB.");
    }
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
        if (CONSULTA || e.status === 403) showBlocked(e.message);
        if (!CONSULTA && e.status === 401) gravarSessao(null);
        return json(401, { ok: false, error: e.message });
      }
    }
    if (method === "POST" && path === "/api/login") {
      if (CONSULTA) return json(401, { ok: false, error: "No HUB a Carteira usa o login do HUB. Entre no HUB e abra a Carteira pelo menu." });
      var lb = body ? JSON.parse(body) : {};
      var email = String(lb.username || "").trim().toLowerCase(), senha = String(lb.password || "");
      if (!email || !senha) return json(400, { ok: false, error: "Informe o e-mail e a senha do HUB." });
      var r = await authFetch("token?grant_type=password", { email: email, password: senha });
      if (!r.ok || !r.data || !r.data.access_token) {
        return json(401, { ok: false, error: r.status === 400 || r.status === 401 ? "E-mail ou senha inválidos." : "Não foi possível entrar agora. Tente de novo." });
      }
      guardarLogin(r.data);
      try {
        var sessao = await rpc("cart_sessao", {});
        papel = sessao.user.role;
        return json(200, sessao);
      } catch (e) {
        gravarSessao(null);
        return json(e.status === 403 ? 403 : 401, { ok: false, error: e.message });
      }
    }
    if (method === "POST" && path === "/api/logout") {
      var atual = lerSessao();
      gravarSessao(null); auth.token = ""; auth.exp = 0; papel = "";
      if (!CONSULTA && atual && atual.access_token) { try { await authFetch("logout?scope=local", {}, atual.access_token); } catch (e) { /* já saiu daqui */ } }
      return json(200, { ok: true });
    }
    if (method === "POST" && path === "/api/me/password") return json(400, { ok: false, error: "A senha é a do HUB. Altere-a no próprio HUB." });
    if (method === "POST" && path === "/api/admin/users") return json(400, { ok: false, error: "Os usuários vêm do HUB. Cadastre a pessoa no HUB (Configurações)." });
    // Consulta no HUB: nada é gravado por aqui (a tela já esconde os botões; isto é a trava da ponte).
    if (CONSULTA && (method !== "GET" || /\/export-xlsx$/.test(path))) return json(403, { ok: false, error: MSG_CONSULTA });

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
    if (CONSULTA) throw fail(403, MSG_CONSULTA);
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

  window.HubCarteira = { importarBaseV2: importarBaseV2, modo: MODO };
})();
