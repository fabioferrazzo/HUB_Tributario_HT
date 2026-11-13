import { createEvent, EVIDENCE_STATUS, EVENT_TYPES, PRODUCT_FAMILIES, validatePosition } from '../domain/model.js';

export const REVIEW_TARGET_TYPES = Object.freeze({
  DOCUMENT: 'DOCUMENT',
  POSITION: 'POSITION',
  EVENT: 'EVENT',
  REPORTED_TOTAL: 'REPORTED_TOTAL',
  EVIDENCE: 'EVIDENCE',
  ISSUE: 'ISSUE',
  DOCUMENT_LINK: 'DOCUMENT_LINK',
});
export const REVIEW_RECORD_TYPES = REVIEW_TARGET_TYPES;

export const REVIEW_ACTIONS = Object.freeze({
  APPROVE: 'APPROVE',
  APPROVE_FOR_TAX: 'APPROVE_FOR_TAX',
  CORRECT: 'CORRECT',
  REJECT: 'REJECT',
  KEEP_PENDING: 'KEEP_PENDING',
  CLOSE_ISSUE: 'CLOSE_ISSUE',
  REOPEN_ISSUE: 'REOPEN_ISSUE',
  LINK_DOCUMENTS: 'LINK_DOCUMENTS',
  UNLINK_DOCUMENTS: 'UNLINK_DOCUMENTS',
});

const clone = value => structuredClone(value);
const moneyFields = new Set(['originalPrincipalCents','amountCents','netAmountCents','grossAmountCents','incomeCents','irrfCents']);

