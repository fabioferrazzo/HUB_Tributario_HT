import { EVENT_TYPES } from '../domain/model.js';
import {
  EVIDENCE_STATUS, PRODUCT_FAMILIES, accountRecord, dateToIso, eventBase, lineList,
  moneyToCents, normalizeForSearch, positionRecord
} from './layout-common.js';

export const sicoobRdcAdapter = {
  id:'sicoob-rdc-statement',
  canHandle({bankId,text=''}) {
    const value=normalizeForSearch(text).toUpperCase();
    return bankId==='sicoob' && /EXTRATO DE APLICACOES/.test(value) && /MODALIDADE\s*:\s*RDC\b/.test(value) && /HISTORICO DE MOVIMENTACAO/.test(value);
  },
  parseNormalizedText({projectId,documentId,text,bankId='sicoob'}) {
    const value=normalizeForSearch(text);
    const accountNumber=value.match(/CONTA\s*:\s*([\d.-]+)/i)?.[1]||'';
    const appNo=value.match(/NUMERO DA APLICACAO\s*:\s*([\d.-]+)/i)?.[1]||'';
    const principal=moneyToCents(value.match(/VALOR INICIAL\s*:\s*R?\$?\s*([\d.]+,\d{2})/i)?.[1]||'0');
    const openedAt=dateToIso(value.match(/DATA DA APLICACAO\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]);
    const modality=value.match(/MODALIDADE\s*:\s*([^\n]+)/i)?.[1]?.trim()||'RDC Flexivel';
    const account=accountRecord({projectId,bankId,account:accountNumber,label:`Sicoob ${accountNumber}`});
    if (!openedAt) return {positions:[],accounts:account.record?[account.record]:[],events:[],issues:[{id:`issue-${documentId}-sicoob-date`,projectId,documentId,severity:'REVIEW',title:'Data da aplicacao Sicoob nao localizada',details:'O layout RDC foi reconhecido, mas a data original nao foi extraida.',status:'OPEN'}],reportedTotals:[],warnings:[],templateId:'SICOOB_RDC_STATEMENT'};
    const position=positionRecord({projectId,bankId,accountId:account.id,name:modality,openedAt,principalCents:principal||null,family:PRODUCT_FAMILIES.FIXED_INCOME_SECURITY,externalReference:appNo||openedAt,metadata:{template:'SICOOB_RDC_STATEMENT',applicationNumber:appNo}});
    position.maturityDate=dateToIso(value.match(/DATA CARENCIA\/VENC\.?\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1])||null;
    const args={projectId,position,bankId,accountId:account.id,documentId};
    const groups=new Map();
    function group(date){ if(!groups.has(date))groups.set(date,{date,income:0,redemption:0,irrf:0,application:0,balance:null}); return groups.get(date); }
    for (const line of lineList(value)) {
      const row=line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(APLICACAO FINANCEIRA|CAPITALIZACAO DE CORRECAO MONETARIA|RESGATE DE APLICACAO FINANCEIRA|RETENCAO DE IRRF)\s+([\d.]+,\d{2})[CD]?\s+([\d.]+,\d{2})?/i);
      if (!row) continue;
      const date=dateToIso(row[1]); const item=group(date); const amount=moneyToCents(row[3]); const label=row[2].toUpperCase();
      if (label==='APLICACAO FINANCEIRA') item.application=amount;
      if (label==='CAPITALIZACAO DE CORRECAO MONETARIA') item.income=amount;
      if (label==='RESGATE DE APLICACAO FINANCEIRA') item.redemption=amount;
      if (label==='RETENCAO DE IRRF') item.irrf=amount;
      if (row[4]) item.balance=moneyToCents(row[4]);
    }
    const events=[];
    for (const item of [...groups.values()].sort((a,b)=>a.date.localeCompare(b.date))) {
      const tag=item.date;
      if (item.application) events.push(eventBase({...args,type:EVENT_TYPES.APPLICATION,date:item.date,amountCents:item.application,suffix:`application-${tag}`,notes:'Aplicacao financeira documentada no historico Sicoob.'}));
      if (item.redemption) {
        const gross=item.redemption+item.irrf; const principalRecovered=Math.max(0,gross-item.income);
        events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION,date:item.date,amountCents:item.redemption,suffix:`redemption-${tag}`,netAmountCents:item.redemption,grossAmountCents:gross,notes:'Resgate creditado, com IRRF debitado separadamente no extrato Sicoob.'}));
        if (item.income) events.push(eventBase({...args,type:EVENT_TYPES.REALIZED_INCOME,date:item.date,amountCents:item.income,suffix:`income-${tag}`,notes:'Capitalizacao de correcao monetaria vinculada ao resgate da mesma data.'}));
        if (item.irrf) events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION_IRRF,date:item.date,amountCents:item.irrf,suffix:`irrf-${tag}`,notes:'Retencao de IRRF vinculada ao resgate da mesma data.'}));
        if (principalRecovered) events.push(eventBase({...args,type:EVENT_TYPES.PRINCIPAL_RECOVERY,date:item.date,amountCents:principalRecovered,suffix:`principal-${tag}`,notes:'Principal recuperado reconstruido por resgate + IRRF - rendimento realizado.',evidenceStatus:EVIDENCE_STATUS.RECONCILED}));
      }
    }
    const summaryDate=dateToIso(value.match(/SALDO DISPONIVEL EM\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]) || [...groups.keys()].sort().at(-1) || openedAt;
    const forecastIncome=moneyToCents(value.match(/RENDIMENTOS BRUTOS PREVISTOS \(\+\)\s*:\s*([\d.]+,\d{2})/i)?.[1]||'0');
    const forecastIr=moneyToCents(value.match(/IR PREVISTO \(-\)\s*:\s*([\d.]+,\d{2})/i)?.[1]||'0');
    const available=moneyToCents(value.match(/SALDO DISPONIVEL EM\s*\d{2}\/\d{2}\/\d{4}\s*:\s*([\d.]+,\d{2})/i)?.[1]||'0');
    if (forecastIncome) events.push(eventBase({...args,type:EVENT_TYPES.UNREALIZED_INCOME,date:summaryDate,amountCents:forecastIncome,suffix:'forecast-income',evidenceStatus:EVIDENCE_STATUS.ESTIMATED,notes:'Rendimentos brutos previstos; nao realizados.'}));
    if (forecastIr) events.push(eventBase({...args,type:EVENT_TYPES.TAX_FORECAST,date:summaryDate,amountCents:forecastIr,suffix:'forecast-ir',evidenceStatus:EVIDENCE_STATUS.ESTIMATED,notes:'IR previsto informado pelo Sicoob.',metadata:{taxKind:'IRRF'}}));
    if (available) events.push(eventBase({...args,type:EVENT_TYPES.BALANCE_SNAPSHOT,date:summaryDate,amountCents:available,suffix:'balance-available',notes:'Saldo disponivel informado no resumo do extrato.'}));
    const expectedIncome=moneyToCents(value.match(/CM PAGO\s*:\s*([\d.]+,\d{2})/i)?.[1]||'0');
    const expectedIr=moneyToCents(value.match(/IR RETIDO\s*:\s*([\d.]+,\d{2})/i)?.[1]||'0');
    const actualIncome=[...groups.values()].reduce((s,x)=>s+x.income,0); const actualIr=[...groups.values()].reduce((s,x)=>s+x.irrf,0);
    const issues=[];
    // Resgates antigos consolidados pelo Sicoob em uma única linha: não há data nem IRRF por resgate.
    const priorDebits=value.match(/^\s*(\d{2}\/\d{2}\/\d{4})\s+DEBITOS ATE ULTIMA VALORIZACAO\s+([\d.]+,\d{2})/im);
    if (priorDebits) issues.push({id:`issue-${documentId}-sicoob-prior-debits`,projectId,documentId,positionId:position.id,severity:'REVIEW',title:'Resgates anteriores consolidados pelo Sicoob',details:`Debitos ate a ultima valorizacao de R$ ${priorDebits[2]} sem detalhamento por data, rendimento e IRRF. Solicite o extrato completo se houver resgate no periodo apurado.`,status:'OPEN'});
    if (expectedIncome && expectedIncome!==actualIncome) issues.push({id:`issue-${documentId}-sicoob-income`,projectId,documentId,positionId:position.id,severity:'BLOCKING',title:'Total de CM pago divergente',details:`Detalhamento ${actualIncome}; resumo ${expectedIncome}.`,status:'OPEN'});
    if (expectedIr && expectedIr!==actualIr) issues.push({id:`issue-${documentId}-sicoob-ir`,projectId,documentId,positionId:position.id,severity:'BLOCKING',title:'Total de IR retido divergente',details:`Detalhamento ${actualIr}; resumo ${expectedIr}.`,status:'OPEN'});
    return {positions:[position],accounts:account.record?[account.record]:[],events,evidences:[],issues,reportedTotals:[],warnings:[],templateId:'SICOOB_RDC_STATEMENT'};
  }
};
