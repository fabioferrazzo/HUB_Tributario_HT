import { CONTRACT_REFERENCE } from "./contract-reference.js?v=1.1.35";
import { CONTRACT_CHECKLIST_PRIORITIES } from "./contract-checklist-priorities.js?v=1.1.35";

const FACETS = CONTRACT_REFERENCE.facetas || {};
const PRIORITY = FACETS.crit || { A: "Alta", M: "Média", B: "Baixa" };
const TYPES = FACETS.tipos || {};
const DEADLINES = FACETS.prazos || {};
const ALL_TABS = [
  ["matrix", "Matriz"], ["adendum-items", "Itens do Adendo"], ["contract-items", "Contrato"],
  ["checklist", "Checklist"], ["declaration", "Declaração"],
  ["contract-full", "Contrato (íntegra)"], ["adendum-full", "Adendo (íntegra)"], ["identification", "Identificação"],
];
const CLIENT_TAB_KEYS = new Set(["adendum-items", "matrix", "checklist", "contract-full", "adendum-full"]);
// 1.1.33: chave fixa; os ids dos itens são estáveis e as marcações continuam valendo quando o Adendo muda de versão.
const CHECKLIST_STORAGE_BASE = "ht.onboarding.contract-checklist.1.3";
const CONTRACT_FONT_STORAGE = "ht.onboarding.contract-font-scale";
const CONTRACT_FONT_STEPS = [0.9, 1, 1.15, 1.3, 1.45, 1.75, 2];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;",
  })[character]);
}

function downloadFile(name, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  window.setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 700);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xFFFFFFFF;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xFF] ^ (value >>> 8);
  return (value ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files, mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  const encoder = new TextEncoder();
  const pieces = [];
  const central = [];
  let offset = 0;
  const u16 = (value) => [value & 0xFF, (value >>> 8) & 0xFF];
  const u32 = (value) => [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF];
  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const checksum = crc32(data);
    const local = [].concat([0x50, 0x4B, 0x03, 0x04], u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0));
    pieces.push(new Uint8Array(local), name, data);
    central.push([].concat([0x50, 0x4B, 0x01, 0x02], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)), name);
    offset += local.length + name.length + data.length;
  });
  const centralBytes = central.flatMap((part) => Array.from(part));
  const end = [].concat([0x50, 0x4B, 0x05, 0x06], u16(0), u16(0), u16(files.length), u16(files.length), u32(centralBytes.length), u32(offset), u16(0));
  pieces.push(new Uint8Array(centralBytes), new Uint8Array(end));
  return new Blob(pieces, { type: mime });
}

