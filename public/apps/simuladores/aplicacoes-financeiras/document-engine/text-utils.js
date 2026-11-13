export function normalizeForSearch(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

export function normalizeDocumentText(value = '') {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function moneyToCents(value) {
  if (typeof value === 'number') return Math.round(value * 100);
  let text = String(value ?? '').trim().replace(/R\$|BRL/gi, '').replace(/\s/g, '');
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  text = text.replace(/[()\-+]/g, '');
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else if (text.includes(',')) text = text.replace(',', '.');
  const number = Number(text);
  if (!Number.isFinite(number)) throw new TypeError(`Valor monetário inválido: ${value}`);
  return Math.round(number * 100) * (negative ? -1 : 1);
}

export function decimalPt(value) {
  const text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function dateToIso(value) {
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function monthReferenceToDate(monthName, year, day = null) {
  const months = {JANEIRO:1,FEVEREIRO:2,MARCO:3,MARÇO:3,ABRIL:4,MAIO:5,JUNHO:6,JULHO:7,AGOSTO:8,SETEMBRO:9,OUTUBRO:10,NOVEMBRO:11,DEZEMBRO:12};
  const month = months[normalizeForSearch(monthName).toUpperCase()];
  if (!month) return null;
  const lastDay = new Date(Date.UTC(Number(year), month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2,'0')}-${String(day || lastDay).padStart(2,'0')}`;
}

export function lineSnippets(text) {
  return normalizeDocumentText(text).split('\n').map((line, index) => ({line: index + 1, text: line.trim()})).filter(item => item.text);
}

export function slug(value, fallback = 'instituicao') {
  const result = normalizeForSearch(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return result || fallback;
}

export function stableId(parts) {
  const text = parts.filter(Boolean).join('|');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
