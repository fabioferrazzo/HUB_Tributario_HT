export const OBSERVABILITY_SCHEMA_VERSION = 1;
export const RELEASE_CHANNELS = Object.freeze({ INTERNAL_RC: 'INTERNAL_RC', INTERNAL_STABLE: 'INTERNAL_STABLE' });
export const OBSERVABILITY_SEVERITIES = Object.freeze({ INFO:'INFO', WARN:'WARN', ERROR:'ERROR', CRITICAL:'CRITICAL' });
export const INCIDENT_STATUSES = Object.freeze({ OPEN:'OPEN', RESOLVED:'RESOLVED' });
export const INCIDENT_CATEGORIES = Object.freeze(['EXTRACTION','RECONCILIATION','REPORT','BACKUP','PERFORMANCE','DATA_INTEGRITY','RUNTIME','OTHER']);
export const DEFAULT_OBSERVABILITY_CONFIG = Object.freeze({retentionDays:30, maxOperationalEvents:1200, maxPerformanceSamples:800, exportRecentEvents:100});

const SAFE_DETAIL_KEYS = new Set([
  'operation','component','status','count','documentCount','eventCount','positionCount','warningCount','failedCount','completedCount',
  'durationMs','pageCount','format','quarter','stage','version','channel','reason','errorName','helper','ocr','offline','online','sourceType',
  'classification','templateKind','layoutStatus','result','store','databaseVersion','schemaVersion','metric','threshold','actual','pass','code'
]);
const SECRET_KEY_RE = /(blob|fulltext|rawtext|textcontent|cnpj|cpf|account|agencia|agency|company|client|customer|name|filename|hash|email|address|phone|amount|value|principal|yield|income|irrf|iof|documentid|positionid|eventid)/i;
const CNPJ_RE = /\b\d{2}[.]?\d{3}[.]?\d{3}[\/]?\d{4}[-]?\d{2}\b/g;
const CPF_RE = /\b\d{3}[.]?\d{3}[.]?\d{3}[-]?\d{2}\b/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const MONEY_RE = /(?:R\$|BRL)\s*[-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{2})?/gi;
const LONG_DIGIT_RE = /\b\d{8,}\b/g;
const FILE_RE = /(?:[A-Za-z0-9_À-ÿ .()\-]+)\.(?:pdf|ofx|xlsx|xls|csv|json|txt|htaf|zip)\b/gi;
const WINDOWS_USER_PATH_RE = /[A-Za-z]:\\Users\\[^\\\s]+/gi;
const UNIX_USER_PATH_RE = /\/(?:home|Users)\/[^\/\s]+/g;

export function scrubDiagnosticText(value='') {
  return String(value)
    .replace(CNPJ_RE,'[CNPJ]')
    .replace(CPF_RE,'[CPF]')
    .replace(EMAIL_RE,'[EMAIL]')
    .replace(MONEY_RE,'[VALOR]')
    .replace(FILE_RE,'[ARQUIVO]')
    .replace(WINDOWS_USER_PATH_RE,'[PASTA_USUARIO]')
    .replace(UNIX_USER_PATH_RE,'[PASTA_USUARIO]')
    .replace(LONG_DIGIT_RE,'[IDENTIFICADOR]')
    .slice(0,1000);
}

function sanitizeScalar(value) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return scrubDiagnosticText(value);
}

export function sanitizeOperationalDetails(details={}) {
  const clean={};
  for (const [key,value] of Object.entries(details||{})) {
    if (SECRET_KEY_RE.test(key) || !SAFE_DETAIL_KEYS.has(key)) continue;
    if (Array.isArray(value)) clean[key]=value.slice(0,20).map(sanitizeScalar);
    else if (value && typeof value === 'object') {
      const nested={};
      for(const [nestedKey,nestedValue] of Object.entries(value)) {
        if (SECRET_KEY_RE.test(nestedKey)) continue;
        if (['status','count','code','type','method','quality','version','stage','pass','durationMs'].includes(nestedKey)) nested[nestedKey]=sanitizeScalar(nestedValue);
      }
      clean[key]=nested;
    } else clean[key]=sanitizeScalar(value);
  }
  return clean;
}

