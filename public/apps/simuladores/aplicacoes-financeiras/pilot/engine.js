import { normalizeForSearch } from '../document-engine/text-utils.js';

export const PILOT_VERSION = 1;
export const PILOT_SOURCE_TYPES = Object.freeze({
  REAL_ANONYMIZED: 'REAL_ANONYMIZED',
  REAL_PRIVATE_LOCAL: 'REAL_PRIVATE_LOCAL',
  CONTROL_EXISTING: 'CONTROL_EXISTING',
  SYNTHETIC: 'SYNTHETIC',
});

export const PILOT_LAYOUT_STATUS = Object.freeze({
  HOMOLOGATED_REAL: 'HOMOLOGATED_REAL',
  PARTIAL: 'PARTIAL',
  NOT_HOMOLOGATED: 'NOT_HOMOLOGATED',
  CONTROL_ONLY: 'CONTROL_ONLY',
});

export const PILOT_GATES = Object.freeze({
  minExternalInstitutions: 4,
  minDocumentsPerLayout: 3,
  bankPct: 100,
  classificationPct: 100,
  structurePct: 95,
  eventRecallPct: 97,
  eventPrecisionPct: 97,
  amountExactPct: 97,
  dateExactPct: 97,
  maxHumanCorrectionPct: 20,
  maxCriticalFalsePositives: 0,
});

const isRealSourceType = sourceType => [PILOT_SOURCE_TYPES.REAL_ANONYMIZED, PILOT_SOURCE_TYPES.REAL_PRIVATE_LOCAL].includes(sourceType);
const norm = value => normalizeForSearch(String(value || '')).toUpperCase();
const pct = (a, b) => b ? Math.round(a / b * 10000) / 100 : 100;
const eventAmount = event => Number(event.amountCents ?? event.netAmountCents ?? event.grossAmountCents ?? 0);
const eventKey = event => `${String(event.type || '')}|${String(event.date || event.postedAt || '').slice(0,10)}|${eventAmount(event)}`;
const eventTypeDateKey = event => `${String(event.type || '')}|${String(event.date || event.postedAt || '').slice(0,10)}`;
const eventTypeAmountKey = event => `${String(event.type || '')}|${eventAmount(event)}`;

function multiset(items, keyFn) {
  const map = new Map();
  for (const item of items || []) { const key = keyFn(item); map.set(key, (map.get(key) || 0) + 1); }
  return map;
}
function intersectCount(expected, actual, keyFn) {
  const a = multiset(expected, keyFn); const b = multiset(actual, keyFn); let n = 0;
  for (const [key,count] of a) n += Math.min(count, b.get(key) || 0);
  return n;
}
function diffItems(expected, actual, keyFn) {
  const pool = multiset(actual, keyFn); const missing=[];
  for (const item of expected || []) { const key=keyFn(item); const count=pool.get(key)||0; if(count){pool.set(key,count-1);} else missing.push(item); }
  const extra=[];
  const expectedPool=multiset(expected,keyFn);
  for(const item of actual||[]){const key=keyFn(item);const count=expectedPool.get(key)||0;if(count){expectedPool.set(key,count-1);}else extra.push(item);}
  return {missing,extra};
}