function spreadsheetBlob(sheetName, headings, rows) {
  const xml = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const column = (number) => { let result = ""; for (let current = number; current >= 0; current = Math.floor(current / 26) - 1) result = String.fromCharCode(65 + (current % 26)) + result; return result; };
  const rowXml = (cells, index, heading = false) => `<row r="${index + 1}">${cells.map((value, cell) => `<c r="${column(cell)}${index + 1}" t="inlineStr"${heading ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`;
  const body = [rowXml(headings, 0, true), ...rows.map((row, index) => rowXml(row, index + 1))].join("");
  const widths = headings.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="38" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${body}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF115E59"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F5F2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zipStore([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ]);
}

function rowsFrom(node) {
  return Array.isArray(node?.linhas) ? node.linhas : [];
}

function nodeText(node, rowIndex = null) {
  if (!node) return "Conteúdo não localizado.";
  if (rowIndex !== null && rowsFrom(node)[rowIndex]) return rowsFrom(node)[rowIndex].join(" · ");
  if (node.x) return node.x;
  return rowsFrom(node).flat().join(" · ");
}

function renderDataTable(node, label = "Tabela contratual") {
  const rows = rowsFrom(node);
  if (!rows.length) return "";
  const head = Array.isArray(node.cab) && node.cab.length
    ? `<thead><tr>${node.cab.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>` : "";
  return `<div class="contract-document-table" role="region" aria-label="${escapeHtml(label)}" tabindex="0"><table>${head}<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replaceAll("\n", "<br>")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderDocumentNode(node, index) {
  const anchor = ` data-contract-doc-index="${index}"`;
  if (node.t === "capa") return `<p class="contract-document-cover"${anchor}>${escapeHtml(node.x).replaceAll("\n", "<br>")}</p>`;
  if (node.t === "h1") return `<h3${anchor}>${escapeHtml(node.x)}</h3>`;
  if (node.t === "h2") return `<h4${anchor}>${escapeHtml(node.x)}</h4>`;
  if (node.t === "p") return `<p${anchor}>${escapeHtml(node.x).replaceAll("\n", "<br>")}</p>`;
  if (node.t === "li") return `<div class="contract-document-list-item"${anchor}><span>•</span><p>${escapeHtml(node.x).replaceAll("\n", "<br>")}</p></div>`;
  if (["tbl", "form", "ident", "assin_tbl"].includes(node.t)) return `<div${anchor}>${renderDataTable(node)}</div>`;
  if (node.t === "quadro") return `<aside class="contract-document-note"${anchor}>${rowsFrom(node).map((row) => `<p>${row.map((cell) => escapeHtml(cell).replaceAll("\n", "<br>")).join("<br>")}</p>`).join("")}</aside>`;
  if (node.t === "assin") return `<div class="contract-document-signature"${anchor}>${escapeHtml(node.x || rowsFrom(node).flat().join("\n")).replaceAll("\n", "<br>")}</div>`;
  if (node.t === "rodape") return `<footer class="contract-document-footer"${anchor}>${escapeHtml(node.x || rowsFrom(node).flat().join(" "))}</footer>`;
  return "";
}

function renderDocument(document, label) {
  return `<article class="contract-document" aria-label="${escapeHtml(label)}">${document.map(renderDocumentNode).join("")}</article>`;
}

function facetEntries(items, key, labels = {}, order = []) {
  const present = new Set(items.map((item) => item[key]).filter(Boolean));
  const keys = [...order.filter((value) => present.has(value)), ...[...present].filter((value) => !order.includes(value)).sort((a, b) => String(labels[a] || a).localeCompare(String(labels[b] || b), "pt-BR"))];
  return keys.map((value) => [value, labels[value] || value]);
}

function referenceRow(item, document, kind) {
  const text = nodeText(document[item.n], item.r ?? null);
  const category = FACETS.categorias?.[item.cat] || item.blocoNome || "Geral";
  const priority = PRIORITY[item.crit] || "—";
  const parties = (item.quem || item.parte || []).join(", ") || "Ambas as partes";
  const type = TYPES[item.tipo] || (kind === "contract" ? "Cláusula contratual" : "Item do Adendo");
  const deadline = DEADLINES[item.prazo] || (kind === "contract" ? "—" : "Sem prazo próprio");
  const search = [item.id, item.num, item.rotulo, item.blocoNome, item.blocoTitulo, category, priority, parties, type, deadline, text].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
  const title = item.rotulo || text.slice(0, 180);
  const target = kind === "contract" ? "contract-full" : "adendum-full";
  const metadata = `data-contract-reference-row data-reference-id="${escapeHtml(item.id)}" data-search="${escapeHtml(search)}" data-block="${escapeHtml(item.bloco || "")}" data-category="${escapeHtml(item.cat || "")}" data-priority="${escapeHtml(item.crit || "")}" data-type="${escapeHtml(item.tipo || "")}" data-deadline="${escapeHtml(item.prazo || "")}" data-parties="${escapeHtml((item.quem || item.parte || []).join("|"))}" data-client="${(item.quem || []).includes("Cliente")}"`;
  const cells = kind === "adendum"
    ? `<td data-label="Item"><strong>${escapeHtml(item.num || item.id)}</strong><small>${escapeHtml(item.blocoNome || item.bloco || "")}</small></td><td data-label="Assunto"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(type)}</small></td><td data-label="Categoria"><span>${escapeHtml(category)}</span></td><td data-label="Quem age"><span>${escapeHtml(parties)}</span></td><td data-label="Prazo"><span>${escapeHtml(deadline)}</span></td><td data-label="Criticidade"><span class="contract-priority contract-priority--${escapeHtml(item.crit || "none")}">${escapeHtml(priority)}</span></td><td data-label="Ação"><button type="button" data-contract-detail="${escapeHtml(item.id)}">Ler trecho</button></td>`
    : `<td data-label="Item"><strong>${escapeHtml(item.num || item.id)}</strong><small>${escapeHtml(item.blocoNome || item.bloco || "")}</small></td><td data-label="Cláusula"><strong>${escapeHtml(item.blocoTitulo || item.blocoNome || "Contrato")}</strong></td><td data-label="Trecho"><span>${escapeHtml(title)}</span></td><td data-label="Parte citada"><span>${escapeHtml(parties)}</span></td><td data-label="Ação"><button type="button" data-contract-detail="${escapeHtml(item.id)}">Ler trecho</button></td>`;
  const columns = kind === "adendum" ? 7 : 5;
  return `<tr ${metadata}>${cells}</tr><tr class="contract-reference-detail" data-contract-reference-detail="${escapeHtml(item.id)}" hidden><td colspan="${columns}"><div><p data-contract-reference-text>${escapeHtml(text).replaceAll("\n", "<br>")}</p><div class="contract-reference-detail-actions"><button type="button" data-contract-copy>Copiar texto</button><button type="button" data-contract-open-document="${target}" data-contract-doc-index="${item.n}">Ver no documento integral →</button></div></div></td></tr>`;
}

function referenceFilters(items, kind) {
  const blocks = [...new Map(items.map((item) => [item.bloco, item.blocoNome || item.bloco])).entries()].filter(([key]) => key);
  const categories = facetEntries(items, "cat", FACETS.categorias || {});
  const types = facetEntries(items, "tipo", TYPES);
  const deadlines = facetEntries(items, "prazo", DEADLINES, FACETS.ordemPrazos || []);
  const parties = [...new Set(items.flatMap((item) => item.quem || item.parte || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return `<div class="contract-reference-toolbar">
    <label class="contract-reference-search"><span>Buscar</span><input type="search" data-contract-reference-search placeholder="Item, assunto, prazo ou trecho"></label>
    <label><span>Seção</span><select data-contract-reference-block><option value="">Todas</option>${blocks.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}</select></label>
    ${kind === "adendum" ? `<label><span>Categoria</span><select data-contract-reference-category><option value="">Todas</option>${categories.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}</select></label><label><span>Quem age</span><select data-contract-reference-party><option value="">Todos</option>${parties.map((party) => `<option value="${escapeHtml(party)}">${escapeHtml(party)}</option>`).join("")}</select></label><label><span>Tipo</span><select data-contract-reference-type><option value="">Todos</option>${types.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}</select></label><label><span>Prazo</span><select data-contract-reference-deadline><option value="">Todos</option>${deadlines.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}</select></label><label><span>Criticidade</span><select data-contract-reference-priority><option value="">Todas</option><option value="A">Alta</option><option value="M">Média</option><option value="B">Baixa</option></select></label><label class="contract-reference-toggle"><span>Escopo</span><b><input type="checkbox" data-contract-reference-client> Só do Cliente</b></label>` : `<label><span>Parte citada</span><select data-contract-reference-party><option value="">Todas</option>${parties.map((party) => `<option value="${escapeHtml(party)}">${escapeHtml(party)}</option>`).join("")}</select></label>`}
    <label><span>Exibir</span><select data-contract-reference-size><option value="10">10 linhas</option><option value="20" selected>20 linhas</option><option value="30">30 linhas</option></select></label>
    <button type="button" class="contract-reference-clear" data-contract-reference-clear>Limpar filtros</button>
  </div>`;
}

function renderReferenceTable(items, document, kind) {
  const headings = kind === "adendum" ? ["Item", "Assunto", "Categoria", "Quem age", "Prazo", "Criticidade", "Ação"] : ["Item", "Cláusula", "Trecho", "Parte citada", "Ação"];
  return `<section class="contract-reference contract-reference--${kind}" data-contract-reference>${referenceFilters(items, kind)}<div class="contract-reference-scroll" role="region" aria-label="Consulta dos itens contratuais" tabindex="0"><table><thead><tr>${headings.map((heading) => `<th>${heading}</th>`).join("")}</tr></thead><tbody>${items.map((item) => referenceRow(item, document, kind)).join("")}</tbody></table></div><div class="contract-reference-empty" data-contract-reference-empty hidden>Nenhum item corresponde aos filtros.</div><footer><span data-contract-reference-count></span><div><button type="button" data-contract-reference-page="previous">← Anterior</button><span data-contract-reference-page-label></span><button type="button" data-contract-reference-page="next">Próxima →</button></div></footer></section>`;
}

function renderMatrix() {
  const tables = CONTRACT_REFERENCE.doc.filter((node) => node.b === "A4" && node.t === "tbl");
  return `<article class="contract-reading-card"><span class="contract-reading-kicker">Anexo 4</span><h3>Matriz de responsabilidades</h3><p>Divisão operacional entre Cliente e Escritório, conforme o Adendo fornecido.</p>${tables.map((table, index) => `<h4>${index ? "Responsabilidades complementares" : "Responsabilidades principais"}</h4>${renderDataTable(table, "Matriz de responsabilidades")}`).join("")}</article>`;
}

function checklistStorageKey(mode, company = {}, user = {}) {
  const companyId = company.id || company.client_id || "empresa";
  const userId = user.id || user.client_user_id || "usuario";
  const scope = [mode, companyId, userId].map((value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "_")).join(".");
  return `${CHECKLIST_STORAGE_BASE}.${scope}`;
}

function orderedChecklistItems(items, configuredOrder) {
  if (!Array.isArray(configuredOrder) || !configuredOrder.length) return items;
  const positions = new Map(configuredOrder.map((id, index) => [String(id), index]));
  return [...items].sort((left, right) => {
    const leftPosition = positions.has(String(left.id)) ? positions.get(String(left.id)) : Number.MAX_SAFE_INTEGER;
    const rightPosition = positions.has(String(right.id)) ? positions.get(String(right.id)) : Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition;
  });
}

function renderChecklist(mode, company = {}, user = {}, checklistOrder = {}) {
  const itemById = new Map(CONTRACT_REFERENCE.itens.map((item) => [item.id, item]));
  const importantItems = orderedChecklistItems(
    CONTRACT_CHECKLIST_PRIORITIES.map((entry) => ({ ...itemById.get(entry.id), checklistOrder: entry.order, checklistTitle: entry.title })).filter((item) => item.id),
    checklistOrder?.important,
  );
  const importantIds = new Set(importantItems.map((item) => item.id));
  const otherItems = orderedChecklistItems(
    CONTRACT_REFERENCE.itens.filter((item) => !importantIds.has(item.id)).sort((left, right) => Number(left.n || 0) - Number(right.n || 0) || Number(left.r ?? -1) - Number(right.r ?? -1) || String(left.id).localeCompare(String(right.id), "pt-BR")),
    checklistOrder?.other,
  );
  const items = [...importantItems, ...otherItems];
  const categories = facetEntries(items, "cat", FACETS.categorias || {});
  const storageKey = checklistStorageKey(mode, company, user);
  const canReorder = mode === "admin" && !["viewer", "collaborator"].includes(user.role);
  const renderItem = (item, important, index) => {
    const category = FACETS.categorias?.[item.cat] || "Geral";
    const priority = PRIORITY[item.crit] || item.crit || "Não classificada";
    const title = important ? item.checklistTitle : item.rotulo;
    const text = nodeText(CONTRACT_REFERENCE.doc[item.n], item.r ?? null);
    const order = important ? item.checklistOrder : String(index + 1);
    const search = [order, item.id, item.num, title, item.rotulo, item.blocoNome, category, priority, text].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
    const detailId = `contract-checklist-detail-${String(item.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const dragHandle = canReorder ? `<button type="button" class="contract-checklist-drag" draggable="true" data-checklist-drag-handle title="Arraste para reorganizar" aria-label="Arrastar ${escapeHtml(title)} para outra posição">↕</button>` : "";
    return `<article class="${important ? "is-priority-important" : "is-priority-complementary"}" data-contract-checklist-item="${escapeHtml(item.id)}" data-checklist-important="${important}" data-checklist-category="${escapeHtml(item.cat || "")}" data-checklist-search="${escapeHtml(search)}" data-checklist-order="${escapeHtml(order)}"><div class="contract-checklist-row">${dragHandle}<input type="checkbox" aria-label="Marcar como conferido: ${escapeHtml(title)}" data-contract-check><button type="button" class="contract-checklist-toggle" data-contract-checklist-toggle aria-expanded="false" aria-controls="${escapeHtml(detailId)}"><span class="contract-checklist-title"><strong>${important ? `<b class="contract-checklist-number">${escapeHtml(order)}</b>` : ""}${escapeHtml(title)}</strong><span class="contract-checklist-priority ${important ? "is-important" : ""}">${important ? "Importante" : "Demais itens"}</span></span><span class="contract-checklist-expand"><span data-contract-checklist-toggle-label>Abrir conteúdo</span><b aria-hidden="true">⌄</b></span></button></div><div class="contract-checklist-detail" id="${escapeHtml(detailId)}" data-contract-checklist-detail hidden><p>${escapeHtml(text)}</p><footer><small>${escapeHtml(item.num || item.id)} · ${escapeHtml(item.blocoNome || "Adendo")} · ${escapeHtml(category)} · Prioridade original: ${escapeHtml(priority)}</small><button type="button" class="contract-checklist-source" data-contract-open-document="adendum-full" data-contract-doc-index="${escapeHtml(item.n)}">Ver no Adendo →</button></footer></div></article>`;
  };
  const renderGroup = (key, title, description, groupItems, open) => `<details class="contract-checklist-group contract-checklist-group--${key}" data-contract-checklist-group="${key}"${open ? " open" : ""}><summary><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span><b data-contract-checklist-group-count>${groupItems.length} itens</b></summary><div class="contract-checklist-items" data-checklist-items="${key}">${groupItems.map((item, index) => renderItem(item, key === "important", index)).join("")}</div></details>`;
  return `<section class="contract-checklist" data-contract-checklist data-checklist-editable="true" data-checklist-reorderable="${canReorder}" data-checklist-storage-key="${escapeHtml(storageKey)}">
    <header><span>Conferência preventiva</span><h3>Checklist do Adendo</h3><p>As marcações são individuais e ficam salvas somente neste navegador. Elas auxiliam a leitura e a conferência, sem editar o Adendo, alterar atribuições ou registrar ciência formal.</p><div class="contract-checklist-coverage"><strong>${importantItems.length} itens importantes em 30 grupos</strong><span>Organizados na ordem definida pelo escritório.</span><small>+ ${otherItems.length} demais itens do Adendo</small>${canReorder ? '<small class="contract-checklist-order-hint">↕ Arraste os itens para salvar uma nova ordem geral.</small>' : ""}</div></header>
    <div class="contract-checklist-summary"><div><strong data-contract-checklist-count></strong><span data-contract-checklist-visible></span></div><button type="button" data-contract-checklist-clear>Desmarcar tudo</button></div>
    <div class="contract-checklist-toolbar">
      <label class="contract-checklist-search"><span>Buscar</span><input type="search" data-contract-checklist-search placeholder="Item, assunto ou trecho"></label>
      <label><span>Categoria</span><select data-contract-checklist-category><option value="">Todas</option>${categories.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}</select></label>
      <label><span>Conferência</span><select data-contract-checklist-status><option value="">Todos</option><option value="pending">Pendentes</option><option value="complete">Marcados</option></select></label>
      <button type="button" data-contract-checklist-filters-clear>Limpar filtros</button>
    </div>
    ${renderGroup("important", "Itens importantes", "Preferência de leitura definida pelo escritório", importantItems, true)}
    ${renderGroup("other", "Demais itens", "Itens residuais do Adendo, mantidos para conferência integral", otherItems, false)}
    <div class="contract-checklist-empty" data-contract-checklist-empty hidden>Nenhum item corresponde aos filtros.</div>
  </section>`;
}

function renderDeclaration(company = {}, user = {}) {
  const declarations = CONTRACT_REFERENCE.itens.filter((item) => /^A6-T/.test(item.id));
  const indexes = new Set(declarations.map((item) => item.n));
  const companyName = company.legal_name || company.trade_name || "________________________________";
  const cnpj = company.cnpj || "________________________________";
  const responsible = user.name || "________________________________";
  const email = user.email || "________________________________";
  const identity = { t: "tbl", cab: ["Identificação", "Informação"], linhas: [["Empresa", companyName], ["CNPJ", cnpj], ["Responsável", responsible], ["CPF", "________________________________"], ["Cargo/Função", user.job_title || user.role_label || "________________________________"], ["E-mail", email], ["Contrato principal", "________________________________"]] };
  const signature = { t: "tbl", cab: ["Assinatura", "Preenchimento"], linhas: [["Local e data", "________________________________"], ["Assinatura do responsável", "________________________________"], ["Forma de assinatura", "☐ gov.br   ☐ certificado digital   ☐ física"]] };
  return `<article class="contract-reading-card contract-declaration-card"><span class="contract-reading-kicker">Declaração</span><h3>Declaração de ciência</h3><p>Contrato de Prestação de Serviços Contábeis e Adendo Contratual Preventivo — versão ${escapeHtml(CONTRACT_REFERENCE.versao)}, revisão ${escapeHtml(CONTRACT_REFERENCE.revisao)}.</p><h4>Identificação</h4>${renderDataTable(identity, "Identificação da declaração")}<h4>Declaração — texto do Anexo 6 do Adendo</h4><div class="contract-declaration">${CONTRACT_REFERENCE.doc.map((node, index) => indexes.has(index) ? renderDocumentNode(node, index) : "").join("")}</div><h4>Alcance desta ciência</h4><p>Declaro que recebi, li e compreendi <strong>a íntegra do Adendo Contratual Preventivo</strong>, composto por ${CONTRACT_REFERENCE.itens.length} itens distribuídos em 13 cláusulas e 6 anexos, dos quais ${CONTRACT_REFERENCE.quadro.length} correspondem a obrigações e regras que me vinculam, bem como o Contrato de Prestação de Serviços Contábeis a que o Adendo se integra. Estou ciente de que, entregue esta Declaração, não poderei alegar desconhecimento das regras, dos prazos e das consequências ali previstas.</p><h4>Como assinar e devolver</h4><p>Escolha a forma que preferir:</p><ul><li><strong>Assinatura eletrônica pelo gov.br</strong> — forma recomendada pelo Escritório. Exporte esta Declaração em PDF, assine em <em>assinador.iti.br</em> com sua conta gov.br (nível prata ou ouro) e devolva o arquivo assinado por um Canal Oficial.</li><li><strong>Certificado digital</strong> (e-CPF ou e-CNPJ, A1 ou A3) — assine o PDF pelo programa de sua preferência e devolva pelo Canal Oficial.</li><li><strong>Assinatura física</strong> — imprima, assine e entregue pessoalmente no Escritório, ou digitalize e envie pelo Canal Oficial.</li></ul>${renderDataTable(signature, "Assinatura da declaração")}<aside class="contract-document-note"><p><strong>Comunicação do Escritório sobre ciência tácita.</strong> Decorridos <strong>30 (trinta) dias corridos</strong> do envio do Contrato e do Adendo pelos Canais Oficiais, sem devolução desta Declaração assinada e sem manifestação de oposição, o Escritório considerará a ciência ocorrida de forma tácita e seguirá aplicando as rotinas, os prazos e os canais ali previstos. Esta é uma comunicação do Escritório sobre como procederá; ela não substitui a devolução da Declaração assinada, que é a forma segura de registrar a ciência.</p></aside></article>`;
}

function renderIdentification(company, user, mode) {
  const name = company.trade_name || company.legal_name || "Empresa ainda não selecionada";
  const legal = company.legal_name || "Será preenchido pelo cadastro do cliente";
  const cnpj = company.cnpj || "Não informado";
  const responsible = user.name || "Responsável ainda não selecionado";
  const email = user.email || "Não informado";
  return `<article class="contract-identification"><span class="contract-reading-kicker">Identificação</span><h3>Partes e canais oficiais</h3>${mode === "admin" ? `<div class="contract-info-note">Os dados da empresa são mantidos no cadastro de Clientes. A tabela de obrigações continua editável neste módulo.</div>` : ""}<div class="contract-identification-grid"><div><span>Nome de exibição</span><strong>${escapeHtml(name)}</strong></div><div><span>Razão social</span><strong>${escapeHtml(legal)}</strong></div><div><span>CNPJ</span><strong>${escapeHtml(cnpj)}</strong></div><div><span>Responsável</span><strong>${escapeHtml(responsible)}</strong></div><div><span>E-mail do responsável</span><strong>${escapeHtml(email)}</strong></div><div><span>Documento contratual</span><strong>Adendo ${escapeHtml(CONTRACT_REFERENCE.versao)} · revisão ${escapeHtml(CONTRACT_REFERENCE.revisao)}</strong></div></div><section class="contract-contact-strip"><a href="mailto:societario.hteixeira@gmail.com"><b>Societário</b><span>societario.hteixeira@gmail.com</span></a><a href="mailto:fiscal@hteixeira.com.br"><b>Fiscal</b><span>fiscal@hteixeira.com.br</span></a><a href="tel:+555437718303"><b>Ligações</b><span>(054) 3771-8303</span></a><a href="https://wa.me/555432441048" target="_blank" rel="noopener noreferrer"><b>WhatsApp</b><span>(054) 3244-1048</span></a></section></article>`;
}

function modelActions(mode) {
  if (mode !== "admin") return "";
  return Object.values(CONTRACT_REFERENCE.models || {}).map((model) => `<a class="contract-tool-button" href="${escapeHtml(model.path)}" download><span>↓</span>${escapeHtml(model.name)}</a>`).join("");
}

function exportMenu() {
  return `<details class="contract-export-menu"><summary class="contract-tool-button"><span>⇩</span>Exportar</summary><div><button type="button" data-contract-export-sheet>Planilha (.xlsx)</button><button type="button" data-contract-export-html>Página (.html)</button></div></details>`;
}

function normalizedCellText(cell) {
  return String(cell?.textContent || "").replace(/↕/g, "").replace(/\s+/g, " ").trim();
}

function tableExportData(root) {
  const key = root.dataset.activeContractPanel || "matrix";
  const panel = root.querySelector(`[data-contract-panel="${CSS.escape(key)}"]`);
  const table = panel?.querySelector(".contract-reference--adendum table");
  if (!table) return null;
  const headings = [...table.querySelectorAll("thead th")].slice(0, -1).map(normalizedCellText);
  const rows = [...table.querySelectorAll("[data-contract-reference-row]")]
    .filter((row) => row.dataset.filterMatch !== "false")
    .map((row) => [...row.children].slice(0, -1).map(normalizedCellText));
  return { key, headings, rows, sheet: "Itens do Adendo" };
}

function exportSpreadsheet(root) {
  const data = tableExportData(root);
  if (!data) return;
  downloadFile(`obrigacoes-${data.key}.xlsx`, spreadsheetBlob(data.sheet, data.headings, data.rows));
}

function exportHtml(root) {
  const key = root.dataset.activeContractPanel || "matrix";
  const source = root.querySelector(`[data-contract-panel="${CSS.escape(key)}"]`);
  if (!source) return;
  const clone = source.cloneNode(true);
  clone.hidden = false;
  clone.querySelectorAll(".contract-reference-toolbar,.obligation-table-toolbar,.contract-reference>footer,.obligation-table-footer,[data-filter-match=false],[data-contract-font-controls]").forEach((node) => node.remove());
  clone.querySelectorAll("[data-filter-match=true]").forEach((node) => { node.hidden = false; });
  clone.querySelectorAll("[data-contract-reference-detail]").forEach((detail) => {
    const row = detail.previousElementSibling;
    if (!row || row.dataset.filterMatch === "false") detail.remove();
    else { detail.hidden = false; detail.removeAttribute("hidden"); }
  });
  clone.querySelectorAll("[data-contract-checklist-group]").forEach((group) => { group.hidden = false; group.open = true; group.removeAttribute("hidden"); });
  clone.querySelectorAll("[data-contract-checklist-item],[data-contract-checklist-detail]").forEach((node) => { node.hidden = false; node.removeAttribute("hidden"); });
  clone.querySelectorAll("[data-contract-checklist-toggle]").forEach((toggle) => {
    const staticTitle = document.createElement("div");
    staticTitle.className = "contract-checklist-toggle contract-checklist-toggle--export";
    const title = toggle.querySelector(".contract-checklist-title")?.cloneNode(true);
    if (title) staticTitle.append(title);
    toggle.replaceWith(staticTitle);
  });
  clone.querySelectorAll("[data-obligation-row],[data-contract-reference-row]").forEach((row) => row.lastElementChild?.remove());
  clone.querySelectorAll("table thead tr").forEach((row) => {
    if (row.children.length > 1 && ["Ações", "Ação"].includes(normalizedCellText(row.lastElementChild))) row.lastElementChild.remove();
  });
  clone.querySelectorAll("button,input,select").forEach((node) => node.remove());
  let styles = "";
  for (const sheet of document.styleSheets) {
    try { styles += [...sheet.cssRules].map((rule) => rule.cssText).join("\n"); } catch (_) { /* folha externa indisponível */ }
  }
  const title = root.querySelector(`[data-contract-tab="${CSS.escape(key)}"]`)?.textContent?.trim() || "Obrigações";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — H. Teixeira</title><style>${styles}</style></head><body><main style="max-width:1320px;margin:0 auto;padding:18px"><header style="border-bottom:2px solid #0795a3;margin-bottom:16px;padding-bottom:10px"><strong>H. Teixeira Contabilidade</strong><br><small>Documento contratual preventivo · versão ${escapeHtml(CONTRACT_REFERENCE.versao)} · revisão ${escapeHtml(CONTRACT_REFERENCE.revisao)}</small></header><section class="contract-workspace"><div class="contract-workspace-body">${clone.outerHTML}</div></section><p style="color:#64748b;font-size:11px;margin-top:16px">Consulta exportada do aplicativo. Em caso de divergência, prevalecem o contrato e o Adendo assinados pelas partes.</p></main></body></html>`;
  downloadFile(`obrigacoes-${key}.html`, new Blob([html], { type: "text/html;charset=utf-8" }));
}

export function renderContractWorkspace({ mode = "runtime", company = {}, user = {}, checklistOrder = {} } = {}) {
  const tabs = mode === "admin" ? ALL_TABS : ALL_TABS.filter(([key]) => CLIENT_TAB_KEYS.has(key));
  const panel = (key, body, active = false) => `<section class="contract-workspace-panel${active ? " is-active" : ""}" data-contract-panel="${key}" ${active ? "" : "hidden"}>${body}</section>`;
  const panels = {
    "adendum-items": `<header class="contract-panel-intro"><span>Índice analítico</span><h3>Itens do Adendo</h3><p>Pesquise as 174 referências por seção, assunto, responsável, tipo, prazo, categoria e criticidade.</p></header>${renderReferenceTable(CONTRACT_REFERENCE.itens, CONTRACT_REFERENCE.doc, "adendum")}`,
    "contract-items": `<header class="contract-panel-intro"><span>Índice analítico</span><h3>Contrato de prestação de serviços</h3><p>Consulta estruturada dos 127 itens do contrato incorporado.</p></header>${renderReferenceTable(CONTRACT_REFERENCE.contrato.itens, CONTRACT_REFERENCE.contrato.doc, "contract")}`,
    matrix: renderMatrix(),
    checklist: renderChecklist(mode, company, user, checklistOrder),
    declaration: renderDeclaration(company, user),
    "contract-full": renderDocument(CONTRACT_REFERENCE.contrato.doc, "Contrato integral"),
    "adendum-full": renderDocument(CONTRACT_REFERENCE.doc, "Adendo integral"),
    identification: renderIdentification(company, user, mode),
  };
  return `<section class="contract-workspace" data-contract-workspace data-contract-mode="${escapeHtml(mode)}">
    <header class="contract-workspace-header"><div><span>Documento contratual preventivo</span><h2>Contrato e obrigações do cliente</h2><p>Versão ${escapeHtml(CONTRACT_REFERENCE.versao)} · revisão ${escapeHtml(CONTRACT_REFERENCE.revisao)} · conteúdo incorporado à base do app</p></div><div class="contract-workspace-tools">${modelActions(mode)}${exportMenu()}<div class="contract-font-controls" data-contract-font-controls role="group" aria-label="Tamanho geral do texto"><button type="button" data-contract-font="decrease" title="Diminuir fonte" aria-label="Diminuir fonte">A−</button><button type="button" data-contract-font="reset" title="Restaurar fonte"><output data-contract-font-label>100%</output></button><button type="button" data-contract-font="increase" title="Aumentar fonte" aria-label="Aumentar fonte">A+</button></div><button class="contract-tool-button" type="button" data-contract-print><span>▤</span>Imprimir / PDF</button><button class="contract-tool-button contract-tool-button--primary" type="button" data-contract-fullscreen><span>⛶</span><b data-contract-fullscreen-label>Tela cheia</b></button></div></header>
    <nav class="contract-workspace-tabs" role="tablist" aria-label="Seções do documento">${tabs.map(([key, label], index) => `<button type="button" role="tab" data-contract-tab="${key}" aria-selected="${index === 0}" class="${index === 0 ? "is-active" : ""}">${label}</button>`).join("")}</nav>
    <div class="contract-workspace-body">${tabs.map(([key], index) => panel(key, panels[key], index === 0)).join("")}</div>
    <footer class="contract-workspace-footer"><strong>Nota de leitura</strong><p>Este aplicativo é um recurso de consulta. Em caso de divergência, prevalecem o contrato e o Adendo assinados pelas partes.</p></footer>
  </section>`;
}

function initializeReferenceTable(root) {
  if (root.dataset.contractReferenceReady === "true") return;
  root.dataset.contractReferenceReady = "true";
  const rows = [...root.querySelectorAll("[data-contract-reference-row]")];
  let page = 1;
  const value = (selector) => root.querySelector(selector)?.value || "";
  const refresh = () => {
    const query = value("[data-contract-reference-search]").trim().toLocaleLowerCase("pt-BR");
    const block = value("[data-contract-reference-block]");
    const category = value("[data-contract-reference-category]");
    const priority = value("[data-contract-reference-priority]");
    const party = value("[data-contract-reference-party]");
    const type = value("[data-contract-reference-type]");
    const deadline = value("[data-contract-reference-deadline]");
    const onlyClient = root.querySelector("[data-contract-reference-client]")?.checked || false;
    const size = Number(value("[data-contract-reference-size]") || 20);
    const found = rows.filter((row) => (!query || row.dataset.search.includes(query))
      && (!block || row.dataset.block === block)
      && (!category || row.dataset.category === category)
      && (!priority || row.dataset.priority === priority)
      && (!party || row.dataset.parties.split("|").includes(party))
      && (!type || row.dataset.type === type)
      && (!deadline || row.dataset.deadline === deadline)
      && (!onlyClient || row.dataset.client === "true"));
    const pages = Math.max(1, Math.ceil(found.length / size));
    page = Math.min(page, pages);
    rows.forEach((row) => {
      const index = found.indexOf(row);
      row.dataset.filterMatch = String(index >= 0);
      const visible = index >= (page - 1) * size && index < page * size;
      row.hidden = !visible;
      const detail = root.querySelector(`[data-contract-reference-detail="${CSS.escape(row.dataset.referenceId)}"]`);
      if (!visible && detail) detail.hidden = true;
    });
    root.querySelector("[data-contract-reference-empty]").hidden = found.length > 0;
    root.querySelector("[data-contract-reference-count]").textContent = `${found.length} ${found.length === 1 ? "item encontrado" : "itens encontrados"}`;
    root.querySelector("[data-contract-reference-page-label]").textContent = `Página ${page} de ${pages}`;
    root.querySelector('[data-contract-reference-page="previous"]').disabled = page <= 1;
    root.querySelector('[data-contract-reference-page="next"]').disabled = page >= pages;
  };
  root.addEventListener("input", (event) => { if (event.target.matches("input,select")) { page = 1; refresh(); } });
  root.addEventListener("change", (event) => { if (event.target.matches("select")) { page = 1; refresh(); } });
  root.addEventListener("click", (event) => {
    const clear = event.target.closest("[data-contract-reference-clear]");
    if (clear) {
      root.querySelectorAll("input,select").forEach((control) => {
        if (control.type === "checkbox") control.checked = false;
        else if (control.matches("[data-contract-reference-size]")) control.value = "20";
        else control.value = "";
      });
      page = 1;
      refresh();
      root.querySelector("[data-contract-reference-search]")?.focus();
      return;
    }
    const pager = event.target.closest("[data-contract-reference-page]");
    if (pager) { page += pager.dataset.contractReferencePage === "next" ? 1 : -1; refresh(); }
    const detailButton = event.target.closest("[data-contract-detail]");
    if (detailButton) {
      const detail = root.querySelector(`[data-contract-reference-detail="${CSS.escape(detailButton.dataset.contractDetail)}"]`);
      if (detail) { detail.hidden = !detail.hidden; detailButton.textContent = detail.hidden ? "Ler trecho" : "Fechar trecho"; }
    }
    const copy = event.target.closest("[data-contract-copy]");
    if (copy) {
      const text = copy.closest("[data-contract-reference-detail]")?.querySelector("[data-contract-reference-text]")?.textContent || "";
      const complete = () => {
        copy.textContent = "Copiado!";
        window.setTimeout(() => { if (copy.isConnected) copy.textContent = "Copiar texto"; }, 1400);
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(complete).catch(() => {});
      else {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
        document.body.append(area);
        area.select();
        try { document.execCommand("copy"); complete(); } catch (_) { /* sem suporte no navegador */ }
        area.remove();
      }
    }
  });
  refresh();
}

function checklistDomOrder(root) {
  return Object.fromEntries(["important", "other"].map((group) => [
    group,
    [...root.querySelectorAll(`[data-checklist-items="${group}"] > [data-contract-checklist-item]`)]
      .map((item) => item.dataset.contractChecklistItem),
  ]));
}

function initializeChecklistReordering(root) {
  if (root.dataset.checklistReorderable !== "true") return;
  let dragged = null;
  let previousParent = null;
  let previousNext = null;
  let previousOrder = null;
  const clearTargets = () => root.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
  const persist = () => {
    const order = checklistDomOrder(root);
    if (JSON.stringify(order) === JSON.stringify(previousOrder)) return;
    const movedItem = dragged;
    const originalParent = previousParent;
    const originalNext = previousNext;
    root.dispatchEvent(new CustomEvent("ht:checklist-order-change", {
      bubbles: true,
      detail: {
        order,
        revert: () => {
          if (!movedItem || !originalParent) return;
          originalParent.insertBefore(movedItem, originalNext?.parentElement === originalParent ? originalNext : null);
        },
      },
    }));
  };
  root.addEventListener("dragstart", (event) => {
    const handle = event.target.closest("[data-checklist-drag-handle]");
    if (!handle) return;
    dragged = handle.closest("[data-contract-checklist-item]");
    previousParent = dragged?.parentElement || null;
    previousNext = dragged?.nextElementSibling || null;
    previousOrder = checklistDomOrder(root);
    dragged?.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragged?.dataset.contractChecklistItem || "");
  });
  root.addEventListener("dragover", (event) => {
    if (!dragged) return;
    const target = event.target.closest("[data-contract-checklist-item]");
    const container = target?.parentElement || event.target.closest("[data-checklist-items]");
    if (!container || container !== dragged.parentElement) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearTargets();
    target?.classList.add("is-drop-target");
  });
  root.addEventListener("drop", (event) => {
    if (!dragged) return;
    const target = event.target.closest("[data-contract-checklist-item]");
    const container = target?.parentElement || event.target.closest("[data-checklist-items]");
    if (!container || container !== dragged.parentElement) return;
    event.preventDefault();
    if (target && target !== dragged) {
      const after = event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
      container.insertBefore(dragged, after ? target.nextElementSibling : target);
    } else if (!target) container.append(dragged);
    persist();
  });
  root.addEventListener("dragend", () => {
    dragged?.classList.remove("is-dragging");
    clearTargets();
    dragged = null;
    previousParent = null;
    previousNext = null;
    previousOrder = null;
  });
  root.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-checklist-drag-handle]");
    if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const item = handle.closest("[data-contract-checklist-item]");
    const sibling = event.key === "ArrowUp" ? item?.previousElementSibling : item?.nextElementSibling;
    if (!item || !sibling) return;
    event.preventDefault();
    dragged = item;
    previousParent = item.parentElement;
    previousNext = item.nextElementSibling;
    previousOrder = checklistDomOrder(root);
    if (event.key === "ArrowUp") item.parentElement.insertBefore(item, sibling);
    else item.parentElement.insertBefore(sibling, item);
    persist();
    handle.focus();
    dragged = null;
    previousParent = null;
    previousNext = null;
    previousOrder = null;
  });
}

function initializeChecklist(root) {
  if (root.dataset.checklistEditable !== "true" || root.dataset.checklistReady === "true") return;
  root.dataset.checklistReady = "true";
  const storageKey = root.dataset.checklistStorageKey || CHECKLIST_STORAGE_BASE;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem(CHECKLIST_STORAGE_BASE) || "{}"); } catch (_) { saved = {}; }
  const inputs = [...root.querySelectorAll("[data-contract-check]")];
  const items = [...root.querySelectorAll("[data-contract-checklist-item]")];
  const groups = [...root.querySelectorAll("[data-contract-checklist-group]")];
  const refreshState = () => {
    const state = {};
    inputs.forEach((input) => {
      const item = input.closest("[data-contract-checklist-item]");
      item.classList.toggle("is-complete", input.checked);
      if (input.checked) state[item.dataset.contractChecklistItem] = true;
    });
    const count = inputs.filter((input) => input.checked).length;
    root.querySelector("[data-contract-checklist-count]").textContent = `${count} de ${inputs.length} itens marcados`;
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) { /* armazenamento indisponível */ }
  };
  const applyFilters = () => {
    const query = (root.querySelector("[data-contract-checklist-search]")?.value || "").trim().toLocaleLowerCase("pt-BR");
    const category = root.querySelector("[data-contract-checklist-category]")?.value || "";
    const status = root.querySelector("[data-contract-checklist-status]")?.value || "";
    let visible = 0;
    items.forEach((item) => {
      const checked = item.querySelector("[data-contract-check]")?.checked || false;
      const matches = (!query || item.dataset.checklistSearch.includes(query)) && (!category || item.dataset.checklistCategory === category) && (!status || (status === "complete" ? checked : !checked));
      item.hidden = !matches;
      if (matches) visible += 1;
    });
    const hasFilters = Boolean(query || category || status);
    groups.forEach((group) => {
      const groupVisible = [...group.querySelectorAll("[data-contract-checklist-item]")].filter((item) => !item.hidden).length;
      group.hidden = groupVisible === 0;
      group.querySelector("[data-contract-checklist-group-count]").textContent = `${groupVisible} ${groupVisible === 1 ? "item" : "itens"}`;
      if (hasFilters && groupVisible) group.open = true;
    });
    root.querySelector("[data-contract-checklist-visible]").textContent = hasFilters ? `${visible} itens encontrados` : `${visible} itens no checklist`;
    root.querySelector("[data-contract-checklist-empty]").hidden = visible !== 0;
  };
  inputs.forEach((input) => { input.checked = Boolean(saved[input.closest("[data-contract-checklist-item]").dataset.contractChecklistItem]); });
  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-contract-check]")) refreshState();
    if (event.target.matches("[data-contract-check], [data-contract-checklist-category], [data-contract-checklist-status]")) applyFilters();
  });
  root.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-contract-checklist-toggle]");
    if (!toggle || !root.contains(toggle)) return;
    const item = toggle.closest("[data-contract-checklist-item]");
    const detail = item?.querySelector("[data-contract-checklist-detail]");
    if (!item || !detail) return;
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    detail.hidden = expanded;
    item.classList.toggle("is-expanded", !expanded);
    const label = toggle.querySelector("[data-contract-checklist-toggle-label]");
    if (label) label.textContent = expanded ? "Abrir conteúdo" : "Recolher";
  });
  root.querySelector("[data-contract-checklist-search]")?.addEventListener("input", applyFilters);
  root.querySelector("[data-contract-checklist-clear]")?.addEventListener("click", () => { inputs.forEach((input) => { input.checked = false; }); refreshState(); applyFilters(); });
  root.querySelector("[data-contract-checklist-filters-clear]")?.addEventListener("click", () => {
    root.querySelector("[data-contract-checklist-search]").value = "";
    root.querySelector("[data-contract-checklist-category]").value = "";
    root.querySelector("[data-contract-checklist-status]").value = "";
    groups.forEach((group) => { group.open = group.dataset.contractChecklistGroup === "important"; });
    applyFilters();
  });
  initializeChecklistReordering(root);
  refreshState();
  applyFilters();
}