export function createOperationalEvent({id,projectId=null,severity=OBSERVABILITY_SEVERITIES.INFO,category='RUNTIME',code='EVENT',message='',details={},occurredAt=new Date().toISOString(),sessionId=null}={}) {
  if(!Object.values(OBSERVABILITY_SEVERITIES).includes(severity)) throw new TypeError(`Severidade inválida: ${severity}`);
  return {
    id:id||`op-${Date.now()}-${globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)}`,
    projectId:projectId||null,
    occurredAt,
    severity,
    category:String(category||'RUNTIME').slice(0,40),
    code:String(code||'EVENT').slice(0,80),
    message:scrubDiagnosticText(message||''),
    details:sanitizeOperationalDetails(details),
    sessionId:sessionId?String(sessionId).slice(0,80):null,
    schemaVersion:OBSERVABILITY_SCHEMA_VERSION,
  };
}

export function createPerformanceSample({id,projectId=null,operation,durationMs,status='SUCCESS',occurredAt=new Date().toISOString(),details={}}={}) {
  const duration=Number(durationMs);
  if(!operation) throw new TypeError('Operação é obrigatória.');
  if(!Number.isFinite(duration)||duration<0) throw new TypeError('Duração inválida.');
  return {
    id:id||`perf-${Date.now()}-${globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)}`,
    projectId:projectId||null,
    occurredAt,
    operation:String(operation).slice(0,80),
    durationMs:Math.round(duration*100)/100,
    status:status==='FAILED'?'FAILED':'SUCCESS',
    details:sanitizeOperationalDetails(details),
    schemaVersion:OBSERVABILITY_SCHEMA_VERSION,
  };
}

export function createIncident({id,projectId=null,category='OTHER',severity=OBSERVABILITY_SEVERITIES.WARN,title='Incidente operacional',description='',createdAt=new Date().toISOString()}={}) {
  if(!INCIDENT_CATEGORIES.includes(category)) category='OTHER';
  if(!Object.values(OBSERVABILITY_SEVERITIES).includes(severity)) severity=OBSERVABILITY_SEVERITIES.WARN;
  return {
    id:id||`incident-${Date.now()}-${globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)}`,
    projectId:projectId||null,
    category,
    severity,
    title:scrubDiagnosticText(title).slice(0,160),
    description:scrubDiagnosticText(description).slice(0,1500),
    status:INCIDENT_STATUSES.OPEN,
    createdAt,
    resolvedAt:null,
    resolution:null,
    schemaVersion:OBSERVABILITY_SCHEMA_VERSION,
  };
}

export function resolveIncidentRecord(incident,resolution='',resolvedAt=new Date().toISOString()) {
  if(!incident) throw new TypeError('Incidente não informado.');
  return {...incident,status:INCIDENT_STATUSES.RESOLVED,resolvedAt,resolution:scrubDiagnosticText(resolution).slice(0,1000)};
}

export async function recordOperationalEvent(repo,input) {
  const event=createOperationalEvent(input);
  await repo.put('operationalEvents',event);
  return event;
}
export async function recordPerformanceSample(repo,input) {
  const sample=createPerformanceSample(input);
  await repo.put('performanceSamples',sample);
  return sample;
}
export async function recordIncident(repo,input) {
  const incident=createIncident(input);
  await repo.put('incidentReports',incident);
  return incident;
}

export async function observeOperation(repo,{projectId=null,operation,category='RUNTIME',details={},sessionId=null}={},task) {
  const start=(globalThis.performance?.now?.()??Date.now());
  try {
    const result=await task();
    const duration=(globalThis.performance?.now?.()??Date.now())-start;
    await recordPerformanceSample(repo,{projectId,operation,durationMs:duration,status:'SUCCESS',details});
    return result;
  } catch(error) {
    const duration=(globalThis.performance?.now?.()??Date.now())-start;
    await recordPerformanceSample(repo,{projectId,operation,durationMs:duration,status:'FAILED',details}).catch(()=>{});
    await recordOperationalEvent(repo,{projectId,severity:OBSERVABILITY_SEVERITIES.ERROR,category,code:`${operation}_FAILED`,message:error?.message||String(error),details:{...details,errorName:error?.name||'Error',durationMs:duration},sessionId}).catch(()=>{});
    throw error;
  }
}

export function percentile(values,p=0.95) {
  const clean=(values||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length)return null;
  const index=Math.min(clean.length-1,Math.max(0,Math.ceil(p*clean.length)-1));
  return clean[index];
}

