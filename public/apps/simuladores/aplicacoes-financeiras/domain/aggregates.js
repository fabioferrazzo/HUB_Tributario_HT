import { EVENT_TYPES, EVIDENCE_STATUS, REALIZED_EVIDENCE, REVIEWABLE_EVIDENCE, quarterEnd } from './model.js';

const sum = values => values.reduce((acc, value) => acc + (value || 0), 0);
const acceptedEvent = event => event?.metadata?.reviewDisposition !== 'REJECTED' && event?.metadata?.excludedFromAnalysis !== true;

export function eventsForQuarter(events, quarter, filters = {}) {
  return events.filter(event => {
    if (!acceptedEvent(event)) return false;
    if (quarter && event.quarter !== quarter) return false;
    if (filters.bankId && event.bankId !== filters.bankId) return false;
    if (filters.positionIds && !filters.positionIds.includes(event.positionId)) return false;
    return true;
  });
}

export function latestBalanceByPosition(events, quarter = null, positionIds = null) {
  const endDate = quarter ? quarterEnd(quarter) : '9999-12-31';
  const snapshots = events.filter(event => acceptedEvent(event) && event.type === EVENT_TYPES.BALANCE_SNAPSHOT && event.occurredAt <= endDate && (!positionIds || positionIds.includes(event.positionId)));
  const latest = new Map();
  for (const snapshot of snapshots) {
    const prior = latest.get(snapshot.positionId);
    if (!prior || snapshot.occurredAt > prior.occurredAt) latest.set(snapshot.positionId, snapshot);
  }
  return latest;
}

export function calculateDashboard({events, positions, quarter = null, bankId = null}) {
  const selectedPositions = positions.filter(p => !bankId || p.bankId === bankId);
  const positionIds = selectedPositions.map(p => p.id);
  const filtered = eventsForQuarter(events, quarter, {bankId, positionIds});
  const balanceMap = latestBalanceByPosition(events.filter(e => !bankId || e.bankId === bankId), quarter, positionIds);

  const appliedCents = sum(filtered.filter(e => e.type === EVENT_TYPES.APPLICATION).map(e => e.amountCents));
  const netRedeemedCents = sum(filtered.filter(e => e.type === EVENT_TYPES.REDEMPTION).map(e => e.netAmountCents ?? e.amountCents));
  const grossRedeemedCents = sum(filtered.filter(e => e.type === EVENT_TYPES.REDEMPTION).map(e => e.grossAmountCents ?? e.amountCents));
  const redemptionIrrfCents = sum(filtered.filter(e => e.type === EVENT_TYPES.REDEMPTION_IRRF).map(e => e.amountCents));
  const periodicIrCents = sum(filtered.filter(e => e.type === EVENT_TYPES.PERIODIC_IR).map(e => e.amountCents));
  const iofCents = sum(filtered.filter(e => e.type === EVENT_TYPES.IOF).map(e => e.amountCents));
  const realizedIncomeConfirmedCents = sum(filtered.filter(e => e.type === EVENT_TYPES.REALIZED_INCOME && [EVIDENCE_STATUS.CONFIRMED, EVIDENCE_STATUS.RECONCILED].includes(e.evidenceStatus)).map(e => e.amountCents));
  const realizedIncomeReconstructedCents = sum(filtered.filter(e => e.type === EVENT_TYPES.REALIZED_INCOME && e.evidenceStatus === EVIDENCE_STATUS.RECONSTRUCTED).map(e => e.amountCents));
  const periodIncomeCents = sum(filtered.filter(e => e.type === EVENT_TYPES.PERIOD_INCOME).map(e => e.amountCents));
  const endingBalanceCents = sum([...balanceMap.values()].map(e => e.amountCents));
  const pendingCount = filtered.filter(e => REVIEWABLE_EVIDENCE.has(e.evidenceStatus)).length + selectedPositions.filter(p => p.realizedIncomeStatus === EVIDENCE_STATUS.PENDING).length;

  return {
    appliedCents,
    netRedeemedCents,
    grossRedeemedCents,
    redemptionIrrfCents,
    periodicIrCents,
    iofCents,
    effectiveIrCents: redemptionIrrfCents + periodicIrCents,
    realizedIncomeConfirmedCents,
    realizedIncomeReconstructedCents,
    realizedIncomeTotalCents: realizedIncomeConfirmedCents + realizedIncomeReconstructedCents,
    periodIncomeCents,
    endingBalanceCents,
    pendingCount,
    positionCount: selectedPositions.length,
    filteredEvents: filtered
  };
}

export function quarterlyTotals({events, positions, quarters, bankId = null}) {
  return quarters.map(quarter => ({quarter, ...calculateDashboard({events, positions, quarter, bankId})}));
}

export function positionSummary(position, events, quarter = null) {
  const selected = events.filter(e => acceptedEvent(e) && e.positionId === position.id && (!quarter || e.quarter === quarter));
  const balance = latestBalanceByPosition(events.filter(e => e.positionId === position.id), quarter).get(position.id)?.amountCents || 0;
  const realized = sum(selected.filter(e => e.type === EVENT_TYPES.REALIZED_INCOME && REALIZED_EVIDENCE.has(e.evidenceStatus)).map(e => e.amountCents));
  return {
    position,
    appliedCents: sum(selected.filter(e => e.type === EVENT_TYPES.APPLICATION).map(e => e.amountCents)),
    netRedeemedCents: sum(selected.filter(e => e.type === EVENT_TYPES.REDEMPTION).map(e => e.netAmountCents ?? e.amountCents)),
    realizedIncomeCents: realized,
    redemptionIrrfCents: sum(selected.filter(e => e.type === EVENT_TYPES.REDEMPTION_IRRF).map(e => e.amountCents)),
    periodicIrCents: sum(selected.filter(e => e.type === EVENT_TYPES.PERIODIC_IR).map(e => e.amountCents)),
    iofCents: sum(selected.filter(e => e.type === EVENT_TYPES.IOF).map(e => e.amountCents)),
    periodIncomeCents: sum(selected.filter(e => e.type === EVENT_TYPES.PERIOD_INCOME).map(e => e.amountCents)),
    endingBalanceCents: balance
  };
}
