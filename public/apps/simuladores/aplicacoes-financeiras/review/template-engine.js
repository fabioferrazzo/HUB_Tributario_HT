import { createEvent, EVIDENCE_STATUS, EVENT_TYPES, POSITION_STATUS, PRODUCT_FAMILIES, validatePosition } from '../domain/model.js';
import { DOCUMENT_KINDS } from '../document-engine/classifier.js';
import { dateToIso, decimalPt, moneyToCents, normalizeForSearch, stableId } from '../document-engine/text-utils.js';

export const TEMPLATE_BUNDLE_FORMAT = 'HT_FINANCIAL_TEMPLATE_BUNDLE';
export const TEMPLATE_BUNDLE_VERSION = 1;
export const TEMPLATE_BUNDLE_MIME = 'application/x-hteixeira-financial-template+json';
export const TEMPLATE_BUNDLE_EXTENSION = '.httemplate';
export const TEMPLATE_STATUSES = Object.freeze({DRAFT:'DRAFT',ACTIVE:'ACTIVE',ARCHIVED:'ARCHIVED'});
export const RULE_KINDS = Object.freeze({FIELD:'FIELD',EVENT:'EVENT',REPORTED_TOTAL:'REPORTED_TOTAL'});
export const TRANSFORMS = Object.freeze({TEXT:'TEXT',DATE_BR:'DATE_BR',MONEY_BR:'MONEY_BR',INTEGER:'INTEGER',DECIMAL_BR:'DECIMAL_BR',UPPER:'UPPER'});

const MAX_PATTERN_LENGTH = 500;
const MAX_RULES = 100;
const VALID_FLAGS = /^[gimuy]*$/;
const SUPPORTED_FIELD_TARGETS = new Set([
  'document.bankName','document.kind','account.agency','account.accountNumber',
  'position.name','position.openedAt','position.originalPrincipalCents','position.externalReference','position.productFamily',
]);
const SUPPORTED_TOTAL_TARGETS = new Set(['reportedTotal.quarter','reportedTotal.category','reportedTotal.incomeCents','reportedTotal.irrfCents']);

const SENSITIVE_LITERAL_PATTERNS = [
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\d[ .-]?){9,}\b/,
  /(?:R\$|BRL)\s*\d[\d.]*,\d{2}/i,
];
const FORBIDDEN_TEMPLATE_KEYS = new Set(['blob','bytes','fullText','pages','documents','documentBinaries','snippet','sourceText','clientData','cnpj','cpf','accountNumber']);

function assertPublicTemplateText(value, label='conteúdo') {
  const text=String(value||'');
  for(const pattern of SENSITIVE_LITERAL_PATTERNS) if(pattern.test(text)) throw new TypeError(`O ${label} contém dado literal potencialmente identificável. Use uma expressão genérica, sem CNPJ, CPF, conta, e-mail ou valor do cliente.`);
  return text;
}
function scanForbiddenKeys(value,path='template') {
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)) {
    if(FORBIDDEN_TEMPLATE_KEYS.has(key) && item != null && item !== '' && !(Array.isArray(item)&&!item.length)) throw new TypeError(`O pacote de template contém campo proibido: ${path}.${key}.`);
    if(item&&typeof item==='object')scanForbiddenKeys(item,`${path}.${key}`);
  }
}
export function assertTemplatePrivacy(template) {
  scanForbiddenKeys(template);
  const texts=[template.name,template.description,template.institutionName,template.notes,...(template.fileNamePatterns||[]),...(template.requiredTextPatterns||[]),...(template.optionalTextPatterns||[])];
  for(const value of texts)assertPublicTemplateText(value,'template');
  for(const rule of template.rules||[]) { assertPublicTemplateText(rule.label,'rótulo da regra'); assertPublicTemplateText(rule.regex,'expressão da regra'); }
  return true;
}

