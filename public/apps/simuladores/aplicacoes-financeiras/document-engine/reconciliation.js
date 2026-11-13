import { createEvent, EVENT_TYPES, EVIDENCE_STATUS, POSITION_STATUS } from '../domain/model.js';

const sum = values => values.reduce((total, value) => total + (value || 0), 0);
const evidenceRank = Object.freeze({CONFIRMED: 6, RECONCILED: 5, RECONSTRUCTED: 4, ESTIMATED: 3, PENDING: 2, DIVERGENT: 1});

function eventKey(event) {
  return [event.bankId, event.positionId, event.type, event.occurredAt, event.amountCents, event.netAmountCents ?? '', event.grossAmountCents ?? '', event.quotaQuantity ?? '', event.quotaValue ?? ''].join('|');
}
function positionKey(position) {
  const openedIdentity = position.metadata?.openedAtDocumented === false ? 'OPEN_DATE_UNDOCUMENTED' : position.openedAt;
  // Acentos ignorados: o OCR alterna "Automático"/"Automatico" entre meses do mesmo fundo.
  return [position.bankId, position.accountId || '', position.name, openedIdentity, position.originalPrincipalCents ?? ''].join('|').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
}

function id(prefix, parts) {
  let hash = 2166136261; const text = parts.join('|');
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function mergeDocumentAnalyses({projectId, analyses = []}) {
  const positionsByKey = new Map(); const positionIdMap = new Map();
  const accountsById = new Map(); const eventsByKey = new Map(); const issuesById = new Map();
  const reportedTotals = []; const evidences = []; const warnings = [];
  for (const analysis of analyses) {
    for (const account of analysis.accounts || []) accountsById.set(account.id, account);
    for (const position of analysis.positions || []) {
      const key = positionKey(position);
      const existing = positionsByKey.get(key);
      if (!existing) { positionsByKey.set(key, {...position}); positionIdMap.set(position.id, position.id); }
      else {
        positionIdMap.set(position.id, existing.id);
        if (existing.originalPrincipalCents == null && position.originalPrincipalCents != null) existing.originalPrincipalCents = position.originalPrincipalCents;
        existing.metadata = {...existing.metadata, ...position.metadata};
      }
    }
    for (const event of analysis.events || []) {
      const mapped = {...event, positionId: positionIdMap.get(event.positionId) || event.positionId};
      const key = eventKey(mapped); const existing = eventsByKey.get(key);
      if (!existing || (evidenceRank[mapped.evidenceStatus] || 0) > (evidenceRank[existing.evidenceStatus] || 0)) eventsByKey.set(key, mapped);
    }
    for (const issue of analysis.issues || []) issuesById.set(issue.id, {...issue, positionId: positionIdMap.get(issue.positionId) || issue.positionId});
    for (const total of analysis.reportedTotals || []) reportedTotals.push(total);
    evidences.push(...(analysis.evidences || [])); warnings.push(...(analysis.warnings || []));
  }
  return {projectId, positions:[...positionsByKey.values()], accounts:[...accountsById.values()], events:[...eventsByKey.values()], issues:[...issuesById.values()], reportedTotals, evidences, warnings:[...new Set(warnings)]};
}

function currentPrincipal(position, principalRecoveries) {
  if (position.originalPrincipalCents == null) return null;
  return Math.max(0, position.originalPrincipalCents - sum(principalRecoveries.filter(event => event.positionId === position.id).map(event => event.amountCents)));
}
function hasPositiveBalanceAfter(events, redemption) {
  return events.some(event => event.positionId === redemption.positionId && event.type === EVENT_TYPES.BALANCE_SNAPSHOT && event.occurredAt >= redemption.occurredAt && event.amountCents > 1 && event.sourceDocumentId !== redemption.sourceDocumentId);
}
function irrfForRedemption(events, redemption) {
  return sum(events.filter(event => event.positionId === redemption.positionId && event.type === EVENT_TYPES.REDEMPTION_IRRF && event.occurredAt === redemption.occurredAt).map(event => event.amountCents));
}
function controlKey(control) { return `${control.bankId}|${control.quarter || ''}|${control.category || ''}`; }

function createRealizationEvents({projectId, position, redemption, incomeCents, principalCents, control}) {
  const base = {projectId, positionId:position.id, bankId:position.bankId, accountId:position.accountId, occurredAt:redemption.occurredAt, evidenceStatus:EVIDENCE_STATUS.RECONCILED, sourceDocumentId:control.documentId, metadata:{controlId:control.id, reconciliation:'INCOME_REPORT'}};
  return [
    createEvent({id:id('event-realized',[control.id,redemption.id]), ...base, type:EVENT_TYPES.REALIZED_INCOME, amountCents:Math.max(0,incomeCents), notes:'Rendimento realizado conciliado com o informe fiscal e o resgate.'}),
    createEvent({id:id('event-principal',[control.id,redemption.id]), ...base, type:EVENT_TYPES.PRINCIPAL_RECOVERY, amountCents:Math.max(0,principalCents), notes:'Principal recuperado calculado pela diferença entre resgate bruto e rendimento realizado.'}),
  ];
}

/**
 * Concilia informes agregados com extratos detalhados.
 * Regras conservadoras: somente cria rendimento individual quando o total é fechado e há critério objetivo.
 */
export function reconcileReportedTotals({projectId, positions = [], events = [], reportedTotals = []}) {
  const issues=[]; const results=[]; const generated=[];
  const orderedControls=[...reportedTotals].sort((a,b)=>String(a.quarter||'').localeCompare(String(b.quarter||'')));
  for (const control of orderedControls) {
    const quarterEvents=events.concat(generated).filter(event=>event.bankId===control.bankId && (!control.quarter || event.quarter===control.quarter));
    const detailedIncome=sum(quarterEvents.filter(event=>event.type===EVENT_TYPES.REALIZED_INCOME).map(event=>event.amountCents));
    const detailedIrrf=sum(quarterEvents.filter(event=>[EVENT_TYPES.REDEMPTION_IRRF,EVENT_TYPES.PERIODIC_IR].includes(event.type)).map(event=>event.amountCents));
    const result={...control,detailedIncomeCents:detailedIncome,detailedIrrfCents:detailedIrrf,incomeDifferenceCents:control.incomeCents-detailedIncome,irrfDifferenceCents:control.irrfCents-detailedIrrf,status:'CONTROL_TOTAL'};

    // BBINF01: informe de fundo (QUOTA_FUND) também individualiza o rendimento realizado nos resgates do trimestre,
    // restrito às posições do mesmo CNPJ quando o informe o identifica.
    if (['FIXED_INCOME','QUOTA_FUND'].includes(control.category) && control.incomeCents > 0 && Math.abs(result.incomeDifferenceCents) > 1) {
      const sameFund=event=>!control.fundCnpj || positions.find(item=>item.id===event.positionId)?.metadata?.fundCnpj===control.fundCnpj;
      const redemptions=quarterEvents.filter(event=>event.type===EVENT_TYPES.REDEMPTION && sameFund(event)).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));
      const principalEvents=events.concat(generated).filter(event=>event.type===EVENT_TYPES.PRINCIPAL_RECOVERY && (!control.quarter || event.quarter < control.quarter));
      const allocations=[];
      if (redemptions.length === 1) allocations.push({redemption:redemptions[0], incomeCents:control.incomeCents});
      else if (redemptions.length > 1) {
        let allocated=0; const unresolved=[];
        for (const redemption of redemptions) {
          const position=positions.find(item=>item.id===redemption.positionId);
          const remaining=position ? currentPrincipal(position, principalEvents.concat(generated.filter(e=>e.type===EVENT_TYPES.PRINCIPAL_RECOVERY))) : null;
          const gross=redemption.grossAmountCents ?? redemption.amountCents;
          const positiveAfter=hasPositiveBalanceAfter(events, redemption);
          if (remaining != null && gross >= remaining && !positiveAfter) {
            const income=Math.max(0,gross-remaining); allocations.push({redemption,incomeCents:income}); allocated+=income;
          } else unresolved.push(redemption);
        }
        const residual=control.incomeCents-allocated;
        if (unresolved.length===1 && residual>=0) allocations.push({redemption:unresolved[0],incomeCents:residual});
        else if (unresolved.length>0 && residual>=0) {
          const irTotal=sum(unresolved.map(redemption=>irrfForRedemption(quarterEvents,redemption)));
          if (irTotal>0) {
            let used=0;
            unresolved.forEach((redemption,index)=>{const income=index===unresolved.length-1?residual-used:Math.round(residual*irrfForRedemption(quarterEvents,redemption)/irTotal);used+=income;allocations.push({redemption,incomeCents:income});});
          }
        }
      }
      const allocatedTotal=sum(allocations.map(item=>item.incomeCents));
      if (allocations.length && Math.abs(allocatedTotal-control.incomeCents)<=1) {
        for (const allocation of allocations) {
          const position=positions.find(item=>item.id===allocation.redemption.positionId); if(!position) continue;
          const gross=allocation.redemption.grossAmountCents ?? allocation.redemption.amountCents;
          generated.push(...createRealizationEvents({projectId,position,redemption:allocation.redemption,incomeCents:allocation.incomeCents,principalCents:gross-allocation.incomeCents,control}));
        }
        result.status='RECONCILED'; result.detailedIncomeCents=control.incomeCents; result.incomeDifferenceCents=0;
      } else {
        issues.push({id:`issue-${control.id}-income`,projectId,documentId:control.documentId,positionId:null,severity:'REVIEW',title:'Rendimento do informe requer conciliação',details:`O informe registra rendimento de ${(control.incomeCents/100).toFixed(2)}, mas a individualização entre os resgates não possui critério documental suficiente.`,status:'OPEN'});
      }
    } else if (control.incomeCents && Math.abs(result.incomeDifferenceCents)>1) {
      issues.push({id:`issue-${control.id}-income`,projectId,documentId:control.documentId,positionId:null,severity:'REVIEW',title:'Rendimento do informe requer conciliação',details:`O informe registra rendimento de ${(control.incomeCents/100).toFixed(2)}, ainda não individualizado integralmente.`,status:'OPEN'});
    }

    const updatedIrrf=sum(events.concat(generated).filter(event=>event.bankId===control.bankId && (!control.quarter||event.quarter===control.quarter) && [EVENT_TYPES.REDEMPTION_IRRF,EVENT_TYPES.PERIODIC_IR].includes(event.type)).map(event=>event.amountCents));
    result.detailedIrrfCents=updatedIrrf; result.irrfDifferenceCents=control.irrfCents-updatedIrrf;
    if(control.irrfCents&&Math.abs(result.irrfDifferenceCents)>1)issues.push({id:`issue-${control.id}-irrf`,projectId,documentId:control.documentId,positionId:null,severity:'REVIEW',title:'IRRF do informe requer conciliação',details:`O informe registra IRRF de ${(control.irrfCents/100).toFixed(2)}, enquanto os documentos detalhados somam ${(updatedIrrf/100).toFixed(2)}.`,status:'OPEN'});
    results.push(result);
  }
  return {results,issues,generatedEvents:generated};
}


