import { diagnosticContainsSensitivePatterns, scrubDiagnosticText } from '../observability/engine.js';

export const STAGE18_UAT_KIND = 'STAGE18_UAT_STATION';
export const UAT_STATUSES = Object.freeze({
  PENDING:'PENDING',
  PASSED:'PASSED',
  FAILED:'FAILED',
  NOT_APPLICABLE:'NOT_APPLICABLE',
  WAIVED_NOT_EXECUTED:'WAIVED_NOT_EXECUTED',
});
export const STAGE18_MIN_STATIONS = 1;
export const STAGE18_RECOMMENDED_MAX_STATIONS = 1;
export const STAGE18_UAT_CHECKS = Object.freeze([
  {id:'WINDOWS_STATION', label:'Execução em estação Windows representativa', required:true},
  {id:'INDEXEDDB_V8_TO_V9', label:'Migração IndexedDB v8 → v9 sem perda', required:true},
  {id:'AUTHORIZED_REAL_CASES', label:'Processamento de casos reais autorizados', required:true},
  {id:'POPPLER_AVAILABLE', label:'Poppler disponível na estação', required:true},
  {id:'TESSERACT_AVAILABLE', label:'Tesseract disponível na estação', required:true},
  {id:'OCR_PORTUGUESE', label:'OCR em português disponível e validado', required:true},
  {id:'OPERATION_PAGE', label:'Página Operação e incidentes locais validada', required:true},
  {id:'HTAF_BACKUP', label:'Backup .htaf criado e validado', required:true},
  {
    id:'HTAF_CROSS_STATION_RESTORE',
    label:'Restauração .htaf validada em outra estação',
    required:false,
    waiverAllowed:true,
    defaultStatus:UAT_STATUSES.WAIVED_NOT_EXECUTED,
    defaultNote:'Não executado por decisão explícita de escopo: implantação offline em estação única.',
  },
  {id:'PDF_EXPORT', label:'Exportação PDF validada', required:true},
  {id:'XLSX_EXPORT', label:'Exportação XLSX validada', required:true},
  {id:'QUARTER_CLOSURE', label:'Fechamento trimestral validado', required:true},
  {id:'PARTIAL_REVIEW_BLOCK', label:'Layout PARTIAL bloqueado sem revisão humana integral', required:true},
]);

function safeAlias(value='') {
  return scrubDiagnosticText(String(value || '').trim()).replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 40) || 'Estação';
}
function safeNote(value='') { return scrubDiagnosticText(String(value || '')).slice(0, 240); }
function checkMap(existing={}, {useDefaults=false}={}) {
  const out = {};
  for (const definition of STAGE18_UAT_CHECKS) {
    const current = existing?.[definition.id] || {};
    const requested = current.status;
    const status = Object.values(UAT_STATUSES).includes(requested)
      ? requested
      : useDefaults && definition.defaultStatus
        ? definition.defaultStatus
        : UAT_STATUSES.PENDING;
    const defaultNote = useDefaults && !current.note && definition.defaultNote ? definition.defaultNote : '';
    out[definition.id] = {
      status,
      updatedAt:current.updatedAt || null,
      note:safeNote(current.note || defaultNote),
    };
  }
  return out;
}

export function createStage18UatSession({id, stationAlias, version, createdAt=new Date().toISOString()}={}) {
  if (!id) throw new TypeError('UAT session id is required');
  if (!version) throw new TypeError('Release version is required');
  return {
    id,
    kind:STAGE18_UAT_KIND,
    stage:18,
    stationAlias:safeAlias(stationAlias),
    version:String(version),
    createdAt,
    updatedAt:createdAt,
    status:UAT_STATUSES.PENDING,
    checks:checkMap({}, {useDefaults:true}),
  };
}

export function updateStage18UatCheck(session, checkId, status, {note='', updatedAt=new Date().toISOString()}={}) {
  if (!session || session.kind !== STAGE18_UAT_KIND) throw new TypeError('Invalid Stage 18 UAT session');
  const definition = STAGE18_UAT_CHECKS.find(item => item.id === checkId);
  if (!definition) throw new TypeError(`Unknown UAT check: ${checkId}`);
  if (!Object.values(UAT_STATUSES).includes(status)) throw new TypeError(`Invalid UAT status: ${status}`);
  if (status === UAT_STATUSES.WAIVED_NOT_EXECUTED && !definition.waiverAllowed) throw new TypeError(`Waiver not allowed for required UAT check: ${checkId}`);
  const checks = checkMap(session.checks);
  checks[checkId] = {status, updatedAt, note:safeNote(note)};
  const required = STAGE18_UAT_CHECKS.filter(item => item.required);
  const requiredStatuses = required.map(item => checks[item.id]?.status || UAT_STATUSES.PENDING);
  const optionalFailure = STAGE18_UAT_CHECKS.some(item => !item.required && checks[item.id]?.status === UAT_STATUSES.FAILED);
  const aggregate = requiredStatuses.some(value => value === UAT_STATUSES.FAILED) || optionalFailure
    ? UAT_STATUSES.FAILED
    : requiredStatuses.every(value => value === UAT_STATUSES.PASSED)
      ? UAT_STATUSES.PASSED
      : UAT_STATUSES.PENDING;
  return {...session, checks, status:aggregate, updatedAt};
}