function clone(value){return structuredClone(value);}
function now(){return new Date().toISOString();}
function safeId(value){return String(value||'').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'template';}
function stripGlobal(flags=''){return String(flags).replaceAll('g','');}
function ensureGlobal(flags=''){return flags.includes('g')?flags:`${flags}g`;}
function nestedQuantifierRisk(pattern){return /\((?:[^()]|\\.)*[+*{][^)]*\)[+*{]/.test(pattern) || /(\.\*){2,}|(\.\+){2,}/.test(pattern);}

export function validateRegex(pattern, flags='im'){
  if(typeof pattern!=='string'||!pattern.trim())throw new TypeError('A expressão regular é obrigatória.');
  if(pattern.length>MAX_PATTERN_LENGTH)throw new TypeError(`A expressão regular excede ${MAX_PATTERN_LENGTH} caracteres.`);
  if(!VALID_FLAGS.test(flags))throw new TypeError('Flags permitidas: g, i, m, u e y.');
  if(nestedQuantifierRisk(pattern))throw new TypeError('Expressão rejeitada por risco de repetição catastrófica.');
  try{return new RegExp(pattern,flags);}catch(error){throw new TypeError(`Expressão regular inválida: ${error.message}`);}
}

export function transformCaptured(value, transform=TRANSFORMS.TEXT){
  if(value==null)return null;
  switch(transform){
    case TRANSFORMS.DATE_BR:return dateToIso(String(value));
    case TRANSFORMS.MONEY_BR:return moneyToCents(String(value));
    case TRANSFORMS.INTEGER:{const number=Number(String(value).replace(/\D/g,''));return Number.isSafeInteger(number)?number:null;}
    case TRANSFORMS.DECIMAL_BR:return decimalPt(String(value));
    case TRANSFORMS.UPPER:return String(value).trim().toUpperCase();
    default:return String(value).trim();
  }
}

function normalizeRule(rule,index){
  const kind=Object.values(RULE_KINDS).includes(rule.kind)?rule.kind:RULE_KINDS.FIELD;
  const transform=Object.values(TRANSFORMS).includes(rule.transform)?rule.transform:TRANSFORMS.TEXT;
  const flags=String(rule.flags||'im');
  validateRegex(String(rule.regex||''),kind===RULE_KINDS.EVENT?ensureGlobal(flags):stripGlobal(flags));
  const normalized={
    id:String(rule.id||`rule-${index+1}`).slice(0,100),label:assertPublicTemplateText(String(rule.label||`Regra ${index+1}`).slice(0,160),'rótulo da regra'),kind,
    regex:assertPublicTemplateText(String(rule.regex),'expressão da regra'),flags,captureGroup:Number.isInteger(Number(rule.captureGroup))?Number(rule.captureGroup):1,
    transform,required:Boolean(rule.required),confidence:Math.min(1,Math.max(0.1,Number(rule.confidence)||0.85)),
  };
  if(kind===RULE_KINDS.FIELD){if(!SUPPORTED_FIELD_TARGETS.has(rule.target))throw new TypeError(`Destino de campo não suportado: ${rule.target}`);normalized.target=rule.target;}
  if(kind===RULE_KINDS.REPORTED_TOTAL){if(!SUPPORTED_TOTAL_TARGETS.has(rule.target))throw new TypeError(`Destino de total não suportado: ${rule.target}`);normalized.target=rule.target;}
  if(kind===RULE_KINDS.EVENT){
    if(!Object.values(EVENT_TYPES).includes(rule.eventType))throw new TypeError(`Tipo de evento não suportado: ${rule.eventType}`);
    normalized.eventType=rule.eventType;
    normalized.dateGroup=Number(rule.dateGroup||1);normalized.amountGroup=Number(rule.amountGroup||2);
    normalized.netGroup=rule.netGroup==null?null:Number(rule.netGroup);normalized.grossGroup=rule.grossGroup==null?null:Number(rule.grossGroup);
    normalized.quotaQuantityGroup=rule.quotaQuantityGroup==null?null:Number(rule.quotaQuantityGroup);normalized.quotaValueGroup=rule.quotaValueGroup==null?null:Number(rule.quotaValueGroup);
    normalized.dateTransform=rule.dateTransform||TRANSFORMS.DATE_BR;normalized.amountTransform=rule.amountTransform||TRANSFORMS.MONEY_BR;
  }
  return normalized;
}

export function normalizeCustomTemplate(input={}){
  const familyId=safeId(input.familyId||input.id||input.name||'template');
  const version=Math.max(1,Number(input.version)||1);
  const rules=Array.isArray(input.rules)?input.rules:[];
  if(rules.length>MAX_RULES)throw new TypeError(`O template excede ${MAX_RULES} regras.`);
  const status=Object.values(TEMPLATE_STATUSES).includes(input.status)?input.status:TEMPLATE_STATUSES.DRAFT;
  const template={
    id:String(input.id||`${familyId}-v${version}`).slice(0,120),familyId,name:String(input.name||familyId).trim().slice(0,180),
    description:String(input.description||'').trim().slice(0,1000),version,status,priority:Math.max(0,Math.min(1000,Number(input.priority)||150)),
    institutionId:String(input.institutionId||'').trim().slice(0,100),institutionName:String(input.institutionName||'').trim().slice(0,160),
    documentKinds:(Array.isArray(input.documentKinds)?input.documentKinds:[]).filter(kind=>Object.values(DOCUMENT_KINDS).includes(kind)),
    fileNamePatterns:(Array.isArray(input.fileNamePatterns)?input.fileNamePatterns:[]).map(String).filter(Boolean).slice(0,20),
    requiredTextPatterns:(Array.isArray(input.requiredTextPatterns)?input.requiredTextPatterns:[]).map(String).filter(Boolean).slice(0,20),
    optionalTextPatterns:(Array.isArray(input.optionalTextPatterns)?input.optionalTextPatterns:[]).map(String).filter(Boolean).slice(0,20),
    productFamily:Object.values(PRODUCT_FAMILIES).includes(input.productFamily)?input.productFamily:PRODUCT_FAMILIES.FIXED_INCOME_SECURITY,
    rules:rules.map(normalizeRule),createdAt:input.createdAt||now(),updatedAt:input.updatedAt||now(),createdBy:String(input.createdBy||'LOCAL_USER').slice(0,80),
    origin:String(input.origin||'USER_BUILT').slice(0,80),notes:String(input.notes||'').slice(0,1000),
  };
  for(const pattern of [...template.fileNamePatterns,...template.requiredTextPatterns,...template.optionalTextPatterns])validateRegex(pattern,'im');
  if(!template.name)throw new TypeError('Nome do template é obrigatório.');
  assertTemplatePrivacy(template);
  return template;
}

function regexMatches(pattern,value){return validateRegex(pattern,'im').test(String(value||'').slice(0,250000));}
export function templateMatchScore(templateInput,{fileName='',text='',bank={},classification={}}={}){
  const template=normalizeCustomTemplate(templateInput);
  if(template.status!==TEMPLATE_STATUSES.ACTIVE)return {matched:false,score:0,reasons:['Template não está ativo.']};
  const reasons=[];let score=0;
  if(template.institutionId){if(bank.id===template.institutionId){score+=40;reasons.push('Instituição identificada.');}else return {matched:false,score:0,reasons:['Instituição incompatível.']};}
  if(template.documentKinds.length){if(template.documentKinds.includes(classification.kind)){score+=20;reasons.push('Tipo de documento compatível.');}else return {matched:false,score:0,reasons:['Tipo de documento incompatível.']};}
  if(template.fileNamePatterns.length){const hits=template.fileNamePatterns.filter(pattern=>regexMatches(pattern,fileName)).length;if(!hits)return {matched:false,score:0,reasons:['Nome do arquivo não corresponde.']};score+=Math.min(15,hits*5);}
  for(const pattern of template.requiredTextPatterns){if(!regexMatches(pattern,text))return {matched:false,score:0,reasons:[`Texto obrigatório não encontrado: ${pattern}`]};score+=10;}
  const optionalHits=template.optionalTextPatterns.filter(pattern=>regexMatches(pattern,text)).length;score+=Math.min(15,optionalHits*3);
  if(!template.institutionId&&!template.documentKinds.length&&!template.fileNamePatterns.length&&!template.requiredTextPatterns.length)return {matched:false,score:0,reasons:['Template sem critérios de correspondência.']};
  return {matched:true,score:Math.min(100,score||50),reasons};
}

function firstCapture(rule,text){const re=validateRegex(rule.regex,stripGlobal(rule.flags));const match=re.exec(text);if(!match)return null;return {raw:match[rule.captureGroup]??match[0],match,index:match.index};}
function evidence({projectId,documentId,pageNumber=1,fieldPath,value,snippet,method,confidence,status}){return {id:`evd-${documentId}-${stableId([fieldPath,String(value),snippet])}`,projectId,documentId,pageNumber,fieldPath,value,snippet:String(snippet||'').slice(0,500),method,confidence,status:status||'REVIEW'};}
function fallbackDate(text){const match=String(text).match(/\b(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/);return dateToIso(match?.[1])||new Date().toISOString().slice(0,10);}
function applyField(target,value,records){const [,field]=target.split('.');if(target.startsWith('document.'))records.document[field]=value;else if(target.startsWith('account.'))records.account[field]=value;else if(target.startsWith('position.'))records.position[field]=value;else if(target.startsWith('reportedTotal.'))records.reportedTotal[field]=value;}

export function applyCustomTemplate(context,templateInput){
  const template=normalizeCustomTemplate(templateInput);const {projectId,documentId,text,bank,classification,method='CUSTOM_TEMPLATE'}=context;
  const match=templateMatchScore(template,{fileName:context.fileName||'',text,bank,classification});if(!match.matched)return null;
  const accountId=`account-${projectId}-${stableId([template.familyId,documentId,'account'])}`;
  const positionId=context.positionIdOverride || `position-${projectId}-${stableId([template.familyId,documentId,'position'])}`;
  const records={
    document:{bankName:template.institutionName||bank.name,kind:classification.kind},
    account:{id:accountId,projectId,bankId:template.institutionId||bank.id,agency:'',accountNumber:'',name:template.institutionName||bank.name},
    position:{id:positionId,projectId,bankId:template.institutionId||bank.id,accountId,name:'Posição extraída por template',externalReference:`${template.familyId}|${documentId}`,productFamily:template.productFamily,openedAt:fallbackDate(text),originalPrincipalCents:null,status:POSITION_STATUS.REQUIRES_REVIEW,realizedIncomeStatus:EVIDENCE_STATUS.PENDING,metadata:{templateId:template.id,templateFamilyId:template.familyId,templateVersion:template.version,sourceDocumentId:documentId,openedAtDocumented:false,principalDocumented:false}},
    reportedTotal:{id:`reported-${documentId}-${template.familyId}`,projectId,documentId,bankId:template.institutionId||bank.id,category:'FIXED_INCOME',quarter:null,incomeCents:0,irrfCents:0,method:`CUSTOM_TEMPLATE:${template.id}`,confidence:0.85},
  };
  const events=[];const evidences=[];const issues=[];const fieldResults=[];
  for(const rule of template.rules){
    if(rule.kind===RULE_KINDS.EVENT)continue;
    const found=firstCapture(rule,text);
    if(!found){fieldResults.push({ruleId:rule.id,status:'NOT_FOUND'});if(rule.required)issues.push({id:`issue-${documentId}-template-${rule.id}`,projectId,documentId,positionId,severity:'REVIEW',title:`Campo obrigatório não encontrado: ${rule.label}`,details:'A regra do template não encontrou o campo. Revise a expressão ou informe o valor manualmente.',status:'OPEN'});continue;}
    const value=transformCaptured(found.raw,rule.transform);if(value==null){fieldResults.push({ruleId:rule.id,status:'INVALID_VALUE',raw:found.raw});continue;}
    applyField(rule.target,value,records);if(rule.target==='position.openedAt')records.position.metadata.openedAtDocumented=true;if(rule.target==='position.originalPrincipalCents')records.position.metadata.principalDocumented=true;
    evidences.push(evidence({projectId,documentId,fieldPath:rule.target,value,snippet:found.match[0],method:`CUSTOM_TEMPLATE:${template.id}`,confidence:rule.confidence}));fieldResults.push({ruleId:rule.id,status:'MATCHED',value});
  }
  validatePosition(records.position);
  for(const rule of template.rules.filter(item=>item.kind===RULE_KINDS.EVENT)){
    const regex=validateRegex(rule.regex,ensureGlobal(rule.flags));let count=0;for(const matchValue of text.matchAll(regex)){
      const occurredAt=transformCaptured(matchValue[rule.dateGroup],rule.dateTransform)||fallbackDate(text);const amount=transformCaptured(matchValue[rule.amountGroup],rule.amountTransform);if(!Number.isSafeInteger(amount))continue;
      const net=rule.netGroup?transformCaptured(matchValue[rule.netGroup],TRANSFORMS.MONEY_BR):null;const gross=rule.grossGroup?transformCaptured(matchValue[rule.grossGroup],TRANSFORMS.MONEY_BR):null;
      const quotaQuantity=rule.quotaQuantityGroup?transformCaptured(matchValue[rule.quotaQuantityGroup],TRANSFORMS.DECIMAL_BR):null;const quotaValue=rule.quotaValueGroup?transformCaptured(matchValue[rule.quotaValueGroup],TRANSFORMS.DECIMAL_BR):null;
      const event=createEvent({id:`event-${documentId}-${rule.id}-${count}`,projectId,positionId,bankId:records.position.bankId,accountId,type:rule.eventType,occurredAt,amountCents:Math.abs(amount),netAmountCents:net==null?null:Math.abs(net),grossAmountCents:gross==null?null:Math.abs(gross),quotaQuantity,quotaValue,evidenceStatus:EVIDENCE_STATUS.RECONSTRUCTED,sourceDocumentId:documentId,notes:`Extraído pelo template local ${template.name} v${template.version}.`,metadata:{templateId:template.id,templateRuleId:rule.id}});events.push(event);
      evidences.push(evidence({projectId,documentId,fieldPath:`events.${event.id}.amountCents`,value:event.amountCents,snippet:matchValue[0],method:`CUSTOM_TEMPLATE:${template.id}`,confidence:rule.confidence}));count+=1;
    }fieldResults.push({ruleId:rule.id,status:count?'MATCHED':'NOT_FOUND',count});if(!count&&rule.required)issues.push({id:`issue-${documentId}-template-${rule.id}`,projectId,documentId,positionId,severity:'REVIEW',title:`Evento obrigatório não encontrado: ${rule.label}`,details:'A regra de evento não encontrou ocorrências no documento.',status:'OPEN'});
  }
  const hasTotals=template.rules.some(rule=>rule.kind===RULE_KINDS.REPORTED_TOTAL);
  issues.push({id:`issue-${documentId}-custom-template-review`,projectId,documentId,positionId,severity:'REVIEW',title:'Template local aplicado — revisão recomendada',details:`O documento foi processado pelo template ${template.name} v${template.version}. Confirme as evidências antes da escrituração.`,status:'OPEN'});
  return {positions:[records.position],accounts:[records.account],events,evidences,issues,reportedTotals:hasTotals?[records.reportedTotal]:[],warnings:[],templateId:`CUSTOM:${template.familyId}:v${template.version}`,templateMatch:match,fieldResults,documentOverrides:records.document};
}

export function applyFirstCustomTemplate(context,templates=[]){
  const candidates=templates.map(normalizeCustomTemplate).filter(template=>template.status===TEMPLATE_STATUSES.ACTIVE).sort((a,b)=>b.priority-a.priority||b.version-a.version);
  for(const template of candidates){const result=applyCustomTemplate(context,template);if(result)return result;}return null;
}

export function testCustomTemplate(templateInput,context){
  const template=normalizeCustomTemplate({...templateInput,status:TEMPLATE_STATUSES.ACTIVE});const match=templateMatchScore(template,context);if(!match.matched)return {matched:false,match,fields:[],events:[],issues:[]};
  const result=applyCustomTemplate({...context,projectId:context.projectId||'template-test',documentId:context.documentId||'template-test-doc'},template);
  return {matched:true,match,fields:result.fieldResults,events:result.events.map(event=>({type:event.type,occurredAt:event.occurredAt,amountCents:event.amountCents,evidenceStatus:event.evidenceStatus})),positions:result.positions.map(position=>({name:position.name,openedAt:position.openedAt,originalPrincipalCents:position.originalPrincipalCents,productFamily:position.productFamily})),reportedTotals:result.reportedTotals,issues:result.issues.map(issue=>issue.title)};
}

export function nextTemplateVersion(templateInput){const current=normalizeCustomTemplate(templateInput);return normalizeCustomTemplate({...clone(current),id:`${current.familyId}-v${current.version+1}`,version:current.version+1,status:TEMPLATE_STATUSES.DRAFT,createdAt:now(),updatedAt:now(),origin:'VERSIONED_COPY'});}
export function activateTemplateVersion(templates,templateId){const target=templates.find(item=>item.id===templateId);if(!target)throw new Error('Template não encontrado.');return templates.map(item=>item.familyId===target.familyId?{...item,status:item.id===templateId?TEMPLATE_STATUSES.ACTIVE:TEMPLATE_STATUSES.ARCHIVED,updatedAt:now()}:item);}

export function suggestRuleFromCorrection({label='',target='position.originalPrincipalCents',transform=TRANSFORMS.MONEY_BR,kind=RULE_KINDS.FIELD,eventType=EVENT_TYPES.REDEMPTION}={}){
  const genericLabels={
    'position.originalPrincipalCents':'Valor aplicado','position.openedAt':'Data da aplicação','position.name':'Produto',
    'account.agency':'Agência','account.accountNumber':'Conta','document.bankName':'Instituição','document.kind':'Tipo do documento',
    'reportedTotal.incomeCents':'Rendimento bruto','reportedTotal.irrfCents':'IR retido','reportedTotal.quarter':'Trimestre','reportedTotal.category':'Categoria',
  };
  const cleanLabel=assertPublicTemplateText(String(label||genericLabels[target]||'Campo').replace(/\s+/g,' ').slice(0,80),'rótulo da regra');
  const keywordByTarget={
    'position.originalPrincipalCents':'(?:VALOR\\s+(?:APLICADO|DA\\s+APLICA[CÇ][AÃ]O)|APLICA[CÇ][AÃ]O)',
    'position.openedAt':'(?:DATA\\s+(?:DA\\s+)?APLICA[CÇ][AÃ]O|APLICA[CÇ][AÃ]O\\s+EM)',
    'position.name':'(?:PRODUTO|FUNDO|CDB|LCI|LCA|RDB)',
    'account.agency':'AG[EÊ]NCIA','account.accountNumber':'CONTA','document.bankName':'(?:BANCO|COOPERATIVA|CORRETORA)',
    'reportedTotal.incomeCents':'RENDIMENTO\\s+BRUTO','reportedTotal.irrfCents':'(?:I\\.?R\\.?\\s+RETIDO|IRRF)','reportedTotal.quarter':'TRIMESTRE','reportedTotal.category':'CATEGORIA',
  };
  const keyword=keywordByTarget[target]||cleanLabel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
  const capture=transform===TRANSFORMS.MONEY_BR?'(R?\\$?\\s*[\\d.]+,\\d{2})':transform===TRANSFORMS.DATE_BR?'(\\d{2}\\/\\d{2}\\/\\d{4})':'([^\\n]+)';
  const base={id:`rule-${safeId(cleanLabel||target)}`,label:cleanLabel,kind,regex:`${keyword}\\s*[:\\-]?\\s*${capture}`,flags:'im',captureGroup:1,transform,required:false,confidence:0.85};
  if(kind===RULE_KINDS.EVENT){
    const eventKeyword={
      [EVENT_TYPES.APPLICATION]:'(?:APLICA[CÇ][AÃ]O|APORTE)',[EVENT_TYPES.REDEMPTION]:'(?:RESGATE|RETIRADA)',
      [EVENT_TYPES.REDEMPTION_IRRF]:'(?:IRRF|IMPOSTO\\s+DE\\s+RENDA\\s+RETIDO)',[EVENT_TYPES.PERIODIC_IR]:'(?:COBRAN[CÇ]A\\s+DE\\s+IR|COME-COTAS)',
      [EVENT_TYPES.REALIZED_INCOME]:'(?:RENDIMENTO\\s+(?:REALIZADO|TRIBUT[AÁ]VEL))',[EVENT_TYPES.PERIOD_INCOME]:'(?:RENDIMENTO\\s+BRUTO|RENDIMENTO\\s+AT[EÉ])',
      [EVENT_TYPES.BALANCE_SNAPSHOT]:'(?:SALDO\\s+ATUAL|SALDO\\s+FINAL)',[EVENT_TYPES.TAX_FORECAST]:'(?:PREVIS[AÃ]O\\s+DE\\s+I\\.?R\\.?)',
    }[eventType]||keyword;
    return {...base,eventType,dateGroup:1,amountGroup:2,regex:`(\\d{2}\\/\\d{2}\\/\\d{4})[^\\n]*(?:${eventKeyword})[^\\n]*?(R?\\$?\\s*[\\d.]+,\\d{2})`,flags:'gim',dateTransform:TRANSFORMS.DATE_BR,amountTransform:TRANSFORMS.MONEY_BR};
  }
  return {...base,target};
}

function exportableTemplate(template){const value=normalizeCustomTemplate(template);assertTemplatePrivacy(value);const {createdBy,...safe}=value;return {...safe,createdBy:'LOCAL_USER'};}
export function createTemplateBundle(templates){for(const template of templates)assertTemplatePrivacy(template);return {format:TEMPLATE_BUNDLE_FORMAT,formatVersion:TEMPLATE_BUNDLE_VERSION,exportedAt:now(),templates:templates.map(exportableTemplate)};}
export function parseTemplateBundle(payload){const data=typeof payload==='string'?JSON.parse(payload):payload;if(!data||data.format!==TEMPLATE_BUNDLE_FORMAT||data.formatVersion!==TEMPLATE_BUNDLE_VERSION||!Array.isArray(data.templates))throw new Error('Arquivo de templates inválido.');if(data.templates.length>100)throw new Error('O pacote excede 100 templates.');return data.templates.map(normalizeCustomTemplate);}
export function templateBundleBlob(templates){return new Blob([JSON.stringify(createTemplateBundle(templates),null,2)],{type:TEMPLATE_BUNDLE_MIME});}
