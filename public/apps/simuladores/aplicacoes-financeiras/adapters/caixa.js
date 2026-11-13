import { EVENT_TYPES } from '../domain/model.js';
import {
  PRODUCT_FAMILIES, accountRecord, ddmmToIso, eventBase, inferYearFromPeriod, lineList,
  moneyToCents, normalizeForSearch, positionRecord
} from './layout-common.js';

function decimalPt(value) {
  const text=String(value||'').replace(/\./g,'').replace(',','.');
  const n=Number(text); return Number.isFinite(n)?n:null;
}

export const caixaFundAdapter = {
  id:'caixa-fund-statement',
  canHandle({bankId,text=''}) {
    const value=normalizeForSearch(text).toUpperCase();
    return bankId==='caixa' && /MOVIMENTACAO DETALHADA/.test(value) && /CNPJ DO FUNDO/.test(value) && /QTDE DE COTAS/.test(value);
  },
  parseNormalizedText({projectId,documentId,text,bankId='caixa'}) {
    const value=normalizeForSearch(text);
    const year=inferYearFromPeriod(value);
    const periodMatch=value.match(/PERIODO\s+(\d{2}\/\d{2}\/\d{4})\s+A\s+(\d{2}\/\d{2}\/\d{4})/i);
    const periodStart=periodMatch?`${periodMatch[1].slice(6,10)}-${periodMatch[1].slice(3,5)}-${periodMatch[1].slice(0,2)}`:`${year}-01-01`;
    const accountNumber=value.match(/CONTA\s+([\d.\/-]+)/i)?.[1]||'';
    const account=accountRecord({projectId,bankId,account:accountNumber,label:`Caixa ${accountNumber}`});
    const funds=new Map(); let current=null; let pending=null;

    function ensureFund(code,name,cnpj) {
      const key=cnpj||code;
      if (!funds.has(key)) funds.set(key,{code,name,cnpj,rows:[],redemptions:[]});
      return funds.get(key);
    }
    function flushPending() { if (pending && current) current.redemptions.push(pending); pending=null; }

    for (const raw of lineList(value)) {
      const line=normalizeForSearch(raw);
      const header=line.match(/^(\d{4})\s+(CAIXA\s+.+?)\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/i);
      if (header) { const next=ensureFund(header[1],header[2].trim(),header[3]); if (current && current!==next) flushPending(); current=next; continue; }
      if (!current) continue;
      const dated=line.match(/^(\d{2}\/\d{2})\s+(SALDO INICIAL|SALDO FINAL|APLICACAO|RESGATE AUT)\s+([\d.]+,\d{2})[CD]?\s*([\d.]+,\d+)?$/i);
      if (dated) {
        flushPending();
        const date=ddmmToIso(dated[1],year); const label=dated[2].toUpperCase(); const amount=moneyToCents(dated[3]); const quota=decimalPt(dated[4]);
        if (label==='RESGATE AUT') pending={date,grossCents:amount,quota,irrfCents:0,iofCents:0,incomeCents:0,taxableIncomeCents:0};
        else current.rows.push({date,label,amountCents:amount,quota});
        continue;
      }
      if (pending) {
        const extra=line.match(/^(IRRF|IOF|RENDIMENTO BASE TRIB\.|RENDIMENTO)\s+([\d.]+,\d{2})[CD]?$/i);
        if (extra) {
          const label=extra[1].toUpperCase(); const amount=moneyToCents(extra[2]);
          if (label==='IRRF') pending.irrfCents=amount;
          else if (label==='IOF') pending.iofCents=amount;
          else if (label==='RENDIMENTO') pending.incomeCents=amount;
          else pending.taxableIncomeCents=amount;
        }
      }
    }
    flushPending();

    const positions=[]; const events=[]; const issues=[];
    for (const fund of funds.values()) {
      const position=positionRecord({projectId,bankId,accountId:account.id,name:fund.name,openedAt:periodStart,principalCents:null,family:PRODUCT_FAMILIES.QUOTA_FUND,externalReference:fund.cnpj||fund.code,metadata:{template:'CAIXA_FUND_STATEMENT',fundCode:fund.code,fundCnpj:fund.cnpj,openedAtDocumented:false}});
      positions.push(position); const args={projectId,position,bankId,accountId:account.id,documentId};
      for (const row of fund.rows) {
        const suffix=`${fund.code}-${row.date}-${row.label.replace(/\s+/g,'-').toLowerCase()}`;
        if (row.label==='APLICACAO') events.push(eventBase({...args,type:EVENT_TYPES.APPLICATION,date:row.date,amountCents:row.amountCents,suffix,quotaQuantity:row.quota,notes:'Aplicacao em fundo documentada pela Caixa.'}));
        if (row.label==='SALDO INICIAL' || row.label==='SALDO FINAL') {
          events.push(eventBase({...args,type:EVENT_TYPES.BALANCE_SNAPSHOT,date:row.date,amountCents:row.amountCents,suffix:`${suffix}-balance`,quotaQuantity:row.quota,notes:`${row.label==='SALDO FINAL'?'Saldo final':'Saldo inicial'} do fundo.`}));
          if (row.quota!=null) events.push(eventBase({...args,type:EVENT_TYPES.QUOTA_SNAPSHOT,date:row.date,amountCents:row.amountCents,suffix:`${suffix}-quota`,quotaQuantity:row.quota,notes:'Quantidade de cotas informada no extrato.'}));
        }
      }
      for (let index=0; index<fund.redemptions.length; index+=1) {
        const row=fund.redemptions[index]; const net=Math.max(0,row.grossCents-row.irrfCents-row.iofCents); const principal=Math.max(0,row.grossCents-row.incomeCents); const suffix=`${fund.code}-${row.date}-${index+1}`;
        events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION,date:row.date,amountCents:net,suffix:`redemption-${suffix}`,netAmountCents:net,grossAmountCents:row.grossCents,quotaQuantity:row.quota,notes:'Resgate bruto menos IRRF e IOF conforme extrato Caixa.',metadata:{taxableIncomeCents:row.taxableIncomeCents}}));
        if (principal) events.push(eventBase({...args,type:EVENT_TYPES.PRINCIPAL_RECOVERY,date:row.date,amountCents:principal,suffix:`principal-${suffix}`,notes:'Principal recuperado calculado como resgate bruto menos rendimento documentado.'}));
        if (row.incomeCents) events.push(eventBase({...args,type:EVENT_TYPES.REALIZED_INCOME,date:row.date,amountCents:row.incomeCents,suffix:`income-${suffix}`,notes:'Rendimento do resgate informado pela Caixa.',metadata:{taxableIncomeCents:row.taxableIncomeCents}}));
        if (row.irrfCents) events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION_IRRF,date:row.date,amountCents:row.irrfCents,suffix:`irrf-${suffix}`,notes:'IRRF informado na sequencia do resgate.'}));
        if (row.iofCents) events.push(eventBase({...args,type:EVENT_TYPES.IOF,date:row.date,amountCents:row.iofCents,suffix:`iof-${suffix}`,notes:'IOF informado na sequencia do resgate.'}));
      }
    }
    if (!positions.length) issues.push({id:`issue-${documentId}-caixa-funds`,projectId,documentId,severity:'REVIEW',title:'Fundos Caixa nao localizados',details:'O layout foi reconhecido, mas nenhum bloco Codigo/Fundo/CNPJ foi estruturado.',status:'OPEN'});
    return {positions,accounts:account.record?[account.record]:[],events,evidences:[],issues,reportedTotals:[],warnings:[],templateId:'CAIXA_FUND_STATEMENT'};
  }
};
