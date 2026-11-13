import { identifyInstitution } from '../document-engine/bank-catalog.js';
import { classifyDocument } from '../document-engine/classifier.js';
import { processByTemplate } from '../document-engine/template-registry.js';
import { parseOfx } from '../adapters/ofx.js';
import { normalizeForSearch } from '../document-engine/text-utils.js';

export const BENCHMARK_GATES = Object.freeze({
  overallScore: 90,
  bankIdentificationPct: 95,
  classificationPct: 95,
  structurePct: 90,
  eventAmountExactPct: 95,
  ofxPct: 95,
});

const now = () => globalThis.performance?.now?.() ?? Date.now();
const pct = (pass, total) => total ? Math.round(pass / total * 10000) / 100 : 100;
const normalized = value => normalizeForSearch(String(value || '')).toUpperCase();
const sortedNumbers = values => [...(values || [])].map(Number).sort((a,b)=>a-b);
const sortedStrings = values => [...(values || [])].map(String).sort();
const arraysEqual = (a,b) => JSON.stringify(a) === JSON.stringify(b);

function eventMap(events = []) {
  const map = new Map();
  for (const event of events) {
    const row = map.get(event.type) || [];
    row.push(Number(event.amountCents || event.netAmountCents || 0));
    map.set(event.type, row);
  }
  return map;
}

function addCheck(checks, dimension, label, ok, weight = 1, detail = '') {
  checks.push({dimension, label, ok:Boolean(ok), weight:Number(weight) || 1, detail:String(detail || '')});
}

function evaluateTextCase(testCase, index = 0) {
  const started = now();
  const bank = identifyInstitution({fileName:testCase.fileName, text:testCase.text});
  const classification = classifyDocument({fileName:testCase.fileName, text:testCase.text});
  const parsed = processByTemplate({
    projectId:'benchmark-stage15',
    documentId:`benchmark-${testCase.id || index}`,
    fileName:testCase.fileName,
    text:testCase.text,
    bank,
    classification,
    method:'BENCHMARK_TEXT',
    pages:String(testCase.text || '').split('\f').map((text,pageIndex)=>({pageNumber:pageIndex+1,text})),
  });
  const elapsedMs = now() - started;
  const expected = testCase.expected || {};
  const checks = [];
  addCheck(checks,'bank','Instituição identificada',normalized(bank.name).includes(normalized(expected.bankNameContains)),4,`${bank.name} (${bank.source})`);
  addCheck(checks,'classification','Tipo documental',classification.kind === expected.documentKind,3,`${classification.kind}`);
  addCheck(checks,'structure','Quantidade de posições',(parsed.positions || []).length === Number(expected.positionCount || 0),2,`${(parsed.positions || []).length}`);
  addCheck(checks,'structure','Famílias de produto',arraysEqual(sortedStrings((parsed.positions||[]).map(p=>p.productFamily)),sortedStrings(expected.families||[])),2,(parsed.positions||[]).map(p=>p.productFamily).join(', '));

  if (Array.isArray(expected.reportedTotals)) {
    const actualTotals = (parsed.reportedTotals || []).map(item=>({category:item.category,incomeCents:item.incomeCents,irrfCents:item.irrfCents,quarter:item.quarter}));
    for (const total of expected.reportedTotals) {
      const match = actualTotals.some(item=>item.category===total.category && item.incomeCents===total.incomeCents && item.irrfCents===total.irrfCents && item.quarter===total.quarter);
      addCheck(checks,'amounts',`Total informe ${total.category}`,match,4,match?'OK':JSON.stringify(actualTotals));
    }
  }

  const map = eventMap(parsed.events || []);
  for (const [type, count] of Object.entries(expected.events || {})) {
    addCheck(checks,'events',`Contagem ${type}`,(map.get(type)||[]).length === count,3,`${(map.get(type)||[]).length}/${count}`);
  }
  for (const [type, values] of Object.entries(expected.amounts || {})) {
    addCheck(checks,'amounts',`Valores ${type}`,arraysEqual(sortedNumbers(map.get(type)||[]),sortedNumbers(values)),4,`${JSON.stringify(sortedNumbers(map.get(type)||[]))}`);
  }
  const totalWeight = checks.reduce((s,c)=>s+c.weight,0);
  const passedWeight = checks.filter(c=>c.ok).reduce((s,c)=>s+c.weight,0);
  return {
    id:testCase.id,
    institution:testCase.institution,
    format:testCase.format,
    bank,
    classification,
    templateId:parsed.templateId,
    positionCount:(parsed.positions||[]).length,
    eventCount:(parsed.events||[]).length,
    issueCount:(parsed.issues||[]).length,
    elapsedMs:Math.round(elapsedMs*1000)/1000,
    score:Math.round((passedWeight/Math.max(1,totalWeight))*10000)/100,
    checks,
  };
}

