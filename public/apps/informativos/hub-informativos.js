/*
 * Informativos no HUB — ponte entre a tela do Infos HT (Release 21.14) e o banco do HUB (Supabase).
 *
 * A tela continua chamando os endereços "/api/..." do programa original; aqui essas chamadas são
 * atendidas pelas funções inf_* do banco e pelo armazenamento "hub-informativos", com o login do HUB.
 *
 * Papéis: administrador do HUB = administrador do app; gestor = usuário editor; demais = leitura
 * (veem e baixam só os publicados).
 */
(function () {
  "use strict";

  var RELEASE = "21.14";
  var BUCKET = "hub-informativos";
  var CFG_KEY = "hub_supabase_public";
  // Recursos liberados por etapa da recriação.
  var RECURSOS = { editar: true, template: true, importar: true, exportarDocx: true, exportarHtml: true,
                   // A base do Infos HT já foi trazida (12/11/2026). Importar de novo sobrescreveria o que foi editado
                   // no HUB nos informativos migrados, por isso o botão fica desligado.
                   migracao: false };
  var MAX_UPLOAD = 25 * 1024 * 1024;
  var realFetch = window.fetch.bind(window);

  // -------------------------------------------------------------------------------------------
  // Sessão do HUB (mesmo esquema do Controle de Férias e do Checklist)

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
    // Janelas abertas a partir desta (PDF, PPTX) pedem a sessão para esta janela.
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
      try { hubWindow.postMessage({ type: "hub:auth-request" }, location.origin); } catch (e) {}
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
    if (!auth.url || !auth.anonKey) throw erro("Configuração do HUB não encontrada. Abra os Informativos pelo HUB.", 401);
    if (!token) throw erro("Sessão do HUB não encontrada. Entre no HUB e abra os Informativos por ele.", 401);
    return { url: auth.url.replace(/\/+$/, ""), token: token };
  }
  async function rpc(fn, args, retried) {
    var b = await base();
    var response;
    try {
      response = await realFetch(b.url + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: { apikey: auth.anonKey, Authorization: "Bearer " + b.token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(args || {})
      });
    } catch (e) {
      throw erro("Sem conexão com o HUB.", 0);
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
    if (code === "PGRST202") throw erro("Os Informativos ainda não foram ativados no banco do HUB (falta rodar o SQL dos Informativos no Supabase).", 503, code);
    var status = code === "42501" ? 403 : code === "P0002" ? 404 : code === "P0001" ? 409 : response.status;
    throw erro(message, status, code);
  }

  // -------------------------------------------------------------------------------------------
  // Armazenamento

  function caminhoUrl(caminho) { return caminho.split("/").map(encodeURIComponent).join("/"); }
  async function storage(method, path, body, headers, retried) {
    var b = await base();
    var h = Object.assign({ apikey: auth.anonKey, Authorization: "Bearer " + b.token }, headers || {});
    var r = await realFetch(b.url + "/storage/v1/" + path, { method: method, headers: h, body: body });
    if (!r.ok && !retried && (r.status === 401 || r.status === 400)) {
      var t = "";
      try { t = await r.clone().text(); } catch (e) {}
      if (/jwt|token|expired/i.test(t)) { await getToken(true); return storage(method, path, body, headers, true); }
    }
    return r;
  }
  async function lerErro(r, padrao) {
    var t = "";
    try { t = await r.text(); } catch (e) {}
    try { var d = JSON.parse(t); return d.message || d.error || padrao; } catch (e) { return t || padrao; }
  }
  var cacheBlobs = new Map();
  async function baixarArquivo(caminho) {
    if (cacheBlobs.has(caminho)) return cacheBlobs.get(caminho);
    var r = await storage("GET", "object/authenticated/" + BUCKET + "/" + caminhoUrl(caminho));
    if (!r.ok) throw erro("Arquivo não disponível: " + (await lerErro(r, "erro " + r.status)), r.status === 400 ? 404 : r.status);
    var blob = await r.blob();
    cacheBlobs.set(caminho, blob);
    return blob;
  }
  async function enviarArquivo(caminho, blob, tipo) {
    var r = await storage("POST", "object/" + BUCKET + "/" + caminhoUrl(caminho), blob, {
      "Content-Type": tipo || blob.type || "application/octet-stream", "x-upsert": "true"
    });
    if (!r.ok) throw erro("Não foi possível enviar o arquivo " + caminho + ": " + (await lerErro(r, "erro " + r.status)), r.status);
    cacheBlobs.set(caminho, blob);
  }
  async function apagarArquivos(caminhos) {
    var lista = (caminhos || []).filter(Boolean);
    if (!lista.length) return;
    lista.forEach(function (c) { cacheBlobs.delete(c); });
    try {
      var r = await storage("DELETE", "object/" + BUCKET, JSON.stringify({ prefixes: lista }), { "Content-Type": "application/json" });
      if (!r.ok) console.warn("Informativos: arquivos não apagados", await lerErro(r, r.status));
    } catch (e) {
      console.warn("Informativos: falha ao apagar arquivos", e);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Papel e permissões

  var sessaoPromise = null;
  function sessao() {
    if (!sessaoPromise) {
      sessaoPromise = rpc("inf_sessao", {}).then(function (s) {
        var papel = (s && s.papel) || "leitor";
        document.documentElement.classList.add("inf-papel-" + papel);
        return { papel: papel, nome: (s && s.nome) || "", email: (s && s.email) || "" };
      }).catch(function (e) { sessaoPromise = null; throw e; });
    }
    return sessaoPromise;
  }
  function capacidades(papel) {
    var comum = papel === "admin" || papel === "editor";
    var adm = papel === "admin";
    return {
      can_import: comum && RECURSOS.importar,
      can_create_template: comum && RECURSOS.template,
      can_edit: comum && RECURSOS.editar,
      can_publish: comum,
      can_move_documents: comum,
      can_export: true,
      can_archive: comum,
      can_replace_source: comum && RECURSOS.importar,
      can_restore_version: comum,
      can_manage_users: false,
      can_manage_folders: adm,
      can_backup_restore: false,
      can_view_audit: false,
      can_permanently_delete: adm
    };
  }

  // -------------------------------------------------------------------------------------------
  // Respostas

  function json(data, status) {
    return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
  function arquivo(blob, nome, tipo) {
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": tipo || blob.type || "application/octet-stream",
        "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(nome || "arquivo")
      }
    });
  }
  function respostaErro(e) {
    var status = Number(e && e.status) || 500;
    if (status < 400) status = 503;
    return json({ error: (e && e.message) || "Erro" }, status);
  }
  function emBreve(o) { return json({ error: o + " chega numa próxima etapa da recriação dos Informativos no HUB." }, 501); }

  var assetsPorDoc = new Map();
  function semInternos(snap) {
    var out = Object.assign({}, snap);
    if (out._assets) assetsPorDoc.set(String(out.document_id), out._assets);
    delete out._assets;
    delete out._doc;
    return out;
  }
  async function assetsDoDocumento(id) {
    if (assetsPorDoc.has(id)) return assetsPorDoc.get(id);
    var s = await sessao();
    var snap;
    try {
      snap = await rpc("inf_documento_obter", { p_id: id, p_qual: "published" });
    } catch (e) {
      if (s.papel === "leitor") throw e;
      snap = await rpc("inf_documento_obter", { p_id: id, p_qual: "draft" });
    }
    semInternos(snap);
    return assetsPorDoc.get(id) || {};
  }

  async function lerCorpo(init) {
    var b = init && init.body;
    if (!b) return {};
    if (typeof b === "string") { try { return JSON.parse(b); } catch (e) { return {}; } }
    return b;
  }

  // -------------------------------------------------------------------------------------------
  // Rotas "/api/..."

  async function rota(method, url, init) {
    var path = url.pathname.replace(/\/+$/, "");
    var q = url.searchParams;
    var partes = path.split("/").filter(Boolean).map(decodeURIComponent); // ["api", ...]
    var s;

    if (method === "GET" && path === "/api/app/info") {
      return json({ app: "H. Teixeira Informativos (HUB)", release: RELEASE, template_create: RECURSOS.template, bulk_html_export: RECURSOS.exportarHtml,
                    import_formats: RECURSOS.importar ? ["docx", "pdf", "html"] : [], accounts: false, roles: ["admin", "user"] });
    }
    if (path === "/api/auth/status") {
      s = await sessao();
      var editor = s.papel === "admin" || s.papel === "editor";
      return json({ authenticated: editor, admin_configured: true, name: s.nome, email: s.email, role: editor ? (s.papel === "admin" ? "admin" : "user") : null,
                    csrf: editor ? "hub" : null, capabilities: editor ? capacidades(s.papel) : { can_export: true }, session_minutes: 720, app_release: RELEASE });
    }
    if (path === "/api/auth/logout") return json({ ok: true });
    if (path === "/api/auth/login") return json({ error: "Use o login do HUB. Somente administradores e gestores do HUB editam os informativos." }, 403);

    if (method === "GET" && path === "/api/folders") return json({ folders: await rpc("inf_pastas_listar", {}) });
    if (method === "GET" && path === "/api/documents") {
      var incluir = q.get("include_archived") === "1";
      return json({ documents: await rpc("inf_documentos_listar", { p_incluir_arquivados: incluir }), include_archived: incluir });
    }
    if (path === "/api/export/html.zip") return RECURSOS.exportarHtml ? exportarTodosHtml() : emBreve("A exportação em HTML (ZIP)");
    if (path.indexOf("/api/admin/") === 0) return json({ error: "Usuários, backup e restauração são feitos pelo HUB (Configurações)." }, 403);
    if (path === "/api/import" || path === "/api/import/file" || path === "/api/import/docx") {
      if (method !== "POST") return json({ error: "Rota não encontrada" }, 404);
      if (!RECURSOS.importar) return emBreve("A importação de DOCX, PDF e HTML");
      return importarArquivo(init, q, path === "/api/import/docx");
    }
    var corpo = method === "POST" ? await lerCorpo(init) : {};

    if (method === "POST" && path === "/api/templates/default/create") {
      if (!RECURSOS.template) return emBreve("A criação pelo Template");
      var lista = await rpc("inf_documentos_listar", { p_incluir_arquivados: true });
      var snap = window.InfNucleo.templateSnapshot(corpo || {}, lista);
      var novoId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2, 10));
      var meta = snap.metadata;
      var criado = await rpc("inf_documento_criar", { p: {
        id: novoId, title: meta.title || "Novo informativo", document_number: meta.document_number || "", date: meta.date || "",
        department: meta.department || "Departamento Tributário", source_type: "template",
        folder_id: corpo.folder_id ? Number(corpo.folder_id) : null, snapshot: snap, publicado: { metadata: meta, elements: {} }
      } });
      return json({ ok: true, template_profile: window.InfNucleo.DEFAULT_TEMPLATE_PROFILE, document: criado.document,
                    open_url: "informativo.html?document=" + encodeURIComponent(novoId) + "&draft=1&edit=1" }, 201);
    }

    // Pastas
    if (method === "POST" && path === "/api/folders") return json({ ok: true, folder: await rpc("inf_pasta_salvar", { p_id: null, p_nome: corpo.name || "" }) }, 201);
    if (partes[1] === "folders" && partes.length === 4 && method === "POST") {
      var fid = Number(partes[2]);
      if (partes[3] === "rename") return json({ ok: true, folder: await rpc("inf_pasta_salvar", { p_id: fid, p_nome: corpo.name || "" }) });
      if (partes[3] === "delete") return json(Object.assign({ ok: true }, await rpc("inf_pasta_excluir", { p_id: fid })));
    }

    // Documentos
    if (partes[1] === "documents" && partes.length >= 3) {
      var id = partes[2];
      var acao = partes[3] || "";
      if (method === "GET") {
        if (acao === "published" || acao === "draft") return json(semInternos(await rpc("inf_documento_obter", { p_id: id, p_qual: acao })));
        if (acao === "versions") return json({ document_id: id, versions: await rpc("inf_versoes_listar", { p_id: id }) });
        if (acao === "sources") return json({ document_id: id, sources: (await rpc("inf_fontes_listar", { p_id: id })).sources });
        if (acao === "original") {
          var f = await rpc("inf_fontes_listar", { p_id: id });
          if (!f.original || !f.original.caminho) return json({ error: "Arquivo original não disponível" }, 404);
          return arquivo(await baixarArquivo(f.original.caminho), f.original.filename || "informativo");
        }
        if (acao === "assets" && partes[4]) {
          var mapa = await assetsDoDocumento(id);
          var a = mapa[partes[4]];
          if (!a) return json({ error: "Imagem não encontrada" }, 404);
          return arquivo(await baixarArquivo(a.caminho), a.source_name || partes[4], a.mime_type);
        }
        var tipoExp = tipoExportacao(partes);
        if (tipoExp === "docx") return RECURSOS.exportarDocx ? exportarDocumento(id, "docx") : emBreve("A exportação DOCX");
        if (tipoExp === "html") return RECURSOS.exportarHtml ? exportarDocumento(id, "html") : emBreve("A exportação HTML");
      }
      if (method === "POST") {
        if (acao === "metadata") return json(await rpc("inf_metadados", { p_id: id, p: corpo || {} }));
        if (acao === "archive" || acao === "unarchive") return json(await rpc("inf_arquivar", { p_id: id, p_arquivar: acao === "archive" }));
        if (acao === "folder") {
          var pasta = corpo.folder_id === null || corpo.folder_id === "" || corpo.folder_id === undefined ? null : Number(corpo.folder_id);
          return json(await rpc("inf_mover", { p_id: id, p_pasta: pasta }));
        }
        if (acao === "delete" || acao === "discard") {
          var r = await rpc(acao === "delete" ? "inf_excluir" : "inf_descartar", { p_id: id });
          await apagarArquivos(r.caminhos);
          assetsPorDoc.delete(id);
          delete r.caminhos;
          return json(r);
        }
        if (acao === "publish") { assetsPorDoc.delete(id); return json(await rpc("inf_publicar", { p_id: id, p_nota: corpo.note || "" })); }
        if (acao === "restore") return json(await rpc("inf_restaurar", { p_id: id, p_versao: Number(corpo.version_id) }));
        if (acao === "draft") {
          if (!RECURSOS.editar) return emBreve("A edição");
          var limpo;
          try { limpo = window.InfNucleo.sanitizeSnapshot(corpo); } catch (e) { return json({ error: e.message }, 400); }
          return json(await rpc("inf_rascunho_salvar", { p_id: id, p_snapshot: limpo }));
        }
        if (acao === "replace-docx") return RECURSOS.importar ? substituirDocx(id, init) : emBreve("A substituição do DOCX");
      }
    }
    return json({ error: "Rota não encontrada" }, 404);
  }

  // -------------------------------------------------------------------------------------------
  // Importação de DOCX, PDF e HTML (lida no navegador por inf-importar.js) e substituição do DOCX

  function cabecalho(init, nome) {
    var h = init && init.headers;
    if (!h) return "";
    if (typeof h.get === "function") return h.get(nome) || "";
    var alvo = nome.toLowerCase();
    for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === alvo) return String(h[k] == null ? "" : h[k]);
    return "";
  }
  async function lerUpload(init) {
    var body = init && init.body;
    if (!body || typeof body.arrayBuffer !== "function") throw erro("Envie o arquivo pelo formulário de importação do aplicativo.", 400);
    if (body.size > MAX_UPLOAD) throw erro("O upload deve ter no máximo 25 MB.", 400);
    var nome = cabecalho(init, "X-HTI-Filename");
    if (nome) {
      try { nome = decodeURIComponent(nome); } catch (e) { throw erro("Nome do arquivo enviado é inválido.", 400); }
    } else nome = body.name || "informativo";
    var bytes = new Uint8Array(await body.arrayBuffer());
    if (!bytes.length) throw erro("Arquivo vazio.", 400);
    return { nome: nome, bytes: bytes, declarado: cabecalho(init, "X-HTI-Source-Type").trim().toLowerCase() };
  }
  async function hashArquivo(bytes) {
    try {
      var d = await crypto.subtle.digest("SHA-256", bytes);
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    } catch (e) {
      return window.InfImportar.sha256(bytes);
    }
  }
  var pdfjsPromise = null;
  function carregarPdfjs() {
    if (!pdfjsPromise) {
      var base = new URL("vendor/pdfjs/", location.href).href;
      pdfjsPromise = import(base + "pdf.min.js").then(function (m) {
        m.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
        return m;
      }).catch(function (e) {
        pdfjsPromise = null;
        console.warn("Informativos: pdf.js", e);
        throw erro("Não foi possível carregar o leitor de PDF. Recarregue a página e tente de novo.", 503);
      });
    }
    return pdfjsPromise;
  }
  async function lerConteudo(tipo, bytes, nome) {
    var I = window.InfImportar;
    if (!I) throw erro("O leitor de arquivos dos Informativos não carregou. Recarregue a página.", 503);
    try {
      if (tipo === "docx") return await I.parseDocx(bytes, nome, window.JSZip);
      if (tipo === "html") return I.parseHtml(bytes, nome);
      var pdfjs = await carregarPdfjs();
      return await I.parsePdf(bytes, nome, pdfjs);
    } catch (e) {
      if (e && e.status) throw e;
      console.warn("Informativos: leitura do arquivo", e);
      throw erro((e && e.message) || "Não foi possível ler o arquivo.", 400);
    }
  }
  function abrirUrl(id, rascunho) { return "informativo.html?document=" + encodeURIComponent(id) + (rascunho ? "&draft=1" : ""); }
  function novoId() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2, 10);
  }
  async function enviarAssets(docId, assets, permitirMais, enviados) {
    var I = window.InfImportar, out = [];
    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      var c = docId + "/assets/" + a.id + I.extensaoAsset(a, permitirMais);
      var tipo = String(a.mime_type || "application/octet-stream").slice(0, 100);
      await enviarArquivo(c, new Blob([a.bytes], { type: tipo }), tipo);
      enviados.push(c);
      out.push({ id: a.id, source_name: String(a.source_name || "").slice(0, 180), mime_type: tipo, caminho: c, sha256: String(a.sha256 || "").slice(0, 64), tamanho: a.bytes.length });
    }
    return out;
  }

  async function importarArquivo(init, q, soDocx) {
    var s = await sessao();
    if (s.papel !== "admin" && s.papel !== "editor") return json({ error: "Somente administradores e gestores do HUB importam informativos." }, 403);
    var I = window.InfImportar, N = window.InfNucleo;
    var up = await lerUpload(init);
    var info;
    try { info = I.nomeSeguro(up.nome); } catch (e) { return json({ error: e.message }, 400); }
    if (soDocx && info.tipo !== "docx") return json({ error: "Somente arquivos com extensão .docx são aceitos." }, 400);
    if (up.declarado && up.declarado !== info.tipo && !(info.tipo === "html" && up.declarado === "htm"))
      return json({ error: "Tipo declarado não corresponde à extensão do arquivo." }, 400);
    var sha = await hashArquivo(up.bytes);
    var existente = await rpc("inf_documento_por_hash", { p_sha: sha });
    if (existente) {
      return json({ error: "Este arquivo já foi importado.", existing_document_id: existente.id, document: existente,
                    open_url: abrirUrl(existente.id, existente.status === "draft" || existente.status === "archived") }, 409);
    }
    var parsed = await lerConteudo(info.tipo, up.bytes, info.nome);
    I.aplicarPerfil(parsed, N.DEFAULT_TEMPLATE_PROFILE);
    var snap = N.sanitizeSnapshot({ metadata: parsed.metadata, elements: parsed.elements, model: parsed.model });
    var lista = await rpc("inf_documentos_listar", { p_incluir_arquivados: true });
    snap.metadata.document_number = N.nextDocumentNumber(lista, snap.metadata.date || "", snap.metadata.document_number || "");
    var id = novoId();
    var ext = I.sufixo(info.nome).toLowerCase();
    var tipoArq = tipoPorNome(info.nome);
    var orig = id + "/original" + ext, fonte = id + "/sources/rev-001" + ext;
    var enviados = [], criado;
    try {
      await enviarArquivo(orig, new Blob([up.bytes], { type: tipoArq }), tipoArq); enviados.push(orig);
      await enviarArquivo(fonte, new Blob([up.bytes], { type: tipoArq }), tipoArq); enviados.push(fonte);
      var assets = await enviarAssets(id, parsed.assets || [], info.tipo !== "docx", enviados);
      var meta = snap.metadata;
      var pasta = q.get("folder_id");
      criado = await rpc("inf_documento_criar", { p: {
        id: id, title: meta.title || I.stem(info.nome), document_number: meta.document_number || "", date: meta.date || "",
        department: meta.department || "Departamento Tributário", source_type: info.tipo, original_filename: info.nome, original_sha256: sha,
        original_caminho: orig, folder_id: pasta && /^\d+$/.test(pasta) ? Number(pasta) : null, snapshot: snap,
        publicado: { metadata: meta, elements: {} }, assets: assets,
        fonte: { original_filename: info.nome, sha256: sha, caminho: fonte, stats: parsed.stats || {}, warnings: parsed.warnings || [] }
      } });
    } catch (e) {
      await apagarArquivos(enviados);
      throw e;
    }
    return json({ duplicate: false, document: criado.document, stats: parsed.stats || {}, warnings: parsed.warnings || [], review: parsed.review || {},
                  open_url: abrirUrl(id, true) }, 201);
  }

  async function substituirDocx(id, init) {
    var s = await sessao();
    if (s.papel !== "admin" && s.papel !== "editor") return json({ error: "Somente administradores e gestores do HUB substituem a fonte DOCX." }, 403);
    var I = window.InfImportar, N = window.InfNucleo;
    var up = await lerUpload(init);
    var nome = up.nome.split(/[\\/]/).pop().slice(0, 180);
    if (!/\.docx$/i.test(nome)) return json({ error: "Somente arquivos com extensão .docx são aceitos." }, 400);
    if (up.declarado && up.declarado !== "docx") return json({ error: "Tipo declarado não corresponde a um arquivo DOCX." }, 400);
    var sha = await hashArquivo(up.bytes);
    var prep = await rpc("inf_fonte_preparar", { p_id: id, p_sha: sha });
    var rev = Number(prep.revisao);
    var parsed = await lerConteudo("docx", up.bytes, nome);
    I.prefixarAssets(parsed, "r" + rev);
    I.aplicarPerfil(parsed, N.DEFAULT_TEMPLATE_PROFILE);
    var snap = N.sanitizeSnapshot({ metadata: parsed.metadata, elements: parsed.elements, model: parsed.model });
    var meta = snap.metadata;
    var tipoArq = tipoPorNome(nome);
    var fonte = id + "/sources/rev-" + String(rev).padStart(3, "0") + ".docx";
    var enviados = [], r;
    try {
      await enviarArquivo(fonte, new Blob([up.bytes], { type: tipoArq }), tipoArq); enviados.push(fonte);
      var assets = await enviarAssets(id, parsed.assets || [], false, enviados);
      r = await rpc("inf_fonte_substituir", { p_id: id, p: {
        revisao: rev, original_filename: nome, sha256: sha, caminho: fonte, title: meta.title || I.stem(nome),
        document_number: meta.document_number || "", date: meta.date || "", department: meta.department || "Departamento Tributário",
        snapshot: snap, assets: assets, stats: parsed.stats || {}, warnings: parsed.warnings || []
      } });
    } catch (e) {
      await apagarArquivos(enviados);
      throw e;
    }
    await apagarArquivos(r.apagar || []);
    assetsPorDoc.delete(id);
    return json({ document_id: id, source_revision: rev, stats: parsed.stats || {}, warnings: parsed.warnings || [], review: parsed.review || {},
                  open_url: abrirUrl(id, true) });
  }

  // -------------------------------------------------------------------------------------------
  // Exportação da versão publicada (inf-exportar.js): HTML autônomo, DOCX e ZIP com todos em HTML

  var ALIASES_EXPORT = { "export.docx": "docx", "export-docx": "docx", "export_docx": "docx", "export.html": "html", "export-html": "html", "export_html": "html" };
  function tipoExportacao(partes) {
    if (partes.length === 4) return ALIASES_EXPORT[String(partes[3]).toLowerCase()] || null;
    if (partes.length === 5 && String(partes[3]).toLowerCase() === "export") {
      var k = String(partes[4]).toLowerCase();
      return k === "docx" || k === "html" ? k : null;
    }
    return null;
  }
  var logoPromise = null;
  function logoInstitucional() {
    if (!logoPromise) {
      logoPromise = realFetch(new URL("logo-ht-azul-escuro.png", location.href).href).then(function (r) {
        if (!r.ok) throw new Error("logo " + r.status);
        return r.arrayBuffer();
      }).then(function (b) {
        return "data:image/png;base64," + window.InfExportar.base64(new Uint8Array(b));
      }).catch(function (e) {
        console.warn("Informativos: logo institucional não carregado", e);
        logoPromise = null;
        return "";
      });
    }
    return logoPromise;
  }
  // Baixa as imagens do informativo; as que faltarem no armazenamento ficam de fora (como no programa original).
  async function imagensDoSnapshot(mapa) {
    var out = {}, faltando = [];
    var ids = Object.keys(mapa || {});
    for (var i = 0; i < ids.length; i += 6) {
      await Promise.all(ids.slice(i, i + 6).map(async function (id) {
        var a = mapa[id];
        try {
          var blob = await baixarArquivo(a.caminho);
          out[id] = { data: new Uint8Array(await blob.arrayBuffer()), source_name: a.source_name || "", mime_type: a.mime_type || "" };
        } catch (e) {
          faltando.push(a.source_name || id);
        }
      }));
    }
    return { assets: out, faltando: faltando };
  }
  function exportadorPronto() {
    if (!window.InfExportar || !window.InfImportar || !window.JSZip) throw erro("O exportador dos Informativos não carregou. Recarregue a página.", 503);
    return window.InfExportar;
  }
  async function exportarDocumento(id, tipo) {
    var E = exportadorPronto();
    var snap = await rpc("inf_documento_obter", { p_id: id, p_qual: "published" });
    if (!snap || !snap.published_at) return json({ error: "Este informativo ainda não possui versão publicada" }, 409);
    var doc = snap._doc || {};
    var imgs = await imagensDoSnapshot(snap._assets);
    var titulo = (snap.metadata && snap.metadata.title) || doc.title || "Informativo";
    try {
      if (tipo === "docx") {
        var bytes = await E.buildDocx(snap, imgs.assets, window.JSZip);
        var tipoDocx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        return arquivo(new Blob([bytes], { type: tipoDocx }), E.safeExportFilename(titulo), tipoDocx);
      }
      var html = E.buildHtml(snap, imgs.assets, await logoInstitucional());
      return arquivo(new Blob([html], { type: "text/html;charset=utf-8" }), E.safeExportFilename(titulo, ".html"), "text/html; charset=utf-8");
    } catch (e) {
      console.warn("Informativos: exportação", e);
      return json({ error: "Falha ao exportar " + tipo.toUpperCase() + ": " + ((e && e.message) || e) }, 500);
    }
  }
  function chaveNocase(t) { return String(t || "").replace(/[A-Z]/g, function (c) { return c.toLowerCase(); }); }
  function carimbo() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + "-" + p(d.getMinutes()) + "-" + p(d.getSeconds());
  }
  async function exportarTodosHtml() {
    var E = exportadorPronto();
    var lista = (await rpc("inf_publicados_conteudo", {})) || [];
    if (!lista.length) return json({ error: "Nenhum informativo publicado disponível para exportar." }, 409);
    lista.sort(function (a, b) {
      var ta = chaveNocase((a._doc || {}).title), tb = chaveNocase((b._doc || {}).title);
      if (ta !== tb) return ta < tb ? -1 : 1;
      return String(a.document_id) < String(b.document_id) ? -1 : String(a.document_id) > String(b.document_id) ? 1 : 0;
    });
    var docs = [];
    for (var i = 0; i < lista.length; i++) {
      var s = lista[i], d = s._doc || {};
      var imgs = await imagensDoSnapshot(s._assets);
      docs.push({ id: s.document_id, title: d.title, published_at: d.published_at, snapshot: s, assets: imgs.assets, faltando: imgs.faltando });
    }
    try {
      var bytes = await E.buildHtmlZip(docs, await logoInstitucional(), window.JSZip);
      return arquivo(new Blob([bytes], { type: "application/zip" }), "H_Teixeira_Informativos_HTML_" + carimbo() + ".zip", "application/zip");
    } catch (e) {
      if (/Nenhum informativo/.test((e && e.message) || "")) return json({ error: e.message }, 409);
      return json({ error: "Falha ao exportar HTML em lote: " + ((e && e.message) || e) }, 500);
    }
  }

  window.fetch = async function (input, init) {
    var raw = typeof input === "string" ? input : input && input.url;
    var u;
    try { u = new URL(raw, location.href); } catch (e) { return realFetch(input, init); }
    if (u.origin !== location.origin || u.pathname.indexOf("/api/") !== 0) return realFetch(input, init);
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    try {
      return await rota(method, u, init || {});
    } catch (e) {
      if (!(e && e.status)) console.warn("Informativos:", e);
      return respostaErro(e);
    }
  };

  // -------------------------------------------------------------------------------------------
  // Imagens e downloads que a tela abria direto pelo endereço

  var urlsImagem = new Map();
  function setImg(img, url) {
    if (!img) return;
    if (urlsImagem.has(url)) { img.src = urlsImagem.get(url); return; }
    window.fetch(url).then(function (r) {
      if (!r.ok) throw new Error("imagem " + r.status);
      return r.blob();
    }).then(function (blob) {
      var obj = URL.createObjectURL(blob);
      urlsImagem.set(url, obj);
      img.src = obj;
    }).catch(function (e) {
      console.warn("Informativos: imagem não carregada", url, e);
      img.alt = img.alt || "Imagem não disponível";
    });
  }
  async function baixar(url) {
    try {
      var r = await window.fetch(url);
      if (!r.ok) {
        var msg = "Erro " + r.status;
        try { msg = (await r.json()).error || msg; } catch (e) {}
        throw new Error(msg);
      }
      var blob = await r.blob();
      var nome = "arquivo";
      var m = (r.headers.get("Content-Disposition") || "").match(/filename\*=UTF-8''([^;]+)/i);
      if (m) { try { nome = decodeURIComponent(m[1]); } catch (e) {} }
      var obj = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = obj;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(obj); }, 4000);
    } catch (e) {
      alert(e.message || "Não foi possível baixar o arquivo.");
    }
  }

  // -------------------------------------------------------------------------------------------
  // Migração da base do Infos HT (administrador)

  function tipoPorNome(nome) {
    var ext = String(nome || "").split(".").pop().toLowerCase();
    return { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf", html: "text/html",
             htm: "text/html", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", emf: "image/emf" }[ext]
      || "application/octet-stream";
  }
  async function migrar(file, progresso) {
    var s = await sessao();
    if (s.papel !== "admin") throw new Error("Somente o administrador pode importar a base do Infos HT.");
    if (typeof JSZip === "undefined") throw new Error("Componente de leitura de ZIP não carregado.");
    var zip = await JSZip.loadAsync(file);
    var mf = zip.file("manifest.json");
    if (!mf) throw new Error("Arquivo não reconhecido: falta o manifest.json do pacote de migração.");
    var manifest = JSON.parse(await mf.async("string"));
    if (manifest.formato !== "hub-informativos-migracao") throw new Error("Arquivo não reconhecido como pacote de migração do Infos HT.");
    var docs = manifest.documentos || [];
    var avisar = function (t) { if (progresso) progresso(t); };
    await rpc("inf_migrar_pastas", { p_nomes: manifest.pastas || [] });
    var n = 0;
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      var titulo = (d.documento && d.documento.title) || d.documento.id;
      avisar("Informativo " + (i + 1) + " de " + docs.length + ": " + titulo);
      var envios = [];
      if (d.original_arquivo && d.documento.original_caminho) envios.push([d.original_arquivo, d.documento.original_caminho]);
      (d.assets || []).forEach(function (a) { if (a.arquivo) envios.push([a.arquivo, a.caminho, a.mime_type]); });
      (d.fontes || []).forEach(function (f) { if (f.arquivo && f.caminho) envios.push([f.arquivo, f.caminho]); });
      for (var k = 0; k < envios.length; k++) {
        var z = zip.file(envios[k][0]);
        if (!z) continue;
        var bytes = await z.async("uint8array");
        var tipo = envios[k][2] || tipoPorNome(envios[k][1]);
        await enviarArquivo(envios[k][1], new Blob([bytes], { type: tipo }), tipo);
      }
      var limpa = function (lista) { return (lista || []).map(function (x) { var o = Object.assign({}, x); delete o.arquivo; return o; }); };
      await rpc("inf_migrar_documento", { p: { pasta: d.pasta, documento: d.documento, conteudo: d.conteudo, versoes: [], assets: limpa(d.assets), fontes: limpa(d.fontes) } });
      for (var v = 0; v < (d.versoes || []).length; v++) {
        await rpc("inf_migrar_documento", { p: { documento: { id: d.documento.id }, versoes: [d.versoes[v]] } });
      }
      n++;
    }
    var hist = manifest.historico || [];
    var inseridos = 0;
    for (var h = 0; h < hist.length; h += 100) {
      avisar("Histórico: " + Math.min(h + 100, hist.length) + " de " + hist.length);
      var r = await rpc("inf_migrar_historico", { p_itens: hist.slice(h, h + 100) });
      inseridos += (r && r.inseridos) || 0;
    }
    assetsPorDoc.clear();
    return { documentos: n, historico: inseridos, pastas: (manifest.pastas || []).length };
  }

  // -------------------------------------------------------------------------------------------
  // Ajustes da tela (o que não se aplica dentro do HUB ou ainda não foi recriado)

  function estilo() {
    var css = [
      "[data-pwa-install],.hti-pwa-install,.pwa-actions,#backupButton,#restoreButton,#logoutAdmin,#htLogout,a[href$='admin.html'],#loginAdmin{display:none!important}",
      "html.inf-papel-leitor #importDocx,html.inf-papel-leitor #createFromTemplate,html.inf-papel-leitor #openSecureEditor,html.inf-papel-leitor #htAdminBar{display:none!important}",
      ".inf-hub-migrar{margin-left:auto}",
      ".inf-hub-progresso{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45)}",
      ".inf-hub-progresso div{background:#fff;color:#1c2a3a;border-radius:12px;padding:22px 26px;max-width:460px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.25)}"
    ];
    if (!RECURSOS.importar) css.push("#importDocx{display:none!important}");
    if (!RECURSOS.template) css.push("#createFromTemplate{display:none!important}");
    if (!RECURSOS.editar) css.push("#openSecureEditor{display:none!important}");
    if (!RECURSOS.exportarHtml) css.push("#bulkHtmlExport,[data-library-export='html'],[data-export='html']{display:none!important}");
    if (!RECURSOS.exportarDocx) css.push("[data-library-export='docx'],[data-export='docx']{display:none!important}");
    var st = document.createElement("style");
    st.textContent = css.join("\n");
    document.head.appendChild(st);
  }
  function botaoMigracao() {
    var barra = document.querySelector(".toolbar");
    if (!barra || document.getElementById("infHubMigrar")) return;
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.hidden = true;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "infHubMigrar";
    btn.className = "secondary inf-hub-migrar";
    btn.textContent = "Importar base do Infos HT";
    btn.title = "Traz para o HUB os informativos, pastas, versões, imagens e histórico do Infos HT (pacote de migração .zip).";
    btn.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      if (!confirm("Importar a base do Infos HT a partir de \"" + file.name + "\"?\n\nInformativos já importados antes são atualizados (não duplica).")) return;
      var box = document.createElement("div");
      box.className = "inf-hub-progresso";
      box.innerHTML = "<div><strong>Importando a base do Infos HT…</strong><p id='infHubMigrarTexto'>Lendo o pacote…</p></div>";
      document.body.appendChild(box);
      try {
        var r = await migrar(file, function (t) { var p = document.getElementById("infHubMigrarTexto"); if (p) p.textContent = t; });
        box.remove();
        alert("Base importada: " + r.documentos + " informativo(s), " + r.pastas + " pasta(s) e " + r.historico + " registro(s) de histórico.");
        location.reload();
      } catch (e) {
        box.remove();
        alert("A importação parou: " + (e.message || e) + "\n\nVocê pode repetir: o que já foi importado é atualizado, sem duplicar.");
      }
    });
    barra.appendChild(btn);
    barra.appendChild(input);
  }
  function aoCarregar() {
    estilo();
    sessao().then(function (s) {
      if ((RECURSOS.migracao || /[?&]migracao=1(&|$)/.test(location.search)) && s.papel === "admin" && document.getElementById("bulkHtmlExport")) botaoMigracao();
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", aoCarregar);
  else aoCarregar();

  window.HubInf = { setImg: setImg, baixar: baixar, migrar: migrar, sessao: sessao, recursos: RECURSOS };
})();
