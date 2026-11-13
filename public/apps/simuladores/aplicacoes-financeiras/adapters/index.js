import { identifyBank, identifyDocumentKind } from './registry.js';
import { interAdapter } from './inter.js';
import { bancoDoBrasilAdapter } from './banco-do-brasil.js';
import { sicrediAdapter } from './sicredi.js';
import { itauSummaryAdapter } from './itau.js';
import { caixaFundAdapter } from './caixa.js';
import { sicoobRdcAdapter } from './sicoob.js';
import { banrisulCdbAdapter } from './banrisul.js';
import { parseOfx } from './ofx.js';

export const adapters = [interAdapter, bancoDoBrasilAdapter, sicrediAdapter, itauSummaryAdapter, caixaFundAdapter, sicoobRdcAdapter, banrisulCdbAdapter];
export { identifyBank, identifyDocumentKind, parseOfx };
export function adapterFor(input) {
  const bank = identifyBank(input);
  return adapters.find(adapter => adapter.canHandle({bankId: bank.id, text: input.text || ''})) || null;
}
