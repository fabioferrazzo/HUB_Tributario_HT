/*
 * Checklist no HUB — acesso ao banco do HUB (Supabase) para a tela do Checklist.
 *
 * - Login: sessão do HUB (o HUB envia o token; na janela flutuante, quem envia é a janela do
 *   Checklist que a abriu; sem nenhuma das duas, usa a sessão salva no navegador).
 * - Dados: funções chk_* do banco (cada um vê os seus checklists e os compartilhados com ele).
 * - Anexos: bucket privado "hub-checklist", na pasta do checklist.
 */
(function () {
  "use strict";

  var CFG_KEY = "hub_supabase_public";
  var BUCKET = "hub-checklist";
  var MAX_BYTES = 15 * 1024 * 1024;

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
    if (event.origin !== location.origin || !event.data) return;
    if (event.data.type === "hub-auth-token") acceptToken(event.data);
    // A janela flutuante do Checklist pede a sessão a esta janela (que a abriu).
    if (event.data.type === "hub:auth-request" && event.source && event.source !== window) {
      var src = event.source;
      getToken(false).then(function (token) {
        if (!token) return;
        try {
          src.postMessage({ type: "hub-auth-token", token: token, supabaseUrl: auth.url, supabaseAnonKey: auth.anonKey }, location.origin);
        } catch (e) {}
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

  function erro(message, status, code) {
    var e = new Error(message);
    e.status = status;
    e.code = code || "";
    return e;
  }

  async function base() {
    var token = await getToken(false);
    if (!auth.url || !auth.anonKey) throw erro("Configuração do HUB não encontrada. Abra o Checklist pelo HUB.", 401, "SEM_HUB");
    if (!token) throw erro("Sessão do HUB não encontrada. Entre no HUB e abra o Checklist por ele.", 401, "SEM_SESSAO");
    return { url: auth.url.replace(/\/+$/, ""), token: token };
  }

  async function rpc(fn, args, retried) {
    var b = await base();
    var corpo = JSON.stringify(args || {});
    var response;
    try {
      response = await fetch(b.url + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: { apikey: auth.anonKey, Authorization: "Bearer " + b.token, "Content-Type": "application/json", Accept: "application/json" },
        body: corpo,
        // Pequenas gravações seguem mesmo se a tela for fechada logo depois.
        keepalive: corpo.length < 60000
      });
    } catch (e) {
      throw erro("Sem conexão com o HUB.", 0, "REDE");
    }
    var text = await response.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (response.ok) return data;
    if ((response.status === 401 || (data && data.code === "PGRST301")) && !retried) {
      await getToken(true);
      return rpc(fn, args, true);
    }
    var message = (data && (data.message || data.error)) || "Erro " + response.status;
    var code = (data && data.code) || "";
    if (code === "PGRST202") throw erro("O Checklist ainda não foi ativado no banco do HUB (falta rodar o SQL do Checklist no Supabase).", 404, "SEM_SQL");
    throw erro(message, response.status, code);
  }

  // ---------------------------------------------------------------------------------------------
  // Armazenamento dos anexos

  function caminhoUrl(caminho) {
    return caminho.split("/").map(encodeURIComponent).join("/");
  }

  function seguro(txt) {
    return String(txt || "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 120) || "x";
  }

  async function storageFetch(method, path, body, headers, retried) {
    var b = await base();
    var h = Object.assign({ apikey: auth.anonKey, Authorization: "Bearer " + b.token }, headers || {});
    var response = await fetch(b.url + "/storage/v1/" + path, { method: method, headers: h, body: body });
    if ((response.status === 401 || response.status === 400) && !retried) {
      var clone = response.clone();
      var t = "";
      try { t = await clone.text(); } catch (e) {}
      if (/jwt|token|expired/i.test(t)) {
        await getToken(true);
        return storageFetch(method, path, body, headers, true);
      }
    }
    return response;
  }

  async function lerErro(response, padrao) {
    var t = "";
    try { t = await response.text(); } catch (e) {}
    try { var d = JSON.parse(t); return d.message || d.error || padrao; } catch (e) { return t || padrao; }
  }

  async function enviarArquivo(caminho, blob, tipo) {
    var r = await storageFetch("POST", "object/" + BUCKET + "/" + caminhoUrl(caminho), blob, {
      "Content-Type": tipo || blob.type || "application/octet-stream",
      "x-upsert": "false"
    });
    if (!r.ok) throw erro("Não foi possível enviar o arquivo: " + (await lerErro(r, "erro " + r.status)), r.status);
  }

  var cacheBlobs = new Map();
  async function baixar(caminho) {
    if (cacheBlobs.has(caminho)) return cacheBlobs.get(caminho);
    var r = await storageFetch("GET", "object/authenticated/" + BUCKET + "/" + caminhoUrl(caminho));
    if (!r.ok) throw erro("Não foi possível baixar o anexo: " + (await lerErro(r, "erro " + r.status)), r.status);
    var blob = await r.blob();
    cacheBlobs.set(caminho, blob);
    return blob;
  }

  async function apagarArquivos(caminhos) {
    var lista = (caminhos || []).filter(Boolean);
    if (!lista.length) return;
    lista.forEach(function (c) { cacheBlobs.delete(c); });
    try {
      var r = await storageFetch("DELETE", "object/" + BUCKET, JSON.stringify({ prefixes: lista }), { "Content-Type": "application/json" });
      if (!r.ok) console.warn("Checklist: arquivos não apagados do armazenamento", await lerErro(r, r.status));
    } catch (e) {
      console.warn("Checklist: falha ao apagar arquivos do armazenamento", e);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // API usada pela tela

  window.HubChecklist = {
    MAX_BYTES: MAX_BYTES,
    ehConflito: function (e) { return !!e && e.code === "CONFLITO"; },
    carregar: function () { return rpc("chk_dados", {}); },
    versoes: function () { return rpc("chk_versoes", {}); },
    salvarLista: async function (payload) {
      var r = await rpc("chk_lista_salvar", { p: payload });
      if (r && r.conflito) throw erro("O checklist foi alterado por outra pessoa.", 409, "CONFLITO");
      return r;
    },
    excluirLista: async function (id, caminhosConhecidos) {
      // Primeiro os arquivos (enquanto o checklist ainda existe e libera o acesso), depois o registro.
      await apagarArquivos(caminhosConhecidos);
      var r = await rpc("chk_lista_excluir", { p_id: id });
      var resto = ((r && r.caminhos) || []).filter(function (c) { return (caminhosConhecidos || []).indexOf(c) < 0; });
      await apagarArquivos(resto);
      return r;
    },
    compartilhar: function (id, todos, usuarios) {
      return rpc("chk_compartilhar", { p_id: id, p_todos: !!todos, p_usuarios: usuarios || [] });
    },
    sair: function (id) { return rpc("chk_sair", { p_id: id }); },
    enviarAnexo: async function (att) {
      var blob = att.blob;
      if (!blob) throw erro("Arquivo vazio.", 400);
      if (blob.size > MAX_BYTES) throw erro("O arquivo passa de 15 MB.", 400);
      var caminho = att.listId + "/" + seguro(att.id) + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
      await enviarArquivo(caminho, blob, att.type);
      var r;
      try {
        r = await rpc("chk_anexo_registrar", { p: {
          id: att.id, lista_id: att.listId, item_id: att.itemId, tipo_anexo: att.kind === "floatingPrint" ? "print" : "arquivo",
          slot: att.slot || null, nome: att.name, tipo: att.type || blob.type || "", tamanho: blob.size, caminho: caminho
        } });
      } catch (e) {
        await apagarArquivos([caminho]);
        throw e;
      }
      if (r && r.caminho_antigo) await apagarArquivos([r.caminho_antigo]);
      cacheBlobs.set(caminho, blob);
      return { caminho: caminho };
    },
    baixar: baixar,
    excluirAnexos: async function (listId, ids, itemId) {
      var r = await rpc("chk_anexos_excluir", { p_lista: listId, p_ids: ids && ids.length ? ids : null, p_item: itemId || null });
      await apagarArquivos((r && r.caminhos) || []);
      return r;
    },
    apagarArquivos: apagarArquivos
  };
})();