export function createGroundTruthCase({projectId, document, bankName, documentKind, positions=[], events=[], reportedTotals=[], bankTransactions=[], reviewDecisions=[], layoutLabel='', sourceType=PILOT_SOURCE_TYPES.REAL_ANONYMIZED, authorized=false, anonymized=false, parserVersion='', templateId=''}) {
  if (!projectId || !document?.id || !document?.hash) throw new Error('Projeto, documento e SHA-256 são obrigatórios para o caso piloto.');
  if (isRealSourceType(sourceType) && !authorized) throw new Error('Caso real exige confirma\u00e7\u00e3o de autoriza\u00e7\u00e3o.');
  if (sourceType === PILOT_SOURCE_TYPES.REAL_ANONYMIZED && !anonymized) throw new Error('Caso REAL_ANONYMIZED exige confirma\u00e7\u00e3o de anonimiza\u00e7\u00e3o.');
  const documentEvents=(events||[]).filter(event=>event.sourceDocumentId===document.id && event.reviewAction!=='REJECT');
  const positionIds=new Set(documentEvents.map(e=>e.positionId).filter(Boolean));
  const docPositions=(positions||[]).filter(position=>positionIds.has(position.id) || position.sourceDocumentId===document.id);
  const totals=(reportedTotals||[]).filter(total=>total.documentId===document.id || total.sourceDocumentId===document.id);
  const decisions=(reviewDecisions||[]).filter(decision=>decision.documentId===document.id);
  const corrections=decisions.filter(d=>['CORRECT','REJECT','KEEP_PENDING','APPROVE_FOR_TAX'].includes(d.action)).length;
  const groundTruth={
    bankName:String(bankName || document.bankName || ''),
    bankId:String(document.bankId || ''),
    documentKind:String(documentKind || document.kind || ''),
    positionCount:docPositions.length,
    families:[...docPositions.map(p=>p.productFamily).filter(Boolean)].sort(),
    events:documentEvents.map(event=>({type:event.type,date:String(event.occurredAt||event.date||'').slice(0,10),amountCents:eventAmount(event),positionId:event.positionId||null})),
    reportedTotals:totals.map(total=>({category:total.category||'',quarter:total.quarter||'',incomeCents:Number(total.incomeCents||0),irrfCents:Number(total.irrfCents||0)})),
    bankTransactions:(bankTransactions||[]).filter(tx=>tx.documentId===document.id).map(tx=>({postedAt:String(tx.postedAt||'').slice(0,10),direction:tx.direction||'',amountCents:Number(tx.amountCents||0)})),
  };
  return {
    id:`pilot-case-${document.hash.slice(0,16)}-${Date.now()}`,
    format:'HT_STAGE16_PILOT_CASE',version:PILOT_VERSION,projectId,documentId:document.id,documentHash:document.hash,
    layoutLabel:String(layoutLabel||document.kind||'Layout real revisado').slice(0,160),
    institutionName:groundTruth.bankName || 'Instituição não identificada',
    institutionKey:norm(groundTruth.bankName || document.bankId || 'UNKNOWN'),
    sourceType,authorized:Boolean(authorized),anonymized:Boolean(anonymized),
    createdAt:new Date().toISOString(),parserVersion:String(parserVersion||''),templateId:String(templateId||document.metadata?.lastTemplateId||''),
    reviewDecisionCount:decisions.length,manualCorrectionCount:corrections,groundTruth,
  };
}

