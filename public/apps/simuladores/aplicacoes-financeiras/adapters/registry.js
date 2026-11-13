export const BANKS = Object.freeze({
  INTER: {id: 'inter', name: 'Banco Inter', aliases: ['inter', 'banco inter']},
  BB: {id: 'bb', name: 'Banco do Brasil', aliases: ['banco do brasil', 'bb rf', 'aplicacaobb']},
  SICREDI: {id: 'sicredi', name: 'Sicredi', aliases: ['sicredi']},
  ITAU: {id: 'itau', name: 'Itau Unibanco', aliases: ['banco itau', 'itau unibanco', 'itau']},
  CAIXA: {id: 'caixa', name: 'Caixa Economica Federal', aliases: ['caixa economica federal']},
  SICOOB: {id: 'sicoob', name: 'Sicoob', aliases: ['sicoob']},
  BANRISUL: {id: 'banrisul', name: 'Banrisul', aliases: ['banrisul']},
  GENERIC: {id: 'generic', name: 'Banco não identificado', aliases: []}
});

export function identifyBank({fileName = '', text = ''}) {
  const haystack = `${fileName} ${text}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  for (const bank of [BANKS.INTER, BANKS.BB, BANKS.SICREDI, BANKS.ITAU, BANKS.CAIXA, BANKS.SICOOB, BANKS.BANRISUL]) {
    if (bank.aliases.some(alias => haystack.includes(alias))) return bank;
  }
  if (/(^|[^a-z])bb([^a-z]|$)/i.test(haystack)) return BANKS.BB;
  return BANKS.GENERIC;
}

export function identifyDocumentKind({fileName = '', text = ''}) {
  const value = `${fileName} ${text}`.toLocaleLowerCase('pt-BR');
  if (/\.ofx$/i.test(fileName)) return 'OFX';
  if (value.includes('comprovante de rendimentos') || value.includes('informe de rendimentos')) return 'INCOME_REPORT';
  if (value.includes('comprovante de resgate') || value.includes('resgate realizado')) return 'REDEMPTION_RECEIPT';
  if (value.includes('extrato de movimentação de renda fixa')) return 'FIXED_INCOME_STATEMENT';
  if (value.includes('investimentos fundos') || value.includes('bb rf cp automático')) return 'QUOTA_FUND_STATEMENT';
  if (/\.pdf$/i.test(fileName)) return 'PDF_UNCLASSIFIED';
  return 'UNKNOWN';
}