function normalizedStatus(value) {
  if (['CONFIRMED','RECONCILED','APPROVED','CLOSED','RESOLVED'].includes(value)) return 'CONFIRMED';
  if (['DIVERGENT','REJECTED','BLOCKING'].includes(value)) return 'DIVERGENT';
  return 'PENDING';
}
function evidenceFor(evidences, predicate) {
  return evidences.filter(predicate).sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0))[0] || null;
}
function field(path,label,value,type='text') { return {path,label,value,type}; }
function item({targetType,targetId,documentId,label,category,fields,status,pageNumber=1,snippet='',confidence=null,evidenceIds=[],record}) {
  return {id:`review-${targetType.toLowerCase()}-${targetId}`,targetType,targetId,documentId,label,category,fields,status:normalizedStatus(status),pageNumber,snippet,confidence,evidenceIds,record:clone(record)};
}
function positionLinked(position, events, documentId) {
  return position.metadata?.sourceDocumentId === documentId || events.some(event => event.positionId === position.id && event.sourceDocumentId === documentId);
}
function friendlyEvidenceLabel(fieldPath='') {
  const path=String(fieldPath||'');
  const known={
    'event.amountCents':'Valor do evento',
    'event.netAmountCents':'Valor líquido do resgate',
    'position.name':'Identificação do produto',
    'document.bankName':'Instituição financeira',
    'document.kind':'Tipo do documento',
  };
  if(known[path])return known[path];
  if(/^events?[.\[]/i.test(path)||/event-doc-project-/i.test(path))return 'Evidência de evento extraído';
  if(/^positions?[.\[]/i.test(path))return 'Evidência de aplicação';
  if(/^reportedTotals?[.\[]/i.test(path))return 'Evidência de total informado';
  if(/^documents?[.\[]/i.test(path))return 'Evidência de identificação do documento';
  return path&&path.length<=80&&!/[0-9a-f]{8}-[0-9a-f-]{20,}/i.test(path)?path:'Evidência extraída';
}

export function buildDocumentReviewItems({document=null,documentId,positions=[],events=[],reportedTotals=[],evidences=[],issues=[]}) {
  const id=document?.id || documentId;
  if(!id)return [];
  const rows=[];
  if(document){
    const evidence=evidenceFor(evidences,value=>value.documentId===id&&!value.positionId&&!value.eventId);
    rows.push(item({targetType:REVIEW_TARGET_TYPES.DOCUMENT,targetId:id,documentId:id,label:'Identificação e classificação do documento',category:'Documento',fields:[field('bankName','Instituição financeira',document.bankName||document.bankId||'','text'),field('kind','Tipo do documento',document.kind||'','text')],status:document.metadata?.manuallyReviewed?'RECONCILED':document.bankId==='generic'?'PENDING':'CONFIRMED',pageNumber:evidence?.pageNumber||1,snippet:evidence?.snippet||document.metadata?.classificationEvidence||'',confidence:evidence?.confidence??document.metadata?.extractionQuality,evidenceIds:evidence?[evidence.id]:[],record:document}));
  }
  const linkedEvents=events.filter(value=>value.sourceDocumentId===id);
  for(const position of positions.filter(value=>positionLinked(value,events,id))){
    const evidence=evidenceFor(evidences,value=>value.documentId===id&&value.positionId===position.id&&!value.eventId);
    rows.push(item({targetType:REVIEW_TARGET_TYPES.POSITION,targetId:position.id,documentId:id,label:position.name||'Aplicação financeira',category:'Aplicação',fields:[field('name','Produto',position.name,'text'),field('openedAt','Data inicial',position.openedAt,'date'),field('originalPrincipalCents','Valor aplicado',position.originalPrincipalCents,'money'),field('productFamily','Família',position.productFamily,'productFamily'),field('status','Situação',position.status,'positionStatus'),field('realizedIncomeStatus','Qualidade do rendimento',position.realizedIncomeStatus,'evidenceStatus')],status:position.metadata?.excludedFromAnalysis?'DIVERGENT':position.realizedIncomeStatus,pageNumber:evidence?.pageNumber||position.metadata?.pageNumber||1,snippet:evidence?.snippet||position.metadata?.sourceSnippet||'',confidence:evidence?.confidence??position.metadata?.confidence,evidenceIds:evidence?[evidence.id]:[],record:position}));
  }
  for(const event of linkedEvents.sort((a,b)=>String(a.occurredAt).localeCompare(String(b.occurredAt)))){
    const related=evidences.filter(value=>value.documentId===id&&value.eventId===event.id);
    const best=related.sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0))[0];
    const fields=[field('occurredAt','Data',event.occurredAt,'date'),field('type','Natureza',event.type,'eventType'),field('amountCents','Valor',event.amountCents,'money')];
    if(event.type===EVENT_TYPES.REDEMPTION){fields.push(field('netAmountCents','Resgate líquido',event.netAmountCents,'money'));fields.push(field('grossAmountCents','Resgate bruto',event.grossAmountCents,'money'));}
    rows.push(item({targetType:REVIEW_TARGET_TYPES.EVENT,targetId:event.id,documentId:id,label:`${event.type} — ${event.occurredAt}`,category:'Evento',fields,status:event.metadata?.excludedFromAnalysis?'DIVERGENT':event.evidenceStatus,pageNumber:best?.pageNumber||event.metadata?.pageNumber||1,snippet:best?.snippet||event.metadata?.sourceSnippet||'',confidence:best?.confidence??event.metadata?.confidence,evidenceIds:related.map(value=>value.id),record:event}));
  }
  for(const total of reportedTotals.filter(value=>value.documentId===id)){
    rows.push(item({targetType:REVIEW_TARGET_TYPES.REPORTED_TOTAL,targetId:total.id,documentId:id,label:`Total informado — ${total.quarter||'período não identificado'}`,category:'Informe',fields:[field('quarter','Trimestre',total.quarter,'text'),field('category','Categoria',total.category,'text'),field('incomeCents','Rendimento informado',total.incomeCents,'money'),field('irrfCents','IRRF informado',total.irrfCents,'money')],status:total.reviewStatus||total.status||'PENDING',pageNumber:total.pageNumber||1,snippet:total.snippet||'',confidence:total.confidence,record:total}));
  }
  for(const evidence of evidences.filter(value=>value.documentId===id&&!value.eventId&&!value.positionId)){
    rows.push(item({targetType:REVIEW_TARGET_TYPES.EVIDENCE,targetId:evidence.id,documentId:id,label:friendlyEvidenceLabel(evidence.fieldPath),category:'Evidência',fields:[field('value','Valor',evidence.value,Number.isSafeInteger(evidence.value)?'money':'text')],status:evidence.status,pageNumber:evidence.pageNumber||1,snippet:evidence.snippet||'',confidence:evidence.confidence,evidenceIds:[evidence.id],record:evidence}));
  }
  for(const issue of issues.filter(value=>value.documentId===id&&['OPEN','REOPENED'].includes(value.status))){
    rows.push(item({targetType:REVIEW_TARGET_TYPES.ISSUE,targetId:issue.id,documentId:id,label:issue.title,category:'Pendência',fields:[field('status','Situação',issue.status,'text')],status:issue.severity==='BLOCKING'?'DIVERGENT':'PENDING',pageNumber:issue.pageNumber||1,snippet:issue.details||'',record:issue}));
  }
  const order={Documento:1,Aplicação:2,Evento:3,Informe:4,Evidência:5,Pendência:6};
  return rows.sort((a,b)=>(order[a.category]||99)-(order[b.category]||99)||Number(a.pageNumber||1)-Number(b.pageNumber||1)||a.label.localeCompare(b.label));
}

function cleanReason(value,required=false){const text=String(value||'').trim().replace(/\s+/g,' ').slice(0,1000);if(required&&text.length<5)throw new TypeError('Informe uma justificativa com pelo menos cinco caracteres.');return text;}
function applyChanges(record,changes={}){
  const result={...record};
  for(const [key,value] of Object.entries(changes||{})){
    if(key==='metadata')result.metadata={...(result.metadata||{}),...(value||{})};
    else result[key]=value;
  }
  return result;
}

export function applyReviewDecision({targetType,record,action,changes={},justification='',decisionId,reviewer='USUARIO_LOCAL'}){
  if(!Object.values(REVIEW_TARGET_TYPES).includes(targetType))throw new TypeError('Tipo de registro de revisão inválido.');
  if(!Object.values(REVIEW_ACTIONS).includes(action))throw new TypeError('Ação de revisão inválida.');
  const required=[REVIEW_ACTIONS.CORRECT,REVIEW_ACTIONS.REJECT,REVIEW_ACTIONS.KEEP_PENDING,REVIEW_ACTIONS.CLOSE_ISSUE,REVIEW_ACTIONS.REOPEN_ISSUE].includes(action);
  const note=cleanReason(justification,required);
  const before=clone(record);let updated=applyChanges(record,changes);const decidedAt=new Date().toISOString();
  if(targetType===REVIEW_TARGET_TYPES.EVENT){
    const metadata={...(updated.metadata||{}),reviewedAt:decidedAt,reviewedBy:reviewer};
    if(action===REVIEW_ACTIONS.REJECT){metadata.excludedFromAnalysis=true;metadata.reviewDisposition='REJECTED';metadata.approvedForTaxSimulation=false;updated={...updated,evidenceStatus:EVIDENCE_STATUS.DIVERGENT,metadata,notes:[updated.notes,`Rejeitado: ${note}`].filter(Boolean).join(' | ')};}
    else if(action===REVIEW_ACTIONS.KEEP_PENDING){metadata.excludedFromAnalysis=false;metadata.reviewDisposition='PENDING';updated={...updated,evidenceStatus:EVIDENCE_STATUS.PENDING,metadata,notes:[updated.notes,`Pendente: ${note}`].filter(Boolean).join(' | ')};}
    else {metadata.excludedFromAnalysis=false;metadata.reviewDisposition='ACCEPTED';metadata.manuallyReviewed=true;if(action===REVIEW_ACTIONS.APPROVE_FOR_TAX)metadata.approvedForTaxSimulation=true;updated={...updated,evidenceStatus:updated.evidenceStatus===EVIDENCE_STATUS.CONFIRMED?EVIDENCE_STATUS.CONFIRMED:EVIDENCE_STATUS.RECONCILED,metadata};}
    updated=createEvent(updated);
  } else if(targetType===REVIEW_TARGET_TYPES.POSITION){
    updated={...updated,metadata:{...(updated.metadata||{}),manuallyReviewed:true,reviewedAt:decidedAt,reviewedBy:reviewer,excludedFromAnalysis:action===REVIEW_ACTIONS.REJECT}};
    if(action===REVIEW_ACTIONS.KEEP_PENDING)updated.realizedIncomeStatus=EVIDENCE_STATUS.PENDING;
    else if(action===REVIEW_ACTIONS.REJECT)updated.realizedIncomeStatus=EVIDENCE_STATUS.DIVERGENT;
    else if(updated.realizedIncomeStatus!==EVIDENCE_STATUS.CONFIRMED)updated.realizedIncomeStatus=EVIDENCE_STATUS.RECONCILED;
    validatePosition(updated);
  } else if(targetType===REVIEW_TARGET_TYPES.DOCUMENT){
    updated={...updated,metadata:{...(updated.metadata||{}),manuallyReviewed:true,reviewedAt:decidedAt,reviewedBy:reviewer,reviewDisposition:action===REVIEW_ACTIONS.REJECT?'REJECTED':'ACCEPTED'}};
    if(action===REVIEW_ACTIONS.REJECT)updated.status='REJECTED';
  } else if(targetType===REVIEW_TARGET_TYPES.REPORTED_TOTAL){
    updated={...updated,reviewStatus:action===REVIEW_ACTIONS.REJECT?'REJECTED':action===REVIEW_ACTIONS.KEEP_PENDING?'PENDING':'APPROVED',reviewedAt:decidedAt,reviewNote:note};
  } else if(targetType===REVIEW_TARGET_TYPES.EVIDENCE){
    updated={...updated,status:action===REVIEW_ACTIONS.REJECT?'REJECTED':action===REVIEW_ACTIONS.KEEP_PENDING?'REVIEW':'APPROVED',reviewedAt:decidedAt,reviewNote:note};
  } else if(targetType===REVIEW_TARGET_TYPES.ISSUE){
    const reopen=action===REVIEW_ACTIONS.REOPEN_ISSUE||action===REVIEW_ACTIONS.KEEP_PENDING;
    updated={...updated,status:reopen?'OPEN':'RESOLVED',resolvedAt:reopen?null:decidedAt,resolution:note};
  }
  const decision={id:decisionId||`review-${Date.now()}-${Math.random().toString(36).slice(2)}`,projectId:record.projectId,documentId:record.documentId||record.sourceDocumentId||null,targetType,targetId:record.id,entityType:targetType,entityId:record.id,action,justification:note||'Aprovação documental individual.',reason:note||'Aprovação documental individual.',before,after:clone(updated),affectsTaxSimulation:targetType===REVIEW_TARGET_TYPES.EVENT&&record.type===EVENT_TYPES.REALIZED_INCOME,decidedAt,occurredAt:decidedAt,reviewer};
  return {updated,decision,before,after:updated};
}

export function parseReviewInput(item,rawValue){
  const text=String(rawValue??'').trim();
  const type=item?.valueType||item?.type||'text';
  if(type==='money'||moneyFields.has(item?.field)){if(!text)return null;const normalized=text.replace(/R\$|BRL/gi,'').replace(/\s/g,'').replace(/\./g,'').replace(',','.');const number=Number(normalized);if(!Number.isFinite(number))throw new TypeError('Valor monetário inválido.');return Math.round(number*100);}
  if(type==='date'){const br=text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);const iso=br?`${br[3]}-${br[2]}-${br[1]}`:text.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||Number.isNaN(Date.parse(`${iso}T00:00:00Z`)))throw new TypeError('Data inválida.');return iso;}
  if(type==='eventType'&&!Object.values(EVENT_TYPES).includes(text))throw new TypeError('Tipo de evento inválido.');
  if(type==='productFamily'&&!Object.values(PRODUCT_FAMILIES).includes(text))throw new TypeError('Família de produto inválida.');
  return text;
}

