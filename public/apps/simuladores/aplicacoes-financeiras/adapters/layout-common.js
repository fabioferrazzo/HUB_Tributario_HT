import { createEvent, EVIDENCE_STATUS, POSITION_STATUS, PRODUCT_FAMILIES, validatePosition } from '../domain/model.js';
import { dateToIso, moneyToCents, monthReferenceToDate, normalizeForSearch, stableId } from '../document-engine/text-utils.js';

export { createEvent, EVIDENCE_STATUS, POSITION_STATUS, PRODUCT_FAMILIES, dateToIso, moneyToCents, monthReferenceToDate, normalizeForSearch, stableId, validatePosition };

export function lineList(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
}

export function endOfMonth(year, month, capDate = null) {
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const natural = `${year}-${String(month).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
  if (!capDate || !/^\d{4}-\d{2}-\d{2}$/.test(capDate)) return natural;
  return capDate.slice(0,7) === `${year}-${String(month).padStart(2,'0')}` && capDate < natural ? capDate : natural;
}

export function inferYearFromPeriod(text, fallback = new Date().getUTCFullYear()) {
  const value = normalizeForSearch(text).toUpperCase();
  const period = value.match(/PERIODO[^\d]*(\d{2})\/(\d{2})\/(\d{4})[^\d]+(?:A|ATE)[^\d]+(\d{2})\/(\d{2})\/(\d{4})/);
  if (period) return Number(period[6]);
  const years = [...value.matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
  return years.length ? Math.max(...years) : Number(fallback);
}

export function ddmmToIso(value, year) {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})$/);
  return match ? `${year}-${match[2]}-${match[1]}` : dateToIso(value);
}

export function accountRecord({projectId, bankId, agency = '', account = '', label = ''}) {
  if (!agency && !account) return {id:'unknown', record:null};
  const id = `account-${projectId}-${bankId}-${stableId([agency, account])}`;
  return {id, record:{id, projectId, bankId, agency, accountNumber:account, name:label || `${bankId} ${agency}/${account}`.trim()}};
}

export function positionRecord({projectId, bankId, accountId='unknown', name, openedAt, principalCents=null, family=PRODUCT_FAMILIES.FIXED_INCOME_SECURITY, externalReference='', metadata={}}) {
  const id = `position-${projectId}-${stableId([bankId, accountId, name, openedAt, principalCents, externalReference])}`;
  const position = {
    id, projectId, bankId, accountId, name, externalReference:externalReference || `${bankId}|${name}|${openedAt}`,
    productFamily:family, openedAt, originalPrincipalCents:principalCents,
    status:POSITION_STATUS.REQUIRES_REVIEW, realizedIncomeStatus:EVIDENCE_STATUS.PENDING, metadata
  };
  validatePosition(position);
  return position;
}

export function eventBase({projectId, position, bankId, accountId, documentId, type, date, amountCents, suffix, evidenceStatus=EVIDENCE_STATUS.CONFIRMED, notes='', metadata={}, netAmountCents=null, grossAmountCents=null, quotaQuantity=null, quotaValue=null}) {
  return createEvent({
    id:`event-${documentId}-${suffix}`, projectId, positionId:position.id, bankId, accountId,
    type, occurredAt:date, amountCents:Math.abs(Number(amountCents || 0)), netAmountCents, grossAmountCents,
    quotaQuantity, quotaValue, evidenceStatus, sourceDocumentId:documentId, notes, metadata
  });
}

export function parseMoneyList(line) {
  return [...String(line || '').matchAll(/(?:R\$\s*)?([\d.]+,\d{2})/g)].map(match => moneyToCents(match[1]));
}

export function normalizedLine(line) { return normalizeForSearch(line).toUpperCase(); }
