import { applyCustomTemplate, applyFirstCustomTemplate, normalizeCustomTemplate } from '../review/template-engine.js';
import { interAdapter } from '../adapters/inter.js';
import { bancoDoBrasilAdapter } from '../adapters/banco-do-brasil.js';
import { sicrediAdapter } from '../adapters/sicredi.js';
import { itauSummaryAdapter } from '../adapters/itau.js';
import { caixaFundAdapter } from '../adapters/caixa.js';
import { sicoobRdcAdapter } from '../adapters/sicoob.js';
import { banrisulCdbAdapter } from '../adapters/banrisul.js';
import { EVIDENCE_STATUS, POSITION_STATUS, PRODUCT_FAMILIES, validatePosition } from '../domain/model.js';
import { extractIncomeReportTotals, parseGenericInvestmentDocument } from './generic-extractor.js';
import { stableId, dateToIso, moneyToCents } from './text-utils.js';
import { DOCUMENT_KINDS } from './classifier.js';
import { interRawToCanonical } from './inter-raw.js';

function interBlocks(text) {
  const marker=/((?:CDB|LCI|LCA|RDB)[^\n]{0,100})\s*\n?Vencimento:\s*([^\n]+?)\s+Data aplica(?:ç|c)ão:\s*(\d{2}\/\d{2}\/\d{4})\s+Valor:\s*R\$\s*([\d.]+,\d{2})/gi;
  const matches=[...text.matchAll(marker)];
  if(!matches.length)return [{text,name:'Posição de renda fixa',openedAt:null,principal:null,index:0}];
  const firstEventIndex=text.search(/\d{2}\/\d{2}\/\d{4}[^\n]{0,120}(?:Saldo até|Rendimento até|Resgate Antecipado|Imposto de renda retido|Previsão de I\.R\.)/i);
  const headerFirst=firstEventIndex>=0&&matches[0].index<firstEventIndex;
  return matches.map((match,index)=>{
    const start=headerFirst?match.index:(index?matches[index-1].index+matches[index-1][0].length:0);
    const end=headerFirst?(index+1<matches.length?matches[index+1].index:text.length):match.index+match[0].length;
    return {text:text.slice(start,end),name:match[1].trim(),openedAt:dateToIso(match[3]),principal:moneyToCents(match[4]),maturity:String(match[2]||'').trim(),index};
  });
}

function accountInfo(text) {
  const agency=text.match(/Ag[eê]ncia\s*:?\s*([\d-]+)/i)?.[1]||'';const account=text.match(/Conta\s*:?\s*([\d.-]+)/i)?.[1]||'';
  return {agency,account};
}

// INTERRAW01: quando o texto -layout não revela nenhum CDB (layout Inter 2026 com colunas desalinhadas),
// usa o texto -raw da extração convertido para o formato homologado. Layouts já reconhecidos não mudam.
function interSourceText(context) {
  const text = context.text || '';
  if (interBlocks(text).some(block => block.openedAt)) return text;
  const raw = (context.pages || []).map(page => page?.rawText || '').join('\n');
  if (!raw.trim()) return text;
  const canonical = interRawToCanonical(raw);
  return canonical ? canonical : text;
}