function contribution(record){const out={appliedCents:0,netRedeemedCents:0,realizedIncomeCents:0,irrfCents:0,periodicIrCents:0};if(!record||record.metadata?.excludedFromAnalysis||record.metadata?.reviewDisposition==='REJECTED')return out;if(record.type===EVENT_TYPES.APPLICATION)out.appliedCents=record.amountCents||0;if(record.type===EVENT_TYPES.REDEMPTION)out.netRedeemedCents=record.netAmountCents??record.amountCents??0;if(record.type===EVENT_TYPES.REALIZED_INCOME)out.realizedIncomeCents=record.amountCents||0;if(record.type===EVENT_TYPES.REDEMPTION_IRRF)out.irrfCents=record.amountCents||0;if(record.type===EVENT_TYPES.PERIODIC_IR)out.periodicIrCents=record.amountCents||0;return out;}
export function contributionDelta(recordType,before,after){if(recordType!==REVIEW_TARGET_TYPES.EVENT)return {appliedCents:0,netRedeemedCents:0,realizedIncomeCents:0,irrfCents:0,periodicIrCents:0};const a=contribution(before),b=contribution(after);return Object.fromEntries(Object.keys(a).map(key=>[key,b[key]-a[key]]));}
export function applyReviewAction({item,record,action,newValue,justification}){const changes=action===REVIEW_ACTIONS.CORRECT?{[String(item.field||'').split('.').pop()]:newValue}:{};const result=applyReviewDecision({targetType:item.recordType||item.targetType,record,action,changes,justification});return {before:result.before,after:result.after,decision:result.decision};}
export function documentReviewSummary({items=[],issues=[],decisions=[],document}){const pending=items.filter(value=>!['CONFIRMED','RECONCILED'].includes(normalizedStatus(value.status||value.evidenceStatus))).length;return {total:items.length,pending,confirmed:items.length-pending,openIssues:issues.filter(issue=>issue.documentId===document?.id&&['OPEN','REOPENED'].includes(issue.status)).length,decisionCount:decisions.filter(value=>value.documentId===document?.id).length};}

