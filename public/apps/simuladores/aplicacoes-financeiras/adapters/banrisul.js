import { EVENT_TYPES } from '../domain/model.js';
import {
  EVIDENCE_STATUS, PRODUCT_FAMILIES, accountRecord, dateToIso, eventBase, moneyToCents,
  normalizeForSearch, positionRecord
} from './layout-common.js';

function fieldMoney(line, startMin, startMax=9999) {
  const matches=[...String(line||'').matchAll(/[\d.]+,\d{2}/g)];
  const item=matches.find(match => (match.index||0)>=startMin && (match.index||0)<startMax);
  return item ? moneyToCents(item[0]) : 0;
}
function allDates(line) { return [...String(line||'').matchAll(/\d{2}\/\d{2}\/\d{4}/g)].map(match=>({value:match[0],index:match.index||0})); }
function labelAt(line) { return String(line||'').slice(108,140).replace(/[^A-Za-z]/g,'').toUpperCase(); }

// Colunas de valores (alinhadas à direita): ponto final do rótulo no cabeçalho.
const COLUMN_ORDER=['value','income','iof','ir','net','final'];
function detectColumns(lines) {
  const index=lines.findIndex(line=>/Rendimento Bruto/i.test(line) && /\bIOF\b/.test(line));
  if (index<0) return null;
  const header=lines[index]; const history=header.search(/Hist[oó]rico/i);
  const endOf=(regex,from=0)=>{const match=header.slice(from).match(regex);return match?from+(match.index||0)+match[0].length:null;};
  const finalLine=lines.slice(Math.max(0,index-3),index+2).find(line=>/Posi(?:ç|c)(?:ã|a)o Final/i.test(line));
  const finalMatch=finalLine?.match(/Posi(?:ç|c)(?:ã|a)o Final/i);
  const columns={value:endOf(/\bValor\b(?!\s+L)/,Math.max(0,history)),income:endOf(/Rendimento Bruto/i),iof:endOf(/\bIOF\b/),ir:endOf(/\bIR\b/),net:endOf(/Valor L(?:í|i)quido/i),final:finalMatch?(finalMatch.index||0)+finalMatch[0].length:null};
  return COLUMN_ORDER.every(key=>columns[key]!=null)?columns:null;
}
function columnAssigner(columns, ends) {
  if (columns) {
    // Agrupa os finais de valor observados; com um grupo por coluna o mapeamento é ordinal (robusto a deslocamentos).
    const clusters=[]; for (const end of [...new Set(ends)].sort((a,b)=>a-b)) { const last=clusters.at(-1); if (last && end-last.max<=3) last.max=end; else clusters.push({min:end,max:end}); }
    const nearest=end=>COLUMN_ORDER.reduce((best,key)=>Math.abs(columns[key]-end)<Math.abs(columns[best]-end)?key:best,COLUMN_ORDER[0]);
    const clusterKey=end=>{const at=clusters.findIndex(item=>end>=item.min&&end<=item.max);return clusters.length===COLUMN_ORDER.length&&at>=0?COLUMN_ORDER[at]:nearest(end);};
    return tokens=>Object.fromEntries(tokens.map(token=>[clusterKey(token.end),token.cents]));
  }
  // Sem cabeçalho posicional: ordem dos valores + equação líquido = valor + rendimento - IOF - IR.
  return (tokens,label)=>{
    const values=tokens.map(token=>token.cents); const last=label==='SLDATUAL'?'final':'net';
    if (values.length<=1) return {value:values[0]||0};
    if (values.length===2) return {value:values[0],[last]:values[1]};
    if (values.length===3) return {value:values[0],income:values[1],[last]:values[2]};
    if (values.length===4) return {value:values[0],income:values[1],ir:values[2],[last]:values[3]};
    return {value:values[0],income:values[1],iof:values[2],ir:values[3],[last]:values.at(-1)};
  };
}

