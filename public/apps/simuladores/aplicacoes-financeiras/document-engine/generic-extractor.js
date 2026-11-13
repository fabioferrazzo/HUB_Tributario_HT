import { createEvent, EVIDENCE_STATUS, EVENT_TYPES, POSITION_STATUS, PRODUCT_FAMILIES } from '../domain/model.js';
import { dateToIso, lineSnippets, moneyToCents, monthReferenceToDate, normalizeForSearch, stableId } from './text-utils.js';

const MONEY_RE = /(?:R\$\s*|BRL\s*)?\(?-?[\d.]+,\d{2}\)?/gi;
const DATE_RE = /(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/;
const PRODUCT_HEADING_RE = /\b(CDB|RDB|LCI|LCA|CRI|CRA|DEB[EÊ]NTURE|TESOURO|FUNDO|FIC|FI\s*RF|RENDA FIXA|APLICA(?:C|Ç)[AÃ]O AUTOM[AÁ]TICA|CONTA REMUNERADA)\b/i;
const EVENT_HEADING_RE = /^(?:\d{2}\/\d{2}\/\d{4}\s+)?(?:SALDO|APLICA(?:C|Ç)[AÃ]O|RESGATE|RENDIMENTO|IMPOSTO|IRRF|IOF|COBRAN(?:C|Ç)A)/i;
const DOCUMENT_TITLE_RE = /^(?:EXTRATO|INFORME|COMPROVANTE|POSI(?:C|Ç)[AÃ]O|RELAT[OÓ]RIO)\b/i;

function moneyTokens(text) {
  return [...String(text || '').matchAll(MONEY_RE)].map(match => ({raw: match[0], cents: moneyToCents(match[0]), index: match.index || 0}));
}

function productFamily(text) {
  const value = normalizeForSearch(text).toUpperCase();
  if (/QUANTIDADE DE? COTAS|VALOR DA COTA|SALDO COTAS|FUNDO DE INVESTIMENTO|FUNDO RF|FIC\b|FI RF/.test(value)) return PRODUCT_FAMILIES.QUOTA_FUND;
  if (/APLICACAO AUTOMATICA|AUTOMATICO|AUTOMATICA|CONTA REMUNERADA|SALDO REMUNERADO/.test(value)) return PRODUCT_FAMILIES.AUTOMATIC_CASH;
  return PRODUCT_FAMILIES.FIXED_INCOME_SECURITY;
}

function productName(text, bankName) {
  const lines = lineSnippets(text).map(item => item.text);
  const candidates = lines.filter(line =>
    PRODUCT_HEADING_RE.test(line) &&
    line.length >= 5 && line.length <= 150 &&
    !EVENT_HEADING_RE.test(normalizeForSearch(line)) &&
    !DOCUMENT_TITLE_RE.test(normalizeForSearch(line))
  );
  return candidates[0]?.replace(/^PRODUTO\s*[:\-]\s*/i, '').trim() || `Aplicação importada - ${bankName}`;
}

function accountInfo(text, projectId, bankId) {
  const agency = text.match(/Ag[eê]ncia\s*[:\-]?\s*([\dXx.-]+)/i)?.[1] || '';
  const account = text.match(/Conta(?:\s+corrente)?\s*[:\-]?\s*([\dXx.-]+)/i)?.[1] || '';
  if (!agency && !account) return {id: 'unknown', record: null};
  const id = `account-${projectId}-${bankId}-${stableId([agency, account])}`;
  return {id, record: {id, projectId, bankId, agency, accountNumber: account, name: `${bankId} ${agency}/${account}`.trim()}};
}

function explicitApplicationDate(text) {
  const patterns = [
    /DATA (?:DA )?APLICA(?:C|Ç)[AÃ]O\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /APLICA(?:C|Ç)[AÃ]O\s+(\d{2}\/\d{2}\/\d{4})/i,
    /APLICADO EM\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return dateToIso(match[1]);
  }
  return null;
}

function referenceDate(text) {
  const month = text.match(/M[EÊ]S\/ANO REFER[EÊ]NCIA\s+([A-ZÇÃÕÉÍÓÚ]+)\/(\d{4})/i);
  if (month) return monthReferenceToDate(month[1], month[2]);
  const period = text.match(/(?:PER[IÍ]ODO|DE)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})\s+(?:A|AT[EÉ])\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (period) return dateToIso(period[2]);
  const dates = [...text.matchAll(/\b(\d{2}\/\d{2}\/\d{4})\b/g)].map(match => dateToIso(match[1])).filter(Boolean).sort();
  return dates.at(-1) || new Date().toISOString().slice(0, 10);
}

