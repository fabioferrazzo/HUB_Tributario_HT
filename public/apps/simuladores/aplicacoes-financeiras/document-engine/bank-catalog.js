import { normalizeForSearch, slug } from './text-utils.js';

export const BANK_CATALOG = Object.freeze([
  {id:'inter', name:'Banco Inter', patterns:[/BANCO INTER/i,/INTER\.CO/i], cnpjs:['00.416.968/0001-01','018.945.670/0001-46']},
  {id:'bb', name:'Banco do Brasil', patterns:[/BANCO DO BRASIL/i,/\bBB RF /i,/EXTRATOS\s*-?\s*INVESTIMENTOS\s+FUNDOS\s*-?\s*MENSAL/i], cnpjs:['00.000.000/0001-91']},
  {id:'itau', name:'Itaú Unibanco', patterns:[/ITAU UNIBANCO/i,/BANCO ITAU/i]},
  {id:'bradesco', name:'Banco Bradesco', patterns:[/BANCO BRADESCO/i,/BRADESCO/i]},
  {id:'santander', name:'Banco Santander', patterns:[/BANCO SANTANDER/i,/SANTANDER BRASIL/i]},
  {id:'sicredi', name:'Sicredi', patterns:[/SICREDI/i]},
  {id:'sicoob', name:'Sicoob', patterns:[/SICOOB/i]},
  {id:'caixa', name:'Caixa Econômica Federal', patterns:[/CAIXA ECONOMICA FEDERAL/i,/CEF\b/i]},
  {id:'nubank', name:'Nubank', patterns:[/NU PAGAMENTOS/i,/NUBANK/i]},
  {id:'btg', name:'BTG Pactual', patterns:[/BTG PACTUAL/i]},
  {id:'xp', name:'XP Investimentos', patterns:[/XP INVESTIMENTOS/i]},
  {id:'banrisul', name:'Banrisul', patterns:[/BANRISUL/i], cnpjs:['92.702.067/0001-96']},
  {id:'c6', name:'Banco C6', patterns:[/BANCO C6\b/i,/\bC6 ?BANK\b/i], cnpjs:['31.872.495/0001-72']},
]);

function inferredName(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 35);
  const candidates = lines.filter(line => /\b(BANCO|COOPERATIVA|CORRETORA|DISTRIBUIDORA|INVESTIMENTOS|FINANCEIRA)\b/i.test(line) && line.length <= 100);
  return candidates[0]?.replace(/\s+/g, ' ') || null;
}

export function identifyInstitution({fileName = '', text = ''}) {
  const haystack = normalizeForSearch(`${fileName}\n${text}`).toUpperCase();
  for (const bank of BANK_CATALOG) {
    if (bank.cnpjs?.some(cnpj => haystack.includes(normalizeForSearch(cnpj).toUpperCase())) || bank.patterns.some(pattern => pattern.test(haystack))) return {...bank, confidence: 0.99, source: 'CATALOG'};
  }
  const name = inferredName(text);
  if (name) return {id: `bank-${slug(name)}`, name, patterns: [], confidence: 0.65, source: 'HEADER_INFERENCE'};
  return {id: 'generic', name: 'Instituição não identificada', patterns: [], confidence: 0.2, source: 'FALLBACK'};
}