export function summarizePerformance(samples=[]) {
  const groups=new Map();
  for(const sample of samples){const key=sample.operation||'UNKNOWN';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(sample);}
  return [...groups.entries()].map(([operation,items])=>({
    operation,
    count:items.length,
    successCount:items.filter(x=>x.status!=='FAILED').length,
    failureCount:items.filter(x=>x.status==='FAILED').length,
    p50Ms:percentile(items.map(x=>x.durationMs),0.5),
    p95Ms:percentile(items.map(x=>x.durationMs),0.95),
    maxMs:items.length?Math.max(...items.map(x=>Number(x.durationMs)||0)):null,
  })).sort((a,b)=>b.count-a.count||a.operation.localeCompare(b.operation));
}

function withinDays(date,days,nowMs=Date.now()) {const ts=Date.parse(date||'');return Number.isFinite(ts)&&ts>=nowMs-days*86400000;}

export function buildHealthSummary({events=[],performanceSamples=[],incidents=[],storage={},snapshots=[],release={},environment={},now=new Date()}={}) {
  const nowMs=+new Date(now);
  const recentEvents=events.filter(x=>withinDays(x.occurredAt,7,nowMs));
  const openIncidents=incidents.filter(x=>x.status!==INCIDENT_STATUSES.RESOLVED);
  const criticalCount=recentEvents.filter(x=>x.severity===OBSERVABILITY_SEVERITIES.CRITICAL).length+openIncidents.filter(x=>x.severity===OBSERVABILITY_SEVERITIES.CRITICAL).length;
  const errorCount=recentEvents.filter(x=>x.severity===OBSERVABILITY_SEVERITIES.ERROR).length+openIncidents.filter(x=>x.severity===OBSERVABILITY_SEVERITIES.ERROR).length;
  const historicalWarningCount=recentEvents.filter(x=>x.severity===OBSERVABILITY_SEVERITIES.WARN).length;
  const openWarningCount=openIncidents.filter(x=>x.severity===OBSERVABILITY_SEVERITIES.WARN).length;
  const warningCount=historicalWarningCount+openWarningCount;
  const storagePct=Number(storage.percent??(storage.quota?storage.usage/storage.quota*100:0))||0;
  const latestSnapshot=[...snapshots].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
  const backupFresh=latestSnapshot?withinDays(latestSnapshot.createdAt,7,nowMs):false;
  const partialReviewPolicy=/MANDATORY_HUMAN_REVIEW/i.test(release?.stageClosure?.operationalPolicy||release?.releasePolicy?.partialLayouts||'');
  const gates=[
    {code:'DB',label:'IndexedDB disponível',pass:environment.indexedDb===true,severity:'CRITICAL'},
    {code:'LOCAL_ONLY',label:'Sem transmissão remota de dados',pass:release.dataTransmission===false&&release.remoteBackend===false,severity:'CRITICAL'},
    {code:'PARTIAL_REVIEW',label:'Revisão obrigatória para layouts não homologados',pass:partialReviewPolicy,severity:'CRITICAL'},
    {code:'STORAGE',label:'Uso de armazenamento abaixo de 85%',pass:storagePct<85,severity:storagePct>=95?'CRITICAL':'WARN',actual:Math.round(storagePct*10)/10},
    {code:'RUNTIME_CRITICAL',label:'Sem falhas críticas nos últimos 7 dias',pass:criticalCount===0,severity:'CRITICAL',actual:criticalCount},
    {code:'RUNTIME_ERROR',label:'Sem erros operacionais nos últimos 7 dias',pass:errorCount===0,severity:'WARN',actual:errorCount},
    {code:'BACKUP_RECENT',label:'Snapshot local criado nos últimos 7 dias',pass:backupFresh,severity:'WARN',actual:latestSnapshot?.createdAt||null},
    {code:'SERVICE_WORKER',label:'Service Worker suportado',pass:environment.serviceWorker===true,severity:'WARN'},
  ];
  let status='GREEN';
  if(gates.some(g=>!g.pass&&g.severity==='CRITICAL'))status='RED';
  else if(gates.some(g=>!g.pass)||openWarningCount>0)status='YELLOW';
  return {
    status,
    generatedAt:new Date(nowMs).toISOString(),
    criticalCount,errorCount,warningCount,historicalWarningCount,openWarningCount,
    openIncidentCount:openIncidents.length,
    storagePercent:Math.round(storagePct*10)/10,
    latestSnapshotAt:latestSnapshot?.createdAt||null,
    performance:summarizePerformance(performanceSamples.filter(x=>withinDays(x.occurredAt,30,nowMs))),
    gates,
  };
}

