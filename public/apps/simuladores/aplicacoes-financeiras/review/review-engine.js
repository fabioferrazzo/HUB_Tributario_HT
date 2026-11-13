import { calculateDashboard } from '../domain/aggregates.js';
import { EVIDENCE_STATUS, EVENT_TYPES, createEvent, validatePosition } from '../domain/model.js';

export const REVIEW_ACTIONS = Object.freeze({
  APPROVE: 'APPROVE',
  APPROVE_FOR_TAX: 'APPROVE_FOR_TAX',
  CORRECT: 'CORRECT',
  KEEP_PENDING: 'KEEP_PENDING',
  UPDATE: 'UPDATE',
  REJECT: 'REJECT',
  CREATE: 'CREATE',
  DELETE: 'DELETE',
  CLOSE_ISSUE: 'CLOSE_ISSUE',
  REOPEN_ISSUE: 'REOPEN_ISSUE',
  LINK_DOCUMENTS: 'LINK_DOCUMENTS',
  UNLINK_DOCUMENTS: 'UNLINK_DOCUMENTS',
});

export const REVIEW_ENTITY_TYPES = Object.freeze({
  EVENT: 'EVENT',
  POSITION: 'POSITION',
  EVIDENCE: 'EVIDENCE',
  REPORTED_TOTAL: 'REPORTED_TOTAL',
  ISSUE: 'ISSUE',
  DOCUMENT_LINK: 'DOCUMENT_LINK',
});

export function reviewReason(value) {
  const reason = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
  if (reason.length < 5) throw new TypeError('Informe uma justificativa com pelo menos cinco caracteres.');
  return reason;
}

export function isRejectedEvent(event) {
  return event?.metadata?.reviewDisposition === 'REJECTED' || event?.metadata?.excludedFromAnalysis === true;
}

export function activeEvents(events = []) {
  return events.filter(event => !isRejectedEvent(event) && event?.metadata?.excludedFromAnalysis !== true);
}

export function createReviewDecision(input) {
  if (!Object.values(REVIEW_ACTIONS).includes(input.action)) throw new TypeError('Ação de revisão inválida.');
  if (!Object.values(REVIEW_ENTITY_TYPES).includes(input.entityType)) throw new TypeError('Tipo de entidade revisada inválido.');
  const reason = reviewReason(input.reason);
  const occurredAt = input.occurredAt || new Date().toISOString();
  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    documentId: input.documentId || null,
    entityType: input.entityType,
    entityId: input.entityId,
    fieldPath: input.fieldPath || null,
    action: input.action,
    reason,
    before: input.before == null ? null : structuredClone(input.before),
    after: input.after == null ? null : structuredClone(input.after),
    affectsTaxSimulation: Boolean(input.affectsTaxSimulation),
    occurredAt,
    reviewer: input.reviewer || 'USUARIO_LOCAL',
    metadata: input.metadata && typeof input.metadata === 'object' ? structuredClone(input.metadata) : {},
  });
}

export function reviewedEvent(event, changes = {}, options = {}) {
  const metadata = {
    ...(event.metadata || {}),
    ...(changes.metadata || {}),
    reviewedAt: options.reviewedAt || new Date().toISOString(),
    reviewedBy: options.reviewer || 'USUARIO_LOCAL',
    reviewDisposition: changes.metadata?.reviewDisposition || event.metadata?.reviewDisposition || 'ACCEPTED',
  };
  if (options.approvedForTaxSimulation != null) metadata.approvedForTaxSimulation = Boolean(options.approvedForTaxSimulation);
  const evidenceStatus = changes.evidenceStatus || (event.evidenceStatus === EVIDENCE_STATUS.CONFIRMED ? EVIDENCE_STATUS.CONFIRMED : EVIDENCE_STATUS.RECONCILED);
  return createEvent({...event, ...changes, metadata, evidenceStatus});
}

export function rejectedEvent(event, options = {}) {
  return createEvent({
    ...event,
    evidenceStatus: EVIDENCE_STATUS.DIVERGENT,
    metadata: {
      ...(event.metadata || {}),
      reviewDisposition: 'REJECTED',
      reviewedAt: options.reviewedAt || new Date().toISOString(),
      reviewedBy: options.reviewer || 'USUARIO_LOCAL',
      approvedForTaxSimulation: false,
    },
  });
}

export function reviewedPosition(position, changes = {}, options = {}) {
  const value = {
    ...position,
    ...changes,
    metadata: {
      ...(position.metadata || {}),
      ...(changes.metadata || {}),
      reviewedAt: options.reviewedAt || new Date().toISOString(),
      reviewedBy: options.reviewer || 'USUARIO_LOCAL',
    },
  };
  validatePosition(value);
  return value;
}

function decisionTime(decision) {
  const value = Date.parse(decision.occurredAt || decision.decidedAt || '');
  return Number.isFinite(value) ? value : 0;
}

export function rebuildEventsBeforeReviews(currentEvents = [], decisions = []) {
  const map = new Map(currentEvents.map(event => [event.id, structuredClone(event)]));
  const relevant = decisions
    .filter(decision => (decision.entityType || decision.targetType) === REVIEW_ENTITY_TYPES.EVENT)
    .sort((a, b) => decisionTime(b) - decisionTime(a));
  for (const decision of relevant) {
    const id = decision.entityId || decision.after?.id || decision.before?.id;
    if (!id) continue;
    if (decision.action === REVIEW_ACTIONS.CREATE) {
      map.delete(id);
      continue;
    }
    if (decision.before) map.set(id, structuredClone(decision.before));
    else if (decision.action === REVIEW_ACTIONS.DELETE) map.delete(id);
  }
  return [...map.values()];
}

export function compareReviewMetrics({events = [], positions = [], decisions = [], quarter = null, bankId = null}) {
  const currentEvents = activeEvents(events);
  const baselineEvents = activeEvents(rebuildEventsBeforeReviews(events, decisions));
  return {
    before: calculateDashboard({events: baselineEvents, positions, quarter, bankId}),
    after: calculateDashboard({events: currentEvents, positions, quarter, bankId}),
  };
}

export function eventReviewFields(event) {
  return {
    type: event.type,
    occurredAt: event.occurredAt,
    amountCents: event.amountCents,
    netAmountCents: event.netAmountCents,
    grossAmountCents: event.grossAmountCents,
    evidenceStatus: event.evidenceStatus,
    approvedForTaxSimulation: Boolean(event.metadata?.approvedForTaxSimulation),
    reviewDisposition: event.metadata?.reviewDisposition || 'UNREVIEWED',
    notes: event.notes || '',
  };
}

export function metricImpactLabel(type) {
  return ({
    [EVENT_TYPES.APPLICATION]: 'Valores aplicados',
    [EVENT_TYPES.REDEMPTION]: 'Resgates',
    [EVENT_TYPES.REDEMPTION_IRRF]: 'IR no resgate',
    [EVENT_TYPES.PERIODIC_IR]: 'IR periódico',
    [EVENT_TYPES.REALIZED_INCOME]: 'Rendimento realizado',
    [EVENT_TYPES.PERIOD_INCOME]: 'Rendimento do período',
    [EVENT_TYPES.BALANCE_SNAPSHOT]: 'Saldo final',
  })[type] || 'Evento financeiro';
}