function principalValue(text) {
  const patterns = [
    /VALOR (?:ORIGINAL )?(?:APLICADO|DA APLICA(?:C|Ç)[AÃ]O)\s*[:\-]?\s*(R?\$?\s*[\d.]+,\d{2})/i,
    /PRINCIPAL\s*[:\-]?\s*(R?\$?\s*[\d.]+,\d{2})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return moneyToCents(match[1]);
  }
  return null;
}

function eventDescriptor(line) {
  const value = normalizeForSearch(line).toUpperCase();
  if (/PREVISAO|ESTIMATIVA/.test(value) && /\b(IR|IOF)\b/.test(value)) return {type: EVENT_TYPES.TAX_FORECAST, label: 'Previsão tributária'};
  if (/COBRANCA DE IR|COME[- ]?COTAS/.test(value)) return {type: EVENT_TYPES.PERIODIC_IR, label: 'IR periódico'};
  if (/IMPOSTO DE RENDA RETIDO|\bIRRF\b|\bIR RETIDO\b/.test(value)) return {type: EVENT_TYPES.REDEMPTION_IRRF, label: 'IR no resgate'};
  if (/RENDIMENTO REALIZADO|RENDIMENTO TRIBUTAVEL|GANHO NO RESGATE/.test(value)) return {type: EVENT_TYPES.REALIZED_INCOME, label: 'Rendimento realizado'};
  if (/RENDIMENTO BRUTO|RENDIMENTO DO PERIODO|RENDIMENTO ATE|RENTABILIDADE EM REAIS/.test(value)) return {type: EVENT_TYPES.PERIOD_INCOME, label: 'Rendimento do período'};
  if (/SALDO ATUAL|SALDO FINAL|POSICAO ATUAL|SALDO BRUTO/.test(value)) return {type: EVENT_TYPES.BALANCE_SNAPSHOT, label: 'Saldo'};
  if (/\bRESGATE\b|\bRETIRADA\b/.test(value)) return {type: EVENT_TYPES.REDEMPTION, label: 'Resgate'};
  if (/\bAPLICACAO\b|\bINVESTIMENTO\b|\bAPORTE\b/.test(value)) return {type: EVENT_TYPES.APPLICATION, label: 'Aplicação'};
  if (/\bIOF\b/.test(value)) return {type: EVENT_TYPES.IOF, label: 'IOF'};
  return null;
}

function evidence(documentId, line, fieldPath, value, method, confidence = 0.72) {
  return {
    id: `evd-${documentId}-${stableId([fieldPath, line.text, String(line.line)])}`,
    projectId: null,
    documentId,
    pageNumber: line.pageNumber || 1,
    lineNumber: line.line,
    fieldPath,
    value,
    snippet: line.text,
    method,
    confidence,
    status: confidence >= 0.9 ? 'CONFIRMED' : 'REVIEW',
  };
}

function eventDate(line, fallback) {
  const match = line.match(DATE_RE);
  return dateToIso(match?.[1]) || fallback;
}

function primaryMoney(line) {
  const tokens = moneyTokens(line);
  return tokens.length ? tokens[0].cents : null;
}

function splitGenericProductSections(text) {
  const lines = lineSnippets(text);
  const anchors = [];
  for (let index = 0; index < lines.length; index += 1) {
    const value = normalizeForSearch(lines[index].text);
    if (value.length > 160 || EVENT_HEADING_RE.test(value) || DOCUMENT_TITLE_RE.test(value) || !PRODUCT_HEADING_RE.test(value)) continue;
    if (/CNPJ|VENCIMENTO|VALOR DA COTA|QUANTIDADE/.test(value.toUpperCase())) continue;
    if (anchors.at(-1)?.index === index - 1 && anchors.at(-1)?.text === value) continue;
    anchors.push({index, text:value});
  }
  if (anchors.length <= 1) return [{text, offset:0, index:0}];
  const header = lines.slice(0, anchors[0].index).map(item => item.text).join('\n');
  return anchors.map((anchor, index) => {
    const next = anchors[index + 1]?.index ?? lines.length;
    const section = lines.slice(anchor.index, next).map(item => item.text).join('\n');
    return {text:[header,section].filter(Boolean).join('\n'), offset:anchor.index, index};
  });
}