export function createAutomaticCashFromReportedTotals({projectId, controls = [], positions = [], events = []}) {
  const createdPositions = [];
  const createdEvents = [];
  const existingEventIds = new Set(events.map(event => event.id));
  for (const control of controls.filter(item => item.category === 'AUTOMATIC_CASH' && item.quarter)) {
    let position = [...positions, ...createdPositions].find(item => item.bankId === control.bankId && item.productFamily === 'AUTOMATIC_CASH');
    if (!position) {
      position = {
        id: id('position-auto', [projectId, control.bankId]),
        projectId,
        bankId: control.bankId,
        accountId: 'unknown',
        name: 'Aplicações automáticas de renda fixa',
        externalReference: `automatic-${control.bankId}`,
        productFamily: 'AUTOMATIC_CASH',
        openedAt: control.quarter ? `${control.quarter.slice(0,4)}-${String((Number(control.quarter.slice(-1))-1)*3+1).padStart(2,'0')}-01` : '2000-01-01',
        originalPrincipalCents: null,
        status: POSITION_STATUS.ACTIVE,
        realizedIncomeStatus: EVIDENCE_STATUS.CONFIRMED,
        metadata: {source: 'INCOME_REPORT_TOTAL', openedAtDocumented: false},
      };
      createdPositions.push(position);
    }
    const date = (() => { const [year, q] = control.quarter.split('-Q').map(Number); return new Date(Date.UTC(year, q * 3, 0)).toISOString().slice(0, 10); })();
    if (control.incomeCents) {
      const eventId = id('event-auto-income', [control.id, position.id]);
      if (!existingEventIds.has(eventId)) createdEvents.push(createEvent({id:eventId, projectId, positionId:position.id, bankId:position.bankId, accountId:position.accountId, type:EVENT_TYPES.REALIZED_INCOME, occurredAt:date, amountCents:control.incomeCents, evidenceStatus:EVIDENCE_STATUS.CONFIRMED, sourceDocumentId:control.documentId, notes:'Rendimento de aplicação automática conforme informe fiscal trimestral.', metadata:{controlId:control.id}}));
    }
    if (control.irrfCents) {
      const eventId = id('event-auto-irrf', [control.id, position.id]);
      if (!existingEventIds.has(eventId)) createdEvents.push(createEvent({id:eventId, projectId, positionId:position.id, bankId:position.bankId, accountId:position.accountId, type:EVENT_TYPES.REDEMPTION_IRRF, occurredAt:date, amountCents:control.irrfCents, evidenceStatus:EVIDENCE_STATUS.CONFIRMED, sourceDocumentId:control.documentId, notes:'IRRF de aplicação automática conforme informe fiscal trimestral.', metadata:{controlId:control.id}}));
    }
  }
  return {positions: createdPositions, events: createdEvents};
}

