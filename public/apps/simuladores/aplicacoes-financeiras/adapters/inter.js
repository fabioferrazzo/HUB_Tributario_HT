import { EVIDENCE_STATUS, EVENT_TYPES, PRODUCT_FAMILIES, createEvent } from '../domain/model.js';

const money = value => Math.round(Number(String(value).replace(/\./g, '').replace(',', '.')) * 100);
const isoDate = value => {
  const [day, month, year] = String(value).split('/');
  return `${year}-${month}-${day}`;
};

function parsedRows(text) {
  const regex = /(\d{2}\/\d{2}\/\d{4})\s+(Aplicação|Resgate Antecipado|Imposto de renda retido na fonte|Rendimento até esta data|Saldo até esta data|Previsão de I\.R\. para resgate total até esta data|Previsão para I\.O\.F\. até esta data(?:\(isento após 30 dias da aplicação\))?)\s+R\$\s*([\d.]+,\d{2})/gi;
  return [...text.matchAll(regex)].map((match, index) => ({
    index,
    occurredAt: isoDate(match[1]),
    label: match[2],
    amountCents: money(match[3])
  }));
}

export const interAdapter = {
  id: 'inter',
  productFamilies: [PRODUCT_FAMILIES.FIXED_INCOME_SECURITY, PRODUCT_FAMILIES.AUTOMATIC_CASH],
  canHandle({bankId, text = ''}) {
    return bankId === 'inter' || /BANCO INTER|CDB DI LIQUIDEZ|CDB POS DI|CDB MAIS LIMITE/i.test(text);
  },
  parseNormalizedText({projectId, positionId, accountId, documentId, text}) {
    const events = [];
    const rows = parsedRows(text);
    const consumedIrrf = new Set();

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const lower = row.label.toLowerCase();
      const base = {
        projectId,
        positionId,
        bankId: 'inter',
        accountId,
        occurredAt: row.occurredAt,
        evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
        sourceDocumentId: documentId
      };

      if (lower.startsWith('aplic')) {
        events.push(createEvent({id: `${documentId}-application-${events.length + 1}`, ...base, type: EVENT_TYPES.APPLICATION, amountCents: row.amountCents}));
        continue;
      }

      if (lower.startsWith('resgate')) {
        const irrIndex = rows.findIndex((candidate, index) => index > rowIndex && !consumedIrrf.has(index) && candidate.occurredAt === row.occurredAt && candidate.label.toLowerCase().startsWith('imposto'));
        const irrAmountCents = irrIndex >= 0 ? rows[irrIndex].amountCents : 0;
        if (irrIndex >= 0) consumedIrrf.add(irrIndex);
        events.push(createEvent({
          id: `${documentId}-redemption-${events.length + 1}`,
          ...base,
          type: EVENT_TYPES.REDEMPTION,
          amountCents: row.amountCents,
          netAmountCents: row.amountCents,
          grossAmountCents: row.amountCents + irrAmountCents,
          notes: 'Valor líquido creditado no resgate.'
        }));
        continue;
      }

      if (lower.startsWith('imposto')) {
        events.push(createEvent({id: `${documentId}-redemption-ir-${events.length + 1}`, ...base, type: EVENT_TYPES.REDEMPTION_IRRF, amountCents: row.amountCents}));
        continue;
      }

      if (lower.startsWith('rendimento')) {
        events.push(createEvent({
          id: `${documentId}-period-income-${events.length + 1}`,
          ...base,
          type: EVENT_TYPES.PERIOD_INCOME,
          amountCents: row.amountCents,
          notes: 'Valorização no intervalo do extrato; não equivale automaticamente ao rendimento fiscal realizado.'
        }));
        continue;
      }

      if (lower.startsWith('saldo')) {
        events.push(createEvent({id: `${documentId}-balance-${events.length + 1}`, ...base, type: EVENT_TYPES.BALANCE_SNAPSHOT, amountCents: row.amountCents}));
        continue;
      }

      if (lower.startsWith('previsão')) {
        events.push(createEvent({
          id: `${documentId}-tax-forecast-${events.length + 1}`,
          ...base,
          type: EVENT_TYPES.TAX_FORECAST,
          amountCents: row.amountCents,
          evidenceStatus: EVIDENCE_STATUS.ESTIMATED,
          notes: 'Previsão bancária; não corresponde a imposto efetivamente retido.',
          metadata: {taxKind: lower.includes('i.o.f') ? 'IOF' : 'IRRF'}
        }));
      }
    }

    return {events, warnings: events.length ? [] : ['Nenhum evento reconhecido no texto normalizado.']};
  }
};
