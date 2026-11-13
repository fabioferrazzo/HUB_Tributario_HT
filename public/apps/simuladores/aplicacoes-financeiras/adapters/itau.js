import { EVENT_TYPES } from '../domain/model.js';
import {
  PRODUCT_FAMILIES, accountRecord, eventBase, lineList, monthReferenceToDate, moneyToCents,
  normalizeForSearch, parseMoneyList, positionRecord
} from './layout-common.js';

function rowValues(text, label) {
  const line = lineList(text).find(item => normalizeForSearch(item).toUpperCase().startsWith(label));
  if (!line) return null;
  const values = parseMoneyList(line);
  return values.length >= 8 ? values.slice(-8) : null;
}

export const itauSummaryAdapter = {
  id:'itau-monthly-summary',
  canHandle({bankId,text=''}) {
    const value=normalizeForSearch(text).toUpperCase();
    return bankId==="itau" && /DADOS DO RESUMO/.test(value) && /APURADO NO/.test(value) && /RESGATES/.test(value);
  },
  parseNormalizedText({projectId,documentId,text,bankId='itau'}) {
    const value=normalizeForSearch(text);
    const agency=value.match(/AGENCIA\s*:\s*([\dX.-]+)/i)?.[1]||'';
    const accountNumber=value.match(/CONTA\s*:\s*([\dX.-]+)/i)?.[1]||'';
    const period=value.match(/PERIODO\s*:\s*([A-Z]+)\s*\/\s*(\d{4})/i);
    const periodEnd=period ? monthReferenceToDate(period[1],period[2]) : null;
    const account=accountRecord({projectId,bankId,agency,account:accountNumber,label:`Itau ${agency}/${accountNumber}`});
    if (!periodEnd) return {positions:[],accounts:account.record?[account.record]:[],events:[],issues:[{id:`issue-${documentId}-itau-period`,projectId,documentId,severity:'REVIEW',title:'Periodo mensal Itau nao localizado',details:'O layout foi reconhecido, mas o mes/ano do resumo nao foi identificado.',status:'OPEN'}],reportedTotals:[],warnings:[],templateId:'ITAU_MONTHLY_SUMMARY'};
    const principal=rowValues(value,'PRINCIPAL');
    const gross=rowValues(value,'BRUTO');
    const net=rowValues(value,'LIQUIDO');
    if (!principal || !gross || !net) return {positions:[],accounts:account.record?[account.record]:[],events:[],issues:[{id:`issue-${documentId}-itau-rows`,projectId,documentId,severity:'REVIEW',title:'Linhas Principal/Bruto/Liquido incompletas',details:'O resumo mensal nao apresentou as tres linhas estruturais esperadas.',status:'OPEN'}],reportedTotals:[],warnings:[],templateId:'ITAU_MONTHLY_SUMMARY'};
    const position=positionRecord({projectId,bankId,accountId:account.id,name:'Resumo mensal de aplicacoes - Itau',openedAt:periodEnd,principalCents:null,family:PRODUCT_FAMILIES.FIXED_INCOME_SECURITY,externalReference:`ITAU-SUMMARY-${periodEnd.slice(0,7)}`,metadata:{template:'ITAU_MONTHLY_SUMMARY',aggregateSummary:true,openedAtDocumented:false,dateGranularity:'MONTH'}});
    const args={projectId,position,bankId,accountId:account.id,documentId};
    const events=[];
    const [openPrincipal,applications,,principalRedemption,closePrincipal]=principal;
    const [, ,periodIncome,grossRedemption,,realizedIncome,iof,irrf]=gross;
    const [, , ,netRedemption,netClosing]=net;
    if (applications) events.push(eventBase({...args,type:EVENT_TYPES.APPLICATION,date:periodEnd,amountCents:applications,suffix:'application',notes:'Aplicacoes agregadas do mes; o documento nao informa as datas individuais.',metadata:{dateGranularity:'MONTH'}}));
    if (netRedemption || grossRedemption || principalRedemption) events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION,date:periodEnd,amountCents:netRedemption,suffix:'redemption',netAmountCents:netRedemption,grossAmountCents:grossRedemption,notes:'Resgate mensal agregado. Data operacional individual nao consta no resumo.',metadata:{dateGranularity:'MONTH'}}));
    if (principalRedemption) events.push(eventBase({...args,type:EVENT_TYPES.PRINCIPAL_RECOVERY,date:periodEnd,amountCents:principalRedemption,suffix:'principal-recovery',notes:'Principal recuperado informado na linha Principal.',metadata:{dateGranularity:'MONTH'}}));
    if (realizedIncome) events.push(eventBase({...args,type:EVENT_TYPES.REALIZED_INCOME,date:periodEnd,amountCents:realizedIncome,suffix:'realized-income',notes:'Rendimento pago no mes conforme linha Bruto.',metadata:{dateGranularity:'MONTH'}}));
    if (periodIncome) events.push(eventBase({...args,type:EVENT_TYPES.PERIOD_INCOME,date:periodEnd,amountCents:periodIncome,suffix:'period-income',notes:'Rendimento apurado no mes; inclui operacoes resgatadas e saldo remanescente.',metadata:{dateGranularity:'MONTH'}}));
    if (iof) events.push(eventBase({...args,type:EVENT_TYPES.IOF,date:periodEnd,amountCents:iof,suffix:'iof',notes:'IOF pago no mes.',metadata:{dateGranularity:'MONTH'}}));
    if (irrf) events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION_IRRF,date:periodEnd,amountCents:irrf,suffix:'irrf',notes:'IR pago no mes.',metadata:{dateGranularity:'MONTH'}}));
    events.push(eventBase({...args,type:EVENT_TYPES.BALANCE_SNAPSHOT,date:periodEnd,amountCents:gross[4]||netClosing||closePrincipal,suffix:'balance',notes:'Saldo final bruto do resumo mensal.',metadata:{dateGranularity:'MONTH',principalBalanceCents:closePrincipal,netBalanceCents:netClosing,openingPrincipalCents:openPrincipal}}));
    return {positions:[position],accounts:account.record?[account.record]:[],events,evidences:[],issues:[{id:`issue-${documentId}-itau-aggregate`,projectId,documentId,positionId:position.id,severity:'INFO',title:'Resumo mensal agregado',details:'Datas individuais das aplicacoes e resgates nao constam no arquivo; os eventos usam o fim do periodo apenas como data de referencia.',status:'OPEN'}],reportedTotals:[],warnings:[],templateId:'ITAU_MONTHLY_SUMMARY'};
  }
};
