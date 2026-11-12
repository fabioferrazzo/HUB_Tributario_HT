/*
 * Informativos no HUB — exportação HTML, DOCX e ZIP (porte de html_exporter.py e docx_exporter.py do Infos HT 21.14).
 *
 * Gera no navegador o mesmo HTML autônomo (matriz institucional "Template 15") e o mesmo DOCX que o programa
 * local gerava a partir da versão publicada. Depende de inf-importar.js (utilidades com o comportamento do Python)
 * e do JSZip. Também roda no Node (testes de paridade).
 */
(function (raiz) {
  "use strict";

  var I = typeof module !== "undefined" && module.exports && typeof require === "function" && !raiz.InfImportar
    ? null : raiz.InfImportar;
  function U() { return I || raiz.InfImportar; }
  function py(src, flags) { return U().py(src, flags); }

  // ------------------------------------------------------------------ utilidades
  function str(v) { return v === null || v === undefined || v === false || v === 0 || v === "" ? "" : String(v); }
  function esc(v) { // html.escape(str(value or ""), quote=True)
    return str(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  }
  function x(v) { // saxutils.escape + aspas
    return str(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function quoteattr(v) {
    var d = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
    if (d.indexOf('"') >= 0) {
      if (d.indexOf("'") >= 0) return '"' + d.replace(/"/g, "&quot;") + '"';
      return "'" + d + "'";
    }
    return '"' + d + '"';
  }
  function base64(bytes) {
    if (typeof Buffer !== "undefined" && typeof btoa === "undefined") return Buffer.from(bytes).toString("base64");
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function toInt(v) { // int(v) do Python para os valores do modelo
    if (typeof v === "number") { if (!isFinite(v)) throw new Error("int"); return Math.trunc(v); }
    if (typeof v === "boolean") return v ? 1 : 0;
    var s = U().pyStrip(String(v));
    if (!/^[+-]?\d+(?:_\d+)*$/.test(s)) throw new Error("int");
    return parseInt(s.replace(/_/g, ""), 10);
  }
  function isMap(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function get(o, k, padrao) { return isMap(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : padrao; }
  var MIME_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp", "image/tiff": ".tiff", "image/svg+xml": ".svg" };
  var EXT_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jpe": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
                   ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff", ".svg": "image/svg+xml", ".emf": "image/emf", ".wmf": "image/wmf" };
  function sufixo(nome) {
    var b = String(nome || "").split("/").pop(), i = b.lastIndexOf(".");
    return i > 0 && i < b.length - 1 ? b.slice(i) : "";
  }
  function guessType(nome) { return EXT_MIME[sufixo(nome).toLowerCase()] || null; }

  function safeExportFilename(title, suffix) {
    if (suffix === undefined) suffix = ".docx";
    var v = String(title || "Informativo").replace(/[\\/:*?"<>|]+/g, "-");
    v = v.replace(new RegExp("[" + U().PYS + "]+", "gu"), " ");
    v = v.replace(/^[ .\-]+|[ .\-]+$/g, "") || "Informativo";
    return U().cpSlice(v, 0, 120) + suffix;
  }

  // ==================================================================================================
  // HTML (html_exporter.py)

  var R = {};
  function re() {
    if (R.ok) return R;
    R.ws = py("\\s+", "g");
    R.dotted = py("^(\\d{1,3}(?:\\.\\d{1,3}){1,4})(?:\\s*[–—-]|\\s*[.:)])?\\s+\\S");
    R.main = py("^(\\d{1,3})(?:\\s*[–—-]|\\s*[.:)])\\s+\\S");
    R.generic = py("^(?:conte[uú]do|se[cç][aã]o\\s+\\d+)$", "i");
    R.punct = /[,;:!?]/g;
    R.excl1 = py("^[\\s._–—\\-/:;()\\[\\]{}]+$");
    R.excl2 = py("^(?:recebido\\s+por|data|whats\\s*app|telefone|fone|contato|e-?mail)\\s*:", "i");
    R.excl3 = py("^para\\s+maiores\\s+informa[cç][oõ]es\\b", "i");
    R.excl4 = py("\\b[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}\\b", "i");
    R.excl5 = /^(?:https?:\/\/|www\.)/i;
    R.excl6 = py("^[\\s+()0-9.\\-–—/]+$");
    R.letras = /[A-Za-zÀ-ÖØ-öø-ÿ]/g;
    R.ok = true;
    return R;
  }
  function plain(v) { return U().pyStrip(str(v).replace(/<[^>]+>/g, "")); }
  function norm(v) { return U().pyStrip(plain(v).replace(re().ws, " ")); }
  function numberedOutlineInfo(value) {
    var text = norm(value);
    if (!text) return null;
    var d = re().dotted.exec(text);
    if (d) return [Math.min(4, d[1].split(".").length + 1), d[1]];
    var m = re().main.exec(text);
    if (m) return [2, m[1]];
    return null;
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function stripOutlineNumber(value, number) {
    var text = norm(value);
    if (!text || !number) return text;
    return U().pyStrip(text.replace(py("^" + escRe(number) + "\\s*(?:[–—\\-.:)]\\s*)?"), ""));
  }
  function firstOutlineWords(value, limit) {
    return U().pySplit(norm(value)).slice(0, limit || 6).join(" ");
  }
  function tocDisplayLabel(label, detectedBy) {
    var text = norm(label);
    if (detectedBy === "paragraph-fallback") return [firstOutlineWords(text, 6), false];
    var info = numberedOutlineInfo(text);
    if (!info) return [text, false];
    var number = info[1];
    var rem = stripOutlineNumber(text, number);
    if (detectedBy === "numbered-content") {
      var t = firstOutlineWords(rem, 6);
      return [t ? number + " – " + t : number, true];
    }
    return [rem ? number + " – " + rem : number, true];
  }
  function isGenericTocLabel(v) { var t = norm(v); return !t || re().generic.test(t); }
  function blockText(block, elements) {
    var key = str(get(block, "key", ""));
    return norm(get(elements, key, get(block, "content", "")));
  }
  function isProseLike(value) {
    var text = norm(value);
    if (!text) return false;
    var info = numberedOutlineInfo(text);
    var body = info ? stripOutlineNumber(text, info[1]) : text;
    var words = U().pySplit(body);
    var punct = (body.match(re().punct) || []).length;
    return words.length >= 24 || U().cpLen(body) >= 180 || (words.length >= 18 && punct >= 2);
  }
  function isInferredNumberedProse(block, elements) {
    var reason = U().pyStrip(str(get(block, "detected_by", "")));
    if (reason === "user" || reason === "template") return false;
    if (reason === "pdf_numeric" || reason === "numeric_sequence_long" || reason === "numeric_sequence") return true;
    return isProseLike(blockText(block, elements));
  }
  function isTrueStructural(block, elements) {
    var t = str(get(block, "type", ""));
    if (t !== "heading" && t !== "hybrid") return false;
    if (isGenericTocLabel(blockText(block, elements))) return false;
    return !isInferredNumberedProse(block, elements);
  }
  function isTocExcluded(value) {
    var text = norm(value);
    if (!text) return true;
    var r = re();
    if (r.excl1.test(text)) return true;
    if (r.excl2.test(text)) return true;
    if (r.excl3.test(text)) return true;
    if (r.excl4.test(text)) return true;
    if (r.excl5.test(text)) return true;
    var digits = (text.match(/[0-9]/g) || []).length;
    var letters = (text.match(r.letras) || []).length;
    if (digits >= 7 && letters <= 4 && r.excl6.test(text)) return true;
    return false;
  }
  function hasNumberedTocBlock(block, elements) {
    var t = str(get(block, "type", ""));
    if (t === "heading" || t === "hybrid") return isInferredNumberedProse(block, elements) && !!numberedOutlineInfo(blockText(block, elements));
    if (t === "paragraph" && str(get(block, "role", "body") || "body") === "body") {
      var text = blockText(block, elements);
      return !!numberedOutlineInfo(text) && !isTocExcluded(text);
    }
    if (t === "list") {
      var items = get(block, "items", null) || [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!isMap(item)) continue;
        var ordered = !!get(item, "ordered", get(block, "ordered", undefined));
        var tx = norm(get(elements, str(get(item, "key", "")), get(item, "content", "")));
        if ((ordered || numberedOutlineInfo(tx)) && !isTocExcluded(tx)) return true;
      }
    }
    return false;
  }
  function tocMode(blocks, elements) {
    var hasStructure = blocks.some(function (b) { return isMap(b) && isTrueStructural(b, elements); });
    var hasNumbered = blocks.some(function (b) { return isMap(b) && hasNumberedTocBlock(b, elements); });
    if (hasStructure || hasNumbered) return "mixed";
    var temPar = blocks.some(function (b) {
      if (!isMap(b)) return false;
      var t = str(get(b, "type", ""));
      var cond = (t === "paragraph" && str(get(b, "role", "body") || "body") === "body") ||
                 ((t === "heading" || t === "hybrid") && isInferredNumberedProse(b, elements));
      return cond && !!blockText(b, elements) && !isTocExcluded(blockText(b, elements));
    });
    return temPar ? "paragraphs" : "fallback";
  }
  var SCORE = { structure: 3, "numbered-content": 2, "paragraph-fallback": 1, fallback: 0 };
  function maior(a, b) { return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]; }
  function dedupeToc(items) {
    var winners = {};
    items.forEach(function (it, idx) {
      var info = numberedOutlineInfo(it[1]);
      if (!info) return;
      var cand = [SCORE[it[3]] || 0, -idx];
      if (!Object.prototype.hasOwnProperty.call(winners, info[1]) || maior(cand, winners[info[1]])) winners[info[1]] = cand;
    });
    var out = [], seen = {};
    items.forEach(function (it, idx) {
      var info = numberedOutlineInfo(it[1]);
      if (info) {
        var cand = [SCORE[it[3]] || 0, -idx], w = winners[info[1]];
        if (!w || w[0] !== cand[0] || w[1] !== cand[1]) return;
      }
      if (seen[it[0]]) return;
      seen[it[0]] = 1;
      out.push(it);
    });
    return out;
  }
  function assetDataUri(asset) {
    if (!asset) return "";
    var data = asset.data;
    if (!data) return "";
    var mime = str(asset.mime_type) || guessType(str(asset.source_name)) || "application/octet-stream";
    return "data:" + mime + ";base64," + base64(data);
  }
  function alignClass(a) { var v = str(a) || "left"; return v === "left" || v === "center" || v === "right" ? " align-" + v : ""; }
  function layoutClass(obj) {
    var cls = [], indent = 0, sb = 0;
    try { indent = Math.max(0, Math.min(toInt(get(obj, "indent", 0) || 0), 8)); } catch (e) { indent = 0; }
    try { sb = Math.max(0, Math.min(toInt(get(obj, "space_before", 0) || 0), 6)); } catch (e) { sb = 0; }
    if (indent) cls.push("indent-" + indent);
    if (sb) cls.push("space-before-" + sb);
    return cls.length ? " " + cls.join(" ") : "";
  }
  function sizeClass(block) {
    var box = isMap(get(block, "box", null)) ? block.box : {};
    var out = "";
    try { var h = toInt(get(box, "height", null)); if (h >= 1 && h <= 5) out += " box-h-" + h; } catch (e) {}
    try { var w = toInt(get(box, "width", null)); if (w >= 1 && w <= 5) out += " box-w-" + w; } catch (e) {}
    return out;
  }
  function imgHtml(image, assets) {
    var id = str(get(image, "asset_id", ""));
    var uri = assetDataUri(assets[id]);
    if (!uri) return "";
    var alt = esc(get(image, "alt", "") || (assets[id] || {}).source_name || "Imagem");
    return '<figure class="image-block"><img src="' + uri + '" alt="' + alt + '"></figure>';
  }
  function listLabelHtml(value, fmt, ordered) {
    if (!ordered || fmt === "bullet") return "•";
    var m = function (n, d) { return ((n % d) + d) % d; };
    if (fmt === "lowerLetter") return String.fromCharCode(96 + m(value - 1, 26) + 1) + ".";
    if (fmt === "upperLetter") return String.fromCharCode(64 + m(value - 1, 26) + 1) + ".";
    return value + ".";
  }
  function pad2(n) { return n < 10 && n >= 0 ? "0" + n : String(n); }

  var INTRO1 = "Trazemos aqui algumas informações iniciais que entendemos indispensáveis a fim de alertar nossos clientes para situações que possam lhes trazer prejuízo no exercício de suas atividades empresariais.";
  var INTRO2 = "Por isso, os responsáveis pela empresa devem ter ciência de fatos que podem afetar suas operações, sendo assim, devem ler as informações contidas nesse documento com atenção e em caso de dúvidas entrar em contato conosco em tempo hábil.";
  var CLOSING = "A nossa responsabilidade em informá-lo e a sua responsabilidade em ter ciência, de todos os fatos que podem ajudar ou prejudicar a sua empresa, andam juntos, em parceria, por isso, para esclarecer dúvidas antes de tomada de decisão, entre em contato conosco em tempo hábil.";

  // assets: { id: { data: Uint8Array, source_name, mime_type } }; logoUri: data URI do logo institucional (ou "")
  function buildHtml(snapshot, assets, logoUri) {
    assets = assets || {};
    var metadata = get(snapshot, "metadata", null) || {};
    var elements = get(snapshot, "elements", null) || {};
    var model = get(snapshot, "model", null) || {};
    var blocks = isMap(model) ? get(model, "blocks", null) : null;
    if (!Array.isArray(blocks)) blocks = [];
    var title = str(get(metadata, "title", "")) || "Informativo";
    var titleHtml = str(get(elements, "meta:title", title));
    var number = U().pyStrip(str(get(metadata, "document_number", "")));
    var date = U().pyStrip(str(get(metadata, "date", "")));
    var department = U().pyStrip(str(get(metadata, "department", "")) || "Departamento Tributário");
    logoUri = logoUri || "";

    var tocItems = [], mode = tocMode(blocks, elements), preamble = [], sections = [], current = null, anchorCounter = 0;
    function nextAnchor() { anchorCounter++; return "toc-" + anchorCounter; }
    function target() { return current ? current.parts : preamble; }
    function paragraphHtml(block, anchor) {
      var key = str(get(block, "key", ""));
      var content = str(get(elements, key, get(block, "content", "")));
      var display = str(get(block, "display", "")) === "notice" ? " notice" : "";
      var role = " role-" + esc(get(block, "role", "") || "body");
      var id = anchor ? ' id="' + esc(anchor) + '"' : "";
      return "<div" + id + ' class="doc-paragraph' + display + role + alignClass(get(block, "align", undefined)) + sizeClass(block) + layoutClass(block) + '">' + content + "</div>";
    }

    blocks.forEach(function (block) {
      if (!isMap(block)) return;
      var btype = str(get(block, "type", ""));
      var key, content, outline;
      if (btype === "heading" || btype === "hybrid") {
        key = str(get(block, "key", ""));
        content = str(get(elements, key, get(block, "content", "")));
        var plainTitle = norm(content);
        var level = btype === "heading" ? Math.max(1, Math.min(3, toInt(get(block, "level", null) || 1))) : 1;
        var structural = isTrueStructural(block, elements);
        var inferred = isInferredNumberedProse(block, elements);
        outline = inferred ? numberedOutlineInfo(plainTitle) : null;
        if (level === 1) {
          var sid = "item-" + (sections.length + 1);
          current = { id: sid, title: plainTitle || "Tópico", parts: [] };
          sections.push(current);
          if (mode === "mixed" && structural && plainTitle && !isTocExcluded(plainTitle)) tocItems.push([sid, plainTitle, 2, "structure", content]);
          else if (mode === "mixed" && outline && plainTitle && !isTocExcluded(plainTitle)) tocItems.push([sid, plainTitle, outline[0], "numbered-content", content]);
          else if (mode === "paragraphs" && !structural && plainTitle && !isTocExcluded(plainTitle)) tocItems.push([sid, plainTitle, 2, "paragraph-fallback", content]);
          current.parts.push('<h2 class="doc-heading' + alignClass(get(block, "align", undefined)) + layoutClass(block) + '">' + content + "</h2>");
        } else {
          var tag = level === 2 ? "h3" : "h4";
          var subId = nextAnchor();
          var tl = level === 2 ? 3 : 4;
          if (mode === "mixed" && structural && plainTitle && !isTocExcluded(plainTitle)) tocItems.push([subId, plainTitle, tl, "structure", content]);
          else if (mode === "mixed" && outline && plainTitle && !isTocExcluded(plainTitle)) tocItems.push([subId, plainTitle, outline[0], "numbered-content", content]);
          else if (mode === "paragraphs" && !structural && plainTitle && !isTocExcluded(plainTitle)) tocItems.push([subId, plainTitle, 2, "paragraph-fallback", content]);
          target().push("<" + tag + ' id="' + esc(subId) + '" class="doc-subheading' + alignClass(get(block, "align", undefined)) + layoutClass(block) + '">' + content + "</" + tag + ">");
        }
        return;
      }
      if (btype === "paragraph") {
        key = str(get(block, "key", ""));
        var raw = str(get(elements, key, get(block, "content", "")));
        var pl = norm(raw);
        var role = str(get(block, "role", "")) || "body";
        if (role === "intro" && (pl === INTRO1 || pl === INTRO2 || pl === INTRO1 + " " + INTRO2)) return;
        var eligible = role === "body" && pl && !isTocExcluded(pl);
        outline = eligible ? numberedOutlineInfo(raw) : null;
        var anchor = "";
        if (mode === "mixed" && outline) { anchor = nextAnchor(); tocItems.push([anchor, pl, outline[0], "numbered-content", raw]); }
        else if (mode === "paragraphs" && eligible) { anchor = nextAnchor(); tocItems.push([anchor, pl, 2, "paragraph-fallback", raw]); }
        target().push(paragraphHtml(block, anchor));
        return;
      }
      if (btype === "list") {
        var ordered = !!get(block, "ordered", false);
        var ltag = ordered ? "ol" : "ul";
        var items = [], counters = new Map();
        (get(block, "items", null) || []).forEach(function (item) {
          if (!isMap(item)) return;
          var lv = Math.max(0, Math.min(8, toInt(get(item, "level", null) || 0)));
          Array.from(counters.keys()).filter(function (d) { return d > lv; }).forEach(function (d) { counters.delete(d); });
          var val = get(item, "value", null);
          if (val !== null && val !== undefined) {
            try { counters.set(lv, toInt(val)); } catch (e) { counters.set(lv, (counters.has(lv) ? counters.get(lv) : 0) + 1); }
          } else if (counters.has(lv)) counters.set(lv, counters.get(lv) + 1);
          else { try { counters.set(lv, toInt(get(item, "start", null) || 1)); } catch (e) { counters.set(lv, 1); } }
          var ik = str(get(item, "key", ""));
          var ic = str(get(elements, ik, get(item, "content", "")));
          var plainItem = norm(ic);
          var itemOrdered = !!get(item, "ordered", ordered);
          var label = esc(listLabelHtml(counters.get(lv), str(get(item, "format", "")) || "decimal", itemOrdered));
          var itemAnchor = "";
          var textOutline = numberedOutlineInfo(plainItem);
          var synth = null;
          if (itemOrdered && plainItem) {
            var path = [];
            for (var q = 0; q <= lv; q++) if (counters.has(q)) path.push(String(counters.get(q)));
            if (path.length) synth = [Math.min(4, path.length + 1), path.join(".")];
          }
          var ol = textOutline || synth;
          if (mode === "mixed" && ol && plainItem && !isTocExcluded(plainItem)) {
            itemAnchor = nextAnchor();
            tocItems.push([itemAnchor, textOutline ? plainItem : ol[1] + " – " + plainItem, ol[0], "numbered-content", ic]);
          }
          var idAttr = itemAnchor ? ' id="' + esc(itemAnchor) + '"' : "";
          items.push("<li" + idAttr + ' class="level-' + lv + alignClass(get(item, "align", undefined)) + layoutClass(item) + '"><span class="list-label">' + label +
                     '</span><span class="list-content">' + ic + "</span></li>");
        });
        if (items.length) target().push("<" + ltag + ' class="doc-list">' + items.join("") + "</" + ltag + ">");
        return;
      }
      if (btype === "table") {
        var rowsHtml = [];
        (get(block, "rows", null) || []).forEach(function (row) {
          if (!Array.isArray(row)) return;
          var cells = [];
          row.forEach(function (cell) {
            if (!isMap(cell)) return;
            var ck = str(get(cell, "key", ""));
            var cc = str(get(elements, ck, get(cell, "content", "")));
            var ctag = get(cell, "header", false) ? "th" : "td";
            var attrs = [];
            try { var cs = toInt(get(cell, "colspan", null) || 1); if (cs > 1) attrs.push('colspan="' + cs + '"'); } catch (e) {}
            try { var rs = toInt(get(cell, "rowspan", null) || 1); if (rs > 1) attrs.push('rowspan="' + rs + '"'); } catch (e) {}
            var imgs = (get(cell, "images", null) || []).filter(isMap).map(function (im) { return imgHtml(im, assets); }).join("");
            cells.push("<" + ctag + ' class="' + alignClass(get(cell, "align", undefined)).trim() + '" ' + attrs.join(" ") + ">" + cc + imgs + "</" + ctag + ">");
          });
          if (cells.length) rowsHtml.push("<tr>" + cells.join("") + "</tr>");
        });
        if (rowsHtml.length) target().push('<div class="table-wrap"><table>' + rowsHtml.join("") + "</table></div>");
        return;
      }
      if (btype === "image") target().push(imgHtml(block, assets));
    });

    tocItems = dedupeToc(tocItems);
    if (!sections.length) { sections.push({ id: "item-1", title: "Conteúdo", parts: preamble.slice() }); preamble = []; }
    if (!tocItems.length && sections.length) tocItems.push([sections[0].id, "Conteúdo", 2, "fallback", "Conteúdo"]);
    var tocParts = [], mainCounter = 0;
    tocItems.forEach(function (it) {
      var d = tocDisplayLabel(it[1], it[3]);
      var numberHtml = "";
      if (it[2] === 2) { mainCounter++; if (!d[1]) numberHtml = '<span class="num">' + pad2(mainCounter) + "</span> "; }
      tocParts.push('<li class="level-' + it[2] + '"><a class="level-' + it[2] + '" href="#' + esc(it[0]) + '">' + numberHtml + esc(d[0]) + "</a></li>");
    });
    var tocHtml = tocParts.join(""), preambleHtml = preamble.join("");
    var sectionsHtml = sections.map(function (s) { return '<section class="entry" id="' + esc(s.id) + '">' + s.parts.join("") + "</section>"; }).join("");
    return TEMPLATE.replace(/\{\{(\w+)\}\}/g, function (m, k) {
      return {
        title: esc(title), introModal: '<p><span class="highlight">Importante:</span>' + esc(INTRO1) + "</p><p>" + esc(INTRO2) + "</p>",
        logo: logoUri ? '<img src="' + logoUri + '" alt="Logo HT" class="brand-logo">' : "",
        department: esc(department), meta: esc(number) + (date ? " · " + esc(date) : ""), titleHtml: titleHtml, toc: tocHtml,
        intro: "<p>" + esc(INTRO1) + "</p><p>" + esc(INTRO2) + "</p>", body: preambleHtml + sectionsHtml, closing: esc(CLOSING)
      }[k];
    });
  }

  var TEMPLATE = [
    '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>{{title}} — H. Teixeira Contabilidade</title>\n<style>\n',
    ":root{--navy:#252c62;--navy-dark:#111536;--cyan:#14b8c6;--cyan-text:#0d8a95;--ink:#102d4c;--muted:#5f7080;--gray-light:#e4e4e7;--line:#d7e4ea;--paper:#fff;--bg:#eef5f7}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);font-family:Aptos,Helvetica,Arial,sans-serif;color:var(--ink);line-height:1.7;font-size:16px}.page{max-width:1100px;margin:40px auto 60px;background:var(--paper);border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(20,45,64,.11)}\n",
    ".modal-overlay{display:flex;position:fixed;z-index:9999;inset:0;background:rgba(17,21,54,.7);backdrop-filter:blur(4px);justify-content:center;align-items:center}.modal-content{background:var(--paper);padding:32px 40px;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.3);max-width:600px;width:90%;position:relative;border-left:6px solid var(--cyan-text)}.close-btn{position:absolute;top:16px;right:20px;color:var(--muted);font-size:28px;font-weight:bold;cursor:pointer}.modal-content svg{width:32px;height:32px;margin-bottom:16px}.modal-content p{margin:0 0 12px;font-size:16px;font-weight:500;line-height:1.6;color:var(--cyan-text)}.modal-content .highlight{color:var(--navy-dark);font-weight:800;margin-right:4px;font-size:18px}\n",
    ".header-top{padding:26px 40px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}.brand-wrapper{display:flex;align-items:center;gap:16px}.brand-logo{width:48px;height:48px;object-fit:cover;border-radius:8px;box-shadow:0 2px 8px rgba(37,44,98,.15)}.brand{font-size:28px;font-weight:800;letter-spacing:.02em;color:var(--navy);line-height:1.1}.brand span{font-size:13px;letter-spacing:.22em;display:block;font-weight:600}.meta{text-align:right;line-height:1.4}.meta strong{display:block;color:var(--cyan-text);text-transform:uppercase;letter-spacing:.05em;font-size:14px;font-weight:800;margin-bottom:2px}.meta span{color:var(--muted);font-size:14px;font-weight:500}.hero{background:linear-gradient(120deg,#252c62,#245f7c);color:white;padding:30px 40px;border-bottom:6px solid var(--cyan)}.hero small{display:block;color:#9ff3f7;font-weight:800;letter-spacing:.07em;margin-bottom:6px;text-transform:uppercase}h1{font-size:42px;line-height:1.1;margin:0;font-weight:900}\n",
    ".layout{display:grid;grid-template-columns:220px 1fr;gap:50px;padding:40px;transition:all .3s ease}.layout.sidebar-closed{grid-template-columns:28px 1fr;gap:40px}.sidebar{position:sticky;top:40px;align-self:start;max-height:calc(100vh - 80px);overflow-y:auto}.sidebar-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.sidebar-title{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);font-weight:800;margin:0;white-space:nowrap}.toggle-sidebar-btn{background:none;border:none;color:var(--cyan-text);cursor:pointer;padding:4px;border-radius:4px;display:flex}.toggle-sidebar-btn svg{width:18px;height:18px;transition:transform .3s ease}.layout.sidebar-closed .sidebar-title,.layout.sidebar-closed .sidebar-list{display:none}.layout.sidebar-closed .toggle-sidebar-btn svg{transform:rotate(180deg)}.layout.sidebar-closed .sidebar-header{justify-content:center}.sidebar ul{list-style:none;padding:0;margin:0;border-left:1px solid var(--gray-light)}.sidebar li a{display:block;padding:8px 0 8px 16px;font-size:13.5px;color:var(--muted);text-decoration:none;transition:.2s ease;line-height:1.4}.sidebar li a:hover,.sidebar li a.active{color:var(--navy);border-left:2px solid var(--cyan);margin-left:-1px;background:#f8fafc}.sidebar li a.active{font-weight:700}.sidebar .num{font-family:monospace;font-weight:700;color:var(--cyan-text);margin-right:4px}.sidebar li.level-3 a{padding-left:30px;font-size:12.8px}.sidebar li.level-4 a{padding-left:44px;font-size:12.3px}.sidebar li.level-3 a::before,.sidebar li.level-4 a::before{content:'›';color:var(--cyan-text);font-weight:900;margin-right:6px}\n",
    ".intro-accordion{background:#f6fbfc;border:1px solid #d3e9eb;border-left:4px solid var(--cyan-text);border-radius:8px;margin:0 0 48px;overflow:hidden}.intro-accordion summary{display:flex;align-items:center;gap:16px;padding:18px 24px;cursor:pointer;list-style:none}.intro-accordion summary::-webkit-details-marker{display:none}.intro-accordion svg{flex-shrink:0;width:22px;height:22px}.intro-accordion .summary-text{font-size:15px;color:var(--cyan-text);font-weight:500;flex-grow:1}.intro-accordion .highlight{color:var(--navy-dark);font-weight:800}.intro-accordion summary::after{content:'+';font-size:24px;color:var(--cyan-text);margin-left:auto}.intro-accordion[open] summary::after{content:'−'}.intro-accordion[open] summary{border-bottom:1px solid #d3e9eb}.intro-content{padding:24px 28px}.intro-content p{margin:0 0 12px;color:var(--cyan-text);font-weight:500;line-height:1.6}\n",
    ".entry{padding:32px 0;border-bottom:1px solid var(--gray-light);scroll-margin-top:40px}.entry:first-of-type{padding-top:0}.entry:last-of-type{border-bottom:none;padding-bottom:0}.doc-heading{font-size:24px;color:var(--navy);font-weight:900;margin:0 0 16px;line-height:1.2}.doc-subheading{color:var(--navy);font-weight:800;margin:24px 0 12px}.doc-paragraph{margin:0 0 16px}.notice{padding:20px 24px;border:1px solid var(--gray-light);border-radius:8px;margin:16px 0;background:#fafbfc;border-left:4px solid var(--cyan)}strong,b{font-weight:800;color:var(--navy-dark)}em,i{font-style:italic}mark{background:#fff59d;padding:0 .12em}.ht-font-up{font-size:1.15em}.ht-font-down{font-size:.87em}.ht-font-normal{font-weight:400!important}.align-left{text-align:left}.align-center{text-align:center}.align-right{text-align:right}.doc-list{padding-left:0;margin:16px 0;list-style:none}.doc-list li{display:flex;gap:8px;margin:7px 0}.list-label{font-weight:800;color:var(--navy);min-width:32px}.table-wrap{overflow:auto;margin:22px 0;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid var(--line);padding:9px 10px;vertical-align:top}th{background:#eef3f7;color:var(--navy);font-weight:900}.image-block{margin:24px auto;text-align:center}.image-block img{max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}\n",
    ".closing-note{margin-top:50px;padding:32px 40px;background:#f8fafc;border-radius:12px;border:1px solid var(--line);text-align:center}.closing-text{font-weight:500;font-size:15px;color:var(--navy);margin:0 0 16px;line-height:1.6}.contacts-ref{font-size:12px;color:var(--muted);opacity:.8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:32px}.signature-line{display:flex;justify-content:space-between;margin-top:32px;padding-top:32px;border-top:1px solid var(--line);font-weight:800;color:var(--navy);font-size:15px;text-align:left}.signature-instruction{margin-top:20px;font-size:13px;color:var(--muted);font-weight:500;line-height:1.5}.motto{text-align:center;color:var(--cyan-text);font-size:17px;font-weight:800;font-style:italic;margin:40px 0 16px}\n",
    ".footer{background:var(--navy);color:#fff;padding:40px;font-size:14px;line-height:1.6}.footer-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.footer-header strong{display:block;font-size:18px;color:#fff}.footer-header span{color:#a5b4fc}.footer-badge{border:1px solid var(--cyan);color:#e0f2fe;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:800;letter-spacing:.08em}.btn-download{background:var(--cyan);color:var(--navy-dark);border:0;padding:8px 18px;border-radius:20px;font-weight:800;cursor:pointer}.footer-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;border-top:1px solid rgba(255,255,255,.15);padding-top:24px}.footer-col{border-left:1px solid rgba(255,255,255,.15);padding-left:24px}.footer-col:first-child{border-left:0;padding-left:0}.footer-col h4{color:var(--cyan);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px}.footer-col p{margin:0;color:rgba(255,255,255,.9);font-size:13.5px}.footer-bottom{color:rgba(255,255,255,.6);font-size:12px;border-top:1px solid rgba(255,255,255,.15);margin-top:24px;padding-top:18px}\n",
    "@media(max-width:900px){.page{margin:0;border-radius:0}.layout,.layout.sidebar-closed{grid-template-columns:1fr;gap:32px;padding:24px}.header-top,.hero,.footer{padding:24px;flex-direction:column;align-items:flex-start;gap:16px}.meta{text-align:left}.sidebar{position:static;border-bottom:1px solid var(--line);padding-bottom:24px}.sidebar ul{border-left:0}.sidebar li a{padding-left:0;border-left:0}.sidebar li a:hover,.sidebar li a.active{border-left:0;margin-left:0;background:transparent}.toggle-sidebar-btn svg{transform:rotate(90deg)}.layout.sidebar-closed .toggle-sidebar-btn svg{transform:rotate(-90deg)}.layout.sidebar-closed .sidebar-title{display:block}.layout.sidebar-closed .sidebar-header{justify-content:space-between;margin-bottom:0}.footer-grid{grid-template-columns:1fr}.footer-col{border-left:0;padding-left:0}.signature-line{flex-direction:column;gap:24px}}\n",
    "@media print{body,.page{background:white!important;margin:0!important;padding:0!important;box-shadow:none!important;max-width:100%!important}.sidebar,.modal-overlay,.btn-download,.intro-accordion{display:none!important}.layout{display:block!important;padding:20px 48px!important}.entry{break-inside:avoid}.footer,.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}}\n",
    "</style></head><body>\n",
    '<div id="avisoModal" class="modal-overlay"><div class="modal-content"><span class="close-btn" onclick="fecharModal()">&times;</span><svg viewBox="0 0 24 24" stroke="var(--cyan-text)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>{{introModal}}</div></div>\n',
    '<article class="page"><header><div class="header-top"><div class="brand-wrapper">{{logo}}<div class="brand">H. Teixeira<br><span>CONTABILIDADE</span></div></div><div class="meta"><strong>{{department}}</strong><span>{{meta}}</span></div></div><div class="hero"><small>INFORMATIVO</small><h1>{{titleHtml}}</h1></div></header>\n',
    '<div class="layout" id="mainLayout"><nav class="sidebar"><div class="sidebar-header"><h3 class="sidebar-title">Sumário</h3><button class="toggle-sidebar-btn" onclick="toggleSidebar()" title="Recolher/Expandir Sumário"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg></button></div><ul class="sidebar-list">{{toc}}</ul></nav>\n',
    '<main><details class="intro-accordion"><summary><svg viewBox="0 0 24 24" stroke="var(--cyan-text)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg><span class="summary-text"><span class="highlight">Importante:</span> para ler novamente o aviso clique aqui</span></summary><div class="intro-content">{{intro}}</div></details>{{body}}<div class="closing-note"><p class="closing-text">{{closing}}</p><div class="contacts-ref">Contatos no rodapé</div><div class="signature-line"><span>Recebido por: _____________________________________________</span><span>Data: ____/_____/_________</span></div><div class="signature-instruction">Faça o download em PDF desse informativo e assine-o usando o gov.br ou certificado digital, ou envie um e-mail dizendo que leu os informativos e está ciente do seu conteúdo.</div></div><div class="motto">&quot;Para o empresário que quiser prosperar, estamos aqui para ajudar&quot;</div></main></div>\n',
    '<footer class="footer"><div class="footer-header"><div><strong>H. Teixeira Contabilidade</strong><span>Departamento Tributário</span></div><div><span class="footer-badge">INFORMATIVO TÉCNICO</span> <button class="btn-download" onclick="baixarPDF()">BAIXAR PDF</button></div></div><div class="footer-grid"><div class="footer-col"><h4>Endereço</h4><p>Rua Três de Outubro, nº 046, Centro<br>São Francisco de Paula/RS · CEP 95400-000</p></div><div class="footer-col"><h4>Horário de Funcionamento</h4><p>Seg. a sex., das 8:30h às 12h e das 13:30h às 17:30h<br>fiscal@hteixeira.com.br</p></div><div class="footer-col"><h4>Telefones</h4><p>(54) 3244-1048 · WhatsApp<br>(54) 3771-8303 · Ligações</p></div><div class="footer-col"><h4>Redes Sociais</h4><p>Facebook · /hteixeirasfp<br>Instagram · @hteixeiracontabilidade</p></div></div><div class="footer-bottom">Informativos do Departamento Tributário · H. Teixeira Contabilidade</div></footer></article>\n',
    "<script>const links=Array.from(document.querySelectorAll('.sidebar-list a'));const entries=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);const map=new Map(links.map(a=>[a.getAttribute('href').slice(1),a]));if('IntersectionObserver'in window){const io=new IntersectionObserver(items=>items.forEach(item=>{if(item.isIntersecting){links.forEach(l=>l.classList.remove('active'));map.get(item.target.id)?.classList.add('active')}}),{rootMargin:'-10% 0px -70% 0px',threshold:0});entries.forEach(e=>io.observe(e))}function toggleSidebar(){document.getElementById('mainLayout').classList.toggle('sidebar-closed')}function fecharModal(){document.getElementById('avisoModal').style.display='none'}window.addEventListener('click',e=>{const m=document.getElementById('avisoModal');if(e.target===m)fecharModal()});function baixarPDF(){document.querySelectorAll('details').forEach(d=>d.setAttribute('open',''));window.print()}</script>\n",
    "</body></html>"
  ].join("");

  // ==================================================================================================
  // DOCX (docx_exporter.py)

  var EMU = 914400;
  function estiloRun() { return { bold: false, italic: false, highlight: false, size_delta: 0, vert: null, link: false }; }
  function clone(s) { return Object.assign({}, s); }
  function inlineItems(htmlValue) {
    var stack = [], style = estiloRun(), items = [];
    function start(tag, attrs) {
      var v = {};
      attrs.forEach(function (a) { v[String(a[0]).toLowerCase()] = String(a[1] || ""); });
      if (tag === "br") { items.push({ br: true }); return; }
      stack.push([tag, clone(style)]);
      if (tag === "strong" || tag === "b") style.bold = true;
      else if (tag === "em" || tag === "i") style.italic = true;
      else if (tag === "mark") style.highlight = true;
      else if (tag === "sup") style.vert = "superscript";
      else if (tag === "sub") style.vert = "subscript";
      else if (tag === "span") {
        var cls = U().pySplit(v["class"] || "");
        if (cls.indexOf("ht-font-up") >= 0) style.size_delta += 2;
        if (cls.indexOf("ht-font-down") >= 0) style.size_delta -= 2;
        if (cls.indexOf("ht-font-normal") >= 0) style.bold = false;
      } else if (tag === "font") {
        try { var size = toInt(Object.prototype.hasOwnProperty.call(v, "size") ? v.size : "3"); style.size_delta += Math.max(-4, Math.min(4, size - 3)); } catch (e) {}
      } else if (tag === "a") style.link = true;
    }
    function end(tag) {
      for (var i = stack.length - 1; i >= 0; i--) if (stack[i][0] === tag) { style = stack[i][1]; stack.length = i; return; }
    }
    U().tokenizar(str(htmlValue), {
      start: start, startend: function (t, a) { start(t, a); end(t); }, end: end,
      data: function (d) { if (d) items.push({ text: d, style: clone(style) }); }
    });
    return items;
  }
  var RE_ESPACO1 = null;
  function ehEspaco(c) { RE_ESPACO1 = RE_ESPACO1 || new RegExp("^[" + U().PYS + "]$", "u"); return !!c && RE_ESPACO1.test(c); }
  function runXml(text, style, basePt) {
    var pt = Math.max(7, Math.min(24, basePt + style.size_delta));
    var sz = Math.round(pt * 2);
    var props = ['<w:sz w:val="' + sz + '"/>', '<w:szCs w:val="' + sz + '"/>'];
    if (style.bold) props.push("<w:b/><w:bCs/>");
    if (style.italic) props.push("<w:i/><w:iCs/>");
    if (style.highlight) props.push('<w:highlight w:val="yellow"/>');
    if (style.vert) props.push('<w:vertAlign w:val="' + style.vert + '"/>');
    if (style.link) props.push('<w:color w:val="0563C1"/><w:u w:val="single"/>');
    var ch = Array.from(text);
    var preserve = ehEspaco(ch[0]) || ehEspaco(ch[ch.length - 1]) || text.indexOf("  ") >= 0 ? ' xml:space="preserve"' : "";
    return "<w:r><w:rPr>" + props.join("") + "</w:rPr><w:t" + preserve + ">" + x(text) + "</w:t></w:r>";
  }
  function inlineRuns(htmlValue, basePt) {
    var out = inlineItems(htmlValue).map(function (it) { return it.br ? "<w:r><w:br/></w:r>" : runXml(str(it.text), it.style, basePt); });
    if (!out.length) out.push(runXml("", estiloRun(), basePt));
    return out.join("");
  }
  function paragraphXml(htmlValue, o) {
    o = o || {};
    var base = o.base_pt === undefined ? 11 : o.base_pt;
    var ppr = [];
    if (o.style) ppr.push('<w:pStyle w:val="' + x(o.style) + '"/>');
    if (o.alignment === "left" || o.alignment === "center" || o.alignment === "right" || o.alignment === "justify")
      ppr.push('<w:jc w:val="' + (o.alignment === "justify" ? "both" : o.alignment) + '"/>');
    var left = o.left_twips || 0, first = o.first_line_twips || 0;
    if (left || first) {
      var at = [];
      if (left) at.push('w:left="' + left + '"');
      if (first) at.push('w:firstLine="' + first + '"');
      ppr.push("<w:ind " + at.join(" ") + "/>");
    }
    if (o.boxed) {
      ppr.push('<w:shd w:val="clear" w:color="auto" w:fill="EEF9FA"/>');
      ppr.push('<w:pBdr><w:top w:val="single" w:sz="8" w:space="4" w:color="BFDDE2"/><w:left w:val="single" w:sz="18" w:space="4" w:color="14B8C4"/><w:bottom w:val="single" w:sz="8" w:space="4" w:color="BFDDE2"/><w:right w:val="single" w:sz="8" w:space="4" w:color="BFDDE2"/></w:pBdr>');
    }
    var before = Math.max(toInt(o.before_twips || 0), o.boxed ? 120 : 0);
    var after = Math.max(toInt(o.after_twips || 0), o.boxed ? 120 : 0);
    if (before || after) ppr.push('<w:spacing w:before="' + before + '" w:after="' + after + '"/>');
    var runs = o.prefix ? runXml(o.prefix, estiloRun(), base) : "";
    runs += inlineRuns(htmlValue, base);
    return "<w:p><w:pPr>" + ppr.join("") + "</w:pPr>" + runs + "</w:p>";
  }
  function roman(v) {
    var vals = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    var out = "", n = Math.max(1, v);
    vals.forEach(function (p) { while (n >= p[0]) { out += p[1]; n -= p[0]; } });
    return out;
  }
  function alpha(v) {
    var n = Math.max(1, v), out = "";
    while (n) { n -= 1; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out;
  }
  function listLabelDocx(v, fmt, ordered) {
    if (!ordered || fmt === "bullet") return "• ";
    if (fmt === "lowerLetter") return alpha(v).toLowerCase() + ". ";
    if (fmt === "upperLetter") return alpha(v) + ". ";
    if (fmt === "lowerRoman") return roman(v).toLowerCase() + ". ";
    if (fmt === "upperRoman") return roman(v) + ". ";
    return v + ". ";
  }
  function colspanDe(c) { return Math.max(1, toInt(get(c, "colspan", 1) || 1)); }
  function tableXml(block, elements, imageParagraph) {
    var rows = get(block, "rows", null) || [];
    if (!rows.length) return "";
    var maxCols = Math.max.apply(null, rows.map(function (row) { return row.reduce(function (s, c) { return s + colspanDe(c); }, 0); }));
    var grid = "";
    for (var i = 0; i < maxCols; i++) grid += '<w:gridCol w:w="2400"/>';
    var tblPr = '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7C7D0"/>' +
      '<w:left w:val="single" w:sz="4" w:color="B7C7D0"/><w:bottom w:val="single" w:sz="4" w:color="B7C7D0"/><w:right w:val="single" w:sz="4" w:color="B7C7D0"/>' +
      '<w:insideH w:val="single" w:sz="4" w:color="D4E0E5"/><w:insideV w:val="single" w:sz="4" w:color="D4E0E5"/></w:tblBorders></w:tblPr>';
    var trs = rows.map(function (row) {
      return "<w:tr>" + row.map(function (cell) {
        var cs = colspanDe(cell);
        var tcPr = ['<w:tcW w:w="' + 2400 * cs + '" w:type="dxa"/>'];
        if (cs > 1) tcPr.push('<w:gridSpan w:val="' + cs + '"/>');
        if (get(cell, "header", false)) tcPr.push('<w:shd w:val="clear" w:color="auto" w:fill="E8F4F5"/>');
        var key = str(get(cell, "key", ""));
        var content = get(elements, key, get(cell, "content", ""));
        var p = paragraphXml(content, { base_pt: 10.5, alignment: str(get(cell, "align", "")) || "left" });
        (get(cell, "images", null) || []).forEach(function (im) { p += imageParagraph(im); });
        return "<w:tc><w:tcPr>" + tcPr.join("") + "</w:tcPr>" + p + "</w:tc>";
      }).join("") + "</w:tr>";
    });
    return "<w:tbl>" + tblPr + "<w:tblGrid>" + grid + "</w:tblGrid>" + trs.join("") + "</w:tbl>";
  }
  function drawingXml(rid, name, w, h, id) {
    var cx = Math.trunc(Math.max(0.3, Math.min(7.0, w)) * EMU);
    var cy = Math.trunc(Math.max(0.3, Math.min(9.0, h)) * EMU);
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">\n<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name=' + quoteattr(name) + '/>\n' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>\n<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">\n' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name=' + quoteattr(name) + '/><pic:cNvPicPr/></pic:nvPicPr>\n<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>\n' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>\n</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }
  function num(v) { var n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? n : 0; }

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="102D4C"/><w:sz w:val="44"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="102D4C"/><w:sz w:val="32"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1D6572"/><w:sz w:val="28"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="HTHeadingNormal1"><w:name w:val="HT heading normal 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:color w:val="102D4C"/><w:sz w:val="32"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="HTHeadingNormal2"><w:name w:val="HT heading normal 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:color w:val="1D6572"/><w:sz w:val="28"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="HTHeadingNormal3"><w:name w:val="HT heading normal 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:sz w:val="25"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="HTPlainHeading1"><w:name w:val="HT plain heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="HTPlainHeading2"><w:name w:val="HT plain heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="140" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>\n' +
    '<w:style w:type="paragraph" w:styleId="HTPlainHeading3"><w:name w:val="HT plain heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="50"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>\n' +
    "</w:styles>";

  // Monta as partes do DOCX (texto XML e imagens); buildDocx compacta com o JSZip.
  function docxPartes(snapshot, assets, agora) {
    assets = assets || {};
    var metadata = get(snapshot, "metadata", null) || {};
    var elements = get(snapshot, "elements", null) || {};
    var model = get(snapshot, "model", null) || {};
    var blocks = isMap(model) ? get(model, "blocks", null) : null;
    if (!Array.isArray(blocks)) blocks = [];
    var rels = [], relPorAsset = {}, docpr = 1;
    function imageParagraph(image) {
      var id = str(get(image, "asset_id", ""));
      var asset = assets[id];
      if (!asset) return "";
      if (!relPorAsset[id]) {
        var n = rels.length + 1;
        var sourceName = str(asset.source_name) || "image-" + n + ".png";
        var ext = sufixo(sourceName).toLowerCase() || MIME_EXT[str(asset.mime_type)] || ".bin";
        if (!asset.data) return "";
        var r = { rid: "rIdImage" + n, target: "media/image" + n + ext, data: asset.data,
                  mime: str(asset.mime_type) || guessType(sourceName) || "application/octet-stream" };
        rels.push(r); relPorAsset[id] = r;
      }
      var w = num(get(image, "width_in", null) || 5.3);
      var hv = get(image, "height_in", null);
      var h = hv ? num(hv) : Math.min(4.0, Math.max(1.5, w * 0.62));
      var name = U().cpSlice(str(get(image, "alt", "") || asset.source_name || "Imagem") || "Imagem", 0, 120);
      var d = drawingXml(relPorAsset[id].rid, name, w, h, docpr);
      docpr++;
      return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + d + "</w:p>";
    }
    var body = [];
    var title = str(get(metadata, "title", "")) || "Informativo";
    body.push(paragraphXml(get(elements, "meta:title", title), { style: "Title", base_pt: 22 }));
    var number = U().pyStrip(str(get(metadata, "document_number", "")));
    var date = U().pyStrip(str(get(metadata, "date", "")));
    var department = U().pyStrip(str(get(metadata, "department", "")));
    var metaLine = [number, date].filter(Boolean).join(" · ");
    if (metaLine) body.push(paragraphXml(x(metaLine), { base_pt: 11 }));
    if (department) body.push(paragraphXml(x(department), { base_pt: 11 }));
    body.push("<w:p/>");
    function layoutValues(obj, baseLeft) {
      var indent, sb;
      try { indent = Math.max(0, Math.min(toInt(get(obj, "indent", 0) || 0), 8)); } catch (e) { indent = 0; }
      try { sb = Math.max(0, Math.min(toInt(get(obj, "space_before", 0) || 0), 6)); } catch (e) { sb = 0; }
      return [(baseLeft || 0) + indent * 360, sb * 120];
    }
    var BASE = { 1: 16, 2: 14, 3: 12.5 };
    if (blocks.length) {
      blocks.forEach(function (block) {
        var btype = str(get(block, "type", ""));
        var lv;
        if (btype === "heading" || btype === "hybrid") {
          var hv = get(elements, str(get(block, "key", "")), get(block, "content", ""));
          var level = Math.max(1, Math.min(3, toInt(get(block, "level", 1) || 1)));
          var styleName, baseSize;
          if (str(get(block, "visual_style", "")) === "plain") { styleName = "HTPlainHeading" + level; baseSize = 11; }
          else if (get(block, "source_all_bold", undefined) === false) { styleName = "HTHeadingNormal" + level; baseSize = BASE[level]; }
          else { styleName = "Heading" + level; baseSize = BASE[level]; }
          lv = layoutValues(block);
          body.push(paragraphXml(hv, { style: styleName, base_pt: baseSize, alignment: str(get(block, "align", "")) || "left", left_twips: lv[0], before_twips: lv[1] }));
        } else if (btype === "paragraph") {
          var pv = get(elements, str(get(block, "key", "")), get(block, "content", ""));
          lv = layoutValues(block);
          body.push(paragraphXml(pv, { base_pt: 11, boxed: str(get(block, "display", "")) === "notice", alignment: str(get(block, "align", "")) || "left", left_twips: lv[0], before_twips: lv[1] }));
        } else if (btype === "list") {
          var counters = new Map();
          (get(block, "items", null) || []).forEach(function (item) {
            var l = Math.max(0, Math.min(8, toInt(get(item, "level", 0) || 0)));
            Array.from(counters.keys()).filter(function (k) { return k > l; }).forEach(function (k) { counters.delete(k); });
            var explicit = get(item, "value", null);
            if (explicit !== null && explicit !== undefined) {
              try { counters.set(l, toInt(explicit)); } catch (e) { counters.set(l, (counters.has(l) ? counters.get(l) : 0) + 1); }
            } else if (!counters.has(l)) {
              try { counters.set(l, toInt(get(item, "start", null) || 1)); } catch (e) { counters.set(l, 1); }
            } else counters.set(l, counters.get(l) + 1);
            var ordered = !!get(item, "ordered", get(block, "ordered", undefined));
            var prefix = listLabelDocx(counters.get(l), str(get(item, "format", "")) || "decimal", ordered);
            var iv = get(elements, str(get(item, "key", "")), get(item, "content", ""));
            var lv2 = layoutValues(item, 360 + l * 360);
            body.push(paragraphXml(iv, { base_pt: 11, left_twips: lv2[0], before_twips: lv2[1], prefix: prefix, alignment: str(get(item, "align", "")) || "left" }));
          });
        } else if (btype === "table") {
          body.push(tableXml(block, elements, imageParagraph));
          body.push("<w:p/>");
        } else if (btype === "image") body.push(imageParagraph(block));
      });
    } else {
      Object.keys(elements).forEach(function (k) { body.push(paragraphXml(elements[k], { base_pt: 11 })); });
    }
    var sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"\n' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"\n xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"\n' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"\n xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body.join("") + sect + "</w:body></w:document>";
    var relXml = ['<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
    rels.forEach(function (r) { relXml.push('<Relationship Id="' + r.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + x(r.target) + '"/>'); });
    var documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relXml.join("") + "</Relationships>";
    var defaults = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>', '<Default Extension="xml" ContentType="application/xml"/>'];
    var vistos = {};
    rels.forEach(function (r) {
      var e = sufixo(r.target).replace(/^\./, "").toLowerCase();
      if (e && !vistos[e]) { defaults.push('<Default Extension="' + x(e) + '" ContentType="' + x(r.mime) + '"/>'); vistos[e] = 1; }
    });
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + defaults.join("") +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
    var now = (agora || new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
    var coreXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + x(title) +
      '</dc:title><dc:creator>H. Teixeira Contabilidade</dc:creator><cp:lastModifiedBy>H. Teixeira Informativos</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + "</dcterms:modified></cp:coreProperties>";
    var partes = [["[Content_Types].xml", contentTypes], ["_rels/.rels", rootRels], ["word/document.xml", documentXml], ["word/styles.xml", STYLES_XML],
                  ["word/_rels/document.xml.rels", documentRels], ["docProps/core.xml", coreXml]];
    rels.forEach(function (r) { partes.push(["word/" + r.target, r.data]); });
    return partes;
  }
  async function buildDocx(snapshot, assets, JSZipLib) {
    var Z = JSZipLib || raiz.JSZip;
    var zip = new Z();
    // sem entradas de pasta, como o zipfile do Python
    docxPartes(snapshot, assets).forEach(function (p) { zip.file(p[0], p[1], { compression: "DEFLATE", createFolders: false }); });
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // ZIP com todos os publicados (build_published_html_archive). docs: [{id, title, published_at, snapshot, assets, faltando:[nomes]}]
  async function buildHtmlZip(docs, logoUri, JSZipLib, agora) {
    var Z = JSZipLib || raiz.JSZip;
    if (!docs.length) throw new Error("Nenhum informativo publicado disponível para exportar.");
    var zip = new Z(), files = [], warnings = [], usados = {};
    docs.forEach(function (d) {
      (d.faltando || []).forEach(function (n) { warnings.push({ document_id: d.id, missing_asset: n }); });
      var title = str(get(get(d.snapshot, "metadata", null) || {}, "title", "")) || d.title || "Informativo";
      var base = safeExportFilename(title, ".html"), filename = base, n = 2;
      while (usados[filename.toLowerCase()]) { filename = base.slice(0, -5) + " (" + n + ").html"; n++; }
      usados[filename.toLowerCase()] = 1;
      zip.file(filename, buildHtml(d.snapshot, d.assets, logoUri), { compression: "DEFLATE" });
      files.push({ id: d.id, title: title, file: filename, published_at: d.published_at });
    });
    zip.file("manifest.json", JSON.stringify({
      format: "h-teixeira-informativos-html-zip", version: 1, created_at: (agora || new Date()).toISOString().replace(/\.\d{3}Z$/, "+00:00"),
      document_count: files.length, scope: "published-not-archived", documents: files, warnings: warnings
    }, null, 2), { compression: "DEFLATE" });
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  var api = { buildHtml: buildHtml, buildDocx: buildDocx, docxPartes: docxPartes, buildHtmlZip: buildHtmlZip, safeExportFilename: safeExportFilename, base64: base64 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.InfExportar = api;
})(typeof window !== "undefined" ? window : globalThis);