function interReceipt(context) {
  const {projectId, documentId, text} = context;
  const date = dateToIso(text.match(/Solicita(?:ç|c)[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || text.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1]);
  const amountText = text.match(/Resgate realizado!?\s*R\$\s*([\d.]+,\d{2})/i)?.[1] || text.match(/R\$\s*([\d.]+,\d{2})/)?.[1] || '';
  const amount = amountText ? moneyToCents(amountText) : null; // moneyToCents('') devolve 0: não confundir ausência com R$ 0,00
  const protocol = text.match(/Protocolo de transa(?:ç|c)[ãa]o:\s*(\d+)/i)?.[1] || '';
  const base = {projectId, documentId, pageNumber: 1, method: 'INTER_REDEMPTION_RECEIPT', confidence: 0.95, status: 'CONFIRMED'};
  const evidences = [];
  if (date) evidences.push({...base, id: `evd-${documentId}-receipt-date`, fieldPath: 'receipt.redemption.date', value: date, snippet: `Solicitação: ${date}`});
  if (amount != null) evidences.push({...base, id: `evd-${documentId}-receipt-net`, fieldPath: 'receipt.redemption.netAmountCents', value: amount, snippet: `Resgate realizado R$ ${amountText}`});
  if (protocol) evidences.push({...base, id: `evd-${documentId}-receipt-protocol`, fieldPath: 'receipt.redemption.protocol', value: protocol, snippet: `Protocolo ${protocol}`});
  const issues = date && amount != null ? [] : [{id: `issue-${documentId}-receipt`, projectId, documentId, positionId: null, severity: 'REVIEW', title: 'Comprovante de resgate incompleto', details: 'Não foi possível ler a data ou o valor do resgate no comprovante.', status: 'OPEN'}];
  const warnings = date && amount != null ? [`Comprovante de resgate de ${date.split('-').reverse().join('/')} (líquido R$ ${(amount / 100).toLocaleString('pt-BR', {minimumFractionDigits: 2})}): vincule-o ao resgate correspondente do extrato.`] : [];
  return {positions: [], events: [], evidences, issues, reportedTotals: [], warnings, accounts: [], templateId: 'INTER_REDEMPTION_RECEIPT'};
}

function interTemplate(context) {
  const {projectId,documentId,text,bank,classification}=context;
  if(classification.kind===DOCUMENT_KINDS.INCOME_REPORT)return {positions:[],events:[],evidences:[],issues:[],reportedTotals:extractIncomeReportTotals(context),warnings:[],templateId:'INTER_INCOME_REPORT'};
  // RECEIPT01: comprovante de resgate não é aplicação — vira evidência (data + valor líquido) para vincular ao resgate do extrato.
  if(classification.kind===DOCUMENT_KINDS.REDEMPTION_RECEIPT)return interReceipt(context);
  const info=accountInfo(text);const positions=[];const events=[];const issues=[];
  for(const block of interBlocks(interSourceText(context))){const positionId=`position-${projectId}-${stableId(['inter',block.name,block.openedAt,block.principal])}`;const position={id:positionId,projectId,bankId:bank.id,accountId:info.account?`account-${projectId}-inter-${stableId([info.agency,info.account])}`:'unknown',name:block.name,externalReference:`${block.openedAt||''}|${block.principal||''}`,maturityDate:dateToIso(block.maturity)||null,maturityText:block.maturity&&!dateToIso(block.maturity)?block.maturity.slice(0,60):null,productFamily:PRODUCT_FAMILIES.FIXED_INCOME_SECURITY,openedAt:block.openedAt||dateToIso((text.match(/Per[ií]odo[^\d\n]{0,30}(\d{2}\/\d{2}\/\d{4})/i)||text.match(/\b(\d{2}\/\d{2}\/\d{4})\b/))?.[1])||new Date().toISOString().slice(0,10),originalPrincipalCents:block.principal,status:POSITION_STATUS.REQUIRES_REVIEW,realizedIncomeStatus:EVIDENCE_STATUS.PENDING,metadata:{template:'INTER_EXAMPLE',openedAtDocumented:Boolean(block.openedAt)}};validatePosition(position);positions.push(position);
    const parsed=interAdapter.parseNormalizedText({projectId,positionId,accountId:position.accountId,documentId,text:block.text});events.push(...parsed.events);if(!parsed.events.length)issues.push({id:`issue-${documentId}-${block.index}`,projectId,documentId,positionId,severity:'REVIEW',title:'Bloco Inter sem eventos',details:'O produto foi identificado, mas o bloco não apresentou linhas reconhecíveis.',status:'OPEN'});
  }
  return {positions,events,evidences:[],issues,reportedTotals:[],warnings:[],accounts:info.account?[{id:`account-${projectId}-inter-${stableId([info.agency,info.account])}`,projectId,bankId:bank.id,agency:info.agency,accountNumber:info.account,name:`Inter ${info.agency}/${info.account}`}]:[],templateId:'INTER_EXAMPLE'};
}

function bbIncomeReport(context) {
  const {text}=context;
  // BBINF01: "Demonstrativo de Rendimentos Financeiros IRPJ" do fundo — total trimestral de controle, não aplicação.
  const fundCnpj=(text.match(/CNPJ\.{2,}\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2})/i)?.[1]||'').replace(/\D/g,'');
  const fundName=text.match(/Especifica(?:ç|c)[aã]o\s*\n\s*([^\n]+)/i)?.[1]?.trim()||null;
  const reportedTotals=extractIncomeReportTotals({...context,bank:{id:'bb',name:'Banco do Brasil'}}).map(total=>({...total,category:'QUOTA_FUND',fundCnpj:fundCnpj||null,fundName}));
  const warnings=reportedTotals.some(total=>!total.quarter)?['Trimestre do informe BB não identificado: confira o período antes de conciliar.']:[];
  return {positions:[],events:[],evidences:[],issues:[],reportedTotals,warnings,accounts:[],templateId:'BB_INCOME_REPORT',documentOverrides:{bankName:'Banco do Brasil'}};
}

