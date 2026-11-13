import { calculateDashboard, positionSummary } from '../domain/aggregates.js';
import { positionLifecycle } from '../domain/position-info.js';
import { EVENT_TYPES, quarterLabel } from '../domain/model.js';
import { OFFICIAL_TAX_SOURCES, buildFiscalQuarterlyView, normalizeTaxProfile, simulateFinancialTaxes } from '../domain/tax-profile.js';

const sum = values => values.reduce((total, value) => total + (value || 0), 0);
const isActiveEvent = event => event?.metadata?.reviewDisposition !== 'REJECTED' && event?.metadata?.excludedFromAnalysis !== true;

export function projectQuarters(events = []) {
  return [...new Set(events.filter(isActiveEvent).map(event => event.quarter).filter(Boolean))].sort();
}

function redemptionRows({events, positions, banks, documents, quarter}) {
  const active = events.filter(isActiveEvent);
  const positionMap = new Map(positions.map(item => [item.id, item]));
  const bankMap = new Map(banks.map(item => [item.id, item.name]));
  const documentMap = new Map(documents.map(item => [item.id, item.fileName]));
  const selected = active.filter(event => event.type === EVENT_TYPES.REDEMPTION && (!quarter || event.quarter === quarter));
  return selected.sort((a,b) => a.occurredAt.localeCompare(b.occurredAt)).map(redemption => {
    const related = active.filter(event => event.positionId === redemption.positionId && event.occurredAt === redemption.occurredAt);
    const realized = related.filter(event => event.type === EVENT_TYPES.REALIZED_INCOME);
    const principal = related.filter(event => event.type === EVENT_TYPES.PRINCIPAL_RECOVERY);
    const ir = related.filter(event => event.type === EVENT_TYPES.REDEMPTION_IRRF);
    const iof = related.filter(event => event.type === EVENT_TYPES.IOF);
    const position = positionMap.get(redemption.positionId);
    return {
      id: redemption.id,
      occurredAt: redemption.occurredAt,
      quarter: redemption.quarter,
      bankId: redemption.bankId,
      bankName: bankMap.get(redemption.bankId) || redemption.bankId,
      positionId: redemption.positionId,
      positionName: position?.name || redemption.positionId,
      netAmountCents: redemption.netAmountCents ?? redemption.amountCents,
      grossAmountCents: redemption.grossAmountCents ?? redemption.amountCents,
      irrfCents: sum(ir.map(event => event.amountCents)),
      iofCents: sum(iof.map(event => event.amountCents)),
      realizedIncomeCents: sum(realized.map(event => event.amountCents)),
      principalRecoveryCents: sum(principal.map(event => event.amountCents)),
      evidenceStatus: realized.length ? realized.reduce((status,event) => status === 'DIVERGENT' || event.evidenceStatus === 'DIVERGENT' ? 'DIVERGENT' : event.evidenceStatus, realized[0].evidenceStatus) : (position?.realizedIncomeStatus || 'PENDING'),
      sourceDocumentId: redemption.sourceDocumentId,
      sourceDocumentName: documentMap.get(redemption.sourceDocumentId) || '',
      notes: redemption.notes || '',
    };
  });
}

export function buildAnalysisSnapshot({
  project,
  banks = [],
  positions = [],
  events = [],
  documents = [],
  evidences = [],
  reportedTotals = [],
  issues = [],
  reviewDecisions = [],
  documentLinks = [],
  reconciliations = [],
  quarterClosures = [],
  bankTransactions = [],
  quarter = '',
}) {
  const active = events.filter(isActiveEvent);
  const selectedQuarter = quarter || null;
  const metrics = calculateDashboard({events:active, positions, quarter:selectedQuarter});
  const quarters = projectQuarters(active);
  const bankMap = new Map(banks.map(bank => [bank.id, bank.name]));
  const usedBankIds = [...new Set([...positions.map(item => item.bankId), ...active.map(item => item.bankId)].filter(Boolean))];
  const quarterly = [];
  const quarterlyPeriods = selectedQuarter ? [selectedQuarter] : quarters;
  for (const value of quarterlyPeriods) {
    for (const bankId of usedBankIds) {
      const bankPositions = positions.filter(item => item.bankId === bankId);
      if (!bankPositions.length && !active.some(event => event.bankId === bankId && event.quarter === value)) continue;
      const row = calculateDashboard({events:active, positions, quarter:value, bankId});
      if (![row.appliedCents,row.netRedeemedCents,row.realizedIncomeTotalCents,row.periodIncomeCents,row.effectiveIrCents,row.iofCents,row.endingBalanceCents].some(Boolean) && !row.positionCount) continue;
      quarterly.push({quarter:value, quarterLabel:quarterLabel(value), bankId, bankName:bankMap.get(bankId)||bankId, ...row});
    }
  }
  const positionRows = positions.map(position => {
    const summary = positionSummary(position, active, selectedQuarter);
    // POSINFO01: ciclo de vida completo (independe do filtro de trimestre)
    return {...position, ...summary, position:undefined, bankName:bankMap.get(position.bankId)||position.bankId, lifecycle:positionLifecycle(position, active)};
  });
  const profile = normalizeTaxProfile(project?.taxProfile || {});
  const taxSimulation = simulateFinancialTaxes({events:active, positions, banks, profile, quarter:selectedQuarter});
  const fiscalQuarterly = buildFiscalQuarterlyView({events:active, positions, banks, profile}).filter(item => !selectedQuarter || item.quarter === selectedQuarter);
  const fiscalMemory = taxSimulation.memory || [];
  const selectedEvents = active.filter(event => !selectedQuarter || event.quarter === selectedQuarter).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));
  const selectedIssues = issues.filter(issue => issue.status === 'OPEN');
  const selectedControls = reportedTotals.filter(item => !selectedQuarter || item.quarter === selectedQuarter);
  const selectedReviewDecisions = [...reviewDecisions].sort((a,b)=>String(a.decidedAt||a.createdAt||'').localeCompare(String(b.decidedAt||b.createdAt||'')));
  const selectedDocumentLinks = [...documentLinks].sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  const selectedReconciliations = reconciliations.filter(item => !selectedQuarter || item.quarter === selectedQuarter);
  const selectedClosures = quarterClosures.filter(item => !selectedQuarter || item.quarter === selectedQuarter).sort((a,b)=>String(a.quarter).localeCompare(String(b.quarter)) || Number(a.revision||0)-Number(b.revision||0));
  const selectedBankTransactions = bankTransactions.filter(item => !selectedQuarter || selectedReconciliations.some(rec => rec.bankTransactionId === item.id));
  return {
    generatedAt:new Date().toISOString(),
    project:{...project,taxProfile:profile},
    quarter:selectedQuarter,
    metrics,
    quarterly,
    positions:positionRows,
    redemptions:redemptionRows({events:active,positions,banks,documents,quarter:selectedQuarter}),
    events:selectedEvents,
    documents,
    evidences,
    reportedTotals:selectedControls,
    issues:selectedIssues,
    reviewDecisions:selectedReviewDecisions,
    documentLinks:selectedDocumentLinks,
    reconciliations:selectedReconciliations,
    quarterClosures:selectedClosures,
    bankTransactions:selectedBankTransactions,
    taxSimulation,
    fiscalQuarterly,
    fiscalMemory,
    taxSources: OFFICIAL_TAX_SOURCES,
  };
}