function initializeContractFontControls(root) {
  const selector = "h2,h3,h4,p,li,td,th,label,input,select,button,a,strong,small,span,b,output,summary";
  const elements = [...root.querySelectorAll(selector)];
  elements.forEach((element) => {
    if (!element.dataset.contractBaseFontSize) {
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      if (Number.isFinite(size) && size > 0) element.dataset.contractBaseFontSize = String(size);
    }
  });
  let stored = 1;
  try { stored = Number.parseFloat(localStorage.getItem(CONTRACT_FONT_STORAGE) || "1"); } catch (_) { stored = 1; }
  let index = CONTRACT_FONT_STEPS.reduce((best, value, current) => Math.abs(value - stored) < Math.abs(CONTRACT_FONT_STEPS[best] - stored) ? current : best, 0);
  const apply = () => {
    const scale = CONTRACT_FONT_STEPS[index];
    root.dataset.contractFontScale = String(scale);
    elements.forEach((element) => {
      const base = Number.parseFloat(element.dataset.contractBaseFontSize || "");
      if (Number.isFinite(base)) element.style.fontSize = `${(base * scale).toFixed(2)}px`;
    });
    const label = root.querySelector("[data-contract-font-label]");
    if (label) label.textContent = `${Math.round(scale * 100)}%`;
    root.querySelector('[data-contract-font="decrease"]')?.toggleAttribute("disabled", index === 0);
    root.querySelector('[data-contract-font="increase"]')?.toggleAttribute("disabled", index === CONTRACT_FONT_STEPS.length - 1);
    try { localStorage.setItem(CONTRACT_FONT_STORAGE, String(scale)); } catch (_) { /* preferência não persistida */ }
  };
  root.addEventListener("click", (event) => {
    const command = event.target.closest("[data-contract-font]")?.dataset.contractFont;
    if (!command) return;
    if (command === "decrease") index = Math.max(0, index - 1);
    if (command === "increase") index = Math.min(CONTRACT_FONT_STEPS.length - 1, index + 1);
    if (command === "reset") index = CONTRACT_FONT_STEPS.indexOf(1);
    apply();
  });
  apply();
}