export function stage18UatSessions(releaseChecks=[]) {
  return (releaseChecks || [])
    .filter(item => item?.kind === STAGE18_UAT_KIND && Number(item.stage) === 18)
    .map(item => ({...item, stationAlias:safeAlias(item.stationAlias), checks:checkMap(item.checks)}));
}

export function summarizeStage18Uat({releaseChecks=[], incidents=[], version=null}={}) {
  const allSessions = stage18UatSessions(releaseChecks);
  const sessions = version ? allSessions.filter(item => item.version === version) : allSessions;
  const passedSessions = sessions.filter(item => item.status === UAT_STATUSES.PASSED);
  const failedSessions = sessions.filter(item => item.status === UAT_STATUSES.FAILED);
  const openCriticalIncidents = (incidents || []).filter(item => item.status !== 'RESOLVED' && item.severity === 'CRITICAL');
  const enoughStations = passedSessions.length >= STAGE18_MIN_STATIONS;
  const requiredChecks = STAGE18_UAT_CHECKS.filter(item => item.required);
  const allRequiredPassed = enoughStations && passedSessions.every(session => requiredChecks.every(item => session.checks?.[item.id]?.status === UAT_STATUSES.PASSED));
  const pendingSessions = sessions.filter(item => item.status === UAT_STATUSES.PENDING);
  const ready = enoughStations && allRequiredPassed && failedSessions.length === 0 && pendingSessions.length === 0 && openCriticalIncidents.length === 0;
  const waivedChecks = sessions.reduce((count, session) => count + STAGE18_UAT_CHECKS.filter(item => session.checks?.[item.id]?.status === UAT_STATUSES.WAIVED_NOT_EXECUTED).length, 0);
  return {
    stage:18,
    version,
    totalStations:sessions.length,
    passedStations:passedSessions.length,
    failedStations:failedSessions.length,
    pendingStations:pendingSessions.length,
    openCriticalIncidents:openCriticalIncidents.length,
    minimumStations:STAGE18_MIN_STATIONS,
    recommendedMaximumStations:STAGE18_RECOMMENDED_MAX_STATIONS,
    waivedChecks,
    crossStationRestorePolicy:'WAIVED_NOT_EXECUTED_BY_SCOPE_DECISION',
    readyForStablePromotion:ready,
    status:ready ? 'READY_FOR_INTERNAL_STABLE_PROMOTION' : 'UAT_PENDING',
  };
}

export function buildStage18UatEvidence({release={}, releaseChecks=[], incidents=[], exportedAt=new Date().toISOString()}={}) {
  const sessions = stage18UatSessions(releaseChecks).filter(item => !release.version || item.version === release.version);
  const summary = summarizeStage18Uat({releaseChecks:sessions, incidents, version:release.version || null});
  const crossStationStatuses = sessions.map(session => session.checks?.HTAF_CROSS_STATION_RESTORE?.status).filter(Boolean);
  const crossStationStatus = crossStationStatuses.includes(UAT_STATUSES.FAILED)
    ? UAT_STATUSES.FAILED
    : crossStationStatuses.includes(UAT_STATUSES.PASSED)
      ? UAT_STATUSES.PASSED
      : UAT_STATUSES.WAIVED_NOT_EXECUTED;
  const bundle = {
    format:'HTUAT',
    formatVersion:1,
    stage:18,
    exportedAt,
    release:{version:release.version || null, channel:release.releaseChannel || null, databaseVersion:release.observability?.databaseVersion || 9, dataTransmission:release.dataTransmission === false ? false : null},
    governance:{
      deploymentModel:'SINGLE_WINDOWS_STATION_OFFLINE',
      minimumApprovedStations:STAGE18_MIN_STATIONS,
      crossStationRestore:{status:crossStationStatus, rationale:crossStationStatus===UAT_STATUSES.WAIVED_NOT_EXECUTED?'Teste em segunda estação não executado por decisão explícita de escopo.':'Resultado registrado no checklist da estação.'},
      criticalIncidentsMustBeZero:true,
    },
    summary,
    stations:sessions.map(session => ({
      stationAlias:safeAlias(session.stationAlias),
      status:session.status,
      createdAt:session.createdAt,
      updatedAt:session.updatedAt,
      checks:Object.fromEntries(STAGE18_UAT_CHECKS.map(definition => [definition.id, {
        required:Boolean(definition.required),
        status:session.checks?.[definition.id]?.status || UAT_STATUSES.PENDING,
        updatedAt:session.checks?.[definition.id]?.updatedAt || null,
        note:safeNote(session.checks?.[definition.id]?.note || ''),
      }])),
    })),
    incidents:{openCritical:summary.openCriticalIncidents, openTotal:(incidents || []).filter(item => item.status !== 'RESOLVED').length},
    privacy:{containsDocuments:false, containsFinancialAmounts:false, containsClientIdentifiers:false, containsDocumentHashes:false, containsLocalPaths:false, containsHostname:false, containsWindowsUser:false},
  };
  return bundle;
}

export function uatEvidenceContainsSensitivePatterns(bundle) {
  return diagnosticContainsSensitivePatterns(bundle);
}
