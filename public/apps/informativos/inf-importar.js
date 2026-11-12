/*
 * Informativos no HUB — importação de DOCX, HTML e PDF (porte dos importadores do Infos HT 21.14).
 *
 * docx_importer.py, html_importer.py e pdf_importer.py rodavam no servidor local; aqui a leitura é feita
 * no próprio navegador de quem importa, com o mesmo resultado (modelo de blocos, campos editáveis,
 * imagens, estatísticas e alertas de revisão). O PDF é lido pela camada de texto com o pdf.js.
 *
 * Também roda no Node (testes de paridade): window.InfImportar / module.exports.
 */
(function (raiz) {
  "use strict";

  // ------------------------------------------------------------------ utilidades no comportamento do Python
  var PYS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  var WCH = "\\p{L}\\p{N}_";
  var BOUND = "(?:(?<=[" + WCH + "])(?![" + WCH + "])|(?<![" + WCH + "])(?=[" + WCH + "]))";
  var RE_PYWS = new RegExp("[" + PYS + "]", "u");
  var RE_PYWS_RUN = new RegExp("[" + PYS + "]+", "gu");

  // Converte uma expressão escrita como no Python (re) para JavaScript: \s, \S, \w e \b com o alcance
  // Unicode do Python e "." sem atravessar quebra de linha (como no Python).
  function py(src, flags) {
    var out = "", inCls = false;
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      if (c === "\\") {
        var d = src[++i];
        if (d === "s") out += inCls ? PYS : "[" + PYS + "]";
        else if (d === "S") out += "[^" + PYS + "]";
        else if (d === "w") out += inCls ? WCH : "[" + WCH + "]";
        else if (d === "b") out += BOUND;
        else out += "\\" + d;
        continue;
      }
      if (inCls) { if (c === "]") inCls = false; out += c; continue; }
      if (c === "[") { inCls = true; out += c; if (src[i + 1] === "^") { out += "^"; i++; } continue; }
      if (c === ".") { out += "[^\\n]"; continue; }
      out += c;
    }
    return new RegExp(out, (flags || "") + "u");
  }
  function pyStrip(s) {
    s = String(s == null ? "" : s);
    var a = 0, b = s.length;
    while (a < b && RE_PYWS.test(s[a])) a++;
    while (b > a && RE_PYWS.test(s[b - 1])) b--;
    return s.slice(a, b);
  }
  function pySplit(s) { s = pyStrip(s); return s ? s.split(RE_PYWS_RUN) : []; }
  function cps(s) { return Array.from(String(s)); }
  function cpLen(s) { var n = 0; for (var _ of String(s)) n++; return n; }
  function cpSlice(s, a, b) {
    s = String(s);
    // atalho: sem pares substitutos, o fatiamento comum é igual ao do Python
    if (!/[\ud800-\udfff]/.test(s)) return s.slice(a, b);
    return cps(s).slice(a, b).join("");
  }
  function casefold(s) { return String(s).toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ"); }
  function pyInt(v) {
    var s = pyStrip(String(v == null ? "" : v));
    if (!/^[+-]?\d+(?:_\d+)*$/.test(s)) throw new Error("int inválido: " + v);
    return parseInt(s.replace(/_/g, ""), 10);
  }
  function escTexto(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escAttr(s) { return escTexto(s).replace(/"/g, "&quot;").replace(/'/g, "&#x27;"); }
  function rstripChars(s, chars) { var b = s.length; while (b > 0 && chars.indexOf(s[b - 1]) >= 0) b--; return s.slice(0, b); }
  function stripChars(s, chars) { var a = 0; while (a < s.length && chars.indexOf(s[a]) >= 0) a++; return rstripChars(s.slice(a), chars); }

  // round() do Python (arredondamento correto sobre o valor exato do float, empate para o par)
  function pyRound(x, nd) {
    if (!isFinite(x) || x === 0) return x;
    var neg = x < 0; if (neg) x = -x;
    var buf = new DataView(new ArrayBuffer(8)); buf.setFloat64(0, x);
    var hi = buf.getUint32(0), lo = buf.getUint32(4);
    var exp = (hi >>> 20) & 0x7ff;
    var mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    if (exp) mant |= 1n << 52n; else exp = 1;
    var e2 = exp - 1075; // x = mant * 2^e2
    var num, den;
    if (e2 >= 0) { num = mant << BigInt(e2); den = 1n; } else { num = mant; den = 1n << BigInt(-e2); }
    var scale = 10n ** BigInt(nd);
    var t = num * scale;
    var q = t / den, r = t % den;
    if (r * 2n > den || (r * 2n === den && (q & 1n) === 1n)) q += 1n;
    var v = Number(q) / Number(scale);
    // reconstrói pelo texto decimal (evita erro de divisão em ponto flutuante)
    var s = q.toString().padStart(nd + 1, "0");
    v = Number(s.slice(0, s.length - nd) + "." + s.slice(s.length - nd));
    return neg ? -v : v;
  }

  function uuid4() {
    var c = typeof crypto !== "undefined" ? crypto : (typeof require === "function" ? require("crypto").webcrypto : null);
    if (c.randomUUID) return c.randomUUID();
    var b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function hex32() { return uuid4().replace(/-/g, ""); }

  // SHA-256 síncrono (o importador original calcula o hash durante a leitura)
  var K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(bytes) {
    var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    var m = new Uint8Array(total);
    m.set(bytes); m[len] = 0x80;
    var bits = len * 8;
    var dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 4294967296)); dv.setUint32(total - 4, bits >>> 0);
    var h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    var w = new Uint32Array(64);
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var t1 = (k + S1 + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
    }
    var out = "";
    for (i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, "0");
    return out;
  }

  // ------------------------------------------------------------------ referências de caractere (html.unescape)
  var LEGACY = ("AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT Iacute Icirc Igrave Iuml LT " +
    "Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml Yacute aacute acirc acute aelig agrave amp " +
    "aring atilde auml brvbar ccedil cedil cent copy curren deg divide eacute ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc " +
    "iexcl igrave iquest iuml laquo lt macr micro middot nbsp not ntilde oacute ocirc ograve ordf ordm oslash otilde ouml para plusmn " +
    "pound quot raquo reg sect shy sup1 sup2 sup3 szlig thorn times uacute ucirc ugrave uml uuml yacute yen yuml").split(" ");
  var LEGACY_SET = {}; LEGACY.forEach(function (n) { LEGACY_SET[n] = 1; });
  var textareaDec = null;
  // Decodifica "&nome" ou "&nome;" como o HTML5 (em dados de texto).
  function decodificarNomeado(token) {
    if (typeof raiz.__InfEntityDecode === "function") return raiz.__InfEntityDecode(token);
    if (typeof document !== "undefined") {
      textareaDec = textareaDec || document.createElement("textarea");
      textareaDec.innerHTML = token.replace(/</g, "&lt;");
      return textareaDec.value;
    }
    return token;
  }
  var CP1252 = { 0x80: 0x20ac, 0x81: 0x81, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030,
    0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8d: 0x8d, 0x8e: 0x17d, 0x8f: 0x8f, 0x90: 0x90, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d,
    0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9d: 0x9d, 0x9e: 0x17e, 0x9f: 0x178 };
  function codigoInvalido(n) {
    return (n >= 0x1 && n <= 0x8) || n === 0xb || (n >= 0xe && n <= 0x1f) || (n >= 0x7f && n <= 0x9f) || (n >= 0xfdd0 && n <= 0xfdef) ||
      ((n & 0xfffe) === 0xfffe && n <= 0x10ffff);
  }
  function charref(s) { // s sem "&"
    if (s[0] === "#") {
      var num = s[1] === "x" || s[1] === "X" ? parseInt(rstripChars(s.slice(2), ";"), 16) : parseInt(rstripChars(s.slice(1), ";"), 10);
      if (num === 0) return "\ufffd";
      if (num === 0x0d) return "\r";
      if (num >= 0x80 && num <= 0x9f) return String.fromCodePoint(CP1252[num]);
      if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return "\ufffd";
      if (codigoInvalido(num)) return "";
      return String.fromCodePoint(num);
    }
    if (/;$/.test(s) || LEGACY_SET[s]) {
      var d = decodificarNomeado("&" + s);
      if (d !== "&" + s) return d;
    }
    // prefixo legado mais longo
    for (var k = s.length - 1; k > 0; k--) {
      var x = s.slice(0, k);
      if (LEGACY_SET[x]) return decodificarNomeado("&" + x) + s.slice(k);
    }
    return "&" + s;
  }
  var RE_CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/g;
  function unescape(s) {
    s = String(s);
    if (s.indexOf("&") < 0) return s;
    return s.replace(RE_CHARREF, function (m, g) { return charref(g); });
  }
  function nomeExato(key) { // key em html5_entities?
    if (/;$/.test(key)) { var d = decodificarNomeado("&" + key); return d !== "&" + key && !/;$/.test(d); }
    return !!LEGACY_SET[key];
  }
  function unescapeAtributo(s) {
    return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*)[;=]?/g, function (ref) {
      if (ref.slice(0, 2) === "&#") return unescape(ref);
      if (ref.slice(-1) !== "=" && nomeExato(ref.slice(1))) return unescape(ref);
      return ref;
    });
  }

  // ------------------------------------------------------------------ nomes de arquivo
  function nomeBase(nome) { return String(nome || "").split(/[\\/]/).pop(); }
  function stem(nome) {
    var b = nomeBase(nome), i = b.lastIndexOf(".");
    return i > 0 && i < b.length - 1 ? b.slice(0, i) : (i === b.length - 1 && i > 0 ? b.slice(0, i) : b);
  }
  function sufixo(nome) {
    var b = nomeBase(nome), i = b.lastIndexOf(".");
    return i > 0 && i < b.length - 1 ? b.slice(i) : "";
  }
  function tituloDoArquivo(nome) { return pyStrip(stem(nome).replace(/[_-]+/g, " ")) || "Informativo"; }

  // ==================================================================================================
  // DOCX

  var W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  var R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  var A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  var WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  var DC = "http://purl.org/dc/elements/1.1/";

  var MAX_DOCX_UNCOMPRESSED = 80 * 1024 * 1024;
  var MAX_DOCX_ENTRIES = 5000;
  var MAX_ASSET_BYTES = 12 * 1024 * 1024;
  var MAX_ASSETS = 80;
  var MAX_BLOCKS = 3000;

  var HEADING_NUMBER_RE = py("^\\s*(\\d+(?:\\.\\d+){0,3})\\s*(?:[-–—:.)]\\s*|\\s+-\\s+)(\\S.*)$");
  var MANUAL_BULLET_RE = py("^\\s*[-–—•●▪◦]\\s+(\\S.*)$");
  var MANUAL_NUMBERED_LIST_RE = py("^\\s*(\\d{1,3})[.)]\\s+(\\S.*)$");
  var DOCX_DATE_RE = py("\\b(0?[1-9]|1[0-2])[/.-](20\\d{2})\\b");
  var DOCX_DOC_NUMBER_RE = py("\\b(?:n[º°o.]?\\s*)?([0-9]{1,4}\\s*/\\s*[0-9]{2,4})\\b", "i");
  var RE_TITULO_INFO = py("^\\s*INFORMATIVO(?:\\s+TÉCNICO)?\\s*[:\\-–—]\\s*(.+)$", "i");
  var RE_TITULO_CORTE = py("\\s+[|·]\\s+|\\s+n[º°o.]?\\s*\\d", "i");
  var RE_LINHA_NUMERO = py("\\b(?:INFORMATIVO(?:\\s+TÉCNICO)?\\s*[:\\-–—]?\\s*)?n[º°o.]?\\s*\\d", "i");
  var RE_DEPTO_UPPER = py("^\\s*(?:DEPTO\\.?|DEPARTAMENTO)\\b");
  var RE_CONTATO = py("^(?:whatsapp|telefone|tel\\.?|e-mail|email)\\b", "i");
  var RE_HEADING_STYLE = py("(?:heading|titulo|título)\\s*([1-9])");
  var RE_HEADER_PART = /^word\/(?:header|footer)[0-9]+\.xml$/;
  var SAFE_LINK_SCHEMES = { http: 1, https: 1, mailto: 1, tel: 1 };
  var MIME_POR_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jpe": "image/jpeg", ".jfif": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff" };

  function elementos(el) { var out = []; if (!el) return out; for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c); return out; }
  function eh(el, ns, local) { return !!el && el.namespaceURI === ns && el.localName === local; }
  function filho(el, ns, local) {
    if (!el) return null;
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === local) return c;
    return null;
  }
  function filhos(el, ns, local) { return elementos(el).filter(function (c) { return c.namespaceURI === ns && c.localName === local; }); }
  function caminho(el, passos) { for (var i = 0; el && i < passos.length; i++) el = filho(el, W, passos[i]); return el || null; }
  function descendentes(el, ns, local) { return el ? Array.prototype.slice.call(el.getElementsByTagNameNS(ns, local)) : []; }
  function atr(el, ns, nome, padrao) {
    if (padrao === undefined) padrao = "";
    if (!el) return padrao;
    if (ns) return el.hasAttributeNS(ns, nome) ? el.getAttributeNS(ns, nome) : padrao;
    return el.hasAttribute(nome) ? el.getAttribute(nome) : padrao;
  }
  function boolWord(el, padrao) {
    if (!el) return !!padrao;
    var v = casefold(atr(el, W, "val", "1"));
    return !(v === "0" || v === "false" || v === "off" || v === "no");
  }
  function textoEl(el) { return el ? el.textContent || "" : ""; }
  var RE_CLEAN_SPACE_DOCX = /[ \t\u00a0]+/g;
  function cleanSpaceDocx(t) { return pyStrip(String(t || "").replace(RE_CLEAN_SPACE_DOCX, " ")); }
  function plainFromHtml(fragment) {
    if (!fragment) return "";
    var t = fragment.replace(py("<br\\s*/?>", "gi"), "\n");
    t = t.replace(/<[^>]+>/g, "");
    return pyStrip(unescape(t));
  }
  function newKey(prefix) { return prefix + "-" + uuid4(); }
  function slugDocx(text, fallback) {
    var v = String(text || "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
    v = stripChars(v.replace(/[^a-zA-Z0-9]+/g, "-"), "-").toLowerCase();
    return v.slice(0, 55) || fallback || "sec";
  }
  function safeZipTarget(target) {
    target = String(target || "").replace(/\\/g, "/");
    var abs = target[0] === "/";
    var partes = (abs ? target : "word/" + target).split("/").filter(function (x) { return x !== "" && x !== "."; });
    if (partes.indexOf("..") >= 0) return null;
    var v = (abs ? "/" : "") + partes.join("/");
    return v.indexOf("word/") === 0 ? v : null;
  }
  function safeHref(value) {
    value = pyStrip(value || "");
    if (!value || value.length > 2048) return null;
    var m = /^([A-Za-z][A-Za-z0-9+\-.]*):/.exec(value);
    var scheme = m ? m[1].toLowerCase() : "";
    return SAFE_LINK_SCHEMES[scheme] ? value : null;
  }
  function decodificarXml(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    var t = new TextDecoder("utf-8").decode(bytes);
    return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
  }
  function lerXml(bytes) {
    if (!bytes) throw new Error("ausente");
    var Parser = raiz.DOMParser || (typeof DOMParser !== "undefined" ? DOMParser : null);
    var doc = new Parser().parseFromString(decodificarXml(bytes), "application/xml");
    if (!doc || !doc.documentElement || doc.getElementsByTagName("parsererror").length) throw new Error("XML inválido");
    return doc.documentElement;
  }

  // Lê do ZIP (JSZip) só o que o importador usa; o resto fica apenas na lista de nomes.
  async function lerPacoteDocx(zip) {
    var nomes = Object.keys(zip.files);
    var pacote = { nomes: {}, tamanhos: {}, dados: {} };
    var total = 0;
    nomes.forEach(function (n) {
      pacote.nomes[n] = 1;
      var f = zip.files[n];
      var t = f._data && typeof f._data.uncompressedSize === "number" ? f._data.uncompressedSize : 0;
      pacote.tamanhos[n] = t;
      total += Math.max(0, t);
    });
    pacote.quantidade = nomes.length;
    pacote.total = total;
    var precisa = nomes.filter(function (n) {
      return n === "word/document.xml" || n === "word/styles.xml" || n === "word/numbering.xml" || n === "word/_rels/document.xml.rels" ||
        n === "docProps/core.xml" || RE_HEADER_PART.test(n.toLowerCase()) ||
        (n.indexOf("word/") === 0 && n.indexOf("/media/") >= 0 && !zip.files[n].dir && pacote.tamanhos[n] <= MAX_ASSET_BYTES);
    });
    if (pacote.quantidade <= MAX_DOCX_ENTRIES && total <= MAX_DOCX_UNCOMPRESSED) {
      for (var i = 0; i < precisa.length; i++) pacote.dados[precisa[i]] = await zip.files[precisa[i]].async("uint8array");
    }
    return pacote;
  }
  function validarDocx(bytes, pacote) {
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error("O arquivo não possui estrutura ZIP/DOCX válida.");
    if (!pacote) throw new Error("O arquivo DOCX está corrompido ou não é um ZIP válido.");
    if (pacote.quantidade > MAX_DOCX_ENTRIES) throw new Error("DOCX possui quantidade excessiva de itens internos.");
    if (pacote.total > MAX_DOCX_UNCOMPRESSED) throw new Error("DOCX excede o limite seguro de conteúdo descompactado.");
    if (!pacote.nomes["word/document.xml"] || !pacote.nomes["[Content_Types].xml"]) throw new Error("O arquivo não contém a estrutura mínima de um DOCX.");
    if (Object.keys(pacote.nomes).some(function (n) { return /vbaproject\.bin$/.test(n.toLowerCase()); })) throw new Error("Arquivos DOCX com macros não são aceitos.");
  }

  function DocxParser(pacote, filename) {
    this.p = pacote;
    this.filename = filename;
    this.names = pacote.nomes;
    this.defaultFontSize = null;
    this.defaultBold = false;
    this.defaultItalic = false;
    this.styles = this.loadStyles();
    this.numbering = this.loadNumbering();
    this.relationships = this.loadRelationships();
    this.assetsByRel = {};
    this.assetsByTarget = {};
    this.assetsByHash = {};
    this.assets = [];
    this.warnings = [];
    this.counters = { hyperlinks: 0, blocked_links: 0, content_controls: 0, tracked_insertions: 0, merged_cells: 0, table_images: 0, visual_headings: 0 };
    this.detectedBy = {};
  }
  var D = DocxParser.prototype;
  D.warnOnce = function (m) { if (this.warnings.indexOf(m) < 0) this.warnings.push(m); };
  D.xml = function (nome) { try { return lerXml(this.p.dados[nome]); } catch (e) { return null; } };
  D.loadStyles = function () {
    var out = {};
    if (!this.names["word/styles.xml"]) return out;
    var root = this.xml("word/styles.xml");
    if (!root) return out;
    var defaults = caminho(root, ["docDefaults", "rPrDefault", "rPr"]);
    if (defaults) {
      var sz = filho(defaults, W, "sz");
      try { if (sz) this.defaultFontSize = pyInt(atr(sz, W, "val")) / 2; } catch (e) {}
      var b = filho(defaults, W, "b"), i = filho(defaults, W, "i");
      if (b) this.defaultBold = boolWord(b);
      if (i) this.defaultItalic = boolWord(i);
    }
    var self = this;
    filhos(root, W, "style").forEach(function (style) {
      var sid = atr(style, W, "styleId");
      if (!sid) return;
      var name = atr(filho(style, W, "name"), W, "val", sid);
      var based = atr(filho(style, W, "basedOn"), W, "val") || null;
      var outline = null, font = null, bold = null, italic = null, alignment = null;
      var ppr = filho(style, W, "pPr");
      if (ppr) {
        var lvl = filho(ppr, W, "outlineLvl");
        if (lvl) { try { outline = pyInt(atr(lvl, W, "val")); } catch (e) {} }
        var jc = filho(ppr, W, "jc");
        if (jc) alignment = self.normalizeAlignment(atr(jc, W, "val"));
      }
      var rpr = filho(style, W, "rPr");
      if (rpr) {
        var s2 = filho(rpr, W, "sz");
        try { if (s2) font = pyInt(atr(s2, W, "val")) / 2; } catch (e) {}
        var b2 = filho(rpr, W, "b"), i2 = filho(rpr, W, "i");
        if (b2) bold = boolWord(b2);
        if (i2) italic = boolWord(i2);
      }
      out[sid] = { style_id: sid, name: name, based_on: based, outline_level: outline, font_size_pt: font, bold: bold, italic: italic, alignment: alignment };
    });
    return out;
  };
  D.styleChain = function (sid) {
    var chain = [], seen = {}, cur = sid;
    for (var k = 0; k < 12; k++) {
      if (!cur || seen[cur]) break;
      seen[cur] = 1;
      var info = Object.prototype.hasOwnProperty.call(this.styles, cur) ? this.styles[cur] : null;
      if (!info) break;
      chain.push(info);
      cur = info.based_on;
    }
    return chain;
  };
  var ALIGN = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify", thai_distribute: "justify" };
  D.normalizeAlignment = function (v) { v = casefold(pyStrip(String(v || ""))); return Object.prototype.hasOwnProperty.call(ALIGN, v) ? ALIGN[v] : null; };
  D.styleParagraphAlignment = function (sid) {
    var ch = this.styleChain(sid);
    for (var i = 0; i < ch.length; i++) if (ch[i].alignment) return ch[i].alignment;
    return null;
  };
  D.styleRunDefaults = function (sid) {
    var size = null, bold = null, italic = null;
    this.styleChain(sid).forEach(function (info) {
      if (size === null && info.font_size_pt !== null) size = info.font_size_pt;
      if (bold === null && info.bold !== null) bold = info.bold;
      if (italic === null && info.italic !== null) italic = info.italic;
    });
    return [size !== null ? size : this.defaultFontSize, bold === null ? this.defaultBold : bold, italic === null ? this.defaultItalic : italic];
  };
  D.loadNumbering = function () {
    var out = {};
    if (!this.names["word/numbering.xml"]) return out;
    var root = this.xml("word/numbering.xml");
    if (!root) return out;
    var abstract = {};
    filhos(root, W, "abstractNum").forEach(function (an) {
      var aid = atr(an, W, "abstractNumId");
      var levels = {};
      filhos(an, W, "lvl").forEach(function (lvl) {
        var il; try { il = pyInt(atr(lvl, W, "ilvl", "0")); } catch (e) { il = 0; }
        var fmt = atr(filho(lvl, W, "numFmt"), W, "val", "decimal");
        var text = atr(filho(lvl, W, "lvlText"), W, "val", "");
        var start; try { start = pyInt(atr(filho(lvl, W, "start"), W, "val", "1")); } catch (e) { start = 1; }
        levels[il] = { format: fmt, text: text, start: Math.max(1, start) };
      });
      abstract[aid] = levels;
    });
    filhos(root, W, "num").forEach(function (num) {
      var nid = atr(num, W, "numId");
      var aid = atr(filho(num, W, "abstractNumId"), W, "val");
      var levels = {};
      var base = Object.prototype.hasOwnProperty.call(abstract, aid) ? abstract[aid] : {};
      Object.keys(base).forEach(function (k) { levels[k] = Object.assign({}, base[k]); });
      filhos(num, W, "lvlOverride").forEach(function (ov) {
        var il; try { il = pyInt(atr(ov, W, "ilvl", "0")); } catch (e) { il = 0; }
        var st = filho(ov, W, "startOverride");
        if (st) {
          var s; try { s = pyInt(atr(st, W, "val", "1")); } catch (e) { s = 1; }
          if (!levels[il]) levels[il] = { format: "decimal", text: "", start: 1 };
          levels[il].start = Math.max(1, s);
        }
        var lvl = filho(ov, W, "lvl");
        if (lvl) {
          var cur = levels[il] || {};
          var fmt = atr(filho(lvl, W, "numFmt"), W, "val", cur.format !== undefined ? cur.format : "decimal");
          var text = atr(filho(lvl, W, "lvlText"), W, "val", cur.text !== undefined ? cur.text : "");
          if (!levels[il]) levels[il] = { format: "decimal", text: "", start: 1 };
          levels[il].format = fmt; levels[il].text = text;
        }
      });
      out[nid] = levels;
    });
    return out;
  };
  D.loadRelationships = function () {
    var rels = {};
    var nome = "word/_rels/document.xml.rels";
    if (!this.names[nome]) return rels;
    var root = this.xml(nome);
    if (!root) return rels;
    elementos(root).forEach(function (rel) {
      var rid = atr(rel, null, "Id", "");
      if (!rid) return;
      rels[rid] = { target: atr(rel, null, "Target", ""), type: atr(rel, null, "Type", ""), mode: atr(rel, null, "TargetMode", "") };
    });
    return rels;
  };
  D.styleHeadingLevel = function (sid) {
    if (!sid) return null;
    var ch = this.styleChain(sid);
    for (var i = 0; i < ch.length; i++) {
      var vals = [ch[i].style_id, ch[i].name];
      for (var j = 0; j < 2; j++) {
        var norm = casefold(vals[j] || "").replace(/í/g, "i").replace(/ú/g, "u");
        var m = RE_HEADING_STYLE.exec(norm);
        if (m) return Math.min(Number(m[1]), 3);
      }
      if (ch[i].outline_level !== null && ch[i].outline_level >= 0 && ch[i].outline_level <= 2) return ch[i].outline_level + 1;
    }
    return null;
  };
  D.styleIsTitle = function (sid) {
    var ch = this.styleChain(sid);
    for (var i = 0; i < ch.length; i++) {
      var vs = [ch[i].style_id, ch[i].name].filter(Boolean).map(function (v) { return casefold(v).replace(RE_PYWS_RUN, ""); });
      if (vs.some(function (v) { return v === "title" || v === "titulo" || v === "título"; })) return true;
    }
    return false;
  };
  D.paragraphProps = function (p) {
    var ppr = filho(p, W, "pPr");
    var styleId = null, numId = null, ilvl = 0, outline = null, fsize = null, dbold = null, ditalic = null, alignment = null;
    if (ppr) {
      var st = filho(ppr, W, "pStyle");
      if (st) styleId = atr(st, W, "val") || null;
      var numpr = filho(ppr, W, "numPr");
      if (numpr) {
        numId = atr(filho(numpr, W, "numId"), W, "val") || null;
        try { ilvl = pyInt(atr(filho(numpr, W, "ilvl"), W, "val", "0")); } catch (e) { ilvl = 0; }
      }
      var jc = filho(ppr, W, "jc");
      if (jc) alignment = this.normalizeAlignment(atr(jc, W, "val"));
      var ol = filho(ppr, W, "outlineLvl");
      if (ol) { try { outline = pyInt(atr(ol, W, "val")); } catch (e) {} }
      var mrpr = filho(ppr, W, "rPr");
      if (mrpr) {
        var sz = filho(mrpr, W, "sz");
        try { if (sz) fsize = pyInt(atr(sz, W, "val")) / 2; } catch (e) {}
        var b = filho(mrpr, W, "b"), i = filho(mrpr, W, "i");
        if (b) dbold = boolWord(b);
        if (i) ditalic = boolWord(i);
      }
    }
    return { style_id: styleId, num_id: numId, ilvl: Math.max(0, Math.min(ilvl, 8)), outline_level: outline, font_size_pt: fsize, bold: dbold, italic: ditalic,
             alignment: alignment || this.styleParagraphAlignment(styleId) };
  };
  D.runHtml = function (run, dsize, dbold, ditalic) {
    var rpr = filho(run, W, "rPr");
    var bold = dbold, italic = ditalic, vert = "", size = dsize;
    if (rpr) {
      var b = filho(rpr, W, "b"), i = filho(rpr, W, "i");
      if (b) bold = boolWord(b);
      if (i) italic = boolWord(i);
      vert = atr(filho(rpr, W, "vertAlign"), W, "val");
      var sz = filho(rpr, W, "sz");
      try { if (sz) size = pyInt(atr(sz, W, "val")) / 2; } catch (e) {}
    }
    var pieces = [], images = [], hasText = false, self = this;
    elementos(run).forEach(function (c) {
      if (eh(c, W, "t")) {
        var txt = textoEl(c);
        if (txt) { pieces.push(escTexto(txt)); hasText = hasText || !!pyStrip(txt); }
      } else if (eh(c, W, "tab")) pieces.push("&emsp;");
      else if (eh(c, W, "br") || eh(c, W, "cr")) pieces.push("<br>");
      else if (eh(c, W, "drawing") || eh(c, W, "pict")) images = images.concat(self.imagesFromNode(c));
    });
    var frag = pieces.join("");
    if (frag) {
      if (vert === "superscript") frag = "<sup>" + frag + "</sup>";
      else if (vert === "subscript") frag = "<sub>" + frag + "</sub>";
      if (italic) frag = "<em>" + frag + "</em>";
      if (bold) frag = "<strong>" + frag + "</strong>";
    }
    return [frag, images, hasText ? bold : false, size];
  };
  D.imagesFromNode = function (node) {
    var out = [], self = this;
    descendentes(node, A, "blip").forEach(function (blip) {
      var rid = atr(blip, R, "embed") || atr(blip, R, "link");
      if (!rid) return;
      var asset = self.assetForRelationship(rid);
      if (!asset) return;
      var rec = { asset_id: asset.id };
      var ext = descendentes(node, WP, "extent")[0];
      if (ext) {
        try {
          var cx = pyInt(atr(ext, null, "cx", "0")), cy = pyInt(atr(ext, null, "cy", "0"));
          rec.width_in = pyRound(cx / 914400, 3);
          rec.height_in = pyRound(cy / 914400, 3);
        } catch (e) {}
      }
      var props = descendentes(node, WP, "docPr")[0];
      if (props) {
        var alt = atr(props, null, "descr", "") || atr(props, null, "title", "") || "";
        if (alt) rec.alt = cpSlice(alt, 0, 300);
      }
      out.push(rec);
    });
    return out;
  };
  D.assetForRelationship = function (rid) {
    if (Object.prototype.hasOwnProperty.call(this.assetsByRel, rid)) return this.assetsByRel[rid];
    var rel = this.relationships[rid];
    if (!rel || rel.mode === "External") return null;
    var target = safeZipTarget(rel.target);
    if (!target || !this.names[target] || target.indexOf("/media/") < 0) return null;
    if (this.assetsByTarget[target]) { this.assetsByRel[rid] = this.assetsByTarget[target]; return this.assetsByRel[rid]; }
    if (this.assets.length >= MAX_ASSETS) { this.warnOnce("Limite de imagens atingido; imagens excedentes foram ignoradas."); return null; }
    var nomeArq = target.split("/").pop();
    if (this.p.tamanhos[target] > MAX_ASSET_BYTES) { this.warnings.push("Imagem ignorada por exceder o limite seguro: " + nomeArq); return null; }
    var data = this.p.dados[target];
    if (!data) return null;
    var ext = sufixo(nomeArq).toLowerCase() || ".bin";
    var mime = MIME_POR_EXT[ext] || "application/octet-stream";
    if (!/^image\/(png|jpeg|gif|webp|bmp|tiff)$/.test(mime)) return null;
    var digest = sha256(data);
    if (this.assetsByHash[digest]) {
      this.assetsByTarget[target] = this.assetsByHash[digest];
      this.assetsByRel[rid] = this.assetsByHash[digest];
      return this.assetsByRel[rid];
    }
    var asset = { id: newKey("asset"), source_name: cpSlice(nomeArq, 0, 180), extension: ext.slice(0, 10), mime_type: mime, sha256: digest, bytes: data };
    this.assets.push(asset);
    this.assetsByHash[digest] = asset; this.assetsByTarget[target] = asset; this.assetsByRel[rid] = asset;
    return asset;
  };
  D.hyperlinkHref = function (node) {
    var rid = atr(node, R, "id");
    if (!rid) return null;
    var rel = this.relationships[rid];
    if (!rel || casefold(rel.type || "").indexOf("hyperlink") < 0) return null;
    var safe = safeHref(rel.target || "");
    if (safe) { this.counters.hyperlinks++; return safe; }
    this.counters.blocked_links++;
    this.warnOnce("Um ou mais hyperlinks com protocolo não permitido foram mantidos apenas como texto.");
    return null;
  };
  D.inlineContent = function (parent, dsize, dbold, ditalic) {
    var parts = [], images = [], bolds = [], sizes = [], self = this;
    function junta(r) { parts.push.apply(parts, r[0]); images.push.apply(images, r[1]); bolds.push.apply(bolds, r[2]); sizes.push.apply(sizes, r[3]); }
    elementos(parent).forEach(function (c) {
      var local = c.localName;
      if (eh(c, W, "r")) {
        var r = self.runHtml(c, dsize, dbold, ditalic);
        parts.push(r[0]); images.push.apply(images, r[1]);
        if (plainFromHtml(r[0])) bolds.push(r[2]);
        if (r[3] !== null && r[3] !== undefined) sizes.push(r[3]);
      } else if (eh(c, W, "hyperlink")) {
        var sub = self.inlineContent(c, dsize, dbold, ditalic);
        var frag = sub[0].join("");
        var href = self.hyperlinkHref(c);
        if (href && frag) frag = '<a href="' + escAttr(href) + '">' + frag + "</a>";
        parts.push(frag); images.push.apply(images, sub[1]); bolds.push.apply(bolds, sub[2]); sizes.push.apply(sizes, sub[3]);
      } else if (local === "ins" || local === "moveTo") {
        self.counters.tracked_insertions++;
        junta(self.inlineContent(c, dsize, dbold, ditalic));
      } else if (local === "del" || local === "moveFrom") {
        return;
      } else if (local === "smartTag" || local === "fldSimple" || local === "customXml") {
        junta(self.inlineContent(c, dsize, dbold, ditalic));
      } else if (eh(c, W, "sdt")) {
        self.counters.content_controls++;
        var content = filho(c, W, "sdtContent");
        if (content) junta(self.inlineContent(content, dsize, dbold, ditalic));
      }
    });
    return [parts, images, bolds, sizes];
  };
  D.paragraphContent = function (p, props) {
    props = props || this.paragraphProps(p);
    var d = this.styleRunDefaults(props.style_id);
    var r = this.inlineContent(p, d[0], d[1], d[2]);
    var fragment = pyStrip(r[0].join(""));
    var text = plainFromHtml(fragment);
    var allBold = r[2].length > 0 && r[2].every(Boolean);
    var maxSize = r[3].length ? Math.max.apply(null, r[3]) : (text ? d[0] : null);
    return { html: fragment, text: text, images: r[1], all_bold: allBold, max_size: maxSize === undefined ? null : maxSize };
  };
  D.cellParagraphs = function* (tc) {
    var ks = elementos(tc);
    for (var i = 0; i < ks.length; i++) {
      var c = ks[i];
      if (eh(c, W, "p")) yield c;
      else if (eh(c, W, "sdt")) {
        var content = filho(c, W, "sdtContent");
        if (content) { this.counters.content_controls++; yield* this.cellParagraphs(content); }
      } else if (eh(c, W, "customXml")) yield* this.cellParagraphs(c);
      else if (eh(c, W, "tbl")) this.warnOnce("Tabela aninhada detectada: o conteúdo da tabela interna pode exigir revisão manual.");
    }
  };
  D.tableBlock = function (tbl) {
    var self = this;
    var trs = filhos(tbl, W, "tr");
    var explicitExists = trs.some(function (tr) { return !!caminho(tr, ["trPr", "tblHeader"]); });
    var look = caminho(tbl, ["tblPr", "tblLook"]);
    var lookFirst = ["1", "true", "on"].indexOf(atr(look, W, "firstRow", "0")) >= 0;
    var rows = [], prevV = {}, firstRowAllBold = true;
    trs.forEach(function (tr, rIndex) {
      var trpr = filho(tr, W, "trPr");
      var explicitHeader = !!trpr && !!filho(trpr, W, "tblHeader");
      var cells = [], newV = {}, col = 0, rowAllBold = true;
      filhos(tr, W, "tc").forEach(function (tc) {
        var tcpr = filho(tc, W, "tcPr");
        var span = 1;
        if (tcpr) {
          var grid = filho(tcpr, W, "gridSpan");
          try { if (grid) span = Math.max(1, Math.min(pyInt(atr(grid, W, "val", "1")), 40)); } catch (e) { span = 1; }
        }
        var vm = tcpr ? filho(tcpr, W, "vMerge") : null;
        var mode = null;
        if (vm) mode = atr(vm, W, "val", "continue") || "continue";
        if (mode === "continue") {
          var base = prevV[col];
          if (base) {
            base.rowspan = Math.max(1, Number(base.rowspan || 1)) + 1;
            var cs = Math.max(1, Number(base.colspan !== undefined ? base.colspan : span));
            for (var o = 0; o < cs; o++) newV[col + o] = base;
            col += span;
            return;
          }
          self.warnOnce("Mesclagem vertical inconsistente detectada em tabela; revisar a tabela importada.");
        }
        var frags = [], cellImages = [], pBolds = [], pAligns = [];
        for (var p of self.cellParagraphs(tc)) {
          var props = self.paragraphProps(p);
          var content = self.paragraphContent(p, props);
          if (content.html) {
            frags.push(content.html);
            pBolds.push(!!content.all_bold);
            if (props.alignment) pAligns.push(String(props.alignment));
          }
          cellImages.push.apply(cellImages, content.images);
        }
        if (pBolds.length && !pBolds.every(Boolean)) rowAllBold = false;
        else if (!pBolds.length) rowAllBold = false;
        var cell = { key: newKey("cell"), content: frags.join("<br>"), header: explicitHeader, colspan: span, rowspan: 1, align: pAligns.length ? pAligns[0] : "left" };
        if (cellImages.length) { cell.images = cellImages; self.counters.table_images += cellImages.length; }
        cells.push(cell);
        if (span > 1) self.counters.merged_cells++;
        if (mode === "restart") for (var o2 = 0; o2 < span; o2++) newV[col + o2] = cell;
        col += span;
      });
      if (rIndex === 0) firstRowAllBold = rowAllBold;
      if (cells.length) rows.push(cells);
      prevV = newV;
    });
    var vistos = new Set();
    rows.forEach(function (row) {
      row.forEach(function (cell) {
        if (Number(cell.rowspan || 1) > 1 && !vistos.has(cell)) { self.counters.merged_cells++; vistos.add(cell); }
      });
    });
    if (rows.length && !explicitExists && (lookFirst || firstRowAllBold)) rows[0].forEach(function (c) { c.header = true; });
    return { id: newKey("tbl"), type: "table", rows: rows };
  };
  D.numericHeadingCandidate = function (text) {
    var m = HEADING_NUMBER_RE.exec(text || "");
    if (!m) return null;
    var token = m[1];
    var parts = token.split(".");
    if (!parts.every(function (x) { return /^[0-9]+$/.test(x); })) return null;
    if (parts.some(function (x) { return x.length > 1 && x[0] === "0"; })) return null;
    var nums = parts.map(Number);
    return { token: token, numbers: nums, depth: Math.min(nums.length, 3), tail: m[2] };
  };
  D.classifyParagraph = function (props, content) {
    var text = content.text;
    var dol = props.outline_level;
    if (typeof dol === "number" && dol >= 0 && dol <= 2) return ["heading", { level: dol + 1, reason: "direct_outline" }];
    var sl = this.styleHeadingLevel(props.style_id);
    if (sl) return ["heading", { level: sl, reason: "word_style" }];
    var info = props.style_id && Object.prototype.hasOwnProperty.call(this.styles, props.style_id) ? this.styles[props.style_id] : null;
    var sname = casefold(info ? info.name : (props.style_id || ""));
    if (sname.indexOf("list bullet") >= 0 || sname.indexOf("lista com marcador") >= 0 || sname.indexOf("marcador") >= 0)
      return ["list_item", { level: 0, ordered: false, format: "bullet", num_id: "style:" + (props.style_id === null ? "None" : props.style_id) }];
    if (sname.indexOf("list number") >= 0 || sname.indexOf("lista numerada") >= 0 || sname.indexOf("numeração") >= 0 || sname.indexOf("numeracao") >= 0)
      return ["list_item", { level: 0, ordered: true, format: "decimal", num_id: "style:" + (props.style_id === null ? "None" : props.style_id) }];
    if (props.num_id) {
      var lv = (this.numbering[props.num_id] || {})[props.ilvl] || {};
      var fmt = lv.format !== undefined ? lv.format : "decimal";
      return ["list_item", { level: props.ilvl, ordered: fmt !== "bullet" && fmt !== "none", format: fmt, start: lv.start !== undefined ? lv.start : 1, num_id: props.num_id }];
    }
    var m = MANUAL_BULLET_RE.exec(text);
    if (m && cpLen(text) <= 2000) return ["list_item", { level: 0, ordered: false, format: "bullet", manual_text: m[1], num_id: "manual-bullet" }];
    m = MANUAL_NUMBERED_LIST_RE.exec(text);
    if (m && cpLen(text) <= 2000 && !content.all_bold)
      return ["list_item", { level: 0, ordered: true, format: "decimal", manual_text: m[2], value: Number(m[1]), num_id: "manual-number" }];
    return ["paragraph", {}];
  };
  D.simplePartTexts = function (nome) {
    if (!this.names[nome]) return [];
    var root = this.xml(nome);
    if (!root) return [];
    var out = [];
    descendentes(root, W, "p").forEach(function (p) {
      var t = cleanSpaceDocx(descendentes(p, W, "t").map(textoEl).join(""));
      if (t) out.push(t);
    });
    return out;
  };
  D.headerFooterTexts = function () {
    var out = [], self = this;
    Object.keys(this.names).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; }).forEach(function (n) {
      if (RE_HEADER_PART.test(casefold(n))) out.push.apply(out, self.simplePartTexts(n));
    });
    return out.slice(0, 80);
  };
  D.coreTitle = function () {
    if (!this.names["docProps/core.xml"]) return "";
    var root = this.xml("docProps/core.xml");
    if (!root) return "";
    var t = filho(root, DC, "title");
    return t ? cpSlice(cleanSpaceDocx(textoEl(t)), 0, 180) : "";
  };
  D.metadataCandidates = function (paragraphs) {
    var self = this;
    var metadata = { title: cpSlice(tituloDoArquivo(this.filename), 0, 180), document_number: "", date: "", department: "" };
    var sources = { title: "filename", document_number: "", date: "", department: "" };
    var consumed = new Set();
    function scan(text, sid, idx, consume) {
      if (!text) return;
      var upper = text.toUpperCase();
      var matched = false;
      var mt = RE_TITULO_INFO.exec(text);
      if (mt && cpLen(text) <= 280) {
        if (consume || sources.title === "filename") {
          var tv = cleanSpaceDocx(mt[1]);
          var corte = RE_TITULO_CORTE.exec(tv);
          tv = pyStrip(corte ? tv.slice(0, corte.index) : tv) || tv;
          metadata.title = cpSlice(tv, 0, 180);
          sources.title = consume ? "document_body" : "header_footer";
        }
        matched = true;
      } else if (consume && self.styleIsTitle(sid) && cpLen(text) <= 220) {
        metadata.title = cpSlice(cleanSpaceDocx(text), 0, 180);
        sources.title = "word_title_style";
        matched = true;
      }
      if (!metadata.department && RE_DEPTO_UPPER.test(upper) && cpLen(text) <= 180) {
        metadata.department = cpSlice(cleanSpaceDocx(text), 0, 100);
        sources.department = consume ? "document_body" : "header_footer";
        matched = true;
      }
      if (!metadata.date) {
        var md = DOCX_DATE_RE.exec(text);
        if (md && cpLen(text) <= 160) {
          metadata.date = String(Number(md[1])).padStart(2, "0") + "/" + md[2];
          sources.date = consume ? "document_body" : "header_footer";
          matched = true;
        }
      }
      if (!metadata.document_number) {
        var mn = DOCX_DOC_NUMBER_RE.exec(text);
        var linha = RE_LINHA_NUMERO.test(text);
        if (mn && linha && cpLen(text) <= 180) {
          metadata.document_number = "nº " + mn[1].replace(/ /g, "");
          sources.document_number = consume ? "document_body" : "header_footer";
          matched = true;
        }
      }
      if (consume && matched && idx !== null) consumed.add(idx);
    }
    paragraphs.slice(0, 18).forEach(function (it) { scan(it.text, it.style_id, it.index, true); });
    this.headerFooterTexts().forEach(function (t) { scan(t, null, null, false); });
    if (sources.title === "filename") {
      var ct = this.coreTitle();
      if (ct) { metadata.title = ct; sources.title = "core_properties"; }
    }
    if (!metadata.department) { metadata.department = "Departamento Tributário"; sources.department = "default"; }
    return [metadata, consumed, sources];
  };
  D.flowChildren = function* (container) {
    var ks = elementos(container);
    for (var i = 0; i < ks.length; i++) {
      var c = ks[i], local = c.localName;
      if (eh(c, W, "p") || eh(c, W, "tbl")) yield c;
      else if (eh(c, W, "sdt")) {
        this.counters.content_controls++;
        var content = filho(c, W, "sdtContent");
        if (content) yield* this.flowChildren(content);
      } else if (eh(c, W, "customXml")) yield* this.flowChildren(c);
      else if (local === "ins" || local === "moveTo") { this.counters.tracked_insertions++; yield* this.flowChildren(c); }
      else if (local === "del" || local === "moveFrom") continue;
      else if (local === "altChunk") this.warnOnce("Conteúdo altChunk detectado e não importado; revisar o DOCX caso haja conteúdo externo incorporado.");
    }
  };
  function mediana(v) {
    var s = v.slice().sort(function (a, b) { return a - b; });
    var n = s.length, h = Math.floor(n / 2);
    return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }
  D.estimateBodyFont = function (paragraphs, consumed) {
    var sizes = [], self = this;
    paragraphs.forEach(function (it) {
      if (consumed.has(it.index)) return;
      if (self.styleHeadingLevel(it.props.style_id)) return;
      var v = it.content.max_size;
      if (typeof v === "number" && v >= 7 && v <= 20) sizes.push(v);
    });
    if (sizes.length) return mediana(sizes);
    return this.defaultFontSize || 11.0;
  };
  D.visualHeading = function (content, bodyFont, seenHeading) {
    var text = cleanSpaceDocx(content.text || "");
    var size = content.max_size;
    if (!text || !content.all_bold || typeof size !== "number") return null;
    var words = pySplit(text);
    if (!(words.length >= 2 && words.length <= 22 && cpLen(text) <= 180)) return null;
    if (/\.$/.test(text) && !/\.\.\.$/.test(text)) return null;
    if (text.indexOf("@") >= 0 || RE_CONTATO.test(text)) return null;
    var delta = size - bodyFont;
    if (delta < 1.5) return null;
    var level = delta >= 2.75 || !seenHeading ? 1 : 2;
    this.counters.visual_headings++;
    return ["heading", { level: level, reason: "visual_emphasis" }];
  };
  D.imageBlock = function (image) {
    var b = { id: newKey("imgblk"), type: "image", asset_id: image.asset_id, alt: cpSlice(String(image.alt !== undefined ? image.alt : ""), 0, 300) };
    ["width_in", "height_in"].forEach(function (k) {
      var v = image[k];
      if (typeof v === "number" && v > 0) b[k] = Math.min(v, 20.0);
    });
    return b;
  };
  function fontePt(v) { return typeof v === "number" ? pyRound(v, 2) : null; }
  D.parse = function () {
    var self = this;
    var root;
    try { root = lerXml(this.p.dados["word/document.xml"]); } catch (e) { throw new Error("Não foi possível interpretar word/document.xml."); }
    var body = filho(root, W, "body");
    if (!body) throw new Error("DOCX sem corpo de documento reconhecível.");
    var raw = [], cands = [], index = 0;
    for (var c of this.flowChildren(body)) {
      if (raw.length >= MAX_BLOCKS) { this.warnings.push("O documento foi truncado por exceder o limite de blocos suportado."); break; }
      if (eh(c, W, "p")) {
        var props = this.paragraphProps(c);
        var content = this.paragraphContent(c, props);
        var item = { index: index, kind: "p", node: c, props: props, content: content, text: content.text, style_id: props.style_id };
        raw.push(item);
        if (content.text) cands.push(item);
        index++;
      } else {
        raw.push({ index: index, kind: "table", node: c });
        index++;
      }
    }
    var mc = this.metadataCandidates(cands);
    var metadata = mc[0], consumed = mc[1], metaSources = mc[2];
    var bodyFont = this.estimateBodyFont(cands, consumed);
    var blocks = [], elements = {};
    var headingCount = 0, hybridCount = 0, listCount = 0, tableCount = 0, imageCount = 0;
    var seenHeading = false, started = false, lastTop = null, curSub = null, pending = null;
    function flushList() {
      if (pending && pending.items.length) { blocks.push(pending); listCount++; }
      pending = null;
    }
    function record(reason) { self.detectedBy[reason] = (self.detectedBy[reason] || 0) + 1; }
    raw.forEach(function (it) {
      if (it.kind === "table") {
        flushList();
        started = true;
        var table = self.tableBlock(it.node);
        if (table.rows.length) {
          blocks.push(table); tableCount++;
          table.rows.forEach(function (row) { row.forEach(function (cell) { elements[cell.key] = cell.content; imageCount += (cell.images || []).length; }); });
        }
        return;
      }
      if (consumed.has(it.index)) return;
      var content = it.content;
      if (!content.text && !content.images.length) return;
      if (!content.text && content.images.length) {
        if (!started) return;
        content.images.forEach(function (img) { flushList(); blocks.push(self.imageBlock(img)); imageCount++; });
        return;
      }
      started = true;
      var cl = self.classifyParagraph(it.props, content);
      var kind = cl[0], detail = cl[1];
      var numeric = self.numericHeadingCandidate(content.text);
      if (kind === "paragraph" && numeric) {
        var nums = numeric.numbers, depth = numeric.depth, tlen = cpLen(content.text);
        if (depth === 1) {
          var n = nums[0];
          var plaus = (lastTop === null && n >= 1 && n <= 10) || (lastTop !== null && lastTop < n && n <= lastTop + 2);
          if (plaus && tlen <= 360) { kind = "heading"; detail = { level: 1, reason: "numeric_sequence", number: n }; }
          else if (plaus && tlen > 360) { kind = "hybrid"; detail = { level: 1, reason: "numeric_sequence_long", number: n }; }
        } else if (depth === 2 && lastTop !== null && nums[0] === lastTop && tlen <= 360) {
          if (curSub === null || nums[1] >= curSub) { kind = "heading"; detail = { level: 2, reason: "numeric_sequence", number: nums[1] }; }
        } else if (depth >= 3 && lastTop !== null && nums[0] === lastTop && tlen <= 180 && content.all_bold) {
          kind = "heading"; detail = { level: 3, reason: "numeric_sequence", number: nums[nums.length - 1] };
        }
      }
      if (kind === "paragraph" && !numeric) {
        var vis = self.visualHeading(content, bodyFont, seenHeading);
        if (vis) { kind = vis[0]; detail = vis[1]; }
      }
      var ms = content.max_size;
      if (kind === "heading") {
        flushList();
        var key = newKey("head");
        var level = Number(detail.level);
        var reason = detail.reason || "unknown";
        record(reason);
        blocks.push({
          id: newKey("blk"), type: "heading", level: level, key: key, content: content.html,
          anchor: "sec-" + slugDocx(content.text) + "-" + hex32().slice(0, 7), detected_by: reason,
          align: it.props.alignment || "left", source_all_bold: !!content.all_bold, source_font_size_pt: fontePt(ms),
          visual_style: reason === "numeric_sequence" && !content.all_bold && (typeof ms !== "number" || ms <= bodyFont + 0.75) ? "plain" : "heading"
        });
        elements[key] = content.html;
        headingCount++;
        seenHeading = true;
        var nh = self.numericHeadingCandidate(content.text);
        if (level === 1) { curSub = null; if (nh && nh.depth === 1) lastTop = nh.numbers[0]; }
        else if (level === 2 && nh && nh.depth >= 2) curSub = nh.numbers[1];
      } else if (kind === "hybrid") {
        flushList();
        var hk = newKey("hybrid");
        var nh2 = self.numericHeadingCandidate(content.text);
        var number = nh2 ? nh2.numbers[0] : null;
        var tail = nh2 ? nh2.tail : content.text;
        var words = pySplit(cleanSpaceDocx(tail));
        var shortTail = words.slice(0, 10).join(" ") + (words.length > 10 ? "…" : "");
        var toc = number !== null ? number + " - " + shortTail : shortTail;
        var hr = detail.reason || "numeric_sequence_long";
        record(hr);
        blocks.push({
          id: newKey("blk"), type: "hybrid", level: 1, key: hk, content: content.html,
          anchor: "sec-" + slugDocx(content.text) + "-" + hex32().slice(0, 7), toc_label: cpSlice(toc, 0, 180), detected_by: hr,
          align: it.props.alignment || "left", source_all_bold: !!content.all_bold, source_font_size_pt: fontePt(ms)
        });
        elements[hk] = content.html;
        hybridCount++;
        seenHeading = true;
        if (number !== null) { lastTop = number; curSub = null; }
      } else if (kind === "list_item") {
        var ordered = !!detail.ordered;
        var lvl = Number(detail.level || 0);
        var group = detail.num_id || (ordered ? "ordered" : "bullet");
        if (!pending || pending._group !== group) {
          flushList();
          pending = { id: newKey("list"), type: "list", ordered: ordered, items: [], _group: group };
        }
        var lk = newKey("li");
        var value = content.html;
        if (detail.manual_text !== undefined) value = escTexto(detail.manual_text);
        var li = { key: lk, level: lvl, ordered: ordered, format: String(detail.format || (ordered ? "decimal" : "bullet")).slice(0, 30), content: value,
                   align: it.props.alignment || "left" };
        if (typeof detail.value === "number" && detail.value > 0) li.value = Math.min(detail.value, 1000000);
        if (typeof detail.start === "number" && detail.start > 1) li.start = Math.min(detail.start, 1000000);
        pending.items.push(li);
        elements[lk] = value;
      } else {
        flushList();
        var pk = newKey("p");
        var block = { id: newKey("blk"), type: "paragraph", key: pk, content: content.html, role: !seenHeading ? "intro" : "body", align: it.props.alignment || "left" };
        var pl = casefold(content.text);
        if (pl.indexOf("para maiores informações") === 0 || pl.indexOf("para maiores informacoes") === 0) block.role = "contact";
        else if (pl.indexOf("recebido por:") === 0 || pl.indexOf("recebido por ") === 0) block.role = "acknowledgement";
        blocks.push(block);
        elements[pk] = content.html;
      }
      content.images.forEach(function (img) { flushList(); blocks.push(self.imageBlock(img)); imageCount++; });
    });
    flushList();
    blocks.forEach(function (b) { delete b._group; });
    if (!blocks.length) throw new Error("Nenhum conteúdo textual, tabela ou imagem pôde ser extraído do DOCX.");
    if (headingCount === 0) this.warnOnce("Nenhum título estrutural foi detectado. O Sumário usará um rótulo genérico até que o administrador ajuste a hierarquia.");
    if (this.counters.visual_headings) {
      this.warnOnce(this.counters.visual_headings + " título(s) foram inferidos por aparência visual (negrito/tamanho). Recomenda-se revisar o Sumário antes da publicação.");
    }
    var det = {};
    Object.keys(this.detectedBy).sort().forEach(function (k) { det[k] = self.detectedBy[k]; });
    var stats = {
      blocks: blocks.length, headings: headingCount, hybrid_sections: hybridCount, lists: listCount, tables: tableCount, images: imageCount,
      editable_fields: Object.keys(elements).length, hyperlinks: this.counters.hyperlinks, merged_cells: this.counters.merged_cells,
      content_controls: this.counters.content_controls, tracked_insertions: this.counters.tracked_insertions, visual_headings: this.counters.visual_headings,
      heading_detection: det, body_font_estimate_pt: pyRound(bodyFont, 2)
    };
    var reviewRequired = !!(this.warnings.length || headingCount === 0 || this.counters.visual_headings);
    return {
      metadata: metadata,
      model: { schema_version: 1, source_type: "docx", blocks: blocks },
      elements: elements,
      assets: this.assets,
      warnings: unicos(this.warnings),
      stats: stats,
      review: { required: reviewRequired, summary: reviewRequired ? "Revisão estrutural recomendada antes da publicação." : "Estrutura importada sem alertas automáticos.",
                metadata_sources: metaSources }
    };
  };
  function unicos(lista) { var out = []; lista.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); return out; }

  // bytes: Uint8Array do arquivo; JSZipLib: construtor JSZip
  async function parseDocx(bytes, filename, JSZipLib) {
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error("O arquivo não possui estrutura ZIP/DOCX válida.");
    var Z = JSZipLib || raiz.JSZip;
    var zip;
    try { zip = await Z.loadAsync(bytes); } catch (e) { throw new Error("O arquivo DOCX está corrompido ou não é um ZIP válido."); }
    var pacote = await lerPacoteDocx(zip);
    validarDocx(bytes, pacote);
    return new DocxParser(pacote, filename).parse();
  }

  // ==================================================================================================
  // HTML

  var HTML_MAX_ASSETS = 250;
  var MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  var HTML_DATE_RE = py("(?<!\\d)(0?[1-9]|1[0-2])\\s*[/\\-]\\s*(20\\d{2})(?!\\d)");
  var HTML_DOC_NUMBER_RE = py("(?:\\b(?:info(?:rmativo)?(?:\\s+t[eé]cnico)?\\s*)?)?\\bn[º°o.]?\\s*(\\d{1,4}\\s*/\\s*\\d{2,4})", "i");
  var NUMBERED_HEADING_RE = py("^\\s*(\\d+(?:\\.\\d+){0,2})\\s*(?:[-–—.)]|\\s)\\s*(\\S.*)$");
  var RE_DEPTO_I = py("^(?:DEPTO\\.?|DEPARTAMENTO)(?:\\s|$)", "i");

  function cleanSpace(v) { return pyStrip(String(v == null ? "" : v).replace(RE_PYWS_RUN, " ")); }
  function slugHtml(v) { return stripChars(casefold(cleanSpace(v)).replace(/[^a-z0-9]+/g, "-"), "-").slice(0, 70) || "secao"; }
  function keyHex(prefix) { return prefix + "-" + hex32(); }

  function Node(tag, attrs, parent) { this.tag = tag; this.attrs = attrs || {}; this.children = []; this.parent = parent || null; }
  Node.prototype.text = function () {
    var out = [], stack = [this];
    while (stack.length) {
      var it = stack.pop();
      if (typeof it === "string") out.push(it);
      else for (var i = it.children.length - 1; i >= 0; i--) stack.push(it.children[i]);
    }
    return cleanSpace(out.join(" "));
  };
  var VOID = { br: 1, img: 1, hr: 1, meta: 1, link: 1, input: 1, source: 1, area: 1, base: 1, embed: 1, param: 1, track: 1, wbr: 1 };
  var CDATA_EL = { script: 1, style: 1, xmp: 1, iframe: 1, noembed: 1, noframes: 1 };
  var RCDATA_EL = { textarea: 1, title: 1 };

  // Árvore como o TreeParser do Infos HT (html.parser.HTMLParser do Python, sem reconstrução HTML5)
  function construirArvore(texto) {
    var root = new Node("document");
    var stack = [root];
    function inicio(tag, attrs) {
      var v = {};
      attrs.forEach(function (a) { v[String(a[0]).toLowerCase()] = String(a[1] || ""); });
      var node = new Node(tag, v, stack[stack.length - 1]);
      stack[stack.length - 1].children.push(node);
      if (!VOID[tag]) stack.push(node);
    }
    function fim(tag) {
      for (var i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; return; }
    }
    function dado(d) { if (d) stack[stack.length - 1].children.push(d); }
    tokenizar(texto, {
      start: inicio,
      startend: function (tag, attrs) { inicio(tag, attrs); if (!VOID[tag] && stack.length > 1) stack.pop(); },
      end: fim,
      data: dado
    });
    return root;
  }

  var RE_TAGFIND = /[a-zA-Z][^\t\n\r\f \/>]*/y;
  var RE_LOCATETAGEND = new RegExp(
    "[a-zA-Z][^\\t\\n\\r\\f />]*[\\t\\n\\r\\f /]*(?:(?<=['\"\\t\\n\\r\\f /])[^\\t\\n\\r\\f />][^\\t\\n\\r\\f /=>]*" +
    "(?:[\\t\\n\\r\\f ]*=[\\t\\n\\r\\f ]*(?:'[^']*'|\"[^\"]*\"|(?!['\"])[^>\\t\\n\\r\\f ]*))?[\\t\\n\\r\\f /]*)*>?", "y");
  var RE_TAGFIND_TOL = /([a-zA-Z][^\t\n\r\f \/>]*)(?:[\t\n\r\f ]|\/(?!>))*/y;
  var RE_ATTRFIND = new RegExp(
    "((?<=['\"\\t\\n\\r\\f /])[^\\t\\n\\r\\f />][^\\t\\n\\r\\f /=>]*)([\\t\\n\\r\\f ]*=[\\t\\n\\r\\f ]*('[^']*'|\"[^\"]*\"|(?!['\"])[^>\\t\\n\\r\\f ]*))?(?:[\\t\\n\\r\\f ]|/(?!>))*", "y");

  function tokenizar(raw, h) {
    var n = raw.length, i = 0;
    var cdata = null, escapable = true;
    function semDados(a, b) { if (a < b) { var d = raw.slice(a, b); h.data(escapable ? unescape(d) : d); } }
    function locTagEnd(pos) { RE_LOCATETAGEND.lastIndex = pos; var m = RE_LOCATETAGEND.exec(raw); return m ? pos + m[0].length : pos; }
    function parseStart(pos) {
      var j = locTagEnd(pos + 1);
      if (raw[j - 1] !== ">") return -1;
      RE_TAGFIND_TOL.lastIndex = pos + 1;
      var mt = RE_TAGFIND_TOL.exec(raw);
      var k = pos + 1 + mt[0].length;
      var tag = mt[1].toLowerCase();
      var attrs = [];
      while (k < j) {
        RE_ATTRFIND.lastIndex = k;
        var m = RE_ATTRFIND.exec(raw);
        if (!m || !m[0].length) break;
        var nome = m[1], resto = m[2], val = m[3];
        if (!resto) val = null;
        else if ((val[0] === "'" && val.slice(-1) === "'" && val.length >= 1) || (val[0] === '"' && val.slice(-1) === '"' && val.length >= 1)) val = val.slice(1, -1);
        if (val) val = unescapeAtributo(val);
        attrs.push([nome.toLowerCase(), val]);
        k += m[0].length;
      }
      var fimTxt = pyStrip(raw.slice(k, j));
      if (fimTxt !== ">" && fimTxt !== "/>") { h.data(raw.slice(pos, j)); return j; }
      if (fimTxt.slice(-2) === "/>") h.startend(tag, attrs);
      else {
        h.start(tag, attrs);
        if (CDATA_EL[tag] || tag === "plaintext") { cdata = tag; escapable = false; }
        else if (RCDATA_EL[tag]) { cdata = tag; escapable = true; }
      }
      return j;
    }
    function parseEnd(pos) {
      if (raw.indexOf(">", pos + 2) < 0) return -1;
      if (!/[a-zA-Z]/.test(raw[pos + 2] || "")) {
        if (raw[pos + 2] === ">") return pos + 3;
        var p2 = raw.indexOf(">", pos + 2);
        return p2 < 0 ? -1 : p2 + 1;
      }
      var j = locTagEnd(pos + 2);
      if (raw[j - 1] !== ">") return -1;
      RE_TAGFIND_TOL.lastIndex = pos + 2;
      var mt = RE_TAGFIND_TOL.exec(raw);
      h.end(mt[1].toLowerCase());
      cdata = null; escapable = true;
      return j;
    }
    function parseComment(pos) {
      var m = /-?>/y; m.lastIndex = pos + 4;
      var a = m.exec(raw);
      if (a) return pos + 4 + a[0].length;
      var c = /--!?>/g; c.lastIndex = pos + 4;
      var b = c.exec(raw);
      return b ? b.index + b[0].length : -1;
    }
    function parseDecl(pos) {
      if (raw.startsWith("<!--", pos)) return parseComment(pos);
      if (raw.startsWith("<![CDATA[", pos)) { var j = raw.indexOf("]]>", pos + 9); return j < 0 ? -1 : j + 3; }
      if (raw.slice(pos, pos + 9).toLowerCase() === "<!doctype") { var g = raw.indexOf(">", pos + 9); return g < 0 ? -1 : g + 1; }
      var p = raw.indexOf(">", pos + 2);
      return p < 0 ? -1 : p + 1;
    }
    while (i < n) {
      var j;
      if (!cdata) {
        j = raw.indexOf("<", i);
        if (j < 0) {
          var amp = raw.lastIndexOf("&");
          if (amp >= Math.max(i, n - 34) && !/[\t\n\r\f ;]/.test(raw.slice(amp))) break;
          j = n;
        }
      } else {
        var re = new RegExp("</" + cdata + "(?=[\\t\\n\\r\\f />])", "ig");
        re.lastIndex = i;
        var mm = re.exec(raw);
        if (mm) j = mm.index;
        else break;
      }
      semDados(i, j);
      i = j;
      if (i === n) break;
      if (raw[i] === "<") {
        var k;
        if (/[a-zA-Z]/.test(raw[i + 1] || "")) k = parseStart(i);
        else if (raw.startsWith("</", i)) k = parseEnd(i);
        else if (raw.startsWith("<!--", i)) k = parseComment(i);
        else if (raw.startsWith("<?", i)) { var pc = raw.indexOf(">", i + 2); k = pc < 0 ? -1 : pc + 1; }
        else if (raw.startsWith("<!", i)) k = parseDecl(i);
        else { h.data("<"); k = i + 1; }
        if (k < 0) {
          // fim do texto (close): marcas incompletas
          if (/[a-zA-Z]/.test(raw[i + 1] || "")) { /* descarta */ }
          else if (raw.startsWith("</", i)) { if (i + 2 === n) h.data("</"); }
          k = n;
        }
        i = k;
      } else {
        // modo cdata sem fechamento encontrado não chega aqui
        i++;
      }
    }
    if (i < n) { var resto = raw.slice(i, n); h.data(escapable ? unescape(resto) : resto); }
  }

  function findAll(node, tags) {
    var out = [], stack = [node];
    while (stack.length) {
      var cur = stack.pop();
      if (tags[cur.tag]) out.push(cur);
      for (var i = cur.children.length - 1; i >= 0; i--) if (typeof cur.children[i] !== "string") stack.push(cur.children[i]);
    }
    return out;
  }
  function conj(lista) { var o = {}; lista.forEach(function (x) { o[x] = 1; }); return o; }
  function first(node, tag) { var f = findAll(node, conj([tag])); return f.length ? f[0] : null; }
  function parseStyle(style) {
    var out = {};
    String(style || "").split(";").forEach(function (part) {
      var i = part.indexOf(":");
      if (i < 0) return;
      out[casefold(pyStrip(part.slice(0, i)))] = casefold(pyStrip(part.slice(i + 1)));
    });
    return out;
  }
  var ALINHAMENTOS = { left: 1, center: 1, right: 1, justify: 1 };
  function alinhamento(node) {
    var cur = node;
    for (var k = 0; k < 4; k++) {
      if (!cur) break;
      var al = parseStyle(cur.attrs.style || "")["text-align"] || "";
      if (ALINHAMENTOS[al]) return al;
      var at = casefold(cur.attrs.align || "");
      if (ALINHAMENTOS[at]) return at;
      cur = cur.parent;
    }
    return "left";
  }
  var SKIP_INLINE = conj(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "object"]);
  function inlineHtml(node, exclude) {
    exclude = exclude || {};
    var parts = [];
    function walk(item) {
      if (typeof item === "string") { parts.push(escTexto(item)); return; }
      var tag = item.tag;
      if (exclude[tag] || SKIP_INLINE[tag]) return;
      if (tag === "br") { parts.push("<br>"); return; }
      if (tag === "a") {
        var href = pyStrip(item.attrs.href || "");
        if (/^(?:https?|mailto|tel):/i.test(href)) {
          parts.push('<a href="' + escAttr(cpSlice(href, 0, 2048)) + '">');
          item.children.forEach(walk);
          parts.push("</a>");
          return;
        }
      }
      if (tag === "strong" || tag === "b" || tag === "em" || tag === "i" || tag === "sup" || tag === "sub" || tag === "mark") {
        parts.push("<" + tag + ">"); item.children.forEach(walk); parts.push("</" + tag + ">");
        return;
      }
      if (tag === "span" || tag === "font") {
        var st = parseStyle(item.attrs.style || "");
        var cls = item.attrs["class"] || "";
        var bold = ["bold", "700", "800", "900"].indexOf(st["font-weight"]) >= 0;
        var italic = st["font-style"] === "italic";
        var bg = st.background || "", bgc = st["background-color"] || "";
        var hl = ["yellow", "#ff0", "#ffff00", "rgb(255"].some(function (t) { return bg.indexOf(t) >= 0 || bgc.indexOf(t) >= 0; });
        var fontCls = pySplit(cls).filter(function (c) { return c === "ht-font-up" || c === "ht-font-down" || c === "ht-font-normal"; })[0] || "";
        var opens = [];
        if (fontCls) opens.push(["span", '<span class="' + fontCls + '">']);
        if (bold) opens.push(["strong", "<strong>"]);
        if (italic) opens.push(["em", "<em>"]);
        if (hl) opens.push(["mark", "<mark>"]);
        opens.forEach(function (o) { parts.push(o[1]); });
        item.children.forEach(walk);
        for (var q = opens.length - 1; q >= 0; q--) parts.push("</" + opens[q][0] + ">");
        return;
      }
      item.children.forEach(walk);
    }
    node.children.forEach(walk);
    return pyStrip(parts.join(""));
  }
  function meaningful(node) { return !!cleanSpace(node.text()); }
  function maiorPorTexto(lista) {
    var best = null, bl = -1;
    lista.forEach(function (n) { var l = cpLen(n.text()); if (l > bl) { bl = l; best = n; } });
    return best;
  }
  function escopo(root) {
    var mains = findAll(root, { main: 1 });
    if (mains.length) return maiorPorTexto(mains);
    var arts = findAll(root, { article: 1 });
    if (arts.length) return maiorPorTexto(arts);
    return first(root, "body") || root;
  }
  function base64Estrito(s) {
    if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error("base64");
    var bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function dataImage(node, assets, warnings) {
    var src = pyStrip(node.attrs.src || "");
    if (!src) return null;
    var m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(src);
    if (!m) { warnings.push("Imagem HTML externa ou relativa não incorporada; apenas imagens data: embutidas no próprio HTML são importadas offline."); return null; }
    var raw;
    try { raw = base64Estrito(m[2].replace(RE_PYWS_RUN, "")); } catch (e) {
      warnings.push("Uma imagem embutida no HTML estava em base64 inválido e foi ignorada."); return null;
    }
    if (!raw.length || raw.length > MAX_IMAGE_BYTES || assets.length >= HTML_MAX_ASSETS) {
      warnings.push("Uma imagem HTML excedeu o limite seguro de importação e foi ignorada."); return null;
    }
    var mime = m[1].toLowerCase();
    var ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" }[mime] || ".bin";
    var assetId = keyHex("asset");
    assets.push({ id: assetId, source_name: cpSlice(node.attrs.alt !== undefined ? node.attrs.alt : "imagem", 0, 180) || "imagem", mime_type: mime, extension: ext,
                  sha256: sha256(raw), bytes: raw });
    return { id: keyHex("imgblk"), type: "image", asset_id: assetId, alt: cpSlice(node.attrs.alt || "", 0, 300) };
  }

  var ALIASES = { "windows-1252": "cp1252", "win-1252": "cp1252", "iso-8859-1": "latin-1", "iso8859-1": "latin-1", utf8: "utf-8", utf16: "utf-16", utf32: "utf-32" };
  function decodificar(enc, raw) {
    var lat = function (b) { var s = ""; for (var i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
    if (enc === "latin-1" || enc === "latin1" || enc === "iso8859_1") return lat(raw);
    if (enc === "utf-8-sig") {
      var t = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
      return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
    }
    if (enc === "utf-32" || enc === "utf-32-le" || enc === "utf-32-be") {
      if (raw.length % 4) throw new Error("utf-32");
      var le = enc !== "utf-32-be", start = 0;
      if (enc === "utf-32") {
        if (raw[0] === 0xff && raw[1] === 0xfe && raw[2] === 0 && raw[3] === 0) { start = 4; le = true; }
        else if (raw[0] === 0 && raw[1] === 0 && raw[2] === 0xfe && raw[3] === 0xff) { start = 4; le = false; }
      }
      var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), s = "";
      for (var i = start; i < raw.length; i += 4) {
        var cp = dv.getUint32(i, le);
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new Error("utf-32");
        s += String.fromCodePoint(cp);
      }
      return s;
    }
    if (enc === "utf-16") {
      if (raw[0] === 0xfe && raw[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true, ignoreBOM: true }).decode(raw.subarray(2));
      if (raw[0] === 0xff && raw[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(raw.subarray(2));
      return new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(raw);
    }
    if (enc === "cp1252") {
      var proibidos = [0x81, 0x8d, 0x8f, 0x90, 0x9d];
      for (var q = 0; q < raw.length; q++) if (proibidos.indexOf(raw[q]) >= 0) throw new Error("cp1252");
      return new TextDecoder("windows-1252").decode(raw);
    }
    if (enc === "utf-16-le" || enc === "utf-16le") return new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(raw);
    if (enc === "utf-16-be" || enc === "utf-16be") return new TextDecoder("utf-16be", { fatal: true, ignoreBOM: true }).decode(raw);
    return new TextDecoder(enc, { fatal: true, ignoreBOM: true }).decode(raw);
  }
  function decodeHtmlBytes(raw) {
    var cand = [];
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) cand.push("utf-8-sig");
    else if ((raw[0] === 0xff && raw[1] === 0xfe && raw[2] === 0 && raw[3] === 0) || (raw[0] === 0 && raw[1] === 0 && raw[2] === 0xfe && raw[3] === 0xff)) cand.push("utf-32");
    else if ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff)) cand.push("utf-16");
    var head = ""; for (var i = 0; i < Math.min(raw.length, 8192); i++) head += String.fromCharCode(raw[i]);
    var dec = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9._-]+)|<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9._-]+)/i.exec(head);
    if (dec) { var v = casefold(pyStrip(dec[1] || dec[2] || "")); cand.push(ALIASES[v] || v); }
    var sample = raw.subarray(0, 4096);
    if (sample.length) {
      var even = 0, odd = 0;
      for (var a = 0; a < sample.length; a += 2) if (sample[a] === 0) even++;
      for (var b = 1; b < sample.length; b += 2) if (sample[b] === 0) odd++;
      var pairs = Math.max(1, Math.floor(sample.length / 2));
      if (odd / pairs > 0.3 && even / pairs < 0.1) cand.push("utf-16-le");
      else if (even / pairs > 0.3 && odd / pairs < 0.1) cand.push("utf-16-be");
    }
    cand.push("utf-8-sig", "utf-8", "cp1252", "latin-1");
    var seen = {};
    for (var c = 0; c < cand.length; c++) {
      var enc = cand[c];
      if (!enc || seen[enc]) continue;
      seen[enc] = 1;
      var text;
      try { text = decodificar(enc, raw); } catch (e) { continue; }
      text = text.replace(/^\ufeff+/, "");
      if (text && (text.split("\x00").length - 1) / Math.max(1, text.length) > 0.08) continue;
      return text;
    }
    throw new Error("Não foi possível decodificar o HTML.");
  }

  function parseHtml(raw, filename) {
    if (!raw || !raw.length) throw new Error("Arquivo HTML vazio.");
    var text = decodeHtmlBytes(raw);
    if (text.indexOf("<") < 0 || text.indexOf(">") < 0) throw new Error("O arquivo não contém uma estrutura HTML reconhecível.");
    var root;
    try { root = construirArvore(text); } catch (e) { throw new Error("Não foi possível interpretar a estrutura HTML."); }
    var scope = escopo(root);
    var titleNode = first(root, "title");
    var h1s = findAll(scope, { h1: 1 });
    if (!h1s.length) h1s = findAll(root, { h1: 1 });
    var fileTitle = tituloDoArquivo(filename);
    var title = h1s.length ? cleanSpace(h1s[0].text()) : "";
    if (!title && titleNode) title = cleanSpace(titleNode.text());
    title = cpSlice(title || fileTitle, 0, 180);

    var scanText = findAll(root, conj(["header", "div", "span", "strong", "p"])).slice(0, 120).map(function (n) { return n.text(); }).filter(Boolean).join("\n");
    var number = "";
    var mn = HTML_DOC_NUMBER_RE.exec(scanText);
    if (mn) number = "nº " + mn[1].replace(RE_PYWS_RUN, "");
    var date = "";
    var md = HTML_DATE_RE.exec(scanText);
    if (md) date = String(Number(md[1])).padStart(2, "0") + "/" + md[2];
    function deptCands(tags) {
      var out = [];
      findAll(root, conj(tags)).forEach(function (n) {
        var t = cleanSpace(n.text());
        if (RE_DEPTO_I.test(t) && cpLen(t) <= 140) out.push(t);
      });
      return out;
    }
    var dc = deptCands(["strong"]);
    if (!dc.length) dc = deptCands(["span", "div", "p"]);
    var department = "";
    if (dc.length) {
      var menor = dc[0];
      dc.forEach(function (t) { if (cpLen(t) < cpLen(menor)) menor = t; });
      department = cpSlice(menor, 0, 100);
    }
    if (!department) department = "Departamento Tributário";

    var blocks = [], elements = {}, assets = [], warnings = [];
    var counters = { headings: 0, lists: 0, tables: 0, images: 0 };
    var firstH1Consumed = false;

    function addParagraph(node, role) {
      var value = inlineHtml(node, conj(["ul", "ol", "table", "img"]));
      var plain = cleanSpace(node.text());
      if (!plain || !cleanSpace(value.replace(/<[^>]+>/g, " "))) return;
      var key = keyHex("p");
      blocks.push({ id: keyHex("blk"), type: "paragraph", key: key, content: value, role: role || "body", align: alinhamento(node) });
      elements[key] = value;
    }
    function addHeading(node, level) {
      var plain = cleanSpace(node.text());
      if (!plain) return;
      if (node.tag === "h1" && !firstH1Consumed && casefold(plain) === casefold(title)) { firstH1Consumed = true; return; }
      if (level === undefined || level === null) {
        var tl = /^h[1-6]/.test(node.tag) ? Number(node.tag[1]) : 2;
        level = tl <= 2 ? 1 : tl === 3 ? 2 : 3;
      }
      var key = keyHex("head");
      var value = inlineHtml(node) || escTexto(plain);
      blocks.push({ id: keyHex("blk"), type: "heading", key: key, level: Math.max(1, Math.min(level, 3)), content: value,
                    anchor: "sec-" + slugHtml(plain) + "-" + hex32().slice(0, 7), detected_by: "html_heading", align: alinhamento(node), visual_style: "heading" });
      elements[key] = value;
      counters.headings++;
    }
    function addList(node, level) {
      level = level || 0;
      var ordered = node.tag === "ol";
      var items = [];
      node.children.forEach(function (child) {
        if (typeof child === "string" || child.tag !== "li") return;
        var key = keyHex("li");
        var value = inlineHtml(child, conj(["ul", "ol", "img"]));
        if (cleanSpace(child.text())) {
          items.push({ key: key, level: level, ordered: ordered, format: ordered ? "decimal" : "bullet", content: value, align: alinhamento(child) });
          elements[key] = value;
        }
      });
      if (items.length) { blocks.push({ id: keyHex("list"), type: "list", ordered: ordered, items: items }); counters.lists++; }
      node.children.forEach(function (child) {
        if (typeof child !== "string" && child.tag === "li") {
          child.children.forEach(function (nested) {
            if (typeof nested !== "string" && (nested.tag === "ul" || nested.tag === "ol")) addList(nested, level + 1);
          });
        }
      });
    }
    function addTable(node) {
      var rows = [];
      findAll(node, { tr: 1 }).slice(0, 200).forEach(function (tr) {
        var row = [];
        tr.children.forEach(function (cell) {
          if (typeof cell === "string" || (cell.tag !== "td" && cell.tag !== "th")) return;
          var key = keyHex("cell");
          var value = inlineHtml(cell, conj(["table", "img"]));
          var colspan, rowspan;
          try { colspan = Math.max(1, Math.min(pyInt(cell.attrs.colspan !== undefined ? cell.attrs.colspan || 1 : "1"), 40)); } catch (e) { colspan = 1; }
          try { rowspan = Math.max(1, Math.min(pyInt(cell.attrs.rowspan !== undefined ? cell.attrs.rowspan || 1 : "1"), 200)); } catch (e) { rowspan = 1; }
          row.push({ key: key, content: value, header: cell.tag === "th", colspan: colspan, rowspan: rowspan, align: alinhamento(cell) });
          elements[key] = value;
        });
        if (row.length) rows.push(row);
      });
      if (rows.length) { blocks.push({ id: keyHex("tbl"), type: "table", rows: rows }); counters.tables++; }
    }
    var BLOCKISH = conj(["h1", "h2", "h3", "h4", "h5", "h6", "summary", "p", "ul", "ol", "table", "img", "section", "article", "div", "details", "blockquote"]);
    var SKIP = conj(["script", "style", "noscript", "template", "nav", "aside", "footer", "form", "button", "svg", "canvas", "iframe", "object"]);
    function walk(node, intro) {
      if (blocks.length >= MAX_BLOCKS || SKIP[node.tag]) return;
      if (/^h[1-6]$/.test(node.tag)) { addHeading(node); return; }
      if (node.tag === "summary") {
        var plain = cleanSpace(node.text());
        var num = NUMBERED_HEADING_RE.exec(plain);
        if (num) addHeading(node, Math.min(3, num[1].split(".").length));
        return;
      }
      if (node.tag === "p") {
        addParagraph(node, intro[0] && counters.headings === 0 ? "intro" : "body");
        intro[0] = false;
        findAll(node, { img: 1 }).forEach(function (img) {
          var b = dataImage(img, assets, warnings);
          if (b) { blocks.push(b); counters.images++; }
        });
        return;
      }
      if (node.tag === "ul" || node.tag === "ol") { addList(node); return; }
      if (node.tag === "table") { addTable(node); return; }
      if (node.tag === "img") {
        var bi = dataImage(node, assets, warnings);
        if (bi) { blocks.push(bi); counters.images++; }
        return;
      }
      if (node.tag === "div" || node.tag === "section" || node.tag === "article" || node.tag === "details" || node.tag === "blockquote") {
        var childBlocks = node.children.filter(function (c) { return typeof c !== "string" && BLOCKISH[c.tag]; });
        if (meaningful(node) && !childBlocks.length) {
          addParagraph(node, intro[0] && counters.headings === 0 ? "intro" : "body");
          intro[0] = false;
          return;
        }
      }
      node.children.forEach(function (c) { if (typeof c !== "string") walk(c, intro); });
    }
    walk(scope, [true]);
    if (!blocks.length) throw new Error("Nenhum conteúdo textual, lista, tabela ou imagem incorporada pôde ser extraído do HTML.");
    warnings = unicos(warnings);
    var links = text.match(py("<a\\b", "gi"));
    var stats = {
      blocks: blocks.length, headings: counters.headings, hybrid_sections: 0, lists: counters.lists, tables: counters.tables, images: counters.images,
      editable_fields: Object.keys(elements).length, hyperlinks: links ? links.length : 0, merged_cells: 0, visual_headings: 0,
      heading_detection: { html_heading: counters.headings }
    };
    if (counters.headings === 0) warnings.push("Nenhum título HTML estrutural (h1-h6) foi detectado. Revise o Sumário antes da publicação.");
    var rr = !!(warnings.length || counters.headings === 0);
    return {
      metadata: { title: title, document_number: number, date: date, department: department },
      model: { schema_version: 1, source_type: "html", blocks: blocks },
      elements: elements, assets: assets, warnings: warnings, stats: stats,
      review: { required: rr, summary: rr ? "Revisão estrutural recomendada antes da publicação." : "Estrutura HTML importada sem alertas automáticos.",
                metadata_sources: { title: "html", document_number: "html", date: "html", department: "html" } }
    };
  }

  // ==================================================================================================
  // PDF (camada de texto pelo pdf.js; o original usava o pypdf em modo "layout")

  var MAX_PAGES = 400;
  var PDF_NUMERIC_RE = py("^\\s*(\\d+(?:\\.\\d+){0,2})\\s*(?:[-–—.)]|\\s)\\s*(\\S.*)$");

  function looksHeading(line) {
    var text = cleanSpace(line);
    if (!text || cpLen(text) > 260) return null;
    var m = PDF_NUMERIC_RE.exec(text);
    if (m) return [Math.min(3, m[1].split(".").length), "pdf_numeric"];
    var words = pySplit(text);
    var letters = cps(text).filter(function (c) { return /\p{L}/u.test(c); });
    var upper = letters.length ? letters.filter(function (c) { return /\p{Lu}/u.test(c); }).length / letters.length : 0;
    if (words.length >= 2 && words.length <= 16 && cpLen(text) <= 150 && upper >= 0.88 && !/\.$/.test(text)) return [1, "pdf_uppercase"];
    return null;
  }
  function normalizeRepeat(line) { return casefold(cleanSpace(line)).replace(/[0-9]+/g, "#"); }

  // Reconstrói as linhas de uma página a partir dos trechos de texto do pdf.js, com linha em branco
  // onde há espaço vertical maior que o normal (como o modo "layout" separa os parágrafos).
  function linhasDaPagina(items) {
    var trechos = items.filter(function (it) { return typeof it.str === "string" && it.transform; }).map(function (it) {
      var t = it.transform;
      return { s: it.str, x: t[4], y: t[5], w: it.width || 0, h: Math.abs(it.height || t[3] || 0) || Math.abs(t[0]) || 10, eol: !!it.hasEOL };
    });
    var linhas = [];
    trechos.forEach(function (t) {
      if (!t.s && !t.eol) return;
      var alvo = null;
      for (var i = linhas.length - 1; i >= 0 && i >= linhas.length - 4; i--) {
        if (Math.abs(linhas[i].y - t.y) <= Math.max(2, Math.min(linhas[i].h, t.h) * 0.45)) { alvo = linhas[i]; break; }
      }
      if (!alvo) { alvo = { y: t.y, h: t.h, partes: [] }; linhas.push(alvo); }
      if (t.s) alvo.partes.push(t);
      alvo.h = Math.max(alvo.h, t.h);
    });
    linhas = linhas.filter(function (l) { return l.partes.length; });
    linhas.sort(function (a, b) { return b.y - a.y; });
    var out = [];
    var alturas = linhas.map(function (l) { return l.h; }).sort(function (a, b) { return a - b; });
    var hTipica = alturas.length ? alturas[Math.floor(alturas.length / 2)] : 10;
    var anterior = null;
    linhas.forEach(function (l) {
      l.partes.sort(function (a, b) { return a.x - b.x; });
      var txt = "", fimX = null;
      l.partes.forEach(function (p) {
        if (fimX !== null) {
          var gap = p.x - fimX;
          if (gap > Math.max(1, p.h * 0.18) && !/\s$/.test(txt) && !/^\s/.test(p.s)) txt += gap > p.h * 2 ? "   " : " ";
        }
        txt += p.s;
        fimX = p.x + p.w;
      });
      if (anterior) {
        // como o pypdf: linhas em branco = int(distância / altura da fonte da linha) - 1
        var fh = l.partes[0].h || hTipica;
        if (Math.floor(Math.abs(anterior.y - l.y) / fh) - 1 > 0) out.push("");
      }
      out.push(txt);
      anterior = l;
    });
    return out;
  }

  async function parsePdf(raw, filename, pdfjs) {
    var inicio = 0;
    while (inicio < raw.length && /\s/.test(String.fromCharCode(raw[inicio]))) inicio++;
    var cab = String.fromCharCode.apply(null, raw.subarray(inicio, inicio + 5));
    if (!raw.length || cab !== "%PDF-") throw new Error("Arquivo PDF inválido ou não reconhecido.");
    if (!pdfjs) throw new Error("O componente interno de leitura PDF não está disponível nesta instalação.");
    var doc;
    try {
      doc = await pdfjs.getDocument({ data: raw.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") throw new Error("O PDF está protegido por senha. Remova a proteção antes de importar.");
      throw new Error("Não foi possível abrir o PDF.");
    }
    try {
      var total = doc.numPages;
      if (total > MAX_PAGES) throw new Error("PDF com páginas demais. Limite suportado: " + MAX_PAGES + " páginas.");
      var pages = [], falhas = 0;
      for (var p = 1; p <= total; p++) {
        var linhas = [];
        try {
          var page = await doc.getPage(p);
          var tc = await page.getTextContent();
          linhas = linhasDaPagina(tc.items || []);
        } catch (e) { falhas++; }
        pages.push(linhas.map(function (l) { return l.replace(/\s+$/, ""); }));
      }
      var totalText = 0;
      pages.forEach(function (pg) { pg.forEach(function (l) { totalText += cpLen(cleanSpace(l)); }); });
      if (totalText < Math.max(30, pages.length * 8)) {
        throw new Error("O PDF não possui camada de texto suficiente para importação. Ele parece ser digitalizado/escaneado. " +
          "A importação não aplica OCR automaticamente; use um PDF pesquisável, DOCX ou HTML.");
      }
      var repeated = {};
      if (pages.length >= 3) {
        var cnt = {};
        pages.forEach(function (pg) {
          var ne = pg.filter(function (l) { return cleanSpace(l); });
          ne.slice(0, 2).concat(ne.slice(-2)).forEach(function (l) {
            var nn = normalizeRepeat(l);
            if (cpLen(nn) >= 4) cnt[nn] = (cnt[nn] || 0) + 1;
          });
        });
        var limite = Math.max(2, Math.ceil(pages.length * 0.6));
        Object.keys(cnt).forEach(function (k) { if (cnt[k] >= limite) repeated[k] = 1; });
      }
      var all = [];
      pages.forEach(function (pg) { pg.forEach(function (l) { var c = cleanSpace(l); if (c) all.push(c); }); });
      var metaTitle = "";
      try { var md = await doc.getMetadata(); metaTitle = cleanSpace((md && md.info && md.info.Title) || ""); } catch (e) {}
      var fileTitle = tituloDoArquivo(filename);
      var genericos = { "microsoft word": 1, document: 1, untitled: 1, "sem título": 1, "sem titulo": 1 };
      var title = metaTitle && !genericos[casefold(metaTitle)] ? metaTitle : "";
      if (!title) {
        for (var a = 0; a < Math.min(15, all.length); a++) if (cpLen(all[a]) <= 180 && !/^[0-9]+$/.test(all[a])) { title = all[a]; break; }
      }
      title = cpSlice(title || fileTitle, 0, 180);
      var scan = all.slice(0, 80).join("\n");
      var number = "", date = "", department = "";
      var mn = HTML_DOC_NUMBER_RE.exec(scan);
      if (mn) number = "nº " + mn[1].replace(RE_PYWS_RUN, "");
      var mdt = HTML_DATE_RE.exec(scan);
      if (mdt) date = String(Number(mdt[1])).padStart(2, "0") + "/" + mdt[2];
      for (var d = 0; d < Math.min(50, all.length); d++) {
        if (RE_DEPTO_I.test(all[d]) && cpLen(all[d]) <= 140) { department = cpSlice(all[d], 0, 100); break; }
      }
      if (!department) department = "Departamento Tributário";

      var blocks = [], elements = {}, headingCount = 0;
      var warnings = ["PDF importado pela camada de texto. Revise tabelas, colunas, notas de rodapé e posicionamento antes de publicar, pois PDF não contém uma estrutura semântica equivalente ao DOCX/HTML."];
      if (falhas) warnings.push(falhas + " página(s) tiveram falha parcial de extração textual.");
      var para = [], intro = true;
      function flush() {
        if (!para.length || blocks.length >= MAX_BLOCKS) { para = []; return; }
        var t = cleanSpace(para.join(" "));
        para = [];
        if (!t) return;
        if (!blocks.length && casefold(t) === casefold(title)) return;
        var key = keyHex("p");
        var value = escTexto(t);
        blocks.push({ id: keyHex("blk"), type: "paragraph", key: key, content: value, role: intro ? "intro" : "body", align: "left" });
        elements[key] = value;
        intro = false;
      }
      pages.forEach(function (pg) {
        for (var i = 0; i < pg.length; i++) {
          if (blocks.length >= MAX_BLOCKS) break;
          var line = cleanSpace(pg[i]);
          if (line && repeated[normalizeRepeat(line)]) continue;
          if (!line) { flush(); continue; }
          var hd = looksHeading(line);
          if (hd) {
            flush();
            if (casefold(line) === casefold(title) && !blocks.length) continue;
            var key = keyHex("head");
            var value = escTexto(line);
            blocks.push({ id: keyHex("blk"), type: "heading", key: key, level: hd[0], content: value, anchor: "sec-" + slugHtml(line) + "-" + hex32().slice(0, 7),
                          detected_by: hd[1], align: "left", visual_style: "heading" });
            elements[key] = value; headingCount++; intro = false;
          } else para.push(line);
        }
        flush();
      });
      flush();
      if (!blocks.length) throw new Error("Nenhum conteúdo textual aproveitável pôde ser extraído do PDF.");
      if (headingCount === 0) warnings.push("Nenhum título estrutural pôde ser inferido com segurança no PDF. Revise o Sumário antes da publicação.");
      return {
        metadata: { title: title, document_number: number, date: date, department: department },
        model: { schema_version: 1, source_type: "pdf", blocks: blocks },
        elements: elements, assets: [], warnings: unicos(warnings),
        stats: { blocks: blocks.length, headings: headingCount, hybrid_sections: 0, lists: 0, tables: 0, images: 0, editable_fields: Object.keys(elements).length,
                 hyperlinks: 0, merged_cells: 0, visual_headings: 0, heading_detection: { pdf_heuristic: headingCount }, pages: pages.length, text_characters: totalText },
        review: { required: true, summary: "Revisão estrutural recomendada antes da publicação do PDF importado.",
                  metadata_sources: { title: "pdf", document_number: "pdf_text", date: "pdf_text", department: "pdf_text" } }
      };
    } finally {
      try { await doc.destroy(); } catch (e) {}
    }
  }

  // ==================================================================================================
  // Ajustes do app.py

  var IMPORT_EXTENSIONS = { ".docx": "docx", ".pdf": "pdf", ".html": "html", ".htm": "html" };
  function nomeSeguro(filename) {
    var safe = cpSlice(nomeBase(filename || "informativo"), 0, 180);
    var tipo = IMPORT_EXTENSIONS[casefold(sufixo(safe))];
    if (!tipo) throw new Error("Formato não suportado. Use DOCX, PDF, HTML ou HTM.");
    return { nome: safe, tipo: tipo };
  }
  function aplicarPerfil(parsed, perfil) {
    if (parsed && parsed.model && typeof parsed.model === "object") {
      parsed.model.template_profile = perfil || "hti-informativos-v1";
      parsed.model.source_type = String(parsed.model.source_type || "docx");
    }
    return parsed;
  }
  function prefixarAssets(parsed, prefixo) {
    var mapa = {};
    (parsed.assets || []).forEach(function (a) {
      var old = String(a.id || "");
      if (!old) return;
      var novo = (prefixo + "-" + old).slice(0, 120);
      mapa[old] = novo;
      a.id = novo;
    });
    (function walk(v) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        if ("asset_id" in v && Object.prototype.hasOwnProperty.call(mapa, String(v.asset_id))) v.asset_id = mapa[String(v.asset_id)];
        Object.keys(v).forEach(function (k) { walk(v[k]); });
      }
    })(parsed.model);
    return parsed;
  }
  function extensaoAsset(a, permitirMais) {
    var ext = String(a.extension || "").toLowerCase();
    var corpo = ext.slice(1);
    if (permitirMais) corpo = corpo.replace(/\+/g, "");
    if (ext[0] !== "." || !/^[\p{L}\p{N}]+$/u.test(corpo) || ext.length > 10) ext = ".bin";
    return ext;
  }

  var api = {
    parseDocx: parseDocx, parseHtml: parseHtml, parsePdf: parsePdf, sha256: sha256, nomeSeguro: nomeSeguro, sufixo: sufixo, stem: stem,
    aplicarPerfil: aplicarPerfil, prefixarAssets: prefixarAssets, extensaoAsset: extensaoAsset,
    _interno: { unescape: unescape, construirArvore: construirArvore, pyRound: pyRound, decodeHtmlBytes: decodeHtmlBytes, linhasDaPagina: linhasDaPagina },
    // utilidades no comportamento do Python, usadas também pela exportação (inf-exportar.js)
    py: py, pyStrip: pyStrip, pySplit: pySplit, cpLen: cpLen, cpSlice: cpSlice, tokenizar: tokenizar, escTexto: escTexto, PYS: PYS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.InfImportar = api;
})(typeof window !== "undefined" ? window : globalThis);
