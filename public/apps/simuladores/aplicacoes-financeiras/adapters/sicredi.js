import { EVENT_TYPES } from '../domain/model.js';
import {
  EVIDENCE_STATUS, PRODUCT_FAMILIES, accountRecord, dateToIso, endOfMonth, eventBase,
  lineList, moneyToCents, normalizeForSearch, parseMoneyList, positionRecord
} from './layout-common.js';

function matchOne(text, regex, group = 1) {
  return String(text || '').match(regex)?.[group] || '';
}

function positionDate(text) {
  return dateToIso(matchOne(text, /POSICAO\s+EM\s+(\d{2}\/\d{2}\/\d{4})/i)) || null;
}

function header(text) {
  const value = normalizeForSearch(text);
  return {
    product: matchOne(value, /PRODUTO\s*:\s*([^\n]+?)\s+TITULO\s*:/i).trim() || 'SICREDINVEST',
    title: matchOne(value, /TITULO\s*:\s*([\w.-]+)/i),
    principal: moneyToCents(matchOne(value, /APLICACAO INICIAL \(R\$\)\s*:\s*([\d.]+,\d{2})/i) || '0'),
    openedAt: dateToIso(matchOne(value, /DATA APLICACAO\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)),
    cooperative: matchOne(value, /COOPERATIVA\s*:\s*([\d.-]+)/i),
    account: matchOne(value, /CONTA CORRENTE\s*:\s*([\d.-]+)/i),
  };
}

function taxForecastEvent(args, date, amount, taxKind, suffix) {
  return eventBase({...args, type:EVENT_TYPES.TAX_FORECAST, date, amountCents:amount, suffix,
    evidenceStatus:EVIDENCE_STATUS.ESTIMATED, notes:'Provisao bancaria; nao representa tributo efetivamente retido.', metadata:{taxKind}});
}

