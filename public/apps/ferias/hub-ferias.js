/*
 * Controle de Férias no HUB — ponte entre a tela do app (app.js, a mesma do app do servidor)
 * e o banco do HUB (Supabase).
 *
 * A tela continua chamando os endereços "/api/..." do servidor antigo; aqui essas chamadas são
 * atendidas pelas funções fer_* do Supabase, com o login do HUB.
 *
 * - Login: sessão do HUB (o HUB envia o token; fora do HUB, lê a sessão salva no navegador).
 * - Usuários: os do HUB. Administradores e gestores do HUB = ADM do app.
 * - Saldos, contagens e planilha: calculados aqui, com as mesmas regras do servidor (v1.5.0).
 *   O banco confere as regras de gravação (permissões, sobreposições, datas).
 */
(function () {
  "use strict";

  var BUILD = "1.5.0-hub1";
  var CFG_KEY = "hub_supabase_public";
  var MOTIVOS = ["Férias regulares", "Viagem", "Descanso", "Assuntos pessoais", "Compensação", "Saúde", "Casamento", "Estudos"];
  var MIN_LETRAS = 11;
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
    if (event.data && event.data.type === "hub-auth-token") acceptToken(event.data);
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

  function httpError(message, status) {
    var e = new Error(message);
    e.status = status;
    return e;
  }

  async function rpc(fn, args, retried) {
    var token = await getToken(false);
    if (!auth.url || !auth.anonKey) throw httpError("Configuração do HUB não encontrada. Abra o Controle de Férias pelo HUB.", 401);
    if (!token) throw httpError("Sessão do HUB não encontrada. Entre no HUB e abra o Controle de Férias por ele.", 401);
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
    var status = response.status === 401 ? 401 : 400;
    if (data && data.code === "42501") status = 403;
    else if (data && data.code === "PGRST202") message = "Função do banco não encontrada (" + fn + "). Rode o SQL do Férias no Supabase.";
    throw httpError(message, status);
  }

  // -------------------------------------------------------------------------------------------
  // Datas e semestres (mesmas regras do servidor)

  function dt(iso) { var p = iso.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDias(isoTxt, n) { var d = dt(isoTxt); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function diffDias(a, b) { return Math.round((dt(b) - dt(a)) / 86400000); }
  function fimDeSemana(isoTxt) { var w = dt(isoTxt).getUTCDay(); return w === 0 || w === 6; }
  function br(isoTxt) { return isoTxt.slice(8, 10) + "/" + isoTxt.slice(5, 7) + "/" + isoTxt.slice(0, 4); }

  function semIdx(isoTxt) {
    var y = Number(isoTxt.slice(0, 4)), m = Number(isoTxt.slice(5, 7));
    if (m >= 5 && m <= 10) return y * 2;
    if (m >= 11) return y * 2 + 1;
    return (y - 1) * 2 + 1;
  }
  function semChave(idx) { return Math.floor(idx / 2) + "-" + (idx % 2 ? "V" : "I"); }
  function chaveIdx(chave) {
    var m = /^(\d{4})-([IV])$/.exec(chave || "");
    return m ? Number(m[1]) * 2 + (m[2] === "V" ? 1 : 0) : null;
  }
  function semRotulo(idx) {
    var ano = Math.floor(idx / 2);
    return idx % 2 ? "Verão " + ano + "/" + String(ano + 1).slice(-2) : "Inverno " + ano;
  }
  function semPeriodo(idx) {
    var ano = Math.floor(idx / 2);
    return idx % 2 ? [ano + "-11-01", (ano + 1) + "-04-30"] : [ano + "-05-01", ano + "-10-31"];
  }

  function contarPeriodo(ini, fim, feriados) {
    var corr = 0, uteis = 0, porSem = {};
    for (var d = ini; d <= fim; d = addDias(d, 1)) {
      var util = !fimDeSemana(d) && !feriados.has(d) ? 1 : 0;
      corr += 1; uteis += util;
      var s = semIdx(d);
      porSem[s] = porSem[s] || [0, 0];
      porSem[s][0] += 1; porSem[s][1] += util;
    }
    return { corr: corr, uteis: uteis, porSem: porSem };
  }

  function situacao(ini, fim, hoje) {
    if (hoje < ini) return "Agendada";
    if (hoje > fim) return "Gozada";
    return "Em andamento";
  }

  // Contador de saldo: direito por semestre (do semestre inicial até o atual) − dias usados.
  function resumoUsuario(u, feriasU, feriados, hoje) {
    var usaUteis = u.modo === "uteis";
    var semAtual = semIdx(hoje);
    var semIni = chaveIdx(u.inicio_semestre) || semAtual;
    var dias = Number(u.dias_semestre || 0);
    var saldoIni = Number(u.saldo_inicial || 0);
    var nSem = Math.max(0, semAtual - semIni + 1);
    var direito = nSem * dias + saldoIni;
    var gozado = 0, agendado = 0, porSem = {}, proxima = null;
    feriasU.forEach(function (f) {
      for (var d = f.inicio; d <= f.fim; d = addDias(d, 1)) {
        var util = !fimDeSemana(d) && !feriados.has(d) ? 1 : 0;
        var val = usaUteis ? util : 1;
        if (d <= hoje) gozado += val; else agendado += val;
        var s = semIdx(d);
        porSem[s] = porSem[s] || [0, 0];
        porSem[s][0] += 1; porSem[s][1] += util;
      }
      if (f.fim >= hoje && (proxima === null || f.inicio < proxima.inicio)) proxima = { id: f.id, inicio: f.inicio, fim: f.fim };
    });
    var chaves = Object.keys(porSem).map(Number);
    var ultimo = Math.max.apply(null, [semAtual].concat(chaves));
    var primeiro = Math.min.apply(null, [semIni].concat(chaves));
    var linhas = [], acumulado = saldoIni;
    for (var idx = primeiro; idx <= ultimo; idx++) {
      var dirSem = semIni <= idx && idx <= semAtual ? dias : 0;
      var cu = porSem[idx] || [0, 0];
      var usado = usaUteis ? cu[1] : cu[0];
      acumulado += dirSem - usado;
      linhas.push({ chave: semChave(idx), rotulo: semRotulo(idx), direito: dirSem, corridos: cu[0], uteis: cu[1], usado: usado,
        saldo_acumulado: acumulado, futuro: idx > semAtual, atual: idx === semAtual });
    }
    return { modo: u.modo, dias_semestre: dias, semestres_contados: nSem, direito: direito, gozado: gozado, agendado: agendado,
      saldo: direito - gozado - agendado, saldo_hoje: direito - gozado, proxima: proxima, semestres: linhas };
  }

  function feriadosAtivos(raw) {
    var s = new Set();
    raw.feriados.forEach(function (f) { if (f.ativo) s.add(f.data); });
    return s;
  }

  // Mesmo formato do /api/dados do servidor.
  var ultimo = null;
  function montarDados(raw) {
    var adm = raw.me.papel === "ADM";
    var hoje = raw.hoje;
    var feriados = feriadosAtivos(raw);
    var porUsuario = {};
    var ferias = raw.ferias.map(function (f) {
      (porUsuario[f.usuario_id] = porUsuario[f.usuario_id] || []).push(f);
      var c = contarPeriodo(f.inicio, f.fim, feriados);
      return Object.assign({}, f, {
        oculto: false, dias_corridos: c.corr, dias_uteis: c.uteis,
        semestres: Object.keys(c.porSem).map(Number).sort(function (a, b) { return a - b; }).map(semChave),
        situacao: situacao(f.inicio, f.fim, hoje),
        pode_editar: adm || (f.usuario_id === raw.me.id && f.inicio > hoje)
      });
    });
    var ausencias = raw.ausencias.filter(function (a) { return a.dias && a.dias.length; }).map(function (a) {
      return Object.assign({}, a, {
        dias_uteis: a.dias.filter(function (d) { return !fimDeSemana(d) && !feriados.has(d); }).length,
        oculto: false,
        pode_editar: adm || (a.usuario_id === raw.me.id && a.dias[0] > hoje)
      });
    });
    var resumos = {};
    raw.usuarios.forEach(function (u) {
      if (u.participa && (adm || u.id === raw.me.id)) resumos[u.id] = resumoUsuario(u, porUsuario[u.id] || [], feriados, hoje);
    });
    var semAtual = semIdx(hoje);
    var idxs = new Set([semAtual - 2, semAtual - 1, semAtual, semAtual + 1, semAtual + 2]);
    ferias.forEach(function (f) { f.semestres.forEach(function (k) { idxs.add(chaveIdx(k)); }); });
    raw.usuarios.forEach(function (u) { var i = chaveIdx(u.inicio_semestre); if (i) idxs.add(i); });
    (raw.inicios || []).forEach(function (k) { var i = chaveIdx(k); if (i) idxs.add(i); });
    var semestres = Array.from(idxs).sort(function (a, b) { return a - b; }).map(function (i) {
      var p = semPeriodo(i);
      return { chave: semChave(i), rotulo: semRotulo(i), inicio: p[0], fim: p[1] };
    });
    var pa = semPeriodo(semAtual);
    var dados = {
      me: raw.me, hoje: hoje,
      semestre_atual: { chave: semChave(semAtual), rotulo: semRotulo(semAtual), inicio: pa[0], fim: pa[1] },
      semestres: semestres, usuarios: raw.usuarios, ferias: ferias, ausencias: ausencias,
      min_letras_justificativa: MIN_LETRAS, resumos: resumos, feriados: raw.feriados, motivos: MOTIVOS, build: BUILD
    };
    ultimo = { raw: raw, dados: dados };
    return dados;
  }

  async function carregarDados() {
    return montarDados(await rpc("fer_dados", {}));
  }

  // Prévia do lançamento (mesma resposta do /api/contar do servidor).
  // A prévia relê o banco (como o servidor antigo): colegas podem ter lançado algo depois da abertura da tela.
  var leituraPrevia = null;
  function dadosFrescos() {
    if (!leituraPrevia) {
      leituraPrevia = rpc("fer_dados", {});
      leituraPrevia.then(function () { setTimeout(function () { leituraPrevia = null; }, 400); }, function () { leituraPrevia = null; });
    }
    return leituraPrevia;
  }

  async function contar(body) {
    var raw = await dadosFrescos(), me = raw.me, adm = me.papel === "ADM";
    var ini = String(body.inicio || "").slice(0, 10), fim = String(body.fim || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || isNaN(dt(ini))) throw httpError('Data inválida em "Início".', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fim) || isNaN(dt(fim))) throw httpError('Data inválida em "Fim".', 400);
    if (fim < ini) throw httpError("A data final é anterior à data inicial.", 400);
    if (diffDias(ini, fim) > 365) throw httpError("Período maior que 1 ano. Confira as datas.", 400);
    var uid = Number(body.usuario_id) || me.id;
    if (!adm && uid !== me.id) throw httpError("Você só pode lançar as suas próprias férias.", 403);
    var alvo = raw.usuarios.find(function (u) { return u.id === uid; });
    if (!alvo || !alvo.ativo) throw httpError("Usuário não encontrado ou inativo.", 400);
    if (!alvo.participa) throw httpError(alvo.nome + " não participa do controle de férias (ajuste em Usuários).", 400);
    var fid = Number(body.id) || 0;
    var feriados = feriadosAtivos(raw);
    var c = contarPeriodo(ini, fim, feriados);
    var ativos = new Set(raw.usuarios.filter(function (u) { return u.ativo; }).map(function (u) { return u.id; }));
    var nome = function (id) { var u = raw.usuarios.find(function (x) { return x.id === id; }); return u ? u.nome : "#" + id; };
    var proprios = raw.ferias.filter(function (f) { return f.usuario_id === uid && f.id !== fid && f.inicio <= fim && f.fim >= ini; });
    var colegas = raw.ferias.filter(function (f) { return f.usuario_id !== uid && ativos.has(f.usuario_id) && f.inicio <= fim && f.fim >= ini; })
      .sort(function (a, b) { return a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0; });
    var aus = [];
    raw.ausencias.forEach(function (a) { if (a.usuario_id === uid) (a.dias || []).forEach(function (d) { if (d >= ini && d <= fim) aus.push(d); }); });
    aus.sort();
    var feriasU = raw.ferias.filter(function (f) { return f.usuario_id === uid && f.id !== fid; }).concat([{ id: 0, inicio: ini, fim: fim }]);
    var res = resumoUsuario(alvo, feriasU, feriados, raw.hoje);
    return {
      dias_corridos: c.corr, dias_uteis: c.uteis, modo: alvo.modo,
      semestres: Object.keys(c.porSem).map(Number).sort(function (a, b) { return a - b; }).map(function (i) { return { rotulo: semRotulo(i), corridos: c.porSem[i][0], uteis: c.porSem[i][1] }; }),
      feriados: raw.feriados.filter(function (f) { return f.ativo && f.data >= ini && f.data <= fim; }).map(function (f) { return { data: f.data, descricao: f.descricao }; }),
      conflito_proprio: proprios.map(function (f) { return br(f.inicio) + " a " + br(f.fim); }).concat(aus.map(function (d) { return "ausência registrada em " + br(d); })),
      colegas: colegas.map(function (f) { return nome(f.usuario_id) + ": " + br(f.inicio) + " a " + br(f.fim); }),
      saldo_apos: res.saldo
    };
  }

  // -------------------------------------------------------------------------------------------
  // Planilha (mesmas abas do backup do servidor), montada aqui com ExcelJS.

  var scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise(function (resolve, reject) {
        var el = document.createElement("script");
        el.src = src;
        el.onload = function () { resolve(); };
        el.onerror = function () { delete scripts[src]; reject(httpError("Não foi possível carregar o gerador de planilhas. Verifique a conexão e tente de novo.", 400)); };
        document.head.appendChild(el);
      });
    }
    return scripts[src];
  }

  function dataCel(isoTxt) { return isoTxt ? dt(isoTxt) : null; }
  function simNao(v) { return v ? "Sim" : "Não"; }

  async function exportar(qs) {
    var params = new URLSearchParams(qs || "");
    var d = await carregarDados();
    var adm = d.me.papel === "ADM";
    var parseIds = function (txt) { var s = new Set(); String(txt || "").split(",").forEach(function (x) { if (/^\d+$/.test(x)) s.add(Number(x)); }); return s.size ? s : null; };
    var ids = parseIds(params.get("ids")), ausIds = parseIds(params.get("aus"));
    var nomes = {}; d.usuarios.forEach(function (u) { nomes[u.id] = u.nome; });
    var rot = {}; d.semestres.forEach(function (s) { rot[s.chave] = s.rotulo; });
    var nomeDe = function (id) { return nomes[id] || "#" + id; };
    var fer = d.ferias.filter(function (f) { return !ids || ids.has(f.id); })
      .sort(function (a, b) { return a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : nomeDe(a.usuario_id).localeCompare(nomeDe(b.usuario_id)); });
    var linhasF = fer.map(function (f) {
      return [nomeDe(f.usuario_id), dataCel(f.inicio), dataCel(f.fim), f.dias_corridos, f.dias_uteis, f.semestres.map(function (k) { return rot[k] || k; }).join(", "),
        f.situacao, f.motivo, f.observacao, f.criado_por, f.criado_em, f.atualizado_por, f.atualizado_em];
    });
    var planilhas = [["Férias", ["Usuário", "Início", "Fim", "Dias corridos", "Dias úteis", "Semestre(s)", "Situação", "Motivo", "Observação", "Lançado por", "Lançado em", "Alterado por", "Alterado em"],
      linhasF, [24, 12, 12, 9, 9, 26, 14, 26, 45, 18, 18, 18, 18]]];
    var dsem = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    var ferSet = new Set(d.feriados.filter(function (f) { return f.ativo; }).map(function (f) { return f.data; }));
    var linhasA = [];
    d.ausencias.filter(function (a) { return !ausIds || ausIds.has(a.id); }).forEach(function (a) {
      a.dias.forEach(function (x) {
        linhasA.push([nomeDe(a.usuario_id), dataCel(x), dsem[dt(x).getUTCDay()], fimDeSemana(x) || ferSet.has(x) ? "Não" : "Sim",
          a.justificativa, a.id, a.criado_por, a.criado_em, a.atualizado_por, a.atualizado_em, x]);
      });
    });
    linhasA.sort(function (a, b) { return a[10] < b[10] ? -1 : a[10] > b[10] ? 1 : a[0].localeCompare(b[0]); });
    linhasA = linhasA.map(function (r) { return r.slice(0, 10); });
    var abaAus = ["Ausências", ["Usuário", "Data", "Dia da semana", "Dia útil", "Justificativa", "Registro nº", "Lançado por", "Lançado em", "Alterado por", "Alterado em"],
      linhasA, [24, 12, 13, 9, 60, 11, 18, 18, 18, 18]];
    if (ausIds) planilhas = [abaAus];
    else if (!ids) planilhas.push(abaAus);
    if (!ids && !ausIds) {
      var saldos = [], porSem = [];
      d.usuarios.forEach(function (u) {
        var r = d.resumos[u.id];
        if (!r) return;
        var prox = r.proxima;
        saldos.push([u.nome, r.modo === "uteis" ? "Dias úteis" : "Dias corridos", r.dias_semestre, rot[u.inicio_semestre || ""] || u.inicio_semestre || "",
          u.saldo_inicial === undefined ? "" : u.saldo_inicial, r.direito, r.gozado, r.agendado, r.saldo, prox ? dataCel(prox.inicio) : null, prox ? dataCel(prox.fim) : null]);
        r.semestres.forEach(function (s) {
          porSem.push([u.nome, s.rotulo, s.direito, s.corridos, s.uteis, s.usado, s.saldo_acumulado, s.futuro ? "futuro" : s.atual ? "atual" : ""]);
        });
      });
      planilhas.push(["Saldos", ["Usuário", "Contagem", "Dias/semestre", "Início do controle", "Saldo inicial", "Direito acumulado", "Gozado", "Agendado", "Saldo", "Próximas férias (início)", "Próximas férias (fim)"],
        saldos, [24, 14, 12, 18, 12, 16, 10, 10, 10, 20, 20]]);
      planilhas.push(["Por semestre", ["Usuário", "Semestre", "Direito", "Usado (corridos)", "Usado (úteis)", "Usado (conta no saldo)", "Saldo acumulado", "Obs."],
        porSem, [24, 16, 10, 16, 14, 20, 16, 10]]);
      if (adm) {
        planilhas.push(["Usuários", ["Nome", "E-mail", "Perfil", "Ativo", "Participa", "Dias/semestre", "Contagem", "Início do controle", "Saldo inicial", "Cadastrado em"],
          d.usuarios.map(function (u) {
            return [u.nome, u.login, u.papel, simNao(u.ativo), simNao(u.participa), u.dias_semestre, u.modo === "uteis" ? "Dias úteis" : "Dias corridos",
              rot[u.inicio_semestre] || u.inicio_semestre, u.saldo_inicial, u.criado_em];
          }), [24, 28, 10, 8, 10, 12, 14, 18, 12, 18]]);
      }
      planilhas.push(["Feriados", ["Data", "Descrição", "Conta como feriado", "Origem"],
        d.feriados.map(function (f) { return [dataCel(f.data), f.descricao, simNao(f.ativo), f.origem === "auto" ? "Nacional (automático)" : "Incluído"]; }),
        [12, 32, 18, 20]]);
    }

    await loadScript("/apps/apuracao/vendor/exceljs.min.js?v=4.4.0");
    var wb = new window.ExcelJS.Workbook();
    planilhas.forEach(function (p) {
      var ws = wb.addWorksheet(p[0].slice(0, 31));
      ws.columns = p[1].map(function (h, i) { return { header: h, width: p[3][i] || 14 }; });
      var cab = ws.getRow(1);
      cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cab.eachCell(function (cell) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF252758" } }; });
      p[2].forEach(function (linha) {
        var row = ws.addRow(linha.map(function (v) { return v === "" || v === undefined ? null : v; }));
        row.eachCell(function (cell) { if (cell.value instanceof Date) cell.numFmt = "dd/mm/yyyy"; });
      });
      ws.views = [{ state: "frozen", ySplit: 1 }];
    });
    var buffer = await wb.xlsx.writeBuffer();
    var tipo = ausIds ? "ausencias" : ids ? "lista" : "backup";
    var agora = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var nome = "controle_ferias_" + tipo + "_" + agora.getFullYear() + pad(agora.getMonth() + 1) + pad(agora.getDate()) + "_" + pad(agora.getHours()) + pad(agora.getMinutes()) + ".xlsx";
    var blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    var tipoTxt = ausIds ? " (lista de ausências)" : ids ? " (lista de férias)" : " (backup)";
    rpc("fer_registrar_exportacao", { p_detalhe: linhasF.length + " férias, " + linhasA.length + " dias de ausência" + tipoTxt }).catch(function () {});
    return nome;
  }

  window.hubFeriasExportar = function (qs) {
    exportar(qs).catch(function (e) {
      var box = document.getElementById("toasts");
      if (!box) return;
      var el = document.createElement("div");
      el.className = "toast erro";
      el.textContent = e.message || "Não foi possível gerar a planilha.";
      box.appendChild(el);
      setTimeout(function () { el.remove(); }, 7000);
    });
  };

  // -------------------------------------------------------------------------------------------
  // Rotas do app antigo -> Supabase

  function idNum(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }

  async function route(method, path, body) {
    if (path === "/api/health") return { app: "ht-controle-ferias", server_build: BUILD, ok: true };
    if (path === "/api/me") {
      if (!ultimo) await carregarDados();
      var me = ultimo.raw.me;
      return { logado: true, troca_senha: false, nome: me.nome, login: me.login, papel: me.papel };
    }
    if (path === "/api/dados") {
      // A primeira carga da tela reaproveita a leitura feita ao entrar.
      if (primeiraCarga) { var pc = primeiraCarga; primeiraCarga = null; return pc; }
      return carregarDados();
    }
    if (path === "/api/logout") return { ok: true };
    if (path === "/api/login" || path === "/api/senha") throw httpError("Login e senha são os do HUB. Use o HUB para entrar ou trocar a senha.", 400);
    if (path === "/api/contar") return contar(body);
    if (path === "/api/ferias/salvar") return rpc("fer_ferias_salvar", { p: body });
    if (path === "/api/ferias/excluir") return rpc("fer_ferias_excluir", { p_id: idNum(body.id) });
    if (path === "/api/ausencias/salvar") return rpc("fer_ausencia_salvar", { p: body });
    if (path === "/api/ausencias/excluir") return rpc("fer_ausencia_excluir", { p_id: idNum(body.id) });
    if (path === "/api/usuarios/salvar") return rpc("fer_usuario_salvar", { p: body });
    if (path === "/api/usuarios/excluir") throw httpError("Os usuários são cadastrados no HUB (Configurações > Usuários).", 400);
    if (path === "/api/feriados/salvar") return rpc("fer_feriado_salvar", { p: body });
    if (path === "/api/feriados/excluir") return rpc("fer_feriado_excluir", { p_id: idNum(body.id) });
    if (path === "/api/feriados/ano") return rpc("fer_feriados_ano", { p_ano: idNum(body.ano) });
    throw httpError("Rota não encontrada.", 404);
  }

  window.fetch = async function (input, init) {
    var href = typeof input === "string" ? input : input && input.url;
    var url;
    try { url = new URL(href, location.href); } catch (e) { return realFetch(input, init); }
    if (url.origin !== location.origin || url.pathname.indexOf("/api/") !== 0) return realFetch(input, init);
    init = init || {};
    var method = String(init.method || "GET").toUpperCase();
    var body = {};
    if (typeof init.body === "string" && init.body) {
      try { body = JSON.parse(init.body); } catch (e) { body = {}; }
    }
    try {
      var result = await route(method, url.pathname.replace(/\/+$/, ""), body);
      return new Response(JSON.stringify(result === undefined ? { ok: true } : result), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ erro: e.message || "Erro inesperado." }), { status: e.status || 500, headers: { "Content-Type": "application/json" } });
    }
  };

  // Sessão do HUB vencida: aviso no lugar da antiga tela de login.
  window.hubFeriasSessao = function (message) {
    var box = document.getElementById("hubFeriasAviso");
    if (!box) return;
    box.querySelector(".erro").textContent = message || "A sessão do HUB expirou. Entre novamente no HUB e reabra o Controle de Férias.";
    box.hidden = false;
    var app = document.getElementById("app");
    if (app) app.hidden = true;
  };

  // Para os testes automáticos (mesmas contas da tela).
  window.hubFeriasCalc = { resumoUsuario: resumoUsuario, montarDados: montarDados, contarPeriodo: contarPeriodo };

  var primeiraCarga = null;
  async function start() {
    try {
      document.documentElement.classList.add("hub-embedded");
      primeiraCarga = carregarDados();
      await primeiraCarga;
      var script = document.createElement("script");
      script.src = "app.js?v=" + BUILD;
      document.body.appendChild(script);
    } catch (e) {
      window.hubFeriasSessao(e.message || "Não foi possível entrar com o usuário do HUB.");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
