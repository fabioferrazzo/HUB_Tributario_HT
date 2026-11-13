import { EVIDENCE_STATUS, EVENT_TYPES, PRODUCT_FAMILIES, createEvent } from '../domain/model.js';

const money = value => Math.round(Number(String(value).replace(/\./g, '').replace(',', '.')) * 100);
const decimal = value => Number(String(value).replace(/\./g, '').replace(',', '.'));
const isoDate = value => {
  const [day, month, year] = String(value).split('/');
  return `${year}-${month}-${day}`;
};

function quotaValuesByDate(lines) {
  const result = new Map();
  const start = lines.findIndex(line => /^Valor da Cota$/i.test(line));
  if (start < 0) return result;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^Rentabilidade$/i.test(lines[index])) break;
    const match = lines[index].match(/^(\d{2}\/\d{2}\/\d{4})\s+([\d.]+,\d+)$/);
    if (match) result.set(isoDate(match[1]), decimal(match[2]));
  }
  return result;
}

// BBRESUMO01: no PDF digital (-layout) os valores do "Resumo do mês" saem deslocados em relação aos rótulos
// (ex.: "RESGATES (-) 1.733,56" quando 1.733,56 é o rendimento bruto). A ordem dos 8 valores é estável:
// saldo anterior, aplicações, resgates, rendimento bruto, IR, IOF, rendimento líquido, saldo atual.
// A leitura só é aceita quando fecha a equação do saldo e a do rendimento líquido.
const SUMMARY_KEYS = ['openingCents', 'applicationsCents', 'redemptionsCents', 'grossIncomeCents', 'irCents', 'iofCents', 'netIncomeCents', 'closingCents'];
const SUMMARY_LABELS = [/SALDO ANTERIOR/i, /APLICA(?:Ç|C|G)(?:Õ|O)ES/i, /RESGATES/i, /RENDIMENTO BRUTO/i, /IMPOSTO DE RENDA/i, /\bI[O0]F\b/i, /RENDIMENTO L[IÍ]QUIDO/i, /SALDO ATUAL/i];

function summaryBalances(summary) {
  const {openingCents, applicationsCents, redemptionsCents, grossIncomeCents, irCents, iofCents, netIncomeCents, closingCents} = summary;
  return Math.abs(openingCents + applicationsCents - redemptionsCents + grossIncomeCents - irCents - iofCents - closingCents) <= 2
    && Math.abs(grossIncomeCents - irCents - iofCents - netIncomeCents) <= 2;
}

export function monthSummary(lines) {
  const start = lines.findIndex(line => /^Resumo do m[eêé]s/i.test(line));
  if (start < 0) return null;
  const block = [];
  for (let index = start; index < lines.length && block.length < 12; index += 1) {
    if (index > start && /^(Valor da Cota|Rentabilidade)/i.test(lines[index])) break;
    block.push(lines[index]);
  }
  const ordered = block.flatMap(line => line.match(/\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g) || []);
  if (ordered.length === SUMMARY_KEYS.length) {
    const summary = Object.fromEntries(SUMMARY_KEYS.map((key, index) => [key, money(ordered[index])]));
    if (summaryBalances(summary)) return {...summary, method: 'ORDERED_VALUES'};
  }
  const labelled = {};
  SUMMARY_LABELS.forEach((label, index) => {
    const line = block.find(value => label.test(value));
    const value = line?.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/)?.[1];
    if (value) labelled[SUMMARY_KEYS[index]] = money(value);
  });
  if (SUMMARY_KEYS.every(key => labelled[key] != null) && summaryBalances(labelled)) return {...labelled, method: 'LABELLED_VALUES'};
  return null;
}

function sourceLotDate(lines, index) {
  const next = lines[index + 1] || '';
  const match = next.match(/^Aplica(?:ç|c|g)[aã]o\s+(\d{2}\/\d{2}\/\d{4})/i);
  return match ? isoDate(match[1]) : null;
}