function evaluateOfxCase(testCase) {
  const started = now();
  const parsed = parseOfx(testCase.text, testCase.fileName);
  const elapsedMs = now() - started;
  const expected = testCase.expected || {};
  const checks = [];
  addCheck(checks,'ofx','Sintaxe',parsed.syntax === expected.syntax,2,parsed.syntax);
  addCheck(checks,'ofx','Banco OFX',String(parsed.bankId) === String(expected.bankId),2,parsed.bankId);
  addCheck(checks,'ofx','Conta OFX',String(parsed.accountId) === String(expected.accountId),2,parsed.accountId);
  addCheck(checks,'ofx','Transações',parsed.transactions.length === expected.transactions,3,`${parsed.transactions.length}`);
  addCheck(checks,'ofx','Créditos',arraysEqual(sortedNumbers(parsed.transactions.filter(t=>t.direction==='CREDIT').map(t=>t.amountCents)),sortedNumbers(expected.creditsCents||[])),3);
  addCheck(checks,'ofx','Débitos',arraysEqual(sortedNumbers(parsed.transactions.filter(t=>t.direction==='DEBIT').map(t=>t.amountCents)),sortedNumbers(expected.debitsCents||[])),3);
  addCheck(checks,'ofx','Duplicidades',parsed.duplicates === expected.duplicates,2,`${parsed.duplicates}`);
  const totalWeight=checks.reduce((s,c)=>s+c.weight,0); const passedWeight=checks.filter(c=>c.ok).reduce((s,c)=>s+c.weight,0);
  return {id:testCase.id,institution:testCase.institution,format:'OFX',templateId:'OFX_GENERIC',positionCount:0,eventCount:0,issueCount:0,elapsedMs:Math.round(elapsedMs*1000)/1000,score:Math.round(passedWeight/totalWeight*10000)/100,checks};
}

function dimensionStats(results, dimension) {
  const checks = results.flatMap(result=>result.checks).filter(check=>check.dimension===dimension);
  return {passed:checks.filter(check=>check.ok).length,total:checks.length,pct:pct(checks.filter(check=>check.ok).length,checks.length)};
}

export function summarizeBenchmark(results = []) {
  const weightedTotal = results.flatMap(r=>r.checks).reduce((s,c)=>s+c.weight,0);
  const weightedPass = results.flatMap(r=>r.checks).filter(c=>c.ok).reduce((s,c)=>s+c.weight,0);
  const dimensions = {
    bank:dimensionStats(results,'bank'),
    classification:dimensionStats(results,'classification'),
    structure:dimensionStats(results,'structure'),
    events:dimensionStats(results,'events'),
    amounts:dimensionStats(results,'amounts'),
    ofx:dimensionStats(results,'ofx'),
  };
  const overallScore = Math.round(weightedPass/Math.max(1,weightedTotal)*10000)/100;
  const gates = {
    overallScore: overallScore >= BENCHMARK_GATES.overallScore,
    bankIdentification: dimensions.bank.pct >= BENCHMARK_GATES.bankIdentificationPct,
    classification: dimensions.classification.pct >= BENCHMARK_GATES.classificationPct,
    structure: dimensions.structure.pct >= BENCHMARK_GATES.structurePct,
    eventAmountExact: Math.min(dimensions.events.pct,dimensions.amounts.pct) >= BENCHMARK_GATES.eventAmountExactPct,
    ofx: dimensions.ofx.pct >= BENCHMARK_GATES.ofxPct,
  };
  const status = Object.values(gates).every(Boolean) ? 'PASSED' : 'REVIEW';
  const latencies = results.map(r=>r.elapsedMs).sort((a,b)=>a-b);
  const quantile = q => latencies.length ? latencies[Math.min(latencies.length-1,Math.floor((latencies.length-1)*q))] : 0;
  return {status,overallScore,dimensions,gates,caseCount:results.length,p50Ms:quantile(.5),p95Ms:quantile(.95),maxMs:latencies.at(-1)||0};
}

export function runCorpusBenchmark(corpus) {
  const cases = Array.isArray(corpus) ? corpus : corpus?.cases || [];
  const results = cases.map((testCase,index)=>testCase.format==='OFX'?evaluateOfxCase(testCase):evaluateTextCase(testCase,index));
  return {executedAt:new Date().toISOString(),results,summary:summarizeBenchmark(results)};
}

export function coverageScore({classificationPct=0, bankPct=0, structurePct=0, eventPct=0, amountPct=0, reconciliationPct=0}={}) {
  const score = classificationPct*0.15 + bankPct*0.15 + structurePct*0.15 + eventPct*0.20 + amountPct*0.25 + reconciliationPct*0.10;
  const rounded = Math.round(score*100)/100;
  return {score:rounded,status:rounded>=95?'HOMOLOGADO':rounded>=85?'HOMOLOGACAO_PARCIAL':'NAO_HOMOLOGADO'};
}

export function estimateSerializedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
