/*
 * Controle de Apuração no HUB — exportação XLSX da competência, gerada no navegador.
 * Tradução de build_monthly_export_xlsx do servidor antigo: mesmas abas, colunas, cores,
 * comentários das notas de célula, filtros, painéis congelados e nome do arquivo.
 * Os dados vêm prontos do banco (apur_export_data); a planilha é montada com ExcelJS.
 *
 * Uso: HubApuracaoExport.build(ExcelJS, dados) -> Promise<{ blob, filename }>
 */
(function (root) {
  "use strict";

  var STATUS = { PENDING: "Pendente", DONE: "Concluído", ALERT: "Alerta", NA: "N/A" };
  var MARK = { YELLOW: "Amarelo", ORANGE: "Laranja", GREEN: "Verde" };
  var NOTE_TYPES = { MESSAGE: "Recado", DIRECTIVE: "Determinação", RECORD: "Registro" };
  var BRAND = "173F52", WHITE = "FFFFFF", INK = "21333D", MUTED = "66757D";
  var FILLS = { DONE: "DFF2E7", ALERT: "FFE1E1", PENDING: "FFF3D6", NA: "E7EAEC" };
  var MARK_FILLS = { YELLOW: "FFF2A8", ORANGE: "FFD0A1", GREEN: "DDF2E3" };

  function txt(v) { return v === null || v === undefined ? "" : String(v); }
  function normalizeText(v) { return txt(v).trim().replace(/\s+/g, " "); }
  // Evita que conteúdo iniciado por =, +, - ou @ vire fórmula no Excel.
  function safe(v) { var t = txt(v); return "=+-@".indexOf(t.charAt(0)) >= 0 && t ? "'" + t : t; }
  function fill(hex) { return { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } }; }
  function font(opts) { var f = { bold: !!opts.bold }; if (opts.color) f.color = { argb: "FF" + opts.color }; if (opts.size) f.size = opts.size; return f; }
  function colLetter(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function checklistOf(co) { return (Array.isArray(co.checklist) ? co.checklist : []).filter(function (x) { return x && typeof x === "object" && x.id; }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function stamp(d) {
    var off = -d.getTimezoneOffset(), sign = off >= 0 ? "+" : "-", a = Math.abs(off);
    return {
      display: pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + " " + sign + pad(Math.floor(a / 60)) + pad(a % 60),
      file: d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
    };
  }
  function header(ws, row, labels, opts) {
    labels.forEach(function (h, i) {
      var cell = ws.getCell(row, i + 1);
      cell.value = opts && opts.safe ? safe(h) : h;
      cell.font = font({ bold: true, color: WHITE });
      cell.fill = fill(BRAND);
      if (opts && opts.align) cell.alignment = opts.align;
    });
  }
  function put(ws, r, c, v) {
    var cell = ws.getCell(r, c);
    cell.value = typeof v === "number" ? v : safe(v);
    cell.alignment = { vertical: "top", wrapText: true };
    return cell;
  }

  async function build(ExcelJS, d, now) {
    var exported = now || new Date();
    var st = stamp(exported);
    var comp = d.competence;
    var companies = d.companies || [];
    var ids = companies.map(function (c) { return c.id; });

    var checkMap = {}, monthlyMap = {}, markMap = {}, adminBy = {}, docsBy = {};
    (d.checks || []).forEach(function (r) { checkMap[r.company_id + "|" + r.item_id] = r; });
    (d.monthly || []).forEach(function (r) { monthlyMap[r.company_id] = r; });
    (d.marks || []).forEach(function (r) { markMap[r.company_id + "|" + r.item_id] = r; });
    ids.forEach(function (id) { adminBy[id] = []; docsBy[id] = []; });
    (d.admin_notes || []).forEach(function (r) { (adminBy[r.company_id] = adminBy[r.company_id] || []).push(r); });
    (d.documents || []).forEach(function (r) { (docsBy[r.company_id] = docsBy[r.company_id] || []).push(r); });

    // União dos itens mantendo a ordem em que aparecem nas carteiras.
    var itemDefs = [], seen = {};
    companies.forEach(function (co) {
      checklistOf(co).forEach(function (item) {
        var iid = String(item.id);
        if (!seen[iid]) { seen[iid] = true; itemDefs.push([iid, normalizeText(item.label) || iid]); }
      });
    });

    var wb = new ExcelJS.Workbook();
    wb.creator = "HUB Depto Tributário";
    var ws = wb.addWorksheet("Checklist", { views: [{ state: "frozen", xSplit: 0, ySplit: 8, topLeftCell: "A9", showGridLines: false }] });
    var scopeLabel = d.owner_label;
    var title = "H. Teixeira — Planilha de Controle de Apuração Tributária";
    var fixed = ["Responsável", "Empresa", "CNPJ", "Domínio", "Regime", "Envio", "Particularidades", "Observações cadastrais", "Pendência mensal", "Observação da competência", "Situação", "Progresso", "Grifo da linha"];
    var tail = ["Grifos de itens", "Notas ADM", "Documentos", "Última alteração"];
    var headers = fixed.concat(itemDefs.map(function (x) { return x[1]; })).concat(tail);
    var endCol = headers.length;
    ws.mergeCells(1, 1, 1, endCol);
    var t = ws.getCell(1, 1);
    t.value = title; t.font = font({ bold: true, color: WHITE, size: 16 }); t.fill = fill(BRAND); t.alignment = { horizontal: "left" };
    [["Competência", comp], ["Data/hora da exportação", st.display], ["Escopo/Responsável", scopeLabel], ["Exportado por", d.exported_by], ["Empresas", companies.length]]
      .forEach(function (m, i) {
        var a = ws.getCell(i + 2, 1); a.value = m[0]; a.font = font({ bold: true, color: MUTED });
        ws.getCell(i + 2, 2).value = safe(m[1]);
      });
    var headerRow = 8;
    header(ws, headerRow, headers, { safe: true, align: { horizontal: "center", vertical: "middle", wrapText: true } });
    ws.getRow(headerRow).height = 32;
    ws.autoFilter = "A" + headerRow + ":" + colLetter(endCol) + (headerRow + companies.length);

    var totalDone = 0, totalAlert = 0, totalPending = 0;
    companies.forEach(function (co, k) {
      var ri = headerRow + 1 + k;
      var checklist = checklistOf(co), present = {};
      checklist.forEach(function (x) { present[String(x.id)] = true; });
      var mn = monthlyMap[co.id], metric = co.metrics || { overall: "PENDING", progress: 0 };
      var overallLabel = { DONE: "Concluída", ALERT: "Com alerta/pendência", PENDING: "Pendente" }[metric.overall];
      if (metric.overall === "DONE") totalDone++; else if (metric.overall === "ALERT") totalAlert++; else totalPending++;
      var rowmark = markMap[co.id + "|__ROW__"];
      var itemMarks = [];
      itemDefs.forEach(function (x) { var mr = markMap[co.id + "|" + x[0]]; if (mr) itemMarks.push(x[1] + ": " + (MARK[mr.color] || mr.color)); });
      var notesText = (adminBy[co.id] || []).map(function (n) {
        var status = n.active ? "Ativa" : "Arquivada", target = n.item_label || "Empresa / competência", when = txt(n.created_at).slice(0, 19).replace("T", " ");
        return (NOTE_TYPES[n.note_type] || n.note_type) + " [" + target + "] — " + n.note + " — " + (n.created_by_name || "") + " — " + when + " — " + status;
      });
      var docsText = (docsBy[co.id] || []).map(function (x) { return x.original_name + " (" + (x.competence || "Geral") + ")"; }).join("; ");
      var changed = [co.updated_at, mn ? mn.updated_at : null];
      Object.keys(checkMap).forEach(function (key) { if (key.indexOf(co.id + "|") === 0) changed.push(checkMap[key].updated_at); });
      Object.keys(markMap).forEach(function (key) { if (key.indexOf(co.id + "|") === 0) changed.push(markMap[key].updated_at); });
      (adminBy[co.id] || []).forEach(function (n) { changed.push(n.created_at); });
      var last = changed.filter(Boolean).sort().pop() || "";
      var values = [co.owner_name, co.legal_name, co.cnpj || "", co.dominio_code || "", co.tax_regime || "", co.envio || "", co.particularities || "", co.notes || "",
        mn && mn.is_pending ? "Sim" : "Não", mn ? mn.note : "", overallLabel, metric.progress / 100, rowmark ? (MARK[rowmark.color] || "") : ""];
      itemDefs.forEach(function (x) {
        if (!present[x[0]]) values.push("—");
        else { var r = checkMap[co.id + "|" + x[0]]; values.push(r ? (STATUS[r.status] || "Pendente") : "Pendente"); }
      });
      values.push(itemMarks.join("; "), notesText.join("\n"), docsText, last);
      values.forEach(function (v, i) { put(ws, ri, i + 1, v); });
      ws.getCell(ri, 12).numFmt = "0%";
      if (FILLS[metric.overall]) ws.getCell(ri, 11).fill = fill(FILLS[metric.overall]);
      var startCheck = fixed.length + 1;
      itemDefs.forEach(function (x, off) {
        var cell = ws.getCell(ri, startCheck + off), r = checkMap[co.id + "|" + x[0]];
        var status = r ? r.status : (present[x[0]] ? "PENDING" : null);
        if (status && FILLS[status]) cell.fill = fill(FILLS[status]);
        if (r && normalizeText(r.note)) {   // nota da célula vira comentário no XLSX
          cell.note = safe(r.note);
        }
      });
      if (rowmark && MARK_FILLS[rowmark.color]) {
        for (var ci = 1; ci <= Math.min(13, endCol); ci++) ws.getCell(ri, ci).fill = fill(MARK_FILLS[rowmark.color]);
      }
      ws.getRow(ri).height = 44;
    });

    var widths = { 1: 20, 2: 34, 3: 18, 4: 12, 5: 18, 6: 15, 7: 34, 8: 34, 9: 15, 10: 36, 11: 20, 12: 12, 13: 14 };
    for (var ci2 = 1; ci2 <= endCol; ci2++) {
      var w;
      if (widths[ci2]) w = widths[ci2];
      else if (ci2 <= fixed.length + itemDefs.length) w = 18;
      else w = ({})[ci2] || (ci2 === endCol - 3 ? 34 : ci2 === endCol - 2 ? 48 : ci2 === endCol - 1 ? 40 : ci2 === endCol ? 24 : 22);
      ws.getColumn(ci2).width = w;
    }
    [["Concluídas", totalDone], ["Alertas/pend.", totalAlert], ["Pendentes", totalPending]].forEach(function (x, i) {
      var a = ws.getCell(i + 2, endCol - 1); a.value = x[0]; a.font = font({ bold: true, color: MUTED });
      var b = ws.getCell(i + 2, endCol); b.value = x[1]; b.font = font({ bold: true, color: INK, size: 13 });
    });

    // Detalhe item a item: status, notas técnicas, grifos e auditoria.
    var det = wb.addWorksheet("Itens detalhados", { views: [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2", showGridLines: false }] });
    header(det, 1, ["Responsável", "Empresa", "Competência", "Item", "Status", "Nota do item", "Grifo", "Atualizado por", "Última alteração"], { align: { wrapText: true } });
    var rr = 2;
    companies.forEach(function (co) {
      checklistOf(co).forEach(function (item) {
        var iid = String(item.id), label = normalizeText(item.label) || iid, r = checkMap[co.id + "|" + iid], m = markMap[co.id + "|" + iid];
        var status = r ? r.status : "PENDING";
        [co.owner_name, co.legal_name, comp, label, STATUS[status] || status, r ? r.note : "", m ? (MARK[m.color] || "") : "", r ? r.updated_by_name : "", r ? r.updated_at : ""]
          .forEach(function (v, i) { put(det, rr, i + 1, txt(v)); });
        if (FILLS[status]) det.getCell(rr, 5).fill = fill(FILLS[status]);
        rr++;
      });
    });
    det.autoFilter = "A1:I" + Math.max(1, rr - 1);
    [20, 34, 13, 28, 16, 40, 12, 22, 24].forEach(function (w2, i) { det.getColumn(i + 1).width = w2; });

    var an = wb.addWorksheet("Notas ADM", { views: [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2", showGridLines: false }] });
    header(an, 1, ["Responsável", "Empresa", "Competência", "Item/alvo", "Tipo", "Nota", "ADM autor", "Criada em", "Status", "Arquivada por", "Arquivada em"]);
    (d.admin_notes || []).forEach(function (n, i) {
      [n.owner_name || "", n.company_name || "", n.competence, n.item_label || "Empresa / competência", NOTE_TYPES[n.note_type] || n.note_type, n.note,
        n.created_by_name || "", n.created_at || "", n.active ? "Ativa" : "Arquivada", n.archived_by_name || "", n.archived_at || ""]
        .forEach(function (v, j) { put(an, i + 2, j + 1, txt(v)); });
    });
    an.autoFilter = "A1:K" + Math.max(1, (d.admin_notes || []).length + 1);
    [20, 34, 13, 26, 16, 52, 22, 24, 12, 22, 24].forEach(function (w3, i) { an.getColumn(i + 1).width = w3; });

    var ds = wb.addWorksheet("Documentos", { views: [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2", showGridLines: false }] });
    header(ds, 1, ["Responsável", "Empresa", "Competência do arquivo", "Nome do arquivo", "Descrição", "Tipo MIME", "Tamanho (bytes)", "SHA-256", "Enviado por", "Data do envio"]);
    (d.documents || []).forEach(function (x, i) {
      [x.owner_name || "", x.company_name || "", x.competence || "Geral", x.original_name, x.note || "", x.mime_type || "", Number(x.size_bytes) || 0, x.sha256, x.uploaded_by_name || "", x.created_at]
        .forEach(function (v, j) { put(ds, i + 2, j + 1, typeof v === "number" ? v : txt(v)); });
    });
    ds.autoFilter = "A1:J" + Math.max(1, (d.documents || []).length + 1);
    [20, 34, 15, 40, 42, 24, 16, 68, 22, 24].forEach(function (w4, i) { ds.getColumn(i + 1).width = w4; });

    var als = wb.addWorksheet("Alertas gerais", { views: [{ showGridLines: false }] });
    header(als, 1, ["Severidade", "Título", "Mensagem", "Público", "Início", "Fim", "Fonte", "Negrito", "Grifo amarelo"]);
    (d.alerts || []).forEach(function (a, i) {
      [a.severity || "", a.title || "", a.message || "", a.audience_label || "", a.starts_on || "", a.ends_on || "", (a.font_size || 15) + " px", a.is_bold ? "Sim" : "Não", a.highlight_yellow ? "Sim" : "Não"]
        .forEach(function (v, j) { put(als, i + 2, j + 1, txt(v)); });
    });
    [14, 34, 72, 42, 14, 14, 12, 12, 16].forEach(function (w5, i) { als.getColumn(i + 1).width = w5; });

    wb.eachSheet(function (sheet) { sheet.pageSetup = Object.assign({}, sheet.pageSetup, { fitToPage: true, fitToWidth: 1, fitToHeight: 0 }); });

    var buffer = await wb.xlsx.writeBuffer();
    var slug = String(scopeLabel || "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "carteira";
    return {
      buffer: buffer,
      filename: "Controle_Fiscal_" + comp + "_" + slug + "_" + st.file + ".xlsx"
    };
  }

  root.HubApuracaoExport = { build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HubApuracaoExport;
})(typeof window !== "undefined" ? window : globalThis);