export function evaluatePilotCase(pilotCase, actual, options={}) {
  const expected=pilotCase?.groundTruth||{};
  const actualEvents=(actual?.events||[]).map(event=>({type:event.type,date:String(event.occurredAt||event.date||'').slice(0,10),amountCents:eventAmount(event),positionId:event.positionId||null}));
  const expectedEvents=expected.events||[];
  const exactMatches=intersectCount(expectedEvents,actualEvents,eventKey);
  const typeDateMatches=intersectCount(expectedEvents,actualEvents,eventTypeDateKey);
  const typeAmountMatches=intersectCount(expectedEvents,actualEvents,eventTypeAmountKey);
  const diffs=diffItems(expectedEvents,actualEvents,eventKey);
  const bankOk = expected.bankId ? String(actual?.bank?.id||'')===String(expected.bankId) : norm(actual?.bank?.name).includes(norm(expected.bankName));
  const classOk = String(actual?.classification?.kind||'')===String(expected.documentKind||'');
  const actualFamilies=(actual?.positions||[]).map(p=>p.productFamily).filter(Boolean).sort();
  const expectedFamilies=[...(expected.families||[])].sort();
  const structureChecks=[Number(actual?.positions?.length||0)===Number(expected.positionCount||0),JSON.stringify(actualFamilies)===JSON.stringify(expectedFamilies)];
  const actualTotals=actual?.reportedTotals||[];
  const expectedTransactions=expected.bankTransactions||[]; const actualTransactions=(actual?.bankTransactions||[]).map(tx=>({postedAt:String(tx.postedAt||'').slice(0,10),direction:tx.direction||'',amountCents:Number(tx.amountCents||0)}));
  const transactionMatches=intersectCount(expectedTransactions,actualTransactions,tx=>`${tx.postedAt}|${tx.direction}|${tx.amountCents}`);
  const totalMatches=(expected.reportedTotals||[]).filter(total=>actualTotals.some(item=>item.category===total.category && item.quarter===total.quarter && Number(item.incomeCents||0)===Number(total.incomeCents||0) && Number(item.irrfCents||0)===Number(total.irrfCents||0))).length;
  const criticalExtra=diffs.extra.filter(item=>['REALIZED_INCOME','REDEMPTION','REDEMPTION_IRRF','PERIODIC_IR','APPLICATION','PRINCIPAL_RECOVERY'].includes(item.type));
  const metrics={
    bankPct:bankOk?100:0,classificationPct:classOk?100:0,structurePct:pct(structureChecks.filter(Boolean).length,structureChecks.length),
    eventRecallPct:pct(exactMatches,expectedEvents.length),eventPrecisionPct:pct(exactMatches,actualEvents.length),
    amountExactPct:pct(typeAmountMatches,expectedEvents.length),dateExactPct:pct(typeDateMatches,expectedEvents.length),
    reportedTotalsPct:pct(totalMatches,(expected.reportedTotals||[]).length),ofxExactPct:pct(transactionMatches,expectedTransactions.length),
    falseNegatives:diffs.missing.length,falsePositives:diffs.extra.length,criticalFalsePositives:criticalExtra.length,
    issueCount:Number(actual?.issues?.length||0),
  };
  const score=Math.round((metrics.bankPct*.12+metrics.classificationPct*.12+metrics.structurePct*.12+metrics.eventRecallPct*.18+metrics.eventPrecisionPct*.18+metrics.amountExactPct*.16+metrics.dateExactPct*.12)*100)/100;
  const pass = metrics.bankPct>=PILOT_GATES.bankPct && metrics.classificationPct>=PILOT_GATES.classificationPct && metrics.structurePct>=PILOT_GATES.structurePct && metrics.eventRecallPct>=PILOT_GATES.eventRecallPct && metrics.eventPrecisionPct>=PILOT_GATES.eventPrecisionPct && metrics.amountExactPct>=PILOT_GATES.amountExactPct && metrics.dateExactPct>=PILOT_GATES.dateExactPct && metrics.ofxExactPct>=100 && metrics.criticalFalsePositives<=PILOT_GATES.maxCriticalFalsePositives;
  return {caseId:pilotCase.id,documentId:pilotCase.documentId,documentHash:pilotCase.documentHash,institutionName:pilotCase.institutionName,institutionKey:pilotCase.institutionKey,layoutLabel:pilotCase.layoutLabel,sourceType:pilotCase.sourceType,parserVersion:options.parserVersion||pilotCase.parserVersion||'',templateId:actual?.templateId||pilotCase.templateId||'',evaluatedAt:new Date().toISOString(),score,pass,metrics,falseNegatives:diffs.missing,falsePositives:diffs.extra};
}

function layoutKey(result){return `${result.institutionKey||norm(result.institutionName)}::${norm(result.layoutLabel)}`;}
function average(values){return values.length?Math.round(values.reduce((a,b)=>a+Number(b||0),0)/values.length*100)/100:0;}

