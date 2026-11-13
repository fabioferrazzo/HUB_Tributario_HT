export const PRODUCT_FAMILIES = Object.freeze({
  FIXED_INCOME_SECURITY: 'FIXED_INCOME_SECURITY',
  QUOTA_FUND: 'QUOTA_FUND',
  AUTOMATIC_CASH: 'AUTOMATIC_CASH'
});

export const EVENT_TYPES = Object.freeze({
  APPLICATION: 'APPLICATION',
  REDEMPTION: 'REDEMPTION',
  REDEMPTION_IRRF: 'REDEMPTION_IRRF',
  PERIODIC_IR: 'PERIODIC_IR',
  IOF: 'IOF',
  REALIZED_INCOME: 'REALIZED_INCOME',
  PERIOD_INCOME: 'PERIOD_INCOME',
  UNREALIZED_INCOME: 'UNREALIZED_INCOME',
  PRINCIPAL_RECOVERY: 'PRINCIPAL_RECOVERY',
  BALANCE_SNAPSHOT: 'BALANCE_SNAPSHOT',
  QUOTA_SNAPSHOT: 'QUOTA_SNAPSHOT',
  TAX_FORECAST: 'TAX_FORECAST',
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT'
});

export const EVIDENCE_STATUS = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  RECONCILED: 'RECONCILED',
  RECONSTRUCTED: 'RECONSTRUCTED',
  ESTIMATED: 'ESTIMATED',
  PENDING: 'PENDING',
  DIVERGENT: 'DIVERGENT'
});

export const POSITION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PARTIALLY_REDEEMED: 'PARTIALLY_REDEEMED',
  CLOSED: 'CLOSED',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW'
});

export const REVIEWABLE_EVIDENCE = new Set([
  EVIDENCE_STATUS.RECONSTRUCTED,
  EVIDENCE_STATUS.ESTIMATED,
  EVIDENCE_STATUS.PENDING,
  EVIDENCE_STATUS.DIVERGENT
]);

export const REALIZED_EVIDENCE = new Set([
  EVIDENCE_STATUS.CONFIRMED,
  EVIDENCE_STATUS.RECONCILED,
  EVIDENCE_STATUS.RECONSTRUCTED
]);

export function assertIntegerCents(value, field = 'amountCents') {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${field} must be an integer number of cents`);
  return value;
}

function assertFiniteOptional(value, field) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${field} must be a finite number`);
  return value;
}

export function quarterOf(date) {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00Z`) : date;
  if (!(d instanceof Date) || Number.isNaN(d.valueOf())) throw new TypeError('Invalid date');
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${quarter}`;
}

export function quarterLabel(q) {
  const [year, n] = q.split('-Q');
  return `${n}T/${year}`;
}

export function quarterEnd(q) {
  const [yearText, qText] = q.split('-Q');
  const year = Number(yearText);
  const quarter = Number(qText);
  const month = quarter * 3;
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString().slice(0, 10);
}

export function createEvent(input) {
  if (!Object.values(EVENT_TYPES).includes(input.type)) throw new TypeError(`Unknown event type: ${input.type}`);
  if (!Object.values(EVIDENCE_STATUS).includes(input.evidenceStatus || EVIDENCE_STATUS.CONFIRMED)) throw new TypeError('Invalid evidence status');
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(input.occurredAt || ''))) throw new TypeError('occurredAt must use ISO date format');
  const computedQuarter = quarterOf(input.occurredAt);
  if (input.quarter && input.quarter !== computedQuarter) throw new TypeError('Event quarter does not match occurredAt');
  const amountCents = assertIntegerCents(input.amountCents ?? 0);
  const allowsNegative = [EVENT_TYPES.PERIOD_INCOME, EVENT_TYPES.UNREALIZED_INCOME, EVENT_TYPES.MANUAL_ADJUSTMENT].includes(input.type);
  if (!allowsNegative && amountCents < 0) throw new TypeError('Negative amount is not allowed for this event type');
  const netAmountCents = input.netAmountCents == null ? null : assertIntegerCents(input.netAmountCents, 'netAmountCents');
  const grossAmountCents = input.grossAmountCents == null ? null : assertIntegerCents(input.grossAmountCents, 'grossAmountCents');
  if ((netAmountCents ?? 0) < 0 || (grossAmountCents ?? 0) < 0) throw new TypeError('Net and gross amounts cannot be negative');
  if (netAmountCents != null && grossAmountCents != null && grossAmountCents < netAmountCents) throw new TypeError('Gross amount cannot be lower than net amount');
  const event = {
    id: input.id,
    projectId: input.projectId,
    positionId: input.positionId,
    bankId: input.bankId,
    accountId: input.accountId,
    type: input.type,
    occurredAt: input.occurredAt.slice(0, 10),
    quarter: computedQuarter,
    amountCents,
    netAmountCents,
    grossAmountCents,
    quotaQuantity: assertFiniteOptional(input.quotaQuantity, 'quotaQuantity'),
    quotaValue: assertFiniteOptional(input.quotaValue, 'quotaValue'),
    evidenceStatus: input.evidenceStatus || EVIDENCE_STATUS.CONFIRMED,
    sourceDocumentId: input.sourceDocumentId || null,
    notes: input.notes || '',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  };
  if (!event.id || !event.projectId || !event.positionId || !event.occurredAt) {
    throw new TypeError('Event id, projectId, positionId and occurredAt are required');
  }
  return Object.freeze(event);
}

export function validatePosition(position) {
  if (!position || typeof position !== 'object') throw new TypeError('Position is required');
  if (!position.id || !position.projectId || !position.bankId || !position.name || !position.openedAt) throw new TypeError('Position id, projectId, bankId, name and openedAt are required');
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(position.openedAt))) throw new TypeError('Position openedAt must use ISO date format');
  if (!Object.values(PRODUCT_FAMILIES).includes(position.productFamily)) throw new TypeError('Invalid product family');
  if (!Object.values(POSITION_STATUS).includes(position.status)) throw new TypeError('Invalid position status');
  if (position.realizedIncomeStatus && !Object.values(EVIDENCE_STATUS).includes(position.realizedIncomeStatus)) throw new TypeError('Invalid realized income status');
  if (position.originalPrincipalCents != null) {
    assertIntegerCents(position.originalPrincipalCents, 'originalPrincipalCents');
    if (position.originalPrincipalCents < 0) throw new TypeError('originalPrincipalCents cannot be negative');
  }
  return position;
}