export function buildDiagnosticBundle({release={},health={},events=[],performanceSamples=[],incidents=[],environment={},storeCounts={},exportedAt=new Date().toISOString()}={}) {
  const recent=[...events].sort((a,b)=>String(b.occurredAt||'').localeCompare(String(a.occurredAt||''))).slice(0,100).map(x=>({
    occurredAt:x.occurredAt,severity:x.severity,category:x.category,code:x.code,message:scrubDiagnosticText(x.message||''),details:sanitizeOperationalDetails(x.details||{})
  }));
  const incidentSummary=[...incidents].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,100).map(x=>({
    category:x.category,severity:x.severity,status:x.status,createdAt:x.createdAt,resolvedAt:x.resolvedAt||null,title:scrubDiagnosticText(x.title||''),description:scrubDiagnosticText(x.description||''),resolution:scrubDiagnosticText(x.resolution||'')
  }));
  return {
    format:'HTDIAG',formatVersion:1,exportedAt,
    privacy:{containsDocuments:false,containsDocumentText:false,containsClientIdentifiers:false,containsFinancialAmounts:false,containsDocumentHashes:false,note:'Pacote operacional sanitizado; não substitui o backup .htaf.'},
    release:{name:release.name||null,version:release.version||null,stage:release.stage||null,channel:release.releaseChannel||release.channel||null,builtAt:release.builtAt||null,persistence:release.persistence||null,releaseReadiness:release.releaseReadiness||null},
    environment:{online:Boolean(environment.online),indexedDb:Boolean(environment.indexedDb),serviceWorker:Boolean(environment.serviceWorker),secureContext:Boolean(environment.secureContext),locale:String(environment.locale||'').slice(0,20),hardwareConcurrency:Number(environment.hardwareConcurrency)||null},
    health:{status:health.status||'UNKNOWN',generatedAt:health.generatedAt||null,criticalCount:health.criticalCount||0,errorCount:health.errorCount||0,warningCount:health.warningCount||0,historicalWarningCount:health.historicalWarningCount||0,openWarningCount:health.openWarningCount||0,openIncidentCount:health.openIncidentCount||0,storagePercent:health.storagePercent??null,gates:(health.gates||[]).map(g=>({code:g.code,label:g.label,pass:Boolean(g.pass),severity:g.severity,actual:typeof g.actual==='number'?g.actual:null}))},
    stores:Object.fromEntries(Object.entries(storeCounts||{}).filter(([,value])=>Number.isFinite(Number(value))).map(([key,value])=>[key,Number(value)])),
    performance:summarizePerformance(performanceSamples),
    recentEvents:recent,
    incidents:incidentSummary,
  };
}

export function diagnosticContainsSensitivePatterns(bundle) {
  const text=JSON.stringify(bundle);
  const patterns=[CNPJ_RE,CPF_RE,EMAIL_RE,MONEY_RE,/"(?:documentId|documentHash|companyName|cnpj|accountNumber|fullText|blob)"/i];
  return patterns.some(re=>{re.lastIndex=0;return re.test(text);});
}

export async function pruneObservability(repo,{retentionDays=DEFAULT_OBSERVABILITY_CONFIG.retentionDays,maxOperationalEvents=DEFAULT_OBSERVABILITY_CONFIG.maxOperationalEvents,maxPerformanceSamples=DEFAULT_OBSERVABILITY_CONFIG.maxPerformanceSamples,now=new Date()}={}) {
  const cutoff=+new Date(now)-Math.max(1,Number(retentionDays)||30)*86400000;
  const pruneStore=async(store,dateField,maxCount)=>{
    const all=(await repo.all(store)).sort((a,b)=>String(b[dateField]||'').localeCompare(String(a[dateField]||'')));
    const remove=all.filter((item,index)=>index>=maxCount||Date.parse(item[dateField]||'')<cutoff);
    for(const item of remove)await repo.delete(store,item.id);
    return remove.length;
  };
  return {operationalEvents:await pruneStore('operationalEvents','occurredAt',maxOperationalEvents),performanceSamples:await pruneStore('performanceSamples','occurredAt',maxPerformanceSamples)};
}