function bbTemplate(context) {
  const {projectId,documentId,text}=context;
  if(context.classification?.kind===DOCUMENT_KINDS.INCOME_REPORT)return bbIncomeReport(context);
  const bank={id:'bb',name:'Banco do Brasil'};
  const info=accountInfo(text);
  const productMatch=text.match(/^([^\n]+?)\s*-\s*CNPJ\s*:\s*(\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2})/mi);
  const product=(productMatch?.[1]||text.match(/^(BB[^\n]+?)(?:\s+-\s+CNPJ|\n)/mi)?.[1]||'Fundo de investimento BB').trim();
  const fundCnpj=productMatch?.[2]?.replace(/\D/g,'')||'';
  const lot=text.match(/Aplica(?:ç|c)ão\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1];
  // OPENDATE01: sem lote no extrato, usa o início do período do documento (SALDO ANTERIOR / 1ª data), nunca a data de hoje.
  const periodDate=text.match(/(\d{2}\/\d{2}\/\d{4})\s+SALDO\s+ANTERIOR/i)?.[1]||text.match(/^\s*(\d{2}\/\d{2}\/\d{4})\s+\S/m)?.[1];
  const openedAt=dateToIso(lot)||dateToIso(periodDate)||new Date().toISOString().slice(0,10);
  const accountId=info.account?`account-${projectId}-bb-${stableId([info.agency,info.account])}`:'unknown';
  // Extratos mensais podem iniciar por lotes históricos distintos. A identidade da
  // posição deve ser estável por conta + fundo, não pela primeira linha de lote do mês.
  const positionIdentity=fundCnpj||product;
  const positionId=`position-${projectId}-${stableId(['bb',accountId,positionIdentity])}`;
  const position={id:positionId,projectId,bankId:bank.id,accountId,name:product,externalReference:fundCnpj||positionIdentity,productFamily:PRODUCT_FAMILIES.QUOTA_FUND,openedAt,originalPrincipalCents:null,status:POSITION_STATUS.REQUIRES_REVIEW,realizedIncomeStatus:EVIDENCE_STATUS.PENDING,metadata:{template:'BB_EXAMPLE',sourceLotDate:openedAt,sourceDocumentId:documentId,fundCnpj:fundCnpj||null,openedAtDocumented:false}};
  validatePosition(position);
  const parsed=bancoDoBrasilAdapter.parseNormalizedText({projectId,positionId,accountId,documentId,text});
  const issues=[];
  if(parsed.events.some(e=>e.type==='REDEMPTION'))issues.push({id:`issue-${documentId}-cost`,projectId,documentId,positionId,severity:'REVIEW',title:'Custo histórico do fundo necessário',details:'O resgate e o IR foram extraídos, mas o rendimento fiscal realizado exige o custo histórico do lote ou informe fiscal equivalente.',status:'OPEN'});
  return {positions:[position],events:parsed.events,evidences:[],issues,reportedTotals:[],warnings:parsed.warnings,accounts:info.account?[{id:accountId,projectId,bankId:bank.id,agency:info.agency,accountNumber:info.account,name:`BB ${info.agency}/${info.account}`}]:[],templateId:'BB_EXAMPLE',documentOverrides:{bankName:'Banco do Brasil',kind:DOCUMENT_KINDS.QUOTA_FUND_STATEMENT}};
}