export function initializeContractWorkspaces(scope = document) {
  for (const root of scope.querySelectorAll("[data-contract-workspace]")) {
    if (root.dataset.contractWorkspaceReady === "true") continue;
    root.dataset.contractWorkspaceReady = "true";
    let highlightTimer = 0;
    const activate = (key) => {
      for (const tab of root.querySelectorAll("[data-contract-tab]")) {
        const active = tab.dataset.contractTab === key;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      }
      for (const panel of root.querySelectorAll("[data-contract-panel]")) {
        const active = panel.dataset.contractPanel === key;
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      }
      root.dataset.activeContractPanel = key;
      const sheetExport = root.querySelector("[data-contract-export-sheet]");
      if (sheetExport) sheetExport.hidden = key !== "adendum-items";
      root.querySelector(".contract-workspace-body")?.scrollTo({ top: 0, behavior: "auto" });
    };
    root.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-contract-tab]");
      if (tab) { activate(tab.dataset.contractTab); return; }
      const open = event.target.closest("[data-contract-open-document]");
      if (open) {
        activate(open.dataset.contractOpenDocument);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const target = root.querySelector(`[data-contract-panel="${open.dataset.contractOpenDocument}"] [data-contract-doc-index="${open.dataset.contractDocIndex}"]`);
          if (!target) return;
          root.querySelectorAll(".is-contract-target").forEach((node) => node.classList.remove("is-contract-target"));
          target.classList.remove("is-contract-target");
          void target.offsetWidth;
          target.classList.add("is-contract-target");
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          window.clearTimeout(highlightTimer);
          highlightTimer = window.setTimeout(() => target.classList.remove("is-contract-target"), 3200);
        }));
        return;
      }
      if (event.target.closest("[data-contract-print]")) { window.print(); return; }
      if (event.target.closest("[data-contract-export-sheet]")) { exportSpreadsheet(root); event.target.closest(".contract-export-menu")?.removeAttribute("open"); return; }
      if (event.target.closest("[data-contract-export-html]")) { exportHtml(root); event.target.closest(".contract-export-menu")?.removeAttribute("open"); return; }
      if (event.target.closest("[data-contract-fullscreen]")) {
        if (document.fullscreenElement === root) document.exitFullscreen?.();
        else root.requestFullscreen?.();
      }
    });
    const updateFullscreen = () => {
      if (!root.isConnected) return document.removeEventListener("fullscreenchange", updateFullscreen);
      const label = root.querySelector("[data-contract-fullscreen-label]");
      if (label) label.textContent = document.fullscreenElement === root ? "Sair da tela cheia" : "Tela cheia";
    };
    document.addEventListener("fullscreenchange", updateFullscreen);
    initializeContractFontControls(root);
    activate(root.querySelector("[data-contract-tab]")?.dataset.contractTab || "matrix");
    root.querySelectorAll("[data-contract-reference]").forEach(initializeReferenceTable);
    root.querySelectorAll("[data-contract-checklist]").forEach(initializeChecklist);
  }
}