export function summarizePilot({cases=[],results=[],parserVersion='',controlInstitutionPatterns=[/BANCO INTER/i,/BANCO DO BRASIL/i]}) {
  const byLayout=new Map();
  for(const result of results){const key=layoutKey(result);const row=byLayout.get(key)||[];row.push(result);byLayout.set(key,row);}
  const layouts=[];
  for(const [key,rows] of byLayout){
    const sourceTypes=[...new Set(rows.map(r=>r.sourceType))];
    const real=sourceTypes.some(isRealSourceType);
    const institutionName=rows[0]?.institutionName||'';
    const external=!controlInstitutionPatterns.some(pattern=>pattern.test(institutionName));
    const caseRecords=cases.filter(c=>rows.some(r=>r.caseId===c.id));
    const manualCorrectionPct=pct(caseRecords.filter(c=>Number(c.manualCorrectionCount||0)>0).length,caseRecords.length);
    const metrics={bankPct:average(rows.map(r=>r.metrics.bankPct)),classificationPct:average(rows.map(r=>r.metrics.classificationPct)),structurePct:average(rows.map(r=>r.metrics.structurePct)),eventRecallPct:average(rows.map(r=>r.metrics.eventRecallPct)),eventPrecisionPct:average(rows.map(r=>r.metrics.eventPrecisionPct)),amountExactPct:average(rows.map(r=>r.metrics.amountExactPct)),dateExactPct:average(rows.map(r=>r.metrics.dateExactPct)),ofxExactPct:average(rows.map(r=>r.metrics.ofxExactPct)),humanCorrectionPct:manualCorrectionPct,falsePositives:rows.reduce((s,r)=>s+r.metrics.falsePositives,0),falseNegatives:rows.reduce((s,r)=>s+r.metrics.falseNegatives,0),criticalFalsePositives:rows.reduce((s,r)=>s+r.metrics.criticalFalsePositives,0)};
    const quantitative=rows.length>=PILOT_GATES.minDocumentsPerLayout && metrics.bankPct>=PILOT_GATES.bankPct && metrics.classificationPct>=PILOT_GATES.classificationPct && metrics.structurePct>=PILOT_GATES.structurePct && metrics.eventRecallPct>=PILOT_GATES.eventRecallPct && metrics.eventPrecisionPct>=PILOT_GATES.eventPrecisionPct && metrics.amountExactPct>=PILOT_GATES.amountExactPct && metrics.dateExactPct>=PILOT_GATES.dateExactPct && metrics.ofxExactPct>=100 && metrics.humanCorrectionPct<=PILOT_GATES.maxHumanCorrectionPct && metrics.criticalFalsePositives===0;
    let status=PILOT_LAYOUT_STATUS.NOT_HOMOLOGATED;
    if(!real)status=PILOT_LAYOUT_STATUS.CONTROL_ONLY; else if(quantitative)status=PILOT_LAYOUT_STATUS.HOMOLOGATED_REAL; else if(rows.some(r=>r.pass))status=PILOT_LAYOUT_STATUS.PARTIAL;
    layouts.push({key,institutionName,layoutLabel:rows[0]?.layoutLabel||'',external,sourceTypes,documentCount:rows.length,metrics,averageScore:average(rows.map(r=>r.score)),status,parserVersion:parserVersion||rows[0]?.parserVersion||'',templateIds:[...new Set(rows.map(r=>r.templateId).filter(Boolean))]});
  }
  const externalRealInstitutions=[...new Set(layouts.filter(l=>l.external&&l.sourceTypes.some(isRealSourceType)).map(l=>norm(l.institutionName)))];
  const realCases=cases.filter(c=>isRealSourceType(c.sourceType));
  const allRealAuthorized=realCases.every(c=>c.authorized && (c.sourceType!==PILOT_SOURCE_TYPES.REAL_ANONYMIZED || c.anonymized));
  const allExternalLayoutsHomologated=layouts.filter(l=>l.external&&l.sourceTypes.some(isRealSourceType)).every(l=>l.status===PILOT_LAYOUT_STATUS.HOMOLOGATED_REAL);
  const gates={
    enoughExternalInstitutions:externalRealInstitutions.length>=PILOT_GATES.minExternalInstitutions,
    allRealAuthorized,
    noCriticalFalsePositives:layouts.reduce((s,l)=>s+l.metrics.criticalFalsePositives,0)===0,
    allExternalLayoutsHomologated:externalRealInstitutions.length>0&&allExternalLayoutsHomologated,
    parserVersionPinned:Boolean(parserVersion),
  };
  const status=Object.values(gates).every(Boolean)?'PILOT_ACCEPTED_REAL':realCases.length?'PILOT_REAL_CORPUS_PARTIAL':'PILOT_INFRASTRUCTURE_READY';
  return {status,parserVersion,caseCount:cases.length,realCaseCount:realCases.length,externalInstitutionCount:externalRealInstitutions.length,layouts,gates,limitations:status==='PILOT_ACCEPTED_REAL'?[]:['A homologa\u00e7\u00e3o plena depende do cumprimento de todos os gates por layout. Documentos reais privados podem ser usados localmente quando autorizados; documentos REAL_ANONYMIZED tamb\u00e9m exigem confirma\u00e7\u00e3o de anonimiza\u00e7\u00e3o.']};
}

export function buildPilotDossier(summary, run={}) {
  return {format:'HT_STAGE16_PILOT_DOSSIER',version:PILOT_VERSION,generatedAt:new Date().toISOString(),status:summary.status,parserVersion:summary.parserVersion,caseCount:summary.caseCount,realCaseCount:summary.realCaseCount,externalInstitutionCount:summary.externalInstitutionCount,gates:summary.gates,layouts:summary.layouts.map(layout=>({institutionName:layout.institutionName,layoutLabel:layout.layoutLabel,documentCount:layout.documentCount,metrics:layout.metrics,averageScore:layout.averageScore,status:layout.status,parserVersion:layout.parserVersion,templateIds:layout.templateIds})),run:{id:run.id||null,createdAt:run.createdAt||null},privacy:'Nenhum PDF, OFX, texto integral, CNPJ, conta ou valor individual de cliente é incluído neste dossiê.'};
}