function parseGenericSection(context, section) {
  const {projectId, documentId, bank, classification, method = 'GENERIC_RULES'} = context;
  const text = section.text;
  const lines = lineSnippets(text).map(item => ({...item, line:item.line + section.offset}));
  const family = productFamily(text);
  const name = productName(text, bank.name);
  const explicitOpenedAt = explicitApplicationDate(text);
  const fallbackDate = referenceDate(text);
  const openedAt = explicitOpenedAt || fallbackDate;
  const principal = principalValue(text);
  const account = accountInfo(text, projectId, bank.id);
  const identityDate = explicitOpenedAt || 'OPEN_DATE_UNDOCUMENTED';
  const positionId = `position-${projectId}-${stableId([bank.id, account.id, name, identityDate, principal, section.index])}`;
  const position = {
    id: positionId,
    projectId,
    bankId: bank.id,
    accountId: account.id,
    name,
    externalReference: `${bank.id}|${account.id}|${name}|${identityDate}|${section.index}`,
    productFamily: family,
    openedAt,
    originalPrincipalCents: principal,
    status: POSITION_STATUS.REQUIRES_REVIEW,
    realizedIncomeStatus: EVIDENCE_STATUS.PENDING,
    metadata: {
      template: 'GENERIC_BANK_NEUTRAL',
      documentKind: classification.kind,
      openedAtDocumented: Boolean(explicitOpenedAt),
      principalDocumented: principal != null,
      genericIdentityDate: identityDate,
      sectionIndex: section.index,
    },
  };

  const events = [];
  const evidences = [];
  const issues = [];
  const seen = new Set();
  let lastRedemption = null;

  for (const line of lines) {
    const descriptor = eventDescriptor(line.text);
    if (!descriptor) continue;
    const date = eventDate(line.text, fallbackDate);
    const amount = primaryMoney(line.text);
    if (amount == null) continue;
    const key = `${descriptor.type}|${date}|${amount}|${line.line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const base = {
      id: `event-${documentId}-${section.index}-${line.line}-${descriptor.type.toLowerCase()}`,
      projectId,
      positionId,
      bankId: bank.id,
      accountId: account.id,
      type: descriptor.type,
      occurredAt: date,
      amountCents: Math.abs(amount),
      evidenceStatus: EVIDENCE_STATUS.RECONSTRUCTED,
      sourceDocumentId: documentId,
      notes: 'Extraído por regra bancária genérica; valide a natureza, data e valor antes da escrituração.',
      metadata: {generic: true, lineNumber: line.line, documentKind: classification.kind, sectionIndex:section.index},
    };

    if (descriptor.type === EVENT_TYPES.REDEMPTION) {
      const irMatch = line.text.match(/(?:IRRF|IR(?:\s+RETIDO)?)\s*[:\-]?\s*(R?\$?\s*[\d.]+,\d{2})/i);
      const ir = irMatch ? Math.abs(moneyToCents(irMatch[1])) : 0;
      const event = createEvent({...base, netAmountCents: Math.abs(amount), grossAmountCents: Math.abs(amount) + ir});
      events.push(event);
      lastRedemption = event;
      if (ir) events.push(createEvent({...base, id: `${base.id}-irrf`, type: EVENT_TYPES.REDEMPTION_IRRF, amountCents: ir, notes: 'IR associado ao resgate extraído da mesma linha por regra genérica.'}));
    } else if (descriptor.type === EVENT_TYPES.REDEMPTION_IRRF && lastRedemption?.occurredAt === date) {
      events.push(createEvent({...base, notes: 'IR possivelmente associado ao resgate da mesma data; requer validação.'}));
    } else {
      if (descriptor.type === EVENT_TYPES.PERIOD_INCOME) base.notes = 'Rendimento do período; não equivale automaticamente ao rendimento fiscal realizado.';
      if (descriptor.type === EVENT_TYPES.BALANCE_SNAPSHOT) base.notes = 'Posição financeira na data indicada ou no encerramento do período do documento.';
      events.push(createEvent(base));
    }
    const added = events.at(-1);
    evidences.push(evidence(documentId, line, `events.${added.id}.amountCents`, added.amountCents, method, 0.74));
  }

  if (!events.length) issues.push({id: `issue-${documentId}-generic-${section.index}`, projectId, documentId, positionId, severity: 'REVIEW', title: 'Documento sem eventos estruturados', details: 'O texto foi extraído, mas nenhum conjunto data/valor/rótulo foi reconhecido. Informe os campos manualmente ou adicione um template.', status: 'OPEN'});
  else issues.push({id: `issue-${documentId}-generic-review-${section.index}`, projectId, documentId, positionId, severity: 'REVIEW', title: 'Extração genérica requer validação', details: 'A instituição ou o layout não possui template dedicado. Confirme datas, valores, natureza do rendimento, IR e vínculo com a aplicação.', status: 'OPEN'});
  if (!explicitOpenedAt) issues.push({id: `issue-${documentId}-opening-date-${section.index}`, projectId, documentId, positionId, severity: 'REVIEW', title: 'Data inicial não documentada', details: 'A data exibida foi usada apenas como referência do documento; não representa necessariamente a data de aplicação.', status: 'OPEN'});
  if (principal == null) issues.push({id: `issue-${documentId}-principal-${section.index}`, projectId, documentId, positionId, severity: 'REVIEW', title: 'Valor original aplicado não documentado', details: 'O documento não apresentou principal ou valor inicial com segurança.', status: 'OPEN'});
  return {position, account:account.record, events, evidences, issues};
}

export function parseGenericInvestmentDocument(context) {
  const sections = splitGenericProductSections(context.text);
  const parsed = sections.map(section => parseGenericSection(context, section));
  const accounts = [...new Map(parsed.map(item=>item.account).filter(Boolean).map(item=>[item.id,item])).values()];
  return {
    positions: parsed.map(item=>item.position),
    accounts,
    events: parsed.flatMap(item=>item.events),
    evidences: parsed.flatMap(item=>item.evidences),
    issues: parsed.flatMap(item=>item.issues),
    reportedTotals: [],
    warnings: [`Adaptador genérico bancário aplicado em ${sections.length} seção(ões). Os campos permanecem revisáveis.`],
    templateId: 'GENERIC_BANK_NEUTRAL',
  };
}

function reportQuarter(text) {
  const period = text.match(/ANO[- ]CALEND[AÁ]RIO DE\s*(\d{4})\s*[-–]\s*(PRIMEIRO|SEGUNDO|TERCEIRO|QUARTO|1[ºO]?|2[ºO]?|3[ºO]?|4[ºO]?)\s*TRIMESTRE/i);
  if (!period) return null;
  const map = {PRIMEIRO:1, SEGUNDO:2, TERCEIRO:3, QUARTO:4, '1º':1, '1O':1, '1':1, '2º':2, '2O':2, '2':2, '3º':3, '3O':3, '3':3, '4º':4, '4O':4, '4':4};
  const number = map[normalizeForSearch(period[2]).toUpperCase()];
  return number ? `${period[1]}-Q${number}` : null;
}

// INFMONTH01 — informes sem "TRIMESTRE" no cabeçalho trazem uma tabela mensal (C6: JANEIRO…DEZEMBRO com
// rendimento bruto | IR retido | líquido; BB: "Janeiro..: x Janeiro..: y" + TOTAL). O trimestre sai dos meses.
const MONTHS = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const MONTH_ROW_RE = /^(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\b[.:\s]*(.*)$/;

function monthlySectionCategory(heading) {
  const value = normalizeForSearch(heading).toUpperCase();
  if (/AUTOMATIC|CONTA REMUNERADA/.test(value)) return 'AUTOMATIC_CASH';
  if (/DERIVATIVO|SWAP|NDF|OPC/.test(value)) return 'DERIVATIVES';
  if (/FUNDO/.test(value)) return 'QUOTA_FUND';
  return 'FIXED_INCOME';
}

export function monthlyIncomeRows(text) {
  const rows = [];
  let category = 'FIXED_INCOME';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = normalizeForSearch(raw.trim()).toUpperCase();
    if (/^\d+(?:\.\d+)*\s+[A-Z]/.test(line) && !MONTH_ROW_RE.test(line)) category = monthlySectionCategory(line);
    const match = line.match(MONTH_ROW_RE);
    if (!match) continue;
    const values = moneyTokens(match[2]).map(token => Math.abs(token.cents));
    if (values.length < 2) continue;
    // BB: "Janeiro..: 1,00 Janeiro..: 2,00" (rendimento | IR); C6: bruto | IR | líquido.
    rows.push({category, month: MONTHS.indexOf(match[1]) + 1, incomeCents: values[0], irrfCents: values[1], netCents: values.length >= 3 ? values[2] : null, snippet: raw.trim()});
  }
  return rows;
}

function reportYear(text) {
  const calendar = text.match(/ANO[- ]CALEND[AÁ]RIO(?: DE)?\s*(\d{4})/i)?.[1];
  if (calendar) return Number(calendar);
  const first = text.match(/\b\d{2}\/(\d{2})\/(\d{4})\b/);
  return first ? {emissionMonth: Number(first[1]), emissionYear: Number(first[2])} : null;
}

function quarterFromMonths(months, text) {
  const quarters = [...new Set(months.map(month => Math.ceil(month / 3)))];
  if (quarters.length !== 1) return null;
  const year = reportYear(text);
  if (!year) return null;
  const number = quarters[0];
  // Sem ano-calendário: ano da emissão, recuando um ano se o trimestre é posterior ao mês de emissão.
  const value = typeof year === 'number' ? year : (number * 3 - 2 > year.emissionMonth ? year.emissionYear - 1 : year.emissionYear);
  return `${value}-Q${number}`;
}

function monthlyReportTotals({projectId, documentId, text, rawText, bank, method}) {
  const rows = monthlyIncomeRows(rawText || text);
  if (rows.length < 3) return null;
  const monthsListed = new Set(rows.map(row => row.month));
  if (monthsListed.size < 12) return null; // tabela anual completa (C6); BB segue pelo TOTAL
  const year = reportYear(text);
  if (typeof year !== 'number') return null;
  const groups = new Map();
  for (const row of rows) {
    if (!row.incomeCents && !row.irrfCents) continue;
    const quarter = `${year}-Q${Math.ceil(row.month / 3)}`;
    const key = `${row.category}|${quarter}`;
    const group = groups.get(key) || {category: row.category, quarter, incomeCents: 0, irrfCents: 0, snippets: []};
    group.incomeCents += row.incomeCents; group.irrfCents += row.irrfCents; group.snippets.push(row.snippet);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    id: `reported-${documentId}-${group.quarter}-${group.category}`,
    projectId, documentId, bankId: bank.id, category: group.category, quarter: group.quarter,
    incomeCents: group.incomeCents, irrfCents: group.irrfCents, pageNumber: 1, lineNumber: null,
    snippet: group.snippets.join(' | '), method, confidence: 0.92, source: 'MONTHLY_TABLE',
  }));
}

export function extractIncomeReportTotals({projectId, documentId, text, bank, method = 'REPORT_TOTALS', pages = []}) {
  const rawText = (pages || []).map(page => page?.rawText || '').join('\n').trim();
  if (!reportQuarter(text)) {
    const monthly = monthlyReportTotals({projectId, documentId, text, rawText, bank, method});
    if (monthly) return monthly;
  }
  const totals = [];
  const lines = lineSnippets(text);
  const monthRows = reportQuarter(text) ? [] : monthlyIncomeRows(rawText || text);
  const quarter = reportQuarter(text) || quarterFromMonths(monthRows.map(row => row.month), text);
  const used = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/\bTOTAL\b/i.test(normalizeForSearch(line.text))) continue;
    const window = lines.slice(index, Math.min(lines.length, index + 6));
    const values = moneyTokens(window.map(item => item.text).join(' '));
    if (values.length < 2) continue;
    const context = lines.slice(Math.max(0, index - 35), index + 1).map(item => item.text).join(' ');
    const category = /AUTOMATIC/i.test(normalizeForSearch(context)) ? 'AUTOMATIC_CASH' : 'FIXED_INCOME';
    const key = `${category}|${quarter}|${values[0].cents}|${values[1].cents}`;
    if (used.has(key)) continue;
    used.add(key);
    totals.push({
      id: `reported-${documentId}-${line.line}-${category}`,
      projectId,
      documentId,
      bankId: bank.id,
      category,
      quarter,
      incomeCents: Math.abs(values[0].cents),
      irrfCents: Math.abs(values[1].cents),
      pageNumber: 1,
      lineNumber: line.line,
      snippet: window.map(item => item.text).join(' | '),
      method,
      confidence: quarter ? 0.94 : 0.82,
    });
  }
  return totals;
}
