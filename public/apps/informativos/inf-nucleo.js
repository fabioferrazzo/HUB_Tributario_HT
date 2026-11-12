/*
 * Informativos no HUB — regras que no Infos HT ficavam no programa local (app.py, Release 21.14):
 * limpeza do conteúdo (sanitize_fragment / sanitize_model / sanitize_snapshot), numeração
 * ("nº NN/AA") e a matriz do Template institucional. Mesmo comportamento do original.
 * Funciona no navegador (window.InfNucleo) e no Node (testes de paridade).
 */
(function (raiz) {
  "use strict";

  var ALLOWED_TAGS = { strong: 1, b: 1, em: 1, i: 1, br: 1, span: 1, sup: 1, sub: 1, a: 1, mark: 1, font: 1 };
  var DANGEROUS = { script: 1, style: 1, iframe: 1, object: 1, embed: 1, svg: 1, math: 1 };
  var RAWTEXT = { script: 1, style: 1 };
  var SPAN_CLASSES = { "ht-font-up": 1, "ht-font-down": 1, "ht-font-normal": 1, "ht-align-left": 1, "ht-align-center": 1, "ht-align-right": 1, "ht-align-justify": 1 };
  var MAX_EDITABLE_FIELDS = 3500;
  var MAX_MODEL_BLOCKS = 3000;
  var DEFAULT_TEMPLATE_PROFILE = "hti-informativos-v1";
  var TEMPLATE_SOURCE_TYPE = "template";
  var IMPORT_SOURCE_TYPES = { docx: 1, pdf: 1, html: 1 };

  // ------------------------------------------------------------------ entidades HTML
  var ENT = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ordm: "º", ordf: "ª", deg: "°",
    ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’",
    ldquo: "“", rdquo: "”", bull: "•", middot: "·", sect: "§", para: "¶", copy: "©",
    reg: "®", trade: "™", euro: "€", cent: "¢", pound: "£", times: "×", divide: "÷",
    plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³",
    shy: "­", iexcl: "¡", iquest: "¿", micro: "µ", ensp: " ", emsp: " ", thinsp: " ",
    zwj: "‍", zwnj: "‌", lrm: "‎", rlm: "‏", rarr: "→", larr: "←", uarr: "↑", darr: "↓",
    harr: "↔", check: "✓", le: "≤", ge: "≥", ne: "≠", asymp: "≈", infin: "∞", minus: "−"
  };
  var ACENTOS = "AaEeIiOoUu";
  [["acute", "ÁáÉéÍíÓóÚú"], ["grave", "ÀàÈèÌìÒòÙù"],
   ["circ", "ÂâÊêÎîÔôÛû"], ["uml", "ÄäËëÏïÖöÜü"]]
    .forEach(function (par) { for (var i = 0; i < 10; i++) ENT[ACENTOS[i] + par[0]] = par[1][i]; });
  Object.assign(ENT, { Atilde: "Ã", atilde: "ã", Otilde: "Õ", otilde: "õ", Ntilde: "Ñ", ntilde: "ñ",
    Ccedil: "Ç", ccedil: "ç", szlig: "ß", Aring: "Å", aring: "å", AElig: "Æ", aelig: "æ", Oslash: "Ø", oslash: "ø", yuml: "ÿ" });

  var decodeBrowser = null;
  function decodeEntidade(nome) {
    if (Object.prototype.hasOwnProperty.call(ENT, nome)) return ENT[nome];
    if (typeof document !== "undefined") {
      decodeBrowser = decodeBrowser || document.createElement("textarea");
      decodeBrowser.innerHTML = "&" + nome + ";";
      var v = decodeBrowser.value;
      if (v !== "&" + nome + ";") return v;
    }
    return null;
  }
  function unescapeHtml(s) {
    return String(s).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]{1,31});?/g, function (m, g) {
      if (g[0] === "#") {
        var cp = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        if (!(cp > 0) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
        if (cp >= 0x80 && cp <= 0x9f) {
          var w1252 = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030,
            0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013,
            0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178 };
          if (w1252[cp]) cp = w1252[cp];
        }
        return String.fromCodePoint(cp);
      }
      var d = decodeEntidade(g);
      return d === null ? m : d;
    });
  }
  function escTexto(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escAttr(s) { return escTexto(s).replace(/"/g, "&quot;").replace(/'/g, "&#x27;"); }

  // ------------------------------------------------------------------ leitor de fragmentos (como o HTMLParser do Python)
  function lerAtributos(txt) {
    var attrs = [];
    var re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    var m;
    while ((m = re.exec(txt))) {
      var v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : null;
      attrs.push([m[1].toLowerCase(), v === null ? "" : unescapeHtml(v)]);
    }
    return attrs;
  }
  function attrMap(attrs) { var o = {}; attrs.forEach(function (a) { o[a[0]] = a[1]; }); return o; }

  function sanitizeFragment(value) {
    if (typeof value !== "string") return "";
    var s = value.slice(0, 30000);
    var parts = [], skip = 0, open = [];
    var i = 0, n = s.length, texto = "";
    function flushTexto() { if (texto) { if (!skip) parts.push(escTexto(unescapeHtml(texto))); texto = ""; } }
    function inicio(tag, attrs) {
      if (DANGEROUS[tag]) { skip++; return; }
      if (skip || !ALLOWED_TAGS[tag]) return;
      if (tag === "br") { parts.push("<br>"); return; }
      var real = tag, v;
      if (tag === "font") {
        v = attrMap(attrs);
        var size = String(v.size || "").trim();
        if (/^[1-7]$/.test(size)) parts.push('<font size="' + size + '">');
        else { real = "span"; parts.push("<span>"); }
      } else if (tag === "span") {
        v = attrMap(attrs);
        var cls = String(v["class"] || "").split(/\s+/).filter(function (c) { return SPAN_CLASSES[c]; });
        parts.push(cls.length ? '<span class="' + escAttr(cls.join(" ")) + '">' : "<span>");
      } else if (tag === "a") {
        v = attrMap(attrs);
        var href = String(v.href || "").trim().slice(0, 2048);
        var mm = /^([A-Za-z][A-Za-z0-9+.\-]*):/.exec(href);
        var scheme = mm ? mm[1].toLowerCase() : "";
        if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel") {
          parts.push('<a href="' + escAttr(href) + '" rel="noopener noreferrer">');
        } else { real = "span"; parts.push("<span>"); }
      } else {
        parts.push("<" + tag + ">");
      }
      open.push([tag, real]);
    }
    function fim(tag) {
      if (DANGEROUS[tag] && skip) { skip--; return; }
      if (skip || !ALLOWED_TAGS[tag] || tag === "br") return;
      var real = tag;
      for (var k = open.length - 1; k >= 0; k--) {
        if (open[k][0] === tag) { real = open[k][1]; open.splice(k, 1); break; }
      }
      parts.push("</" + real + ">");
    }
    while (i < n) {
      var c = s[i];
      if (c !== "<") { texto += c; i++; continue; }
      if (s.startsWith("<!--", i)) {
        flushTexto();
        var fc = s.indexOf("-->", i + 4);
        i = fc < 0 ? n : fc + 3;
        continue;
      }
      if (s[i + 1] === "!" || s[i + 1] === "?") {
        flushTexto();
        var fx = s.indexOf(">", i + 2);
        i = fx < 0 ? n : fx + 1;
        continue;
      }
      var mEnd = /^<\/([A-Za-z][^\s\/>]*)[^>]*>/.exec(s.slice(i, i + 300));
      if (mEnd) { flushTexto(); fim(mEnd[1].toLowerCase()); i += mEnd[0].length; continue; }
      var mStart = /^<([A-Za-z][^\s\/>]*)((?:\s*(?:"[^"]*"|'[^']*'|[^'">])*?)?)(\/?)>/.exec(s.slice(i, i + 4000));
      if (mStart) {
        flushTexto();
        var tag = mStart[1].toLowerCase();
        var attrTxt = mStart[2] || "";
        var autoFecha = mStart[3] === "/" || /\/\s*$/.test(attrTxt);
        inicio(tag, lerAtributos(attrTxt.replace(/\/\s*$/, "")));
        if (autoFecha && ALLOWED_TAGS[tag] && tag !== "br" && !skip) fim(tag);
        i += mStart[0].length;
        if (RAWTEXT[tag]) {
          var re = new RegExp("</" + tag + "\\s*>", "i");
          var resto = s.slice(i);
          var mm2 = re.exec(resto);
          if (mm2) { i += mm2.index + mm2[0].length; if (skip) skip--; }
          else i = n;
        }
        continue;
      }
      // Marca incompleta no fim (sem ">"): o leitor do Python descarta o resto
      if (/[A-Za-z\/!?]/.test(s[i + 1] || "") && s.indexOf(">", i) < 0) break;
      texto += c;
      i++;
    }
    flushTexto();
    return parts.join("");
  }

  // ------------------------------------------------------------------ modelo documental
  function validModelKey(value) {
    var v = String(value == null ? "" : value);
    return !!v && v.length <= 120 && /^[\p{L}\p{N}:_-]+$/u.test(v) && /[\p{L}\p{N}]/u.test(v);
  }
  function toInt(v, padrao) {
    if (typeof v === "boolean") return v ? 1 : 0;
    var n = typeof v === "number" ? v : String(v == null ? "" : v).trim() === "" ? NaN : Number(v);
    if (!Number.isFinite(n)) return padrao;
    return Math.trunc(n);
  }
  function round(v, d) { var f = Math.pow(10, d); return Math.round(v * f) / f; }
  function sanitizeImageRef(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var asset = String(raw.asset_id == null ? "" : raw.asset_id);
    if (!validModelKey(asset)) return null;
    var img = { asset_id: asset, alt: String(raw.alt == null ? "" : raw.alt).slice(0, 300) };
    ["width_in", "height_in"].forEach(function (f) {
      var v = Number(raw[f]);
      if (raw[f] !== null && raw[f] !== undefined && raw[f] !== "" && Number.isFinite(v) && v > 0 && v <= 20) img[f] = round(v, 3);
    });
    return img;
  }
  function sanitizeAlignment(v, padrao) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    return { left: 1, center: 1, right: 1, justify: 1 }[s] ? s : padrao || "left";
  }
  function layoutLevel(v, max) {
    var n = toInt(v || 0, 0);
    return Math.max(0, Math.min(n, max));
  }
  function copyLayout(src, alvo) {
    var indent = layoutLevel(src.indent, 8), sb = layoutLevel(src.space_before, 6);
    if (indent) alvo.indent = indent;
    if (sb) alvo.space_before = sb;
    return alvo;
  }
  function fontSize(v) {
    var n = Number(v);
    if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return null;
    return n >= 6 && n <= 96 ? round(n, 2) : null;
  }
  function boxFrom(raw) {
    var box = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return box;
    ["height", "width"].forEach(function (f) {
      if (!(f in raw)) return;
      var n = toInt(raw[f], NaN);
      if (!Number.isFinite(n)) return;
      box[f] = Math.max(1, Math.min(n, 5));
    });
    return box;
  }
  var LIST_FORMATS = { decimal: 1, decimalZero: 1, lowerLetter: 1, upperLetter: 1, lowerRoman: 1, upperRoman: 1, bullet: 1, none: 1, ordinal: 1, cardinalText: 1, ordinalText: 1 };
  function str(v) { return String(v == null ? "" : v); }

  function sanitizeModel(model) {
    if (model === null || model === undefined || (typeof model === "object" && !Array.isArray(model) && !Object.keys(model).length)) return null;
    if (typeof model !== "object" || Array.isArray(model) || toInt(model.schema_version || 0, 0) !== 1) throw new Error("Modelo documental inválido");
    var blocksIn = model.blocks;
    if (!Array.isArray(blocksIn) || blocksIn.length > MAX_MODEL_BLOCKS) throw new Error("Estrutura documental excedida ou inválida");
    var blocks = [];
    blocksIn.forEach(function (raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      var tipo = str(raw.type), id = str(raw.id).slice(0, 120), key, out;
      if (!validModelKey(id)) return;
      if (tipo === "heading" || tipo === "hybrid") {
        key = str(raw.key);
        if (!validModelKey(key)) return;
        var level = tipo === "heading" ? Math.max(1, Math.min(toInt(raw.level === undefined ? 1 : raw.level, 1), 3)) : 1;
        out = { id: id, type: tipo, key: key, level: level, content: sanitizeFragment(raw.content === undefined ? "" : raw.content), anchor: str(raw.anchor).slice(0, 120) };
        if (tipo === "hybrid") out.toc_label = str(raw.toc_label).slice(0, 180).trim();
        out.detected_by = str(raw.detected_by).slice(0, 40);
        out.align = sanitizeAlignment(raw.align);
        if ("source_all_bold" in raw) out.source_all_bold = !!raw.source_all_bold;
        var fsz = fontSize(raw.source_font_size_pt);
        if (fsz !== null) out.source_font_size_pt = fsz;
        if (tipo === "heading" && (raw.visual_style === "heading" || raw.visual_style === "plain")) out.visual_style = raw.visual_style;
        blocks.push(copyLayout(raw, out));
      } else if (tipo === "paragraph") {
        key = str(raw.key);
        if (!validModelKey(key)) return;
        var role = str(raw.role === undefined ? "body" : raw.role);
        if (!{ intro: 1, body: 1, contact: 1, acknowledgement: 1 }[role]) role = "body";
        out = { id: id, type: "paragraph", key: key, role: role, content: sanitizeFragment(raw.content === undefined ? "" : raw.content), align: sanitizeAlignment(raw.align) };
        if (str(raw.display === undefined ? "normal" : raw.display) === "notice") out.display = "notice";
        var box = boxFrom(raw.box);
        if (Object.keys(box).length) out.box = box;
        blocks.push(copyLayout(raw, out));
      } else if (tipo === "list") {
        var ordered = !!raw.ordered, items = [];
        (Array.isArray(raw.items) ? raw.items : []).forEach(function (item) {
          if (!item || typeof item !== "object" || Array.isArray(item)) return;
          var k = str(item.key);
          if (!validModelKey(k)) return;
          var lv = Math.max(0, Math.min(toInt(item.level === undefined ? 0 : item.level, 0), 8));
          var ord = "ordered" in item ? !!item.ordered : ordered;
          var fmt = str(item.format || (ord ? "decimal" : "bullet")).slice(0, 30);
          if (!LIST_FORMATS[fmt]) fmt = ord ? "decimal" : "bullet";
          var c = { key: k, level: lv, ordered: ord, format: fmt, content: sanitizeFragment(item.content === undefined ? "" : item.content), align: sanitizeAlignment(item.align) };
          ["value", "start"].forEach(function (f) {
            var nv = toInt(item[f], NaN);
            if (Number.isFinite(nv) && nv > 0 && nv <= 1000000) c[f] = nv;
          });
          items.push(copyLayout(item, c));
        });
        if (items.length) blocks.push({ id: id, type: "list", ordered: ordered, items: items });
      } else if (tipo === "table") {
        var rows = [];
        (Array.isArray(raw.rows) ? raw.rows : []).slice(0, 200).forEach(function (row) {
          if (!Array.isArray(row)) return;
          var cells = [];
          row.slice(0, 40).forEach(function (cell) {
            if (!cell || typeof cell !== "object" || Array.isArray(cell)) return;
            var ck = str(cell.key);
            if (!validModelKey(ck)) return;
            var cc = { key: ck, content: sanitizeFragment(cell.content === undefined ? "" : cell.content), header: !!cell.header,
              colspan: Math.max(1, Math.min(toInt(cell.colspan === undefined ? 1 : cell.colspan, 1), 40)),
              rowspan: Math.max(1, Math.min(toInt(cell.rowspan === undefined ? 1 : cell.rowspan, 1), 200)),
              align: sanitizeAlignment(cell.align) };
            var imgs = [];
            (Array.isArray(cell.images) ? cell.images : []).slice(0, 12).forEach(function (r) { var im = sanitizeImageRef(r); if (im) imgs.push(im); });
            if (imgs.length) cc.images = imgs;
            cells.push(copyLayout(cell, cc));
          });
          if (cells.length) rows.push(cells);
        });
        if (rows.length) blocks.push({ id: id, type: "table", rows: rows });
      } else if (tipo === "image") {
        var im = sanitizeImageRef(raw);
        if (!im) return;
        blocks.push(Object.assign({ id: id, type: "image" }, im));
      }
    });
    var st = str(model.source_type || "docx").trim().toLowerCase();
    if (!IMPORT_SOURCE_TYPES[st] && st !== TEMPLATE_SOURCE_TYPE) st = "docx";
    var result = { schema_version: 1, source_type: st, blocks: blocks };
    if (str(model.template_profile).trim().slice(0, 80) === DEFAULT_TEMPLATE_PROFILE) result.template_profile = DEFAULT_TEMPLATE_PROFILE;
    var lay = model.layout && typeof model.layout === "object" && !Array.isArray(model.layout) ? model.layout : {};
    var intro = boxFrom(lay.intro_box);
    if (Object.keys(intro).length) result.layout = { intro_box: intro };
    return result;
  }

  function sanitizeSnapshot(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Formato inválido");
    var meta = payload.metadata || {}, els = payload.elements || {};
    if (typeof meta !== "object" || Array.isArray(meta) || typeof els !== "object" || Array.isArray(els)) throw new Error("Formato inválido");
    if (Object.keys(els).length > MAX_EDITABLE_FIELDS) throw new Error("Quantidade de campos excedida");
    var metadata = {
      title: str(meta.title).slice(0, 180).trim(),
      document_number: str(meta.document_number).slice(0, 40).trim(),
      date: str(meta.date).slice(0, 20).trim(),
      department: str(meta.department === undefined ? "Departamento Tributário" : meta.department).slice(0, 100).trim()
    };
    var elements = {};
    Object.keys(els).forEach(function (k) { if (validModelKey(k)) elements[k] = sanitizeFragment(els[k]); });
    var out = { metadata: metadata, elements: elements };
    var model = sanitizeModel(payload.model);
    if (model) out.model = model;
    return out;
  }

  // ------------------------------------------------------------------ numeração "nº NN/AA"
  function documentYear(dateText, numberText) {
    var d = str(dateText);
    var anos = d.match(/(?<!\d)(20\d{2})(?!\d)/g);
    if (anos) return Number(anos[anos.length - 1]);
    var curto = /(?:^|\D)(?:0?[1-9]|1[0-2])[\/\-](\d{2})(?:$|\D)/.exec(d);
    if (curto) return 2000 + Number(curto[1]);
    var nr = /\/\s*(\d{2,4})(?:$|\D)/.exec(str(numberText));
    if (nr) return nr[1].length === 4 ? Number(nr[1]) : 2000 + Number(nr[1]);
    return new Date().getUTCFullYear();
  }
  function parseNumber(v) {
    var m = /(?:n[º°oO.]?\s*)?(\d{1,4})\s*\/\s*(\d{2,4})/i.exec(str(v).trim());
    if (!m) return null;
    return [Number(m[1]), m[2].length === 4 ? Number(m[2]) : 2000 + Number(m[2])];
  }
  // documentos: [{document_number, document_date}] (inclusive arquivados)
  function nextDocumentNumber(documentos, dateText, proposed) {
    var year = documentYear(dateText, proposed);
    var used = {}, count = 0;
    (documentos || []).forEach(function (d) {
      var p = parseNumber(d.document_number);
      var y = p ? p[1] : documentYear(d.document_date, d.document_number);
      if (y !== year) return;
      count++;
      if (p) used[p[0]] = 1;
    });
    var pp = parseNumber(proposed);
    if (pp && pp[1] === year && !used[pp[0]]) return str(proposed).trim();
    if (str(proposed).trim() && !pp) return str(proposed).trim();
    var highest = Object.keys(used).reduce(function (a, k) { return Math.max(a, Number(k)); }, 0);
    var seq = Math.max(highest, count) + 1;
    return "nº " + String(seq).padStart(2, "0") + "/" + String(year).slice(-2);
  }

  // ------------------------------------------------------------------ Template institucional
  function hex() {
    var c = typeof crypto !== "undefined" ? crypto : (typeof require === "function" ? require("crypto").webcrypto : null);
    return c.randomUUID().replace(/-/g, "");
  }
  function templateBlock(kind, content, extra) {
    return Object.assign({ id: "blk-" + hex(), type: kind, key: "tpl-" + hex(), content: content }, extra || {});
  }
  function templateSnapshot(payload, documentos) {
    payload = payload || {};
    var kind = str(payload.kind || "informativo").trim().toLowerCase();
    if (kind !== "informativo" && kind !== "aviso") kind = "informativo";
    var now = new Date();
    var date = str(payload.date || (String(now.getMonth() + 1).padStart(2, "0") + "/" + now.getFullYear())).trim().slice(0, 20);
    var proposed = str(payload.document_number).trim().slice(0, 40);
    var numero = nextDocumentNumber(documentos, date, proposed);
    var title = str(payload.title || (kind === "aviso" ? "Novo aviso" : "Novo informativo")).trim().slice(0, 180);
    var dep = str(payload.department || "Depto. de Gestão e Planejamento Tributário").trim().slice(0, 100);
    var blocks = [];
    if (kind === "informativo") {
      blocks.push(templateBlock("paragraph", "Digite aqui a introdução ou orientação inicial do informativo.", { role: "intro", align: "left" }));
      blocks.push(templateBlock("heading", "1 – Título do tópico", { level: 1, anchor: "tpl-item-1", detected_by: "template", align: "left", visual_style: "heading" }));
      blocks.push(templateBlock("paragraph", "Digite aqui o conteúdo do tópico.", { role: "body", align: "left" }));
      blocks.push(templateBlock("paragraph", "Atenção: edite ou exclua esta caixa conforme necessário.", { role: "body", display: "notice", box: { height: 1, width: 5 }, align: "left" }));
    } else {
      blocks.push(templateBlock("paragraph", "Digite aqui uma frase curta de abertura do aviso.", { role: "intro", align: "left" }));
      blocks.push(templateBlock("paragraph", "Digite aqui o conteúdo principal do aviso.", { role: "body", align: "left" }));
      blocks.push(templateBlock("paragraph", "Importante: destaque aqui a providência, prazo ou alerta principal.", { role: "body", display: "notice", box: { height: 1, width: 5 }, align: "left" }));
    }
    blocks.push(templateBlock("paragraph", "Em caso de dúvidas, entre em contato conosco em tempo hábil.", { role: "contact", align: "center" }));
    blocks.push(templateBlock("paragraph", "Recebido por: _____________________________________________   Data: ____/____/_________", { role: "acknowledgement", align: "left" }));
    var elements = {};
    blocks.forEach(function (b) { if (b.key) elements[b.key] = str(b.content); });
    return sanitizeSnapshot({
      metadata: { title: title, document_number: numero, date: date, department: dep },
      elements: elements,
      model: { schema_version: 1, source_type: TEMPLATE_SOURCE_TYPE, template_profile: DEFAULT_TEMPLATE_PROFILE, layout: { intro_box: { height: 1, width: 5 } }, blocks: blocks }
    });
  }

  var api = {
    sanitizeFragment: sanitizeFragment, sanitizeModel: sanitizeModel, sanitizeSnapshot: sanitizeSnapshot, validModelKey: validModelKey,
    nextDocumentNumber: nextDocumentNumber, documentYear: documentYear, templateSnapshot: templateSnapshot, unescapeHtml: unescapeHtml,
    DEFAULT_TEMPLATE_PROFILE: DEFAULT_TEMPLATE_PROFILE
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.InfNucleo = api;
})(typeof window !== "undefined" ? window : this);