export const sicrediAdapter = {
  id:'sicredi-term-deposit',
  canHandle({bankId, text=''}) {
    const value = normalizeForSearch(text).toUpperCase();
    return bankId === 'sicredi' && /DEPOSITO A PRAZO/.test(value) && /SICREDINVEST/.test(value);
  },
  parseNormalizedText({projectId, documentId, text, pages=[], bankId='sicredi'}) {
    const value = normalizeForSearch(text);
    // SICREDIRAW01: no modo -layout as células da tabela mensal saem em linhas diferentes; no texto -raw cada
    // mês fica numa linha única. O cabeçalho continua vindo do texto normal (no raw o rótulo vem depois do valor).
    const rawValue = normalizeForSearch((pages || []).map(page => page?.rawText || '').join('\n'));
    const detailValue = /MES\/ANO\s+APLICACOES\s+RESGATES/i.test(rawValue) ? rawValue : value;
    const info = header(text);
    if (!info.openedAt) return {positions:[],accounts:[],events:[],issues:[{id:`issue-${documentId}-sicredi-date`,projectId,documentId,severity:'REVIEW',title:'Data da aplicacao Sicredi nao localizada',details:'O layout foi reconhecido, mas a data original da aplicacao nao foi encontrada.',status:'OPEN'}],warnings:['Layout Sicredi reconhecido com cabecalho incompleto.']};
    const account = accountRecord({projectId,bankId,agency:info.cooperative,account:info.account,label:`Sicredi ${info.cooperative}/${info.account}`});
    const position = positionRecord({projectId,bankId,accountId:account.id,name:info.product,openedAt:info.openedAt,principalCents:info.principal || null,family:PRODUCT_FAMILIES.FIXED_INCOME_SECURITY,externalReference:info.title || info.openedAt,metadata:{template:'SICREDI_TERM_DEPOSIT',title:info.title,principalDocumented:Boolean(info.principal)}});
    position.maturityDate = dateToIso(matchOne(value, /VENCIMENTO\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)) || null;
    const args = {projectId,position,bankId,accountId:account.id,documentId};
    const events=[];
    const detailed = /MES\/ANO\s+APLICACOES\s+RESGATES/i.test(value) || /RENDIMENTOS\s+PAGOS\s+IRRF\s+IOF/i.test(value);

    if (detailed) {
      events.push(eventBase({...args,type:EVENT_TYPES.APPLICATION,date:info.openedAt,amountCents:info.principal,suffix:'application-header',notes:'Aplicacao inicial documentada no cabecalho Sicredi.'}));
      const capDate = positionDate(detailValue);
      for (const line of lineList(detailValue)) {
        const row = line.match(/^(\d{2})\/(\d{4})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})$/i);
        if (!row) continue;
        const month = Number(row[1]); const year = Number(row[2]);
        const date = endOfMonth(year,month,capDate);
        const values = row.slice(3).map(moneyToCents);
        const [applications,redemptions,paidIncome,irrf,iof,provisionMonth,provisionAccum,balance] = values;
        const tag=`${year}-${String(month).padStart(2,'0')}`;
        if (applications && date.slice(0,7) !== info.openedAt.slice(0,7)) events.push(eventBase({...args,type:EVENT_TYPES.APPLICATION,date,amountCents:applications,suffix:`application-${tag}`,notes:'Aplicacao agregada mensalmente no extrato Sicredi.',metadata:{dateGranularity:'MONTH'}}));
        if (redemptions) events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION,date,amountCents:redemptions,suffix:`redemption-${tag}`,notes:'Valor de resgates informado na linha mensal Sicredi.',metadata:{dateGranularity:'MONTH'}}));
        if (paidIncome) events.push(eventBase({...args,type:EVENT_TYPES.REALIZED_INCOME,date,amountCents:paidIncome,suffix:`realized-${tag}`,notes:'Rendimentos pagos informados pelo Sicredi.',metadata:{dateGranularity:'MONTH'}}));
        if (irrf) events.push(eventBase({...args,type:EVENT_TYPES.REDEMPTION_IRRF,date,amountCents:irrf,suffix:`irrf-${tag}`,notes:'IRRF efetivamente informado na linha mensal Sicredi.',metadata:{dateGranularity:'MONTH'}}));
        if (iof) events.push(eventBase({...args,type:EVENT_TYPES.IOF,date,amountCents:iof,suffix:`iof-${tag}`,notes:'IOF efetivamente informado na linha mensal Sicredi.',metadata:{dateGranularity:'MONTH'}}));
        if (provisionMonth) events.push(eventBase({...args,type:EVENT_TYPES.UNREALIZED_INCOME,date,amountCents:provisionMonth,suffix:`unrealized-${tag}`,notes:'Rendimento provisionado no mes; nao tratado como rendimento realizado.',metadata:{dateGranularity:'MONTH',accumulatedProvisionCents:provisionAccum}}));
        events.push(eventBase({...args,type:EVENT_TYPES.BALANCE_SNAPSHOT,date,amountCents:balance+provisionAccum,suffix:`balance-${tag}`,notes:'Saldo atual informado na linha mensal Sicredi.',metadata:{dateGranularity:'MONTH'}}));
      }
      const pDate = positionDate(detailValue);
      if (pDate) {
        const pText = detailValue.slice(detailValue.lastIndexOf('Posicao para Saque'));
        const ir = moneyToCents(matchOne(pText,/PROVISAO IRRF\s+([\d.]+,\d{2})/i) || '0');
        const iof = moneyToCents(matchOne(pText,/PROVISAO IOF\s+([\d.]+,\d{2})/i) || '0');
        if (ir) events.push(taxForecastEvent(args,pDate,ir,'IRRF','forecast-irrf'));
        if (iof) events.push(taxForecastEvent(args,pDate,iof,'IOF','forecast-iof'));
      }
    } else {
      for (const line of lineList(value)) {
        const row = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(SALDO ANTERIOR|APLICACOES|SALDO ATUAL)\s+([\d.]+,\d{2})$/i);
        if (!row) continue;
        const date = dateToIso(row[1]); const amount = moneyToCents(row[3]); const label=row[2].toUpperCase();
        if (label === 'APLICACOES') events.push(eventBase({...args,type:EVENT_TYPES.APPLICATION,date,amountCents:amount,suffix:`application-${date}`,notes:'Aplicacao documentada na movimentacao Sicredi.'}));
        if (label === 'SALDO ATUAL') events.push(eventBase({...args,type:EVENT_TYPES.BALANCE_SNAPSHOT,date,amountCents:amount,suffix:`balance-current-${date}`,notes:'Saldo atual antes dos rendimentos provisionados.'}));
      }
      const pDate = positionDate(value) || dateToIso(matchOne(value,/SALDO ATUAL\s+[\d.]+,\d{2}[\s\S]*?POSICAO EM\s+(\d{2}\/\d{2}\/\d{4})/i));
      if (pDate) {
        const pText = value.slice(value.lastIndexOf('Posicao para Saque'));
        const provision = moneyToCents(matchOne(pText,/RENDIMENTOS PROVISIONADOS\s+([\d.]+,\d{2})/i) || '0');
        const gross = moneyToCents(matchOne(pText,/SALDO BRUTO\s+([\d.]+,\d{2})/i) || '0');
        const ir = moneyToCents(matchOne(pText,/PROVISAO IRRF\s+([\d.]+,\d{2})/i) || '0');
        const iof = moneyToCents(matchOne(pText,/PROVISAO IOF\s+([\d.]+,\d{2})/i) || '0');
        if (provision) events.push(eventBase({...args,type:EVENT_TYPES.UNREALIZED_INCOME,date:pDate,amountCents:provision,suffix:'unrealized-position',notes:'Rendimentos provisionados na posicao para saque.'}));
        const priorBalanceIndex = events.findIndex(event => event.type === EVENT_TYPES.BALANCE_SNAPSHOT && event.occurredAt === pDate);
        if (priorBalanceIndex >= 0) events.splice(priorBalanceIndex, 1);
        if (gross) events.push(eventBase({...args,type:EVENT_TYPES.BALANCE_SNAPSHOT,date:pDate,amountCents:gross,suffix:'balance-gross',notes:'Saldo bruto da posicao para saque.'}));
        if (ir) events.push(taxForecastEvent(args,pDate,ir,'IRRF','forecast-irrf'));
        if (iof) events.push(taxForecastEvent(args,pDate,iof,'IOF','forecast-iof'));
      }
    }
    return {positions:[position],accounts:account.record?[account.record]:[],events,evidences:[],issues:[],reportedTotals:[],warnings:[],templateId:'SICREDI_TERM_DEPOSIT'};
  }
};