export function finalizePositions({positions, events}) {
  return positions.map(position=>{
    const own=events.filter(event=>event.positionId===position.id);
    const applications=sum(own.filter(e=>e.type===EVENT_TYPES.APPLICATION).map(e=>e.amountCents));
    const recoveries=sum(own.filter(e=>e.type===EVENT_TYPES.PRINCIPAL_RECOVERY).map(e=>e.amountCents));
    const lastBalance=own.filter(e=>e.type===EVENT_TYPES.BALANCE_SNAPSHOT).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)).at(-1);
    const principal=position.originalPrincipalCents ?? (applications || null);
    const remaining=principal==null?null:Math.max(0,principal-recoveries);
    const status=remaining===0?POSITION_STATUS.CLOSED:recoveries>0?POSITION_STATUS.PARTIALLY_REDEEMED:position.status;
    const realized=own.filter(e=>e.type===EVENT_TYPES.REALIZED_INCOME);
    const realizedIncomeStatus=realized.some(e=>e.evidenceStatus===EVIDENCE_STATUS.DIVERGENT)?EVIDENCE_STATUS.DIVERGENT:realized.length?EVIDENCE_STATUS.RECONCILED:position.realizedIncomeStatus;
    return {...position,status,realizedIncomeStatus,metadata:{...position.metadata,principalRemainingCents:remaining,lastBalanceCents:lastBalance?.amountCents??null}};
  });
}
