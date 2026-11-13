/*
 * Carteira de Clientes no HUB — XLSX no navegador.
 * Porte fiel de build_period_xlsx e parse_xlsx_records do servidor da V2 (server.py 2.1.0):
 * mesma planilha exportada (mesmos XML) e mesmas regras de leitura na importação.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CartXlsx = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FIELDS = ["empresa", "cnpj", "dominio", "responsavel_fiscal", "responsavel_contabil", "responsavel_depto_pessoal",
    "regime", "socios", "fone", "email", "honorarios", "situacao", "obs"];
  var FIELD_LABELS = {
    empresa: "Empresa", cnpj: "CNPJ", dominio: "Domínio", responsavel_fiscal: "Responsável Fiscal",
    responsavel_contabil: "Responsável Contábil", responsavel_depto_pessoal: "Responsável Depto Pessoal", regime: "Regime",
    socios: "Sócios", fone: "Fone", email: "E-mail", honorarios: "Honorários", situacao: "Situação", obs: "Obs."
  };
  var MAX_LEN = {};
  FIELDS.forEach(function (k) { MAX_LEN[k] = k === "obs" ? 4000 : 1000; });
  MAX_LEN.empresa = 500; MAX_LEN.cnpj = 40; MAX_LEN.dominio = 80; MAX_LEN.regime = 50;
  MAX_LEN.fone = 100; MAX_LEN.email = 320; MAX_LEN.honorarios = 80; MAX_LEN.situacao = 80;

  var MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  var DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  var PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
  var MAX_BYTES = 10000000, MAX_ROWS = 5000;

  function ApiError(status, message) { var e = new Error(message); e.status = status; return e; }

  function colName(index) {
    var result = "", value = Number(index);
    while (value > 0) { var rem = (value - 1) % 26; value = Math.floor((value - 1) / 26); result = String.fromCharCode(65 + rem) + result; }
    return result;
  }
  function colIndex(ref) {
    var m = /^([A-Za-z]+)/.exec(String(ref || ""));
    if (!m) return 0;
    var result = 0, up = m[1].toUpperCase();
    for (var i = 0; i < up.length; i++) result = result * 26 + (up.charCodeAt(i) - 64);
    return result;
  }
  // xml.sax.saxutils.escape: só & < >
  function escapeXml(s) { return s.replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;"); }
  function xmlText(value) {
    var raw = value == null ? "" : String(value), out = "";
    for (var ch of raw) {
      var c = ch.codePointAt(0);
      if (ch === "\t" || ch === "\n" || ch === "\r" || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd)) out += ch;
    }
    return escapeXml(out);
  }
  function pyLen(s) { var n = 0; for (var _ of s) n++; return n; } // eslint-disable-line no-unused-vars

  function cleanField(field, value) {
    if (FIELDS.indexOf(field) < 0) throw ApiError(400, "Campo não permitido: " + field);
    value = value == null ? "" : String(value);
    if (pyLen(value) > MAX_LEN[field]) throw ApiError(400, "Valor excede o limite do campo " + FIELD_LABELS[field] + ".");
    return value;
  }

  // ------------------------------------------------------------------ exportação (build_period_xlsx)
  function buildParts(records, periodKey) {
    var headers = FIELDS.map(function (f) { return FIELD_LABELS[f]; });
    var rows = [headers].concat(records.map(function (row) { return FIELDS.map(function (f) { return String(row[f] || ""); }); }));
    var widths = [38, 18, 12, 22, 22, 24, 13, 30, 17, 30, 17, 16, 42];
    var lastRow = Math.max(1, rows.length), lastCol = colName(headers.length);
    var sheetRows = rows.map(function (values, i) {
      var r = i + 1;
      var cells = values.map(function (value, j) {
        var ref = colName(j + 1) + r, style = r === 1 ? ' s="1"' : "";
        return '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + xmlText(value) + "</t></is></c>";
      });
      return '<row r="' + r + '">' + cells.join("") + "</row>";
    });
    var colsXml = widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join("");
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="' + MAIN_NS + '">\n' +
      '  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>\n' +
      "  <cols>" + colsXml + "</cols>\n  <sheetData>" + sheetRows.join("") + "</sheetData>\n" +
      '  <autoFilter ref="A1:' + lastCol + lastRow + '"/>\n</worksheet>';
    var sheetName = /^\d{4}-\d{2}$/.test(periodKey || "") ? "Carteira " + periodKey.slice(5, 7) + "-" + periodKey.slice(0, 4) : "Carteira";
    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="' + MAIN_NS + '" xmlns:r="' + DOC_REL_NS + '">\n' +
      '  <sheets><sheet name="' + xmlText(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>\n</workbook>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="' + MAIN_NS + '">\n' +
      '  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>\n' +
      '  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>\n' +
      "  <borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\n" +
      '  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n' +
      '  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>\n' +
      '  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\n</styleSheet>';
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '  <Default Extension="xml" ContentType="application/xml"/>\n' +
      '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n' +
      '  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n' +
      '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n</Types>';
    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n</Relationships>';
    var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n' +
      '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n</Relationships>';
    return [["[Content_Types].xml", contentTypes], ["_rels/.rels", rootRels], ["xl/workbook.xml", workbook],
      ["xl/_rels/workbook.xml.rels", workbookRels], ["xl/styles.xml", styles], ["xl/worksheets/sheet1.xml", sheet]];
  }

  function buildPeriodXlsx(JSZip, records, periodKey) {
    var zip = new JSZip();
    buildParts(records, periodKey).forEach(function (p) { zip.file(p[0], p[1]); });
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", createFolders: false });
  }

  // ------------------------------------------------------------------ importação (parse_xlsx_records)
  function normalizeHeader(value) {
    var raw = String(value == null ? "" : value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
    return raw.replace(/[^a-z0-9]+/g, "");
  }
  function headerAliases() {
    var aliases = {};
    FIELDS.forEach(function (f) { aliases[normalizeHeader(FIELD_LABELS[f])] = f; aliases[normalizeHeader(f)] = f; });
    var extra = { responsavelfiscal: "responsavel_fiscal", responsavelcontabil: "responsavel_contabil",
      responsaveldeptopessoal: "responsavel_depto_pessoal", responsaveldepartamentopessoal: "responsavel_depto_pessoal",
      email: "email", observacao: "obs", observacoes: "obs", obs: "obs" };
    Object.keys(extra).forEach(function (k) { aliases[k] = extra[k]; });
    return aliases;
  }
  function children(node, name) {
    var out = [];
    for (var c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.namespaceURI === MAIN_NS && c.localName === name) out.push(c);
    return out;
  }
  function elemText(node) { // ElementTree .text: texto antes do primeiro filho
    var s = "";
    for (var c = node.firstChild; c; c = c.nextSibling) { if (c.nodeType === 1) break; if (c.nodeType === 3 || c.nodeType === 4) s += c.nodeValue; }
    return s;
  }
  function allText(node) { // ''.join(t.text for t in node.iter('t'))
    var out = "", list = node.getElementsByTagNameNS(MAIN_NS, "t");
    if (node.namespaceURI === MAIN_NS && node.localName === "t") out += elemText(node);
    for (var i = 0; i < list.length; i++) out += elemText(list[i]);
    return out;
  }
  function parseXml(DOMParserImpl, text) {
    var doc = new DOMParserImpl().parseFromString(text, "application/xml");
    var err = doc.getElementsByTagName("parsererror")[0];
    if (err) throw new Error(err.textContent.trim().split("\n")[0]);
    return doc;
  }
  function cellValue(cell, shared) {
    var type = cell.getAttribute("t") || "";
    if (type === "inlineStr") {
      var inline = children(cell, "is")[0];
      return inline ? allText(inline) : "";
    }
    var v = children(cell, "v")[0];
    var raw = v ? elemText(v) : "";
    if (type === "s") {
      if (!/^\s*[+-]?\d+\s*$/.test(raw)) return "";
      var index = parseInt(raw, 10);
      return index >= 0 && index < shared.length ? shared[index] : "";
    }
    if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
    return raw;
  }

  async function parseXlsxRecords(JSZip, DOMParserImpl, bytes) {
    if (!bytes || !bytes.length || bytes.length > MAX_BYTES) throw ApiError(400, "Arquivo XLSX vazio ou maior que 10 MB.");
    var zip;
    try { zip = await JSZip.loadAsync(bytes); } catch (e) { throw ApiError(400, "Arquivo XLSX inválido."); }
    var entries = Object.keys(zip.files).map(function (k) { return zip.files[k]; });
    var total = entries.reduce(function (s, f) { return s + ((f._data && f._data.uncompressedSize) || 0); }, 0);
    if (entries.length > 200 || total > 60000000) throw ApiError(400, "Arquivo XLSX excede os limites permitidos.");
    var names = new Set(Object.keys(zip.files));
    if (!names.has("xl/workbook.xml") || !names.has("xl/_rels/workbook.xml.rels")) throw ApiError(400, "Estrutura XLSX não reconhecida.");
    var sheet;
    try {
      var workbook = parseXml(DOMParserImpl, await zip.file("xl/workbook.xml").async("string"));
      var firstSheet = workbook.getElementsByTagNameNS(MAIN_NS, "sheet")[0];
      if (!firstSheet) throw ApiError(400, "O XLSX não contém planilha.");
      var relId = firstSheet.getAttributeNS(DOC_REL_NS, "id");
      var rels = parseXml(DOMParserImpl, await zip.file("xl/_rels/workbook.xml.rels").async("string"));
      var target = null, list = rels.documentElement.childNodes;
      for (var i = 0; i < list.length; i++) {
        var rel = list[i];
        if (rel.nodeType === 1 && rel.namespaceURI === PKG_REL_NS && rel.localName === "Relationship" && rel.getAttribute("Id") === relId) { target = rel.getAttribute("Target"); break; }
      }
      if (!target) throw ApiError(400, "Não foi possível localizar a primeira planilha do XLSX.");
      var sheetPath;
      if (target.charAt(0) === "/") sheetPath = target.replace(/^\/+/, "");
      else if (target.indexOf("xl/") === 0) sheetPath = target;
      else sheetPath = normPath("xl/" + target);
      if (!names.has(sheetPath)) throw ApiError(400, "Planilha principal ausente no XLSX.");
      sheet = parseXml(DOMParserImpl, await zip.file(sheetPath).async("string"));
    } catch (e) {
      if (e.status) throw e;
      throw ApiError(400, "Falha ao ler estrutura XLSX: " + (e.message || e));
    }
    var shared = [];
    if (names.has("xl/sharedStrings.xml")) {
      var sst = parseXml(DOMParserImpl, await zip.file("xl/sharedStrings.xml").async("string"));
      children(sst.documentElement, "si").forEach(function (si) { shared.push(allText(si)); });
    }
    var matrix = [];
    var rowsEl = sheet.getElementsByTagNameNS(MAIN_NS, "row");
    for (var r = 0; r < rowsEl.length; r++) {
      var values = {}, next = 1, max = 0, any = false;
      children(rowsEl[r], "c").forEach(function (cell) {
        var col = colIndex(cell.getAttribute("r") || "") || next;
        values[col] = cellValue(cell, shared); any = true;
        next = col + 1;
        if (col > max) max = col;
      });
      var row = [];
      if (any) for (var c = 1; c <= max; c++) row.push(values[c] !== undefined ? values[c] : "");
      matrix.push(row);
    }
    var blank = function (row) { return !row.some(function (v) { return String(v || "").trim(); }); };
    var headerIndex = -1;
    for (var h = 0; h < Math.min(20, matrix.length); h++) if (!blank(matrix[h])) { headerIndex = h; break; }
    if (headerIndex < 0) throw ApiError(400, "O XLSX está vazio.");
    var headers = matrix[headerIndex], aliases = headerAliases(), columnMap = new Map(), duplicates = [];
    headers.forEach(function (header, idx) {
      var field = aliases[normalizeHeader(header)];
      if (!field) return;
      if (Array.from(columnMap.values()).indexOf(field) >= 0) duplicates.push(FIELD_LABELS[field]);
      columnMap.set(idx, field);
    });
    if (duplicates.length) throw ApiError(400, "Cabeçalhos duplicados no XLSX: " + Array.from(new Set(duplicates)).sort().join(", ") + ".");
    var mapped = Array.from(columnMap.values());
    var missing = FIELDS.filter(function (f) { return mapped.indexOf(f) < 0; }).map(function (f) { return FIELD_LABELS[f]; });
    if (missing.length) throw ApiError(400, "O XLSX precisa conter todas as colunas do app. Faltam: " + missing.join(", ") + ".");
    var imported = [];
    for (var x = headerIndex + 1; x < matrix.length; x++) {
      var mrow = matrix[x], excelIdx = x + 1;
      if (blank(mrow)) continue;
      var rec = {};
      FIELDS.forEach(function (f) { rec[f] = ""; });
      columnMap.forEach(function (field, colIdx) { rec[field] = cleanField(field, colIdx < mrow.length ? mrow[colIdx] : ""); });
      if (!rec.empresa.trim()) throw ApiError(400, "Linha " + excelIdx + ": a coluna Empresa não pode ficar vazia.");
      imported.push(rec);
      if (imported.length > MAX_ROWS) throw ApiError(400, "O XLSX excede o limite de " + MAX_ROWS + " empresas.");
    }
    if (!imported.length) throw ApiError(400, "O XLSX não contém empresas para importar.");
    return imported;
  }
  function normPath(p) {
    var out = [];
    p.split("/").forEach(function (part) { if (!part || part === ".") return; if (part === "..") out.pop(); else out.push(part); });
    return out.join("/");
  }

  return { FIELDS: FIELDS, FIELD_LABELS: FIELD_LABELS, buildParts: buildParts, buildPeriodXlsx: buildPeriodXlsx,
    parseXlsxRecords: parseXlsxRecords, cleanField: cleanField };
});
