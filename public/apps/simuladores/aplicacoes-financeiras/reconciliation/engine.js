import { calculateDashboard } from '../domain/aggregates.js';
import { EVENT_TYPES, EVIDENCE_STATUS, PRODUCT_FAMILIES, quarterEnd } from '../domain/model.js';
import { reconcileReportedTotals } from '../document-engine/reconciliation.js';

export const RECONCILIATION_STATUS = Object.freeze({
  AUTO_MATCHED: 'AUTO_MATCHED',
  REVIEW: 'REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  UNMATCHED: 'UNMATCHED',
  BLOCKING: 'BLOCKING',
});

export const CLOSURE_STATUS = Object.freeze({
  READY: 'READY',
  READY_WITH_PENDING: 'READY_WITH_PENDING',
  BLOCKED: 'BLOCKED',
  CLOSED: 'CLOSED',
});

const sum = values => values.reduce((total, value) => total + (Number(value) || 0), 0);
const activeEvent = event => event?.metadata?.reviewDisposition !== 'REJECTED' && event?.metadata?.excludedFromAnalysis !== true;
const dayMs = 24 * 60 * 60 * 1000;
const centsTolerance = 1;

function stableId(prefix, values) {
  const text = values.map(value => value ?? '').join('|');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
}

function dateDistanceDays(a, b) {
  const left = Date.parse(`${String(a).slice(0, 10)}T12:00:00Z`);
  const right = Date.parse(`${String(b).slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 9999;
  return Math.round(Math.abs(left - right) / dayMs);
}

function docGraph(links = []) {
  const graph = new Map();
  const connect = (a, b, relation) => {
    if (!a || !b) return;
    if (!graph.has(a)) graph.set(a, []);
    graph.get(a).push({documentId:b, relation});
  };
  for (const link of links) {
    if (link.status === 'REJECTED') continue;
    connect(link.sourceDocumentId, link.targetDocumentId, link.relation);
    connect(link.targetDocumentId, link.sourceDocumentId, link.relation);
  }
  return graph;
}

function documentsLinked(graph, a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return (graph.get(a) || []).some(edge => edge.documentId === b);
}

function relatedOnDate(events, redemption, type) {
  return events.filter(event => activeEvent(event) && event.positionId === redemption.positionId && event.occurredAt === redemption.occurredAt && event.type === type);
}

function amountForRedemption(redemption) {
  return redemption.netAmountCents ?? redemption.amountCents ?? 0;
}

function grossForRedemption(redemption, events) {
  if (redemption.grossAmountCents != null) return redemption.grossAmountCents;
  const irrf = sum(relatedOnDate(events, redemption, EVENT_TYPES.REDEMPTION_IRRF).map(item => item.amountCents));
  const iof = sum(relatedOnDate(events, redemption, EVENT_TYPES.IOF).map(item => item.amountCents));
  const fees = sum(relatedOnDate(events, redemption, EVENT_TYPES.MANUAL_ADJUSTMENT).filter(item => item.metadata?.kind === 'FEE').map(item => item.amountCents));
  return amountForRedemption(redemption) + irrf + iof + fees;
}

export function scoreRedemptionTransaction({redemption, transaction, documentLinks = [], account = null}) {
  const reasons = [];
  let score = 0;
  const graph = docGraph(documentLinks);
  const net = amountForRedemption(redemption);
  const txAmount = transaction.amountCents ?? Math.abs(transaction.signedAmountCents || 0);
  const amountDiff = Math.abs(net - txAmount);
  if (transaction.direction === 'CREDIT') { score += 10; reasons.push('crédito bancário'); }
  else reasons.push('direção não é crédito');

  if (amountDiff <= 1) { score += 35; reasons.push('valor líquido coincide'); }
  else if (amountDiff <= 100) { score += 20; reasons.push('valor difere até R$ 1,00'); }
  else if (amountDiff <= 1000) { score += 8; reasons.push('valor difere até R$ 10,00'); }
  else reasons.push('valor incompatível');

  const days = dateDistanceDays(redemption.occurredAt, transaction.postedAt);
  if (days === 0) { score += 25; reasons.push('mesma data'); }
  else if (days === 1) { score += 18; reasons.push('data a 1 dia'); }
  else if (days <= 3) { score += 8; reasons.push('data em até 3 dias'); }
  else reasons.push('data distante');

  const bankId = transaction.bankId || transaction.institutionId || '';
  if (bankId && redemption.bankId && normalizeText(bankId) === normalizeText(redemption.bankId)) { score += 10; reasons.push('instituição coincide'); }
  else if (transaction.documentBankId && redemption.bankId && normalizeText(transaction.documentBankId) === normalizeText(redemption.bankId)) { score += 10; reasons.push('instituição do documento coincide'); }

  const redemptionAccount = redemption.accountId || account?.id || '';
  const transactionAccount = transaction.accountId || '';
  if (redemptionAccount && transactionAccount && normalizeText(redemptionAccount) === normalizeText(transactionAccount)) { score += 8; reasons.push('conta coincide'); }
  else if (account && transaction.accountNumber && normalizeText(account.number) === normalizeText(transaction.accountNumber)) { score += 8; reasons.push('número da conta coincide'); }

  if (documentsLinked(graph, redemption.sourceDocumentId, transaction.documentId)) { score += 10; reasons.push('documentos vinculados'); }
  const history = normalizeText(transaction.history);
  if (/resgat|aplic|invest|cdb|fundo|renda fixa/.test(history)) { score += 2; reasons.push('histórico compatível'); }

  score = Math.max(0, Math.min(100, score));
  return {score, reasons, amountDifferenceCents:amountDiff, dateDifferenceDays:days};
}

export function buildMatchCandidates({events = [], bankTransactions = [], documentLinks = [], accounts = []}) {
  const active = events.filter(activeEvent);
  const redemptions = active.filter(event => event.type === EVENT_TYPES.REDEMPTION);
  const accountMap = new Map(accounts.map(account => [account.id, account]));
  const candidates = [];
  for (const redemption of redemptions) {
    const eligible = bankTransactions.filter(transaction => transaction.direction === 'CREDIT' && dateDistanceDays(redemption.occurredAt, transaction.postedAt) <= 5);
    for (const transaction of eligible) {
      const scored = scoreRedemptionTransaction({redemption, transaction, documentLinks, account:accountMap.get(redemption.accountId)});
      if (scored.score < 35) continue;
      candidates.push({
        id:stableId('candidate',[redemption.id,transaction.id]),
        projectId:redemption.projectId,
        quarter:redemption.quarter,
        bankId:redemption.bankId,
        positionId:redemption.positionId,
        redemptionEventId:redemption.id,
        transactionId:transaction.id,
        documentId:redemption.sourceDocumentId || null,
        transactionDocumentId:transaction.documentId || null,
        score:scored.score,
        reasons:scored.reasons,
        amountDifferenceCents:scored.amountDifferenceCents,
        dateDifferenceDays:scored.dateDifferenceDays,
        createdAt:new Date().toISOString(),
      });
    }
  }
  return candidates.sort((a,b)=>b.score-a.score || a.amountDifferenceCents-b.amountDifferenceCents || a.dateDifferenceDays-b.dateDifferenceDays);
}

export function selectBestCandidates(candidates = []) {
  const result = [];
  const usedRedemptions = new Set();
  const usedTransactions = new Set();
  for (const candidate of [...candidates].sort((a,b)=>b.score-a.score)) {
    if (usedRedemptions.has(candidate.redemptionEventId) || usedTransactions.has(candidate.transactionId)) continue;
    const competingForRedemption = candidates.filter(item => item.redemptionEventId === candidate.redemptionEventId && item.id !== candidate.id && item.score >= candidate.score - 5);
    const competingForTransaction = candidates.filter(item => item.transactionId === candidate.transactionId && item.id !== candidate.id && item.score >= candidate.score - 5);
    const ambiguous = competingForRedemption.length > 0 || competingForTransaction.length > 0;
    result.push({...candidate, ambiguous, selectionStatus:ambiguous ? RECONCILIATION_STATUS.REVIEW : candidate.score >= 80 ? RECONCILIATION_STATUS.AUTO_MATCHED : RECONCILIATION_STATUS.REVIEW});
    usedRedemptions.add(candidate.redemptionEventId);
    usedTransactions.add(candidate.transactionId);
  }
  return result;
}

export function detectEconomicDuplicates(events = [], documentLinks = []) {
  const graph = docGraph(documentLinks);
  const groups = new Map();
  for (const event of events.filter(activeEvent)) {
    if (![EVENT_TYPES.APPLICATION,EVENT_TYPES.REDEMPTION,EVENT_TYPES.REDEMPTION_IRRF,EVENT_TYPES.PERIODIC_IR,EVENT_TYPES.REALIZED_INCOME,EVENT_TYPES.PRINCIPAL_RECOVERY].includes(event.type)) continue;
    const key = [event.positionId,event.type,event.occurredAt,event.amountCents,event.netAmountCents ?? '',event.grossAmountCents ?? ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  const duplicates = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const sourceDocs = [...new Set(group.map(item => item.sourceDocumentId).filter(Boolean))];
    if (sourceDocs.length < 2) continue;
    const linked = sourceDocs.some((doc,index)=>sourceDocs.slice(index+1).some(other=>documentsLinked(graph,doc,other)));
    duplicates.push({id:stableId('duplicate',[key,...sourceDocs]),key,eventIds:group.map(item=>item.id),sourceDocumentIds:sourceDocs,linkedDocuments:linked,status:'DUPLICATE_CANDIDATE'});
  }
  return duplicates;
}

function buildOperationRecord({redemption,events,selectedCandidate,position,transaction}) {
  const net = amountForRedemption(redemption);
  const irrf = sum(relatedOnDate(events,redemption,EVENT_TYPES.REDEMPTION_IRRF).map(item=>item.amountCents));
  const iof = sum(relatedOnDate(events,redemption,EVENT_TYPES.IOF).map(item=>item.amountCents));
  const fees = sum(relatedOnDate(events,redemption,EVENT_TYPES.MANUAL_ADJUSTMENT).filter(item=>item.metadata?.kind==='FEE').map(item=>item.amountCents));
  const incomeEvents = relatedOnDate(events,redemption,EVENT_TYPES.REALIZED_INCOME);
  const principalEvents = relatedOnDate(events,redemption,EVENT_TYPES.PRINCIPAL_RECOVERY);
  const realizedIncome = sum(incomeEvents.map(item=>item.amountCents));
  const principal = sum(principalEvents.map(item=>item.amountCents));
  const gross = grossForRedemption(redemption,events);
  const equation1DifferenceCents = gross - (net + irrf + iof + fees);
  const equation2Available = incomeEvents.length > 0 && principalEvents.length > 0;
  const equation2DifferenceCents = equation2Available ? gross - (realizedIncome + principal) : null;
  const materialDivergence = Math.abs(equation1DifferenceCents) > centsTolerance || (equation2DifferenceCents != null && Math.abs(equation2DifferenceCents) > centsTolerance);
  const fundWithoutCost = position?.productFamily === PRODUCT_FAMILIES.QUOTA_FUND && !equation2Available;
  let status = materialDivergence ? RECONCILIATION_STATUS.BLOCKING : selectedCandidate?.selectionStatus || RECONCILIATION_STATUS.UNMATCHED;
  if (fundWithoutCost && status === RECONCILIATION_STATUS.AUTO_MATCHED) status = RECONCILIATION_STATUS.REVIEW;
  return {
    id:stableId('reconciliation',[redemption.projectId,redemption.id]),
    projectId:redemption.projectId,
    quarter:redemption.quarter,
    bankId:redemption.bankId,
    accountId:redemption.accountId,
    positionId:redemption.positionId,
    redemptionEventId:redemption.id,
    bankTransactionId:transaction?.id || null,
    score:selectedCandidate?.score || 0,
    status,
    ambiguous:Boolean(selectedCandidate?.ambiguous),
    sourceDocumentIds:[...new Set([redemption.sourceDocumentId,transaction?.documentId,...incomeEvents.map(item=>item.sourceDocumentId),...principalEvents.map(item=>item.sourceDocumentId)].filter(Boolean))],
    amounts:{netCents:net,irrfCents:irrf,iofCents:iof,feeCents:fees,grossCents:gross,realizedIncomeCents:realizedIncome,principalRecoveryCents:principal},
    equations:{grossFromCashDifferenceCents:equation1DifferenceCents,grossFromFiscalDifferenceCents:equation2DifferenceCents},
    costBasisStatus:equation2Available?'DETERMINED':fundWithoutCost?'PENDING_HISTORICAL_COST':'PENDING_ALLOCATION',
    reasons:selectedCandidate?.reasons || ['sem correspondência OFX'],
    createdAt:new Date().toISOString(),
  };
}

export function reconcileQuarterControls({events = [], reportedTotals = []}) {
  const active = events.filter(activeEvent);
  return reportedTotals.map(control => {
    const selected = active.filter(event => event.bankId === control.bankId && (!control.quarter || event.quarter === control.quarter));
    const income = sum(selected.filter(event=>event.type===EVENT_TYPES.REALIZED_INCOME).map(event=>event.amountCents));
    const irrf = sum(selected.filter(event=>[EVENT_TYPES.REDEMPTION_IRRF,EVENT_TYPES.PERIODIC_IR].includes(event.type)).map(event=>event.amountCents));
    const incomeDifferenceCents = Number(control.incomeCents || 0) - income;
    const irrfDifferenceCents = Number(control.irrfCents || 0) - irrf;
    return {
      id:stableId('quarter-control',[control.id,control.bankId,control.quarter,control.category]),
      projectId:control.projectId,
      reportedTotalId:control.id,
      documentId:control.documentId || null,
      bankId:control.bankId,
      quarter:control.quarter,
      category:control.category,
      reportedIncomeCents:Number(control.incomeCents || 0),
      detailedIncomeCents:income,
      incomeDifferenceCents,
      reportedIrrfCents:Number(control.irrfCents || 0),
      detailedIrrfCents:irrf,
      irrfDifferenceCents,
      status:Math.abs(incomeDifferenceCents)<=1&&Math.abs(irrfDifferenceCents)<=1?'RECONCILED':'DIVERGENT',
    };
  });
}

export function runAdvancedReconciliation({projectId,positions = [],events = [],reportedTotals = [],bankTransactions = [],documentLinks = [],accounts = []}) {
  const firstPass = reconcileReportedTotals({projectId,positions,events,reportedTotals});
  const combinedEvents = [...events,...firstPass.generatedEvents];
  const candidates = buildMatchCandidates({events:combinedEvents,bankTransactions,documentLinks,accounts});
  const selected = selectBestCandidates(candidates);
  const selectedByRedemption = new Map(selected.map(item=>[item.redemptionEventId,item]));
  const transactionMap = new Map(bankTransactions.map(item=>[item.id,item]));
  const positionMap = new Map(positions.map(item=>[item.id,item]));
  const redemptions = combinedEvents.filter(event=>activeEvent(event)&&event.type===EVENT_TYPES.REDEMPTION);
  const reconciliations = redemptions.map(redemption=>{
    const match=selectedByRedemption.get(redemption.id);
    return buildOperationRecord({redemption,events:combinedEvents,selectedCandidate:match,position:positionMap.get(redemption.positionId),transaction:match?transactionMap.get(match.transactionId):null});
  });
  const controlResults = reconcileQuarterControls({events:combinedEvents,reportedTotals:firstPass.results});
  const duplicateGroups = detectEconomicDuplicates(combinedEvents,documentLinks);
  const issues = [...firstPass.issues];
  for (const reconciliation of reconciliations) {
    if (reconciliation.status === RECONCILIATION_STATUS.BLOCKING) issues.push({id:`issue-${reconciliation.id}`,projectId,documentId:reconciliation.sourceDocumentIds[0]||null,positionId:reconciliation.positionId,severity:'BLOCKING',title:'Divergência material na equação do resgate',details:`O resgate de ${reconciliation.amounts.netCents/100} possui diferença de conciliação acima de R$ 0,01.`,status:'OPEN',metadata:{reconciliationId:reconciliation.id}});
  }
  for (const group of duplicateGroups) issues.push({id:`issue-${group.id}`,projectId,documentId:group.sourceDocumentIds[0]||null,positionId:null,severity:'REVIEW',title:'Possível duplicidade econômica entre documentos',details:`${group.eventIds.length} eventos equivalentes foram encontrados em fontes diferentes. Revise antes do fechamento.`,status:'OPEN',metadata:{duplicateGroupId:group.id}});
  return {generatedEvents:firstPass.generatedEvents,reportedTotals:firstPass.results,reconciliations,candidates,controlResults,duplicateGroups,issues};
}

export function quarterReconciliationSummary({quarter,reconciliations = [],controlResults = [],events = [],issues = []}) {
  const qReconciliations = reconciliations.filter(item=>item.quarter===quarter);
  const qControls = controlResults.filter(item=>item.quarter===quarter);
  const qEvents = events.filter(item=>activeEvent(item)&&item.quarter===quarter);
  const blocking = [
    ...qReconciliations.filter(item=>item.status===RECONCILIATION_STATUS.BLOCKING).map(item=>({kind:'RECONCILIATION',id:item.id,reason:'equação do resgate divergente'})),
    ...qControls.filter(item=>item.status==='DIVERGENT').map(item=>({kind:'CONTROL',id:item.id,reason:'total do informe divergente'})),
    ...issues.filter(item=>item.status==='OPEN'&&item.severity==='BLOCKING'&&(!item.quarter||item.quarter===quarter)).map(item=>({kind:'ISSUE',id:item.id,reason:item.title})),
    ...qEvents.filter(item=>item.evidenceStatus===EVIDENCE_STATUS.DIVERGENT).map(item=>({kind:'EVENT',id:item.id,reason:'evento divergente'})),
  ];
  const pending = [
    ...qReconciliations.filter(item=>[RECONCILIATION_STATUS.REVIEW,RECONCILIATION_STATUS.UNMATCHED].includes(item.status)).map(item=>item.id),
    ...qEvents.filter(item=>[EVIDENCE_STATUS.PENDING,EVIDENCE_STATUS.ESTIMATED].includes(item.evidenceStatus)).map(item=>item.id),
  ];
  return {
    quarter,
    operations:qReconciliations.length,
    autoMatched:qReconciliations.filter(item=>item.status===RECONCILIATION_STATUS.AUTO_MATCHED).length,
    review:qReconciliations.filter(item=>item.status===RECONCILIATION_STATUS.REVIEW).length,
    unmatched:qReconciliations.filter(item=>item.status===RECONCILIATION_STATUS.UNMATCHED).length,
    blockers:blocking,
    pending:[...new Set(pending)],
    status:blocking.length?CLOSURE_STATUS.BLOCKED:pending.length?CLOSURE_STATUS.READY_WITH_PENDING:CLOSURE_STATUS.READY,
  };
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableObject(value[key])]));
  return value;
}

async function sha256Text(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export async function quarterClosureIntegrityHash(payload) {
  return sha256Text(JSON.stringify(stableObject(payload)));
}

function comparableClosurePayload(payload = {}) {
  const {revision: _revision, ...rest} = payload || {};
  return stableObject(rest);
}

function sameClosureState(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(comparableClosurePayload(a)) === JSON.stringify(comparableClosurePayload(b));
}

export async function createQuarterClosure({project,quarter,positions = [],events = [],reconciliations = [],controlResults = [],issues = [],documents = [],existingClosures = [],closedBy = 'Usuário local'}) {
  if (!/^\d{4}-Q[1-4]$/.test(String(quarter||''))) throw new TypeError('Trimestre inválido para fechamento');
  const summary = quarterReconciliationSummary({quarter,reconciliations,controlResults,events,issues});
  if (summary.status === CLOSURE_STATUS.BLOCKED) return {created:false,status:CLOSURE_STATUS.BLOCKED,summary};
  const metrics = calculateDashboard({events,positions,quarter});
  const relevantEvents = events.filter(item=>activeEvent(item)&&item.quarter===quarter).map(item=>item.id).sort();
  const relevantReconciliations = reconciliations.filter(item=>item.quarter===quarter).map(item=>item.id).sort();
  const relevantControls = controlResults.filter(item=>item.quarter===quarter).map(item=>item.id).sort();
  const relevantDocuments = [...new Set(events.filter(item=>activeEvent(item)&&item.quarter===quarter).map(item=>item.sourceDocumentId).filter(Boolean))].sort();
  const quarterClosures = existingClosures.filter(item=>item.quarter===quarter).sort((a,b)=>Number(a.revision||0)-Number(b.revision||0));
  const revision = quarterClosures.length+1;
  const payload = {
    projectId:project.id,quarter,periodEnd:quarterEnd(quarter),revision,
    metrics:{appliedCents:metrics.appliedCents,netRedeemedCents:metrics.netRedeemedCents,grossRedeemedCents:metrics.grossRedeemedCents,realizedIncomeTotalCents:metrics.realizedIncomeTotalCents,periodIncomeCents:metrics.periodIncomeCents,redemptionIrrfCents:metrics.redemptionIrrfCents,periodicIrCents:metrics.periodicIrCents,effectiveIrCents:metrics.effectiveIrCents,iofCents:metrics.iofCents,endingBalanceCents:metrics.endingBalanceCents},
    eventIds:relevantEvents,reconciliationIds:relevantReconciliations,controlIds:relevantControls,documentIds:relevantDocuments,
    pendingIds:summary.pending,
  };
  const latest = quarterClosures.at(-1);
  if (latest && sameClosureState(latest.payload,payload)) {
    return {created:false,status:CLOSURE_STATUS.CLOSED,reason:'UNCHANGED',closure:latest,summary};
  }
  const integrityHash = await quarterClosureIntegrityHash(payload);
  const closedAt = new Date().toISOString();
  return {
    created:true,
    status:CLOSURE_STATUS.CLOSED,
    closure:{
      id:`closure-${project.id}-${quarter}-r${revision}`,
      projectId:project.id,quarter,revision,status:CLOSURE_STATUS.CLOSED,quality:summary.pending.length?'CLOSED_WITH_PENDING':'CLOSED_CLEAN',
      closedAt,closedBy,integrityHash,payload,summary,immutable:true,
    },
    summary,
  };
}

export async function verifyQuarterClosure(closure) {
  if (!closure?.immutable || !closure.payload || !closure.integrityHash) return false;
  return (await quarterClosureIntegrityHash(closure.payload)) === closure.integrityHash;
}