const adapterTemplate = (id, description, priority, adapter) => ({id, description, priority, matches:context=>adapter.canHandle({bankId:context.bank.id,text:context.text}), process:context=>adapter.parseNormalizedText({...context,bankId:context.bank.id})});

const documentTemplates = [
  {id:'INTER_EXAMPLE', description:'Banco Inter reference model', priority:100, matches:context=>context.bank.id==='inter', process:interTemplate},
  {id:'BB_EXAMPLE', description:'Banco do Brasil reference model', priority:100, matches:context=>bancoDoBrasilAdapter.canHandle({bankId:context.bank.id,text:context.text}), process:bbTemplate},
  adapterTemplate('SICREDI_TERM_DEPOSIT','Sicredi term deposit statement',95,sicrediAdapter),
  adapterTemplate('ITAU_MONTHLY_SUMMARY','Itau monthly investment summary',95,itauSummaryAdapter),
  adapterTemplate('CAIXA_FUND_STATEMENT','Caixa quota fund statement',95,caixaFundAdapter),
  adapterTemplate('SICOOB_RDC_STATEMENT','Sicoob RDC statement',95,sicoobRdcAdapter),
  adapterTemplate('BANRISUL_CDB_AUTOMATIC_MONTHLY','Banrisul CDB automatic monthly',95,banrisulCdbAdapter),
];

export function registerDocumentTemplate(template) {
  if (!template || typeof template.id !== 'string' || typeof template.matches !== 'function' || typeof template.process !== 'function') {
    throw new TypeError('Template inválido: id, matches e process são obrigatórios.');
  }
  const existing = documentTemplates.findIndex(item => item.id === template.id);
  const normalized = {...template, priority:Number(template.priority)||0};
  if (existing >= 0) documentTemplates.splice(existing, 1, normalized);
  else documentTemplates.push(normalized);
  documentTemplates.sort((a,b)=>b.priority-a.priority || a.id.localeCompare(b.id));
  return normalized.id;
}

export function listDocumentTemplates(customTemplates = []) {
  const builtIn = documentTemplates.map(({id,description='',priority=0})=>({id,description,priority,type:'BUILT_IN'}));
  const custom = (customTemplates || []).map(item=>{const value=normalizeCustomTemplate(item);return {id:value.id,familyId:value.familyId,name:value.name,description:value.description,priority:value.priority,version:value.version,status:value.status,type:'CUSTOM'};});
  return [...builtIn,...custom].sort((a,b)=>(b.priority||0)-(a.priority||0)||String(a.id).localeCompare(String(b.id)));
}

export function processByTemplate(context, customTemplates = []) {
  if (context.forcedTemplateId) {
    const customTemplate = (customTemplates || []).map(normalizeCustomTemplate).find(item=>item.id===context.forcedTemplateId);
    if (customTemplate) {
      const result = applyCustomTemplate(context,{...customTemplate,status:'ACTIVE'});
      if (!result) throw new Error(`O template ${context.forcedTemplateId} não corresponde ao documento.`);
      return result;
    }
    const builtIn = documentTemplates.find(item=>item.id===context.forcedTemplateId);
    if (builtIn) return builtIn.process(context);
    throw new Error(`Template solicitado não encontrado: ${context.forcedTemplateId}`);
  }
  const custom = applyFirstCustomTemplate(context, customTemplates);
  if (custom) return custom;
  const template = documentTemplates.find(item => item.matches(context));
  if (template) return template.process(context);
  if(context.classification.kind===DOCUMENT_KINDS.INCOME_REPORT)return {positions:[],events:[],evidences:[],issues:[],reportedTotals:extractIncomeReportTotals(context),warnings:['Informe processado por estrutura genérica e sujeito à conferência.'],templateId:'GENERIC_INCOME_REPORT'};
  return parseGenericInvestmentDocument(context);
}
