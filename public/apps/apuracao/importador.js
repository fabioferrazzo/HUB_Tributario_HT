/*
 * Controle de Apuração no HUB — leitura de planilhas de empresas (XLS/XLSX) no navegador.
 * Tradução fiel do importador IMPORT02 do servidor antigo (server.py: parse_companies_detailed),
 * para que a mesma planilha gere a mesma prévia. A leitura do arquivo usa a biblioteca SheetJS.
 *
 * Uso: HubApuracaoImport.parse(XLSX, nomeDoArquivo, bytes) -> { companies, warnings, ignored, info }
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- texto
  function str(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) {
      var p = function (n) { return String(n).padStart(2, "0"); };
      // SheetJS entrega a data do Excel em UTC; mostra como o Python (data e hora "de parede").
      return value.getUTCFullYear() + "-" + p(value.getUTCMonth() + 1) + "-" + p(value.getUTCDate()) + " " + p(value.getUTCHours()) + ":" + p(value.getUTCMinutes()) + ":" + p(value.getUTCSeconds());
    }
    if (value === true) return "True";
    if (value === false) return "False";
    return String(value);
  }
  function normalizeText(value) { return str(value).trim().replace(/\s+/g, " "); }
  function normKey(value) {
    return normalizeText(value).toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function tokens(key) { return key ? key.split(" ") : []; }
  function slug(label) { return normKey(label).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function cleanCnpj(value) { return normalizeText(value).replace(/\D/g, ""); }
  function normalizeDomainCode(value) {
    var text = normalizeText(value);
    if (/^\d+\.0$/.test(text)) text = text.slice(0, -2);
    return text;
  }
  function validCnpj(value) {
    var d = cleanCnpj(value);
    if (!d) return true;
    if (d.length !== 14 || d === d[0].repeat(14)) return false;
    var nums = d.split("").map(Number);
    for (var size = 12; size <= 13; size++) {
      var weights = [];
      for (var w = size - 7; w > 1; w--) weights.push(w);
      for (var w2 = 9; w2 > 1; w2--) weights.push(w2);
      var total = 0;
      for (var i = 0; i < size; i++) total += nums[i] * weights[i];
      var rem = total % 11;
      if (nums[size] !== (rem < 2 ? 0 : 11 - rem)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- regimes e checklists
  var TAX_REGIME_LABELS = { SN: "SIMPLES NACIONAL", LP: "LUCRO PRESUMIDO", LR: "LUCRO REAL" };
  var DEFAULT_CHECKLISTS = {
    "SIMPLES NACIONAL": ["Saídas", "Entradas", "Simples", "ISS", "REINF", "ICMS", "DeSTDA", "DIRBI", "FUNRURAL", "Enviado"],
    "LUCRO PRESUMIDO": ["Saídas", "Entradas", "ISS", "CSLL", "IRPJ", "ICMS", "PIS/COFINS", "REINF", "EFD Contrib.", "EFD ICMS/GIA", "DIRBI", "FUNRURAL", "Aplicações", "Enviado"],
    "LUCRO REAL": ["Saídas", "Entradas", "ISS", "CSLL", "IRPJ", "ICMS", "PIS/COFINS", "REINF", "EFD Contrib.", "EFD ICMS/GIA", "DIRBI", "FUNRURAL", "Aplicações", "Enviado"],
    "COOPERATIVA": ["Saídas", "Entradas", "ISS", "CSLL", "IRPJ", "ICMS", "PIS/COFINS", "REINF", "EFD Contrib.", "EFD ICMS/GIA", "DIRBI", "FUNRURAL", "Aplicações", "Enviado"],
    "OUTROS": ["Saídas", "Entradas", "ISS", "ICMS", "REINF", "Enviado"]
  };
  function taxRegimeCode(value) {
    var key = normKey(value), compact = key.replace(/ /g, ""), t = new Set(tokens(key));
    if (compact === "sn" || compact === "simples" || t.has("sn") || compact.indexOf("simplesnacional") >= 0 || (t.has("simples") && t.has("nacional"))) return "SN";
    if (compact === "lp" || compact === "presumido" || t.has("lp") || compact.indexOf("lucropresumido") >= 0 || (t.has("lucro") && t.has("presumido"))) return "LP";
    if (compact === "lr" || compact === "real" || t.has("lr") || compact.indexOf("lucroreal") >= 0 || (t.has("lucro") && t.has("real"))) return "LR";
    return "OTHER";
  }
  function canonicalTaxRegime(value, fallback) {
    var code = taxRegimeCode(value);
    if (TAX_REGIME_LABELS[code]) return TAX_REGIME_LABELS[code];
    return normalizeText(value).toUpperCase() || fallback || "OUTROS";
  }
  function checklistForRegime(regime) {
    var labels = DEFAULT_CHECKLISTS[canonicalTaxRegime(regime)] || DEFAULT_CHECKLISTS.OUTROS;
    return labels.map(function (label) { return { id: slug(label), label: label }; });
  }
  function detectRegime(text, current) {
    var code = taxRegimeCode(text);
    if (TAX_REGIME_LABELS[code]) return TAX_REGIME_LABELS[code];
    if (normKey(text).indexOf("cooperativa") >= 0) return "COOPERATIVA";
    return current;
  }

  var HEADER_CANON = {
    "empresas": "legal_name", "empresa": "legal_name", "razao social": "legal_name", "cliente": "legal_name",
    "cnpj": "cnpj", "cnpj cpf": "cnpj",
    "dom": "dominio_code", "dominio": "dominio_code", "codigo dominio": "dominio_code",
    "envio": "envio", "particularidades": "particularities", "particularidade": "particularities",
    "observacoes": "notes", "observacao": "notes", "obs": "notes", "notificacoes": "notifications"
  };
  var CHECK_ALIASES = {
    "saidas": "Saídas", "entradas": "Entradas", "simples": "Simples", "iss": "ISS", "reinf": "REINF",
    "icms": "ICMS", "destda": "DeSTDA", "dirbi": "DIRBI", "funrural": "FUNRURAL", "funural": "FUNRURAL",
    "enviado": "Enviado", "csll": "CSLL", "cssl": "CSLL", "irpj": "IRPJ", "pis cofins": "PIS/COFINS",
    "efd contrib": "EFD Contrib.", "efd contribuicoes": "EFD Contrib.", "efd icms gia": "EFD ICMS/GIA",
    "aplicacoes": "Aplicações"
  };
  var MONTH_KEYS = new Set(["jan", "janeiro", "fev", "fevereiro", "mar", "marco", "abr", "abril", "mai", "maio", "jun", "junho",
    "jul", "julho", "ago", "agosto", "set", "setembro", "out", "outubro", "nov", "novembro", "dez", "dezembro"]);
  var CATEGORY_WORDS = new Set(["empresa", "empresas", "comercio", "comercial", "servico", "servicos", "prestados", "prestacao", "industria",
    "e", "de", "simples", "nacional", "gerais", "geral", "holding", "holdings", "lucro", "presumido", "real",
    "cooperativa", "cooperativas", "mei", "outros", "regime", "regimes", "apuracao", "conf", "sn", "lp", "lr", "smp"]);
  var TRIVIAL_VALUES = new Set(["", "-", "--", "(-)", "ok", "sim", "nao", "sm", "x", "s", "n", "na", "n a", "0"]);
  var LP_CHECK_KEYS = new Set(["pis", "cofins", "pis cofins", "csll", "irpj", "csll irpj", "cssl"]);
  var REGIME_VALUES = {
    "sn": "SIMPLES NACIONAL", "smp": "SIMPLES NACIONAL", "simples": "SIMPLES NACIONAL", "simples nacional": "SIMPLES NACIONAL",
    "s n": "SIMPLES NACIONAL", "lp": "LUCRO PRESUMIDO", "presumido": "LUCRO PRESUMIDO", "lucro presumido": "LUCRO PRESUMIDO",
    "lr": "LUCRO REAL", "lucro real": "LUCRO REAL", "cooperativa": "COOPERATIVA", "coop": "COOPERATIVA"
  };
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  function regimeFromText(text) {
    var key = normKey(text);
    if (!key) return "";
    if (has(REGIME_VALUES, key)) return REGIME_VALUES[key];
    var t = new Set(tokens(key));
    if (t.has("cooperativa") || t.has("cooperativas")) return "COOPERATIVA";
    if (t.has("simples") || t.has("sn") || t.has("smp")) return "SIMPLES NACIONAL";
    if (t.has("presumido") || t.has("lp")) return "LUCRO PRESUMIDO";
    if ((t.has("lucro") && t.has("real")) || t.has("lr")) return "LUCRO REAL";
    return "";
  }

  function columnRole(rawHeader) {
    var key = normKey(rawHeader);
    if (!key) return "";
    var tk = tokens(key);
    var first = tk[0];
    if ((["empresa", "empresas", "cliente", "clientes", "nome", "contribuinte", "contribuintes"].indexOf(first) >= 0 || key.indexOf("razao social") === 0) && tk.length <= 4) return "legal_name";
    if (MONTH_KEYS.has(key)) return "month";
    if (has(HEADER_CANON, key)) return HEADER_CANON[key];
    if (key.indexOf("cnpj") === 0 || key === "cpf" || key === "cpf cnpj") return "cnpj";
    if (key.indexOf("dominio") >= 0 || ["cod", "codigo", "cod empresa", "codigo empresa"].indexOf(key) >= 0) return "dominio_code";
    if (key.indexOf("regime") === 0 || ["tributacao", "enquadramento", "trib"].indexOf(key) >= 0) return "regime";
    if (key.indexOf("obs") === 0 || key.indexOf("observac") === 0) return (tk.indexOf("mes") >= 0 || key.indexOf("mensal") >= 0) ? "monthly" : "notes";
    if (key.indexOf("particularidad") >= 0 || key.indexOf("mudanca") >= 0 || key.indexOf("caracteristica") >= 0 || key.indexOf("cuidado") >= 0 || key.indexOf("atencao") === 0) return "particularities";
    if (key.indexOf("notificac") >= 0) return "notifications";
    if ((key.indexOf("envio") >= 0 || key.indexOf("entrega") >= 0) && !["data", "guia", "enviad", "prazo"].some(function (x) { return key.indexOf(x) >= 0; })) return "envio";
    if (["contato", "quem recebe", "socio", "representante", "telefone", "fone", "celular", "whats", "e mail", "email"].some(function (x) { return key.indexOf(x) >= 0; })) return "contact";
    if (has(CHECK_ALIASES, key)) return "check";
    return "";
  }

  function importText(value) { var t = normalizeText(value); return TRIVIAL_VALUES.has(normKey(t)) ? "" : t; }
  function compact(name) { return normKey(name).replace(/ /g, ""); }
  function isCategoryRow(name) {
    var tk = tokens(normKey(name));
    return tk.length > 0 && tk.every(function (t) { return CATEGORY_WORDS.has(t) || MONTH_KEYS.has(t); });
  }
  function looksLikeNote(name) {
    var key = normKey(name);
    return name.length > 80 || name.indexOf("=") >= 0 || /^(obs |passo a passo|nota |lembrar)/.test(key) || tokens(key).length > 9 || !/[a-z]/.test(key);
  }
  function fuzzyCandidates(companies, name, minimum) {
    minimum = minimum || 4;
    var target = compact(name);
    if (target.length < minimum) return [];
    var exact = companies.filter(function (c) { return compact(c.legal_name) === target; });
    if (exact.length) return exact;
    return companies.filter(function (c) {
      var cc = compact(c.legal_name);
      return cc.indexOf(target) === 0 || (cc.length >= minimum && target.indexOf(cc) === 0);
    });
  }
  function sheetRank(sheetName) {
    var tk = tokens(normKey(sheetName));
    var months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    var month = 0, year = 0, i;
    for (i = 0; i < tk.length; i++) if (MONTH_KEYS.has(tk[i])) { month = months.indexOf(tk[i].slice(0, 3)) + 1; break; }
    for (i = 0; i < tk.length; i++) if (/^\d{4}$/.test(tk[i])) { year = Number(tk[i]); break; }
    if (!month && tk.length >= 2 && /^\d+$/.test(tk[0]) && Number(tk[0]) >= 1 && Number(tk[0]) <= 12 && /^\d{4}$/.test(tk[1])) { month = Number(tk[0]); year = Number(tk[1]); }
    return month ? year * 100 + month : -1;
  }

  // difflib.SequenceMatcher(None, a, b).ratio() — mesmo algoritmo do Python (sem "junk" em textos curtos).
  function seqRatio(a, b) {
    var b2j = {}, i, j;
    for (j = 0; j < b.length; j++) (b2j[b[j]] = b2j[b[j]] || []).push(j);
    if (b.length >= 200) {
      var ntest = Math.floor(b.length / 100) + 1;
      Object.keys(b2j).forEach(function (ch) { if (b2j[ch].length > ntest) delete b2j[ch]; });
    }
    function longest(alo, ahi, blo, bhi) {
      var besti = alo, bestj = blo, bestsize = 0, j2len = {};
      for (var i2 = alo; i2 < ahi; i2++) {
        var newj2len = {}, idx = b2j[a[i2]] || [];
        for (var k = 0; k < idx.length; k++) {
          var jj = idx[k];
          if (jj < blo) continue;
          if (jj >= bhi) break;
          var size = (j2len[jj - 1] || 0) + 1;
          newj2len[jj] = size;
          if (size > bestsize) { besti = i2 - size + 1; bestj = jj - size + 1; bestsize = size; }
        }
        j2len = newj2len;
      }
      while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
      while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
      return [besti, bestj, bestsize];
    }
    var queue = [[0, a.length, 0, b.length]], matches = 0;
    while (queue.length) {
      var q = queue.pop(), m = longest(q[0], q[1], q[2], q[3]);
      if (m[2]) {
        matches += m[2];
        if (q[0] < m[0] && q[2] < m[1]) queue.push([q[0], m[0], q[2], m[1]]);
        if (m[0] + m[2] < q[1] && m[1] + m[2] < q[3]) queue.push([m[0] + m[2], q[1], m[1] + m[2], q[3]]);
      }
    }
    var total = a.length + b.length;
    return total ? (2 * matches) / total : 1;
  }
  function similarName(a, b) {
    var ka = normKey(a), kb = normKey(b);
    if (!ka || !kb) return false;
    var ratio = seqRatio(ka, kb);
    var la = tokens(ka), lb = tokens(kb);
    return ratio >= 0.88 || (ratio >= 0.78 && la[la.length - 1] === lb[lb.length - 1]);
  }

  // ---------------------------------------------------------------- planilha -> matriz
  function matrices(XLSX, filename, bytes) {
    var lower = String(filename || "").toLowerCase();
    if (!/\.(xlsx|xls)$/.test(lower)) throw new Error("Formato não suportado. Use .xls ou .xlsx.");
    var wb = XLSX.read(bytes, { type: "array", cellDates: true, cellFormula: true, sheetStubs: true, cellHTML: false, cellStyles: false });
    return wb.SheetNames.map(function (name) {
      var ws = wb.Sheets[name], rows = [];
      if (ws && ws["!ref"]) {
        var range = XLSX.utils.decode_range(ws["!ref"]);
        // Como no openpyxl: linhas e colunas contadas desde A1.
        for (var r = 0; r <= range.e.r; r++) {
          var row = [];
          for (var c = 0; c <= range.e.c; c++) {
            var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
            // Como no servidor antigo (openpyxl sem data_only): célula com fórmula vale o texto da fórmula.
            if (cell && cell.f) row.push("=" + cell.f);
            else row.push(cell && cell.v !== undefined && cell.t !== "z" && cell.t !== "e" ? cell.v : null);
          }
          rows.push(row);
        }
      }
      return [name, rows];
    });
  }

  // ---------------------------------------------------------------- importador (IMPORT02)
  function parseDetailed(XLSX, filename, bytes) {
    var sheets = matrices(XLSX, filename, bytes);
    var parsed = [], warnings = [], ignored = [], info = [];
    var byCnpj = {}, byDom = {}, byName = {};
    var controlRows = [], mergedSheets = new Set();

    function ignore(sheet, idx, values, reason) {
      var text = values.map(normalizeText).filter(Boolean).join(" | ");
      if (text) ignored.push({ source_sheet: sheet, source_row: idx, text: text.slice(0, 160), reason: reason });
    }
    function casefold(s) { return s.toLowerCase(); }
    function findExisting(cnpj, dom, name, currentSheet) {
      if (cnpj && has(byCnpj, cnpj)) return byCnpj[cnpj];
      if (dom && has(byDom, casefold(dom))) return byDom[casefold(dom)];
      var found = has(byName, compact(name)) ? byName[compact(name)] : null;
      if (found && !(cnpj && found.cnpj && found.cnpj !== cnpj)) {
        var sameDom = !(dom && found.dominio_code && casefold(found.dominio_code) !== casefold(dom));
        if (sameDom || !found._sheets.has(currentSheet)) return found;
      }
      return null;
    }
    function index(item) {
      if (item.cnpj) byCnpj[item.cnpj] = item;
      if (item.dominio_code) byDom[casefold(item.dominio_code)] = item;
      var k = compact(item.legal_name);
      if (!has(byName, k)) byName[k] = item;
    }
    function votesTop(votes) {
      var best = null, bestN = -1;
      votes.forEach(function (n, k) { if (n > bestN) { best = k; bestN = n; } });
      return best;
    }

    sheets.forEach(function (pair) {
      var sheetName = pair[0], rows = pair[1];
      var rank = sheetRank(sheetName);
      var sheetRegime = regimeFromText(sheetName);
      var currentRegime = detectRegime(sheetName, "OUTROS");
      var header = null, blankRun = 0;

      rows.forEach(function (values, r) {
        var idx = r + 1;
        var nonempty = values.map(normalizeText).filter(Boolean);
        if (!nonempty.length) {
          blankRun++;
          if (blankRun >= 2) header = null;
          return;
        }
        blankRun = 0;

        // ---- cabeçalho?
        var roles = values.map(columnRole);
        var nameCols = [], checkCols = 0, months = 0, roleCells = 0, fieldRoles = [];
        roles.forEach(function (role, col) {
          if (role === "legal_name") nameCols.push(col);
          if (role === "check") checkCols++;
          if (role === "month") months++;
          if (role) roleCells++;
          if (role && role !== "legal_name" && role !== "check" && role !== "month") fieldRoles.push(role);
        });
        var legacyKnown = values.filter(function (v) { var k = normKey(v); return has(HEADER_CANON, k) || has(CHECK_ALIASES, k); }).length;
        var hasNumber = values.some(function (v) { return typeof v === "number"; });
        var labelLike = roleCells >= 2 && roleCells >= 0.4 * nonempty.length && !hasNumber;
        var isHeader = (nameCols.length > 0 && labelLike) || legacyKnown >= 4;
        if (isHeader) {
          var nameCol = nameCols.length ? nameCols[0] : 0;
          var checklist = [];
          values.forEach(function (raw) {
            var key = normKey(raw);
            if (has(CHECK_ALIASES, key)) {
              var label = CHECK_ALIASES[key];
              checklist.push({ id: slug(label), label: label });
            } else if (raw instanceof Date && checklist.length && checklist.some(function (x) { return x.label === "FUNRURAL"; })) {
              checklist.push({ id: "enviado", label: "Enviado" });
            }
          });
          var headerKeys = new Set(values.map(normKey));
          var label = nameCol < values.length ? normalizeText(values[nameCol]) : "";
          var identity = fieldRoles.some(function (x) { return ["cnpj", "dominio_code", "regime", "envio", "contact"].indexOf(x) >= 0; });
          var kind = months >= 6 ? "control" : (!identity && parsed.length && parsed.some(function (p) { return p.source_sheet === sheetName; }) ? "supplement" : "main");
          var sectionRegime = regimeFromText(label) || "";
          var lpKeys = Array.from(headerKeys).some(function (k) { return LP_CHECK_KEYS.has(k); });
          if (sectionRegime) currentRegime = sectionRegime;
          else if (headerKeys.has("simples") && !lpKeys) currentRegime = "SIMPLES NACIONAL";
          else if (lpKeys && currentRegime === "SIMPLES NACIONAL") currentRegime = "OUTROS";
          header = { roles: roles, name_col: nameCol, kind: kind, label: label, checklist: checklist.length >= 8 ? checklist : [], has_part: fieldRoles.indexOf("particularities") >= 0 };
          return;
        }

        var nameRaw = header && header.name_col < values.length ? values[header.name_col] : (values.length ? values[0] : "");
        var name = normalizeText(nameRaw);

        // ---- títulos de seção / linhas soltas
        var joined = nonempty.join(" ");
        if (!header) {
          if (nonempty.length <= 2) {
            currentRegime = detectRegime(joined, currentRegime);
            var f1 = regimeFromText(joined);
            if (f1) currentRegime = f1;
          }
          if (!isCategoryRow(joined)) ignore(sheetName, idx, values, "Fora de uma lista de empresas (sem cabeçalho acima)");
          return;
        }
        var nk = normKey(name);
        if (!name || isCategoryRow(name) || ["empresas", "empresa", "comercio e servico", "comercio", "servicos prestados", "lucro presumido", "lucro real", "cooperativa"].indexOf(nk) >= 0) {
          if (nonempty.length <= 2) {
            currentRegime = detectRegime(joined, currentRegime);
            var f2 = regimeFromText(joined);
            if (f2) currentRegime = f2;
          }
          if (name && !isCategoryRow(name) && nk !== "empresas" && nk !== "empresa") ignore(sheetName, idx, values, "Título de seção");
          else if (!name && nonempty.length > 0 && !isCategoryRow(joined)) ignore(sheetName, idx, values, "Linha sem nome de empresa");
          return;
        }
        if (looksLikeNote(name)) { ignore(sheetName, idx, values, "Anotação / texto livre"); return; }

        function byRole(role) {
          var parts = [];
          header.roles.forEach(function (rr, col) {
            if (rr === role && col < values.length) {
              var t = importText(values[col]);
              if (t && parts.indexOf(t) < 0) parts.push(t);
            }
          });
          return parts.join(" · ");
        }

        // ---- abas de controle mensal: só servem de evidência de regime
        if (header.kind === "control") {
          controlRows.push([sheetName, idx, name, sheetRegime || regimeFromText(header.label)]);
          return;
        }

        // ---- listas complementares
        if (header.kind === "supplement") {
          var cands = fuzzyCandidates(parsed.filter(function (p) { return p.source_sheet === sheetName; }), name);
          var obs = byRole("notes") || byRole("particularities");
          var section = header.label.replace(/^empresas?\s*/i, "").trim() || "Lista complementar";
          if (cands.length === 1) {
            if (obs) {
              var target = cands[0], extra = section + ": " + obs;
              target.particularities = (target.particularities + (target.particularities ? "\n" : "") + extra).trim();
            }
            info.push("“" + name + "” (" + section + ", linha " + idx + ") foi associada a “" + cands[0].legal_name + "”.");
          } else if (cands.length > 1) {
            ignore(sheetName, idx, values, "Lista complementar '" + section + "': nome corresponde a mais de uma empresa");
          } else {
            ignore(sheetName, idx, values, "Aparece só na lista complementar '" + section + "' — cadastre manualmente se for empresa");
          }
          return;
        }

        // ---- empresa
        var domCols = [];
        header.roles.forEach(function (rr, col) { if (rr === "dominio_code" && col < values.length) domCols.push(col); });
        var dominio = domCols.length ? normalizeDomainCode(importText(values[domCols[0]])) : "";
        var cnpj = cleanCnpj(byRole("cnpj"));
        if (!/[A-Za-zÀ-ÿ]/.test(name)) { ignore(sheetName, idx, values, "Nome da empresa não reconhecido"); return; }
        var envio = byRole("envio"), contact = byRole("contact");
        if (contact && normKey(envio).indexOf(normKey(contact)) < 0) envio = envio ? envio + " · Contato: " + contact : "Contato: " + contact;
        var part = byRole("particularities"), notes = byRole("notes");
        if (!header.has_part) { part = notes; notes = ""; }
        var notif = byRole("notifications");
        if (notif) notes = (notes + (notes ? "\n" : "") + "Notificação: " + notif).trim();
        var regime = "";
        var regimeCols = [];
        header.roles.forEach(function (rr, col) { if (rr === "regime") regimeCols.push(col); });
        if (regimeCols.length && regimeCols[0] < values.length) {
          var rk = normKey(values[regimeCols[0]]);
          regime = (has(REGIME_VALUES, rk) ? REGIME_VALUES[rk] : "") || regimeFromText(values[regimeCols[0]]);
        }
        if (!regime) {
          var textRoles = ["legal_name", "envio", "contact", "particularities", "notes", "monthly", "notifications"];
          for (var col = 0; col < values.length; col++) {
            if (textRoles.indexOf(header.roles[col]) >= 0) continue;
            var vk = normKey(values[col]);
            if (has(REGIME_VALUES, vk)) { regime = REGIME_VALUES[vk]; break; }
          }
        }
        var explicit = Boolean(regime) || currentRegime !== "OUTROS";
        regime = regime || currentRegime;
        var items = header.checklist.length ? header.checklist.slice() : checklistForRegime(regime);
        var votes = new Map();
        if (dominio) votes.set(dominio, 1);
        var item = {
          legal_name: name, cnpj: cnpj, dominio_code: dominio, tax_regime: regime, envio: envio,
          particularities: part, notes: notes, checklist: items.length ? items : checklistForRegime(regime),
          source_sheet: sheetName, source_row: idx,
          _regime_explicit: explicit, _header_checklist: header.checklist.length > 0, _sheets: new Set([sheetName]),
          _rank: rank, _dom_votes: votes
        };
        var existing = findExisting(cnpj, dominio, name, sheetName);
        if (existing && !existing._sheets.has(sheetName)) {
          // mesma empresa em outra aba (ex.: abas mensais): combina, a aba mais recente prevalece
          var newer = rank >= existing._rank;
          ["legal_name", "cnpj", "envio", "particularities", "notes"].forEach(function (field) {
            if (item[field] && (newer || !existing[field])) existing[field] = item[field];
          });
          if (dominio) {
            existing._dom_votes.set(dominio, (existing._dom_votes.get(dominio) || 0) + 1);
            existing.dominio_code = votesTop(existing._dom_votes);
          }
          existing._rank = Math.max(existing._rank, rank);
          if (item._regime_explicit || !existing._regime_explicit) {
            existing.tax_regime = item.tax_regime;
            existing._regime_explicit = existing._regime_explicit || item._regime_explicit;
            if (!existing._header_checklist) existing.checklist = checklistForRegime(existing.tax_regime);
          }
          existing._sheets.add(sheetName);
          if (newer) { existing.source_sheet = sheetName; existing.source_row = idx; }
          mergedSheets.add(sheetName);
          index(existing);
          return;
        }
        parsed.push(item);
        index(item);
      });
    });

    // ---- evidência de regime das abas de controle
    controlRows.forEach(function (cr) {
      var sheet = cr[0], idx = cr[1], name = cr[2], regime = cr[3];
      var cands = fuzzyCandidates(parsed, name);
      if (!cands.length) {
        var best = parsed.filter(function (p) { return similarName(name, p.legal_name); });
        cands = best.length === 1 ? best : [];
      }
      if (cands.length === 1 && regime && !cands[0]._regime_explicit) {
        cands[0].tax_regime = regime;
        cands[0]._regime_explicit = true;
        if (!cands[0]._header_checklist) cands[0].checklist = checklistForRegime(regime);
      } else if (!cands.length) {
        ignored.push({ source_sheet: sheet, source_row: idx, text: name, reason: "Aba de controle mensal: empresa não encontrada nas listas" });
      }
    });

    var sheetsWithCompanies = new Set();
    parsed.forEach(function (p) { p._sheets.forEach(function (s) { sheetsWithCompanies.add(s); }); });
    if (mergedSheets.size) {
      info.push("A planilha repete as empresas em " + sheetsWithCompanies.size + " abas (ex.: meses). Elas foram combinadas em " + parsed.length + " empresa(s), com os dados da aba mais recente.");
    }
    parsed.forEach(function (p) {
      var n = p._sheets.size;
      if (n > 1) p.source_sheet = p.source_sheet + " (+" + (n - 1) + " aba" + (n > 2 ? "s" : "") + ")";
      delete p._regime_explicit; delete p._header_checklist; delete p._sheets; delete p._rank; delete p._dom_votes;
    });
    if (!parsed.length) warnings.push("Nenhuma empresa foi reconhecida automaticamente. Verifique os cabeçalhos da planilha.");
    return { companies: parsed, warnings: warnings, ignored: ignored, info: info };
  }

  // Duplicidades dentro da própria planilha (as da carteira são conferidas pelo banco).
  function sheetDuplicates(companies) {
    var seenCnpj = new Set(), seenDom = new Set(), seenName = new Set();
    return companies.map(function (row) {
      var item = Object.assign({}, row);
      var cnpj = cleanCnpj(item.cnpj), dom = normalizeDomainCode(item.dominio_code), nameKey = normKey(item.legal_name);
      var reason = "";
      if (cnpj && !validCnpj(cnpj)) reason = "CNPJ inválido";
      else if (cnpj && seenCnpj.has(cnpj)) reason = "CNPJ repetido na planilha";
      else if (dom && seenDom.has(dom.toLowerCase())) reason = "Código Domínio repetido na planilha";
      else if (!cnpj && !dom && seenName.has(nameKey)) reason = "Nome repetido na planilha";
      item.cnpj = cnpj; item.dominio_code = dom; item._sheet_reason = reason;
      if (cnpj) seenCnpj.add(cnpj);
      if (dom) seenDom.add(dom.toLowerCase());
      if (nameKey) seenName.add(nameKey);
      return item;
    });
  }

  root.HubApuracaoImport = { parse: parseDetailed, sheetDuplicates: sheetDuplicates, _t: { normKey: normKey, seqRatio: seqRatio, validCnpj: validCnpj, checklistForRegime: checklistForRegime } };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HubApuracaoImport;
})(typeof window !== "undefined" ? window : globalThis);