export const bancoDoBrasilAdapter = {
  id: 'bb',
  productFamilies: [PRODUCT_FAMILIES.QUOTA_FUND],
  canHandle({bankId, text = ''}) {
    return bankId === 'bb' || /BB RF CP Autom[aá]tico/i.test(text) || /Extratos\s*-?\s*Investimentos\s+Fundos\s*-?\s*Mensal/i.test(text);
  },
  parseNormalizedText({projectId, positionId, accountId, documentId, text}) {
    const events = [];
    const lines = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const quotaMap = quotaValuesByDate(lines);
    let currentBalance = null;
    const openingBalances = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      // Movimentação efetiva: a data vem antes de APLICAÇÃO.
      // Linhas indentadas do tipo "Aplicação DD/MM/AAAA ..." são apenas
      // referências do lote/custo ligadas ao resgate e NÃO representam novo aporte.
      let match = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+APLICA(?:Ç|C|G)[AÃ]O\s+([\d.]+,\d{2})(?:\s+([\d.]+,\d+)\s+([\d.]+,\d+)(?:\s+([\d.]+,\d+))?)?/i);
      if (match) {
        const [, dateBr, valueBr, quotaQuantityBr, quotaValueBr, endingQuotaBr] = match;
        events.push(createEvent({
          id: `${documentId}-application-${events.length + 1}`,
          projectId,
          positionId,
          bankId: 'bb',
          accountId,
          type: EVENT_TYPES.APPLICATION,
          occurredAt: isoDate(dateBr),
          amountCents: money(valueBr),
          quotaQuantity: quotaQuantityBr ? decimal(quotaQuantityBr) : null,
          quotaValue: quotaValueBr ? decimal(quotaValueBr) : null,
          evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
          sourceDocumentId: documentId,
          notes: 'Aplicação efetiva identificada na movimentação mensal do fundo.',
          metadata: {
            remainingQuotaQuantity: endingQuotaBr ? decimal(endingQuotaBr) : null,
            productModel: 'QUOTA_FUND'
          }
        }));
        continue;
      }

      // O saldo anterior é referência de reconciliação, não movimentação financeira.
      // Mantê-lo como snapshot permite auditoria do encadeamento entre meses sem
      // afetar o total de aplicações/resgates.
      match = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+SALDO ANTERIOR\s+([\d.]+,\d{2})(?:\s+([\d.]+,\d+)(?:\s+([\d.]+,\d+))?)?/i);
      if (match) {
        const [, dateBr, balanceBr, quotaQuantityBr, endingQuotaBr] = match;
        openingBalances.push({
          occurredAt: isoDate(dateBr),
          amountCents: money(balanceBr),
          quotaQuantity: endingQuotaBr ? decimal(endingQuotaBr) : quotaQuantityBr ? decimal(quotaQuantityBr) : null
        });
        continue;
      }

      match = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+RESGATE\s+(.+)$/i);
      if (match) {
        const [, dateBr, redemptionTail] = match;
        const values = redemptionTail.match(/[\d.]+,\d+/g) || [];
        if (values.length >= 2) {
          const [netBr, irBr, ...detailValues] = values;
          // Layout BB: Valor | IR | [IOF] | Quantidade cotas | Valor cota | Saldo cotas.
          // Quando não há IOF, a coluna vem vazia e restam 3 valores após IR.
          // Quando há IOF, existem 4 valores após IR. Esta distinção evita
          // confundir IOF com quantidade de cotas.
          const hasIofColumn = detailValues.length >= 4;
          const iofBr = hasIofColumn ? detailValues[0] : null;
          const quotaQuantityBr = hasIofColumn ? detailValues[1] : detailValues[0] || null;
          const quotaValueBr = hasIofColumn ? detailValues[2] : detailValues[1] || null;
          const remainingQuotaBr = hasIofColumn ? detailValues[3] : detailValues[2] || null;
          const occurredAt = isoDate(dateBr);
          const netAmountCents = money(netBr);
          const irAmountCents = money(irBr);
          const iofAmountCents = iofBr ? money(iofBr) : 0;
          const metadata = {
            sourceLotDate: sourceLotDate(lines, index),
            remainingQuotaQuantity: remainingQuotaBr ? decimal(remainingQuotaBr) : null,
            productModel: 'QUOTA_FUND'
          };
          events.push(createEvent({
            id: `${documentId}-redemption-${events.length + 1}`,
            projectId,
            positionId,
            bankId: 'bb',
            accountId,
            type: EVENT_TYPES.REDEMPTION,
            occurredAt,
            amountCents: netAmountCents,
            netAmountCents,
            grossAmountCents: netAmountCents + irAmountCents + iofAmountCents,
            quotaQuantity: quotaQuantityBr ? decimal(quotaQuantityBr) : null,
            quotaValue: quotaValueBr ? decimal(quotaValueBr) : null,
            evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
            sourceDocumentId: documentId,
            notes: 'Resgate líquido; o rendimento fiscal realizado permanece pendente quando o custo histórico do lote não estiver documentado.',
            metadata
          }));
          events.push(createEvent({
            id: `${documentId}-redemption-ir-${events.length + 1}`,
            projectId,
            positionId,
            bankId: 'bb',
            accountId,
            type: EVENT_TYPES.REDEMPTION_IRRF,
            occurredAt,
            amountCents: irAmountCents,
            quotaQuantity: quotaQuantityBr ? decimal(quotaQuantityBr) : null,
            quotaValue: quotaValueBr ? decimal(quotaValueBr) : null,
            evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
            sourceDocumentId: documentId,
            metadata
          }));
          if (iofAmountCents > 0) {
            events.push(createEvent({
              id: `${documentId}-redemption-iof-${events.length + 1}`,
              projectId,
              positionId,
              bankId: 'bb',
              accountId,
              type: EVENT_TYPES.IOF,
              occurredAt,
              amountCents: iofAmountCents,
              quotaQuantity: quotaQuantityBr ? decimal(quotaQuantityBr) : null,
              quotaValue: quotaValueBr ? decimal(quotaValueBr) : null,
              evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
              sourceDocumentId: documentId,
              notes: 'IOF associado ao resgate, extraído da coluna específica do extrato BB.',
              metadata
            }));
          }
          continue;
        }
      }

      match = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+COBRAN(?:Ç|C|G)A DE IR\s+([\d.]+,\d{2})(?:\s+([\d.]+,\d+)\s+([\d.]+,\d+)(?:\s+([\d.]+,\d+))?)?/i);
      if (match) {
        const [, dateBr, valueBr, quotaQuantityBr, quotaValueBr, remainingQuotaBr] = match;
        const occurredAt = isoDate(dateBr);
        events.push(createEvent({
          id: `${documentId}-periodic-ir-${events.length + 1}`,
          projectId,
          positionId,
          bankId: 'bb',
          accountId,
          type: EVENT_TYPES.PERIODIC_IR,
          occurredAt,
          amountCents: money(valueBr),
          quotaQuantity: quotaQuantityBr ? decimal(quotaQuantityBr) : null,
          quotaValue: quotaValueBr ? decimal(quotaValueBr) : null,
          evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
          sourceDocumentId: documentId,
          notes: 'Cobrança periódica de IR sem resgate financeiro.',
          metadata: {
            sourceLotDate: sourceLotDate(lines, index),
            remainingQuotaQuantity: remainingQuotaBr ? decimal(remainingQuotaBr) : null,
            productModel: 'QUOTA_FUND'
          }
        }));
        continue;
      }

      match = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+SALDO ATUAL\s+([\d.]+,\d{2})(?:\s+([\d.]+,\d+)(?:\s+([\d.]+,\d+))?)?/i);
      if (match) {
        const [, dateBr, balanceBr, quotaQuantityBr, endingQuotaBr] = match;
        currentBalance = {
          occurredAt: isoDate(dateBr),
          amountCents: money(balanceBr),
          quotaQuantity: endingQuotaBr ? decimal(endingQuotaBr) : quotaQuantityBr ? decimal(quotaQuantityBr) : null
        };
      }
    }

    const reference = text.match(/M[eêé]s\/ano refer[eêé]ncia\s+([A-ZÇÃÕÉÍÓÚ]+)\/(\d{4})/i)
      || text.match(/\b(JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\/(\d{4})\b/i);
    const summary = monthSummary(lines);
    // Sem resumo conferido, mantém a leitura por rótulo (comportamento anterior).
    const periodIncome = summary ? [null, null] : text.match(/RENDIMENTO BRUTO \(\+\)\s+([\d.]+,\d{2})/i);
    if (reference && periodIncome) {
      const fallbackMonths = {JANEIRO:'01',FEVEREIRO:'02',MARCO:'03','MARÇO':'03',ABRIL:'04',MAIO:'05',JUNHO:'06',JULHO:'07',AGOSTO:'08',SETEMBRO:'09',OUTUBRO:'10',NOVEMBRO:'11',DEZEMBRO:'12'};
      const fallbackMonth = fallbackMonths[reference[1].toUpperCase()];
      const occurredAt = currentBalance?.occurredAt || `${reference[2]}-${fallbackMonth}-${new Date(Date.UTC(Number(reference[2]), Number(fallbackMonth), 0)).getUTCDate().toString().padStart(2, '0')}`;
      events.push(createEvent({
        id: `${documentId}-period-income`,
        projectId,
        positionId,
        bankId: 'bb',
        accountId,
        type: EVENT_TYPES.PERIOD_INCOME,
        occurredAt,
        amountCents: summary ? summary.grossIncomeCents : money(periodIncome[1]),
        evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
        sourceDocumentId: documentId,
        notes: 'Rendimento bruto mensal; não equivale automaticamente a rendimento fiscal realizado no resgate.',
        ...(summary ? {metadata: {monthSummary: summary}} : {})
      }));
    }

    if (currentBalance) {
      const quotaValue = quotaMap.get(currentBalance.occurredAt) ?? null;
      events.push(createEvent({
        id: `${documentId}-balance`,
        projectId,
        positionId,
        bankId: 'bb',
        accountId,
        type: EVENT_TYPES.BALANCE_SNAPSHOT,
        occurredAt: currentBalance.occurredAt,
        amountCents: currentBalance.amountCents,
        quotaQuantity: currentBalance.quotaQuantity,
        quotaValue,
        evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
        sourceDocumentId: documentId
      }));
      if (currentBalance.quotaQuantity != null) {
        events.push(createEvent({
          id: `${documentId}-quota-snapshot`,
          projectId,
          positionId,
          bankId: 'bb',
          accountId,
          type: EVENT_TYPES.QUOTA_SNAPSHOT,
          occurredAt: currentBalance.occurredAt,
          amountCents: 0,
          quotaQuantity: currentBalance.quotaQuantity,
          quotaValue,
          evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
          sourceDocumentId: documentId
        }));
      }
    }

    for (const openingBalance of openingBalances) {
      events.push(createEvent({
        id: `${documentId}-opening-balance-${openingBalance.occurredAt}`,
        projectId,
        positionId,
        bankId: 'bb',
        accountId,
        type: EVENT_TYPES.BALANCE_SNAPSHOT,
        occurredAt: openingBalance.occurredAt,
        amountCents: openingBalance.amountCents,
        quotaQuantity: openingBalance.quotaQuantity,
        evidenceStatus: EVIDENCE_STATUS.CONFIRMED,
        sourceDocumentId: documentId,
        notes: 'Saldo anterior informado pelo extrato mensal; referência de reconciliação.',
        metadata: {balanceRole: 'OPENING', productModel: 'QUOTA_FUND'}
      }));
    }

    return {events, warnings: events.length ? [] : ['Nenhum evento reconhecido no texto normalizado.']};
  }
};