export const banrisulCdbAdapter = {
  id:'banrisul-cdb-automatic-monthly',
  canHandle({bankId,text=''}) {
    const value=normalizeForSearch(text).toUpperCase();
    return bankId==='banrisul' && /DEMONSTRATIVO DE MOVIMENTACAO/.test(value) && /CDB AUTOMATICO/.test(value) && /IDENTIFICACAO DAS OPERACOES/.test(value);
  },
  parseNormalizedText({projectId,documentId,text,pages=[],bankId='banrisul'}) {
    const value=normalizeForSearch(text);
    const accountPair=value.match(/\b(\d{4})\s*-\s*[A-Z ]+\s+(\d{2}\.\d{6}\.\d-\d)\b/i);
    const agency=accountPair?.[1]||"";
    const accountNumber=accountPair?.[2]||"";
    const account=accountRecord({projectId,bankId,agency,account:accountNumber,label:`Banrisul ${agency}/${accountNumber}`});
    const period=value.match(/PERIODO DE REFERENCIA\s*:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/i);
    const periodStart=period?dateToIso(period[1]):null;
    const positions=[]; const events=[]; const issues=[]; let current=null; let posIndex=0;
    // BANRCOL01: o texto do pipeline é normalizado (espaços colapsados). As posições de coluna só existem no texto
    // de página (pdftotext -layout); quando disponível, as colunas são detectadas pelo cabeçalho do próprio documento.
    const layoutText=(pages||[]).map(page=>page?.text||'').join('\n');
    const sourceText=/Rendimento Bruto/i.test(layoutText)?layoutText:String(text||'');
    const rawLines=sourceText.replace(/\r\n?/g,'\n').split('\n');
    const columns=detectColumns(rawLines);
    const rows=[];
    for (const line of rawLines) {
      const dates=allDates(line);
      const lotLine=dates.length>=3 && dates[0].index<20;
      if (lotLine) {
        const appDate=dateToIso(dates[0].value); const initial=moneyToCents(line.slice(dates[0].index+10).match(/[\d.]+,\d{2}/)?.[0]||'')||null; posIndex+=1;
        current=positionRecord({projectId,bankId,accountId:account.id,name:`CDB Automatico - lote ${appDate}`,openedAt:appDate,principalCents:initial,family:PRODUCT_FAMILIES.AUTOMATIC_CASH,externalReference:`BANRISUL-${appDate}-${posIndex}`,metadata:{template:'BANRISUL_CDB_AUTOMATIC_MONTHLY',lotIndex:posIndex}});
        current.maturityDate=dateToIso(dates[1].value)||null;
        positions.push(current);
      }
      if (!current) continue;
      const txDateRec=lotLine?dates[2]:(dates.length===1?dates[0]:null);
      if (!txDateRec) continue;
      const tail=line.slice(txDateRec.index+10);
      const label=(tail.match(/^[^\d]*/)?.[0]||'').replace(/[^A-Za-z]/g,'').toUpperCase();
      if (!/^(APLICACAO|RESGANTE|RESGATE|SLDATUAL|SLDANTER)$/.test(label)) continue;
      const tokens=[...line.matchAll(/[\d.]+,\d{2}/g)].filter(match=>(match.index||0)>txDateRec.index).map(match=>({cents:moneyToCents(match[0]),end:(match.index||0)+match[0].length}));
      rows.push({position:current,posIndex,txDate:dateToIso(txDateRec.value),label,tokens});
    }
    const assign=columnAssigner(columns,rows.flatMap(row=>row.tokens.map(token=>token.end)));
    for (const row of rows) {
      const {label,txDate}=row; const fields=assign(row.tokens,label);
      const principalOrValue=fields.value||0; const income=fields.income||0; const iof=fields.iof||0; const ir=fields.ir||0; const net=fields.net||0; const finalPos=fields.final||0;
      const args={projectId,position:row.position,bankId,accountId:account.id,documentId}; const suffix=`${row.posIndex}-${txDate}-${events.length+1}`;
      if (label==='APLICACAO') events.push(eventBase({...args,type:EVENT_TYPES.APPLICATION,date:txDate,amountCents:principalOrValue,suffix:`application-${suffix}`,notes:'Aplicacao do lote CDB Automatico Banrisul.'}));
      else if (label==='RESGATE' || label==='RESGANTE') {
        const gross=principalOrValue+income; const netValue=net || Math.max(0,gross-iof-ir);
        if (net && Math.abs(gross-iof-ir-net)>1) issues.push({id:`issue-${documentId}-banrisul-row-${suffix}`,projectId,documentId,positionId:row.position.id,severity:'REVIEW',title:'Resgate Banrisul com colunas a conferir',details:`Em ${txDate}: valor ${principalOrValue} + rendimento ${income} - IOF ${iof} - IR ${ir} difere do liquido ${net}.`,status:'OPEN'});
        events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION,date:txDate,amountCents:netValue,suffix:`redemption-${suffix}`,netAmountCents:netValue,grossAmountCents:gross,notes:'Resgate Banrisul: principal + rendimento bruto - IOF - IR.'}));
        if (principalOrValue) events.push(eventBase({...args,type:EVENT_TYPES.PRINCIPAL_RECOVERY,date:txDate,amountCents:principalOrValue,suffix:`principal-${suffix}`,notes:'Principal recuperado informado na coluna Valor.'}));
        if (income) events.push(eventBase({...args,type:EVENT_TYPES.REALIZED_INCOME,date:txDate,amountCents:income,suffix:`income-${suffix}`,notes:'Rendimento bruto realizado informado no demonstrativo.'}));
        if (iof) events.push(eventBase({...args,type:EVENT_TYPES.IOF,date:txDate,amountCents:iof,suffix:`iof-${suffix}`,notes:'IOF do resgate informado no demonstrativo.'}));
        if (ir) events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION_IRRF,date:txDate,amountCents:ir,suffix:`ir-${suffix}`,notes:'IR do resgate informado no demonstrativo.'}));
      } else if (label==='SLDATUAL') {
        const calc=Math.max(0,principalOrValue+income-iof-ir); const balance=finalPos||net||calc;
        if (balance) events.push(eventBase({...args,type:EVENT_TYPES.BALANCE_SNAPSHOT,date:txDate,amountCents:balance,suffix:`balance-${suffix}`,notes:'Posicao final liquida do lote Banrisul.',metadata:{principalBalanceCents:principalOrValue,grossIncomeCents:income}}));
        if (income) events.push(eventBase({...args,type:EVENT_TYPES.UNREALIZED_INCOME,date:txDate,amountCents:income,suffix:`unrealized-${suffix}`,notes:'Rendimento bruto da posicao ainda ativa.'}));
        if (iof) events.push(eventBase({...args,type:EVENT_TYPES.TAX_FORECAST,date:txDate,amountCents:iof,suffix:`forecast-iof-${suffix}`,evidenceStatus:EVIDENCE_STATUS.ESTIMATED,notes:'IOF estimado na posicao ativa.',metadata:{taxKind:'IOF'}}));
        if (ir) events.push(eventBase({...args,type:EVENT_TYPES.TAX_FORECAST,date:txDate,amountCents:ir,suffix:`forecast-ir-${suffix}`,evidenceStatus:EVIDENCE_STATUS.ESTIMATED,notes:'IR estimado na posicao ativa.',metadata:{taxKind:'IRRF'}}));
      }
    }    const summary=value.match(/SOMATORIO DAS OPERACOES RESGATADAS NO MES\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})/i);
    if (summary) {
      const expected={principal:moneyToCents(summary[1]),income:moneyToCents(summary[2]),iof:moneyToCents(summary[3]),ir:moneyToCents(summary[4]),net:moneyToCents(summary[5])};
      const sum=type=>events.filter(e=>e.type===type).reduce((s,e)=>s+e.amountCents,0);
      const actual={principal:sum(EVENT_TYPES.PRINCIPAL_RECOVERY),income:sum(EVENT_TYPES.REALIZED_INCOME),iof:sum(EVENT_TYPES.IOF),ir:sum(EVENT_TYPES.REDEMPTION_IRRF),net:sum(EVENT_TYPES.REDEMPTION)};
      for (const key of Object.keys(expected)) if (expected[key]!==actual[key]) issues.push({id:`issue-${documentId}-banrisul-${key}`,projectId,documentId,severity:'BLOCKING',title:`Somatorio Banrisul divergente: ${key}`,details:`Detalhamento ${actual[key]}; resumo ${expected[key]}.`,status:'OPEN'});
    }
    if (!positions.length) issues.push({id:`issue-${documentId}-banrisul-positions`,projectId,documentId,severity:'REVIEW',title:'Lotes Banrisul nao localizados',details:'O demonstrativo foi reconhecido, mas os lotes nao foram estruturados.',status:'OPEN'});
    return {positions,accounts:account.record?[account.record]:[],events,evidences:[],issues,reportedTotals:[],warnings:periodStart?[]:['Periodo de referencia nao identificado.'],templateId:'BANRISUL_CDB_AUTOMATIC_MONTHLY'};
  }
};