function brMoney(cents){return Number.isSafeInteger(cents)?(cents/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'';}
function evidenceLine(extraction,event){
  const amount=brMoney(event.type===EVENT_TYPES.REDEMPTION?(event.netAmountCents??event.amountCents):event.amountCents);const date=String(event.occurredAt||'').slice(0,10).split('-').reverse().join('/');
  const terms={APPLICATION:['APLICA','APORTE'],REDEMPTION:['RESGATE','RETIRADA'],REDEMPTION_IRRF:['IRRF','IMPOSTO','IR RETIDO'],PERIODIC_IR:['COBRANÇA DE IR','COBRANCA DE IR','COME-COTAS'],REALIZED_INCOME:['RENDIMENTO REALIZADO','RENDIMENTO TRIBUT'],PERIOD_INCOME:['RENDIMENTO BRUTO','RENDIMENTO ATÉ','RENDIMENTO ATE'],BALANCE_SNAPSHOT:['SALDO ATUAL','SALDO FINAL','SALDO ANTERIOR'],QUOTA_SNAPSHOT:['COTAS','QUANTIDADE'],TAX_FORECAST:['PREVISÃO','PREVISAO']}[event.type]||[];
  for(const page of extraction?.pages||[]){let best=null,score=-1;for(const [index,raw] of String(page.text||'').split(/\r?\n/).entries()){const text=raw.trim();if(!text)continue;let current=0;if(amount&&text.includes(amount))current+=4;if(date&&text.includes(date))current+=2;if(terms.some(term=>text.toUpperCase().includes(term)))current+=3;if(current>score){best={text,lineNumber:index+1};score=current;}}if(best&&score>=4)return {...best,pageNumber:page.pageNumber||1,method:page.method||extraction.method||'EXTRACTED_TEXT',confidence:Math.min(.99,.55+score*.07)};}
  return {text:'',lineNumber:null,pageNumber:1,method:extraction?.method||'UNKNOWN',confidence:.45};
}
export function deriveEvidenceRecords({projectId,documentId,extraction,positions=[],events=[]}){
  const records=[];
  for(const event of events){const line=evidenceLine(extraction,event);records.push({id:`evidence-${documentId}-${event.id}`,projectId,documentId,positionId:event.positionId,eventId:event.id,pageNumber:line.pageNumber,lineNumber:line.lineNumber,fieldPath:event.type===EVENT_TYPES.REDEMPTION?'event.netAmountCents':'event.amountCents',value:event.type===EVENT_TYPES.REDEMPTION?(event.netAmountCents??event.amountCents):event.amountCents,snippet:line.text,method:line.method,confidence:line.confidence,status:event.evidenceStatus===EVIDENCE_STATUS.CONFIRMED&&line.confidence>=.8?'APPROVED':'REVIEW',createdAt:new Date().toISOString()});}
  for(const position of positions){const found=position.name&&String(extraction?.fullText||'').toUpperCase().includes(position.name.toUpperCase());records.push({id:`evidence-${documentId}-${position.id}-name`,projectId,documentId,positionId:position.id,eventId:null,pageNumber:1,lineNumber:null,fieldPath:'position.name',value:position.name,snippet:found?position.name:'',method:extraction?.method||'UNKNOWN',confidence:found?.9:.55,status:found?'APPROVED':'REVIEW',createdAt:new Date().toISOString()});}
  return records;
}
