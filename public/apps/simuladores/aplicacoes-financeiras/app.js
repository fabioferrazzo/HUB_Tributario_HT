import { calculateDashboard, positionSummary } from './domain/aggregates.js';
import { INITIAL_BALANCE_LABELS, positionLifecycle } from './domain/position-info.js';
import { operationalQuarters } from './domain/periods.js';
import { EVIDENCE_STATUS, EVENT_TYPES, PRODUCT_FAMILIES, POSITION_STATUS, createEvent, quarterEnd, quarterLabel, validatePosition } from './domain/model.js';
import { ENTITY_TYPES, OFFICIAL_TAX_SOURCES, PIS_COFINS_MODES, TAX_REGIMES, TAX_TREATMENTS, normalizeTaxProfile, simulateFinancialTaxes } from './domain/tax-profile.js';
import { createRepository, runIsolatedV8ToV9MigrationCheck, sha256 } from './storage/repository.js';
import { BENCHMARK_GATES, runCorpusBenchmark } from './benchmark/engine.js';
import { PILOT_GATES, PILOT_SOURCE_TYPES, buildPilotDossier, createGroundTruthCase, evaluatePilotCase, summarizePilot } from './pilot/engine.js';
import { DEFAULT_OBSERVABILITY_CONFIG, INCIDENT_CATEGORIES, INCIDENT_STATUSES, OBSERVABILITY_SEVERITIES, buildDiagnosticBundle, buildHealthSummary, createIncident, createOperationalEvent, createPerformanceSample, diagnosticContainsSensitivePatterns, pruneObservability, recordOperationalEvent, recordPerformanceSample, resolveIncidentRecord, sanitizeOperationalDetails, scrubDiagnosticText, summarizePerformance } from './observability/engine.js';
import { STAGE18_MIN_STATIONS, STAGE18_UAT_CHECKS, STAGE18_UAT_KIND, UAT_STATUSES, buildStage18UatEvidence, createStage18UatSession, stage18UatSessions, summarizeStage18Uat, uatEvidenceContainsSensitivePatterns, updateStage18UatCheck } from './release/uat.js';
import { adapterFor, identifyBank, identifyDocumentKind, parseOfx } from './adapters/index.js';
import { extractPdfLocally, processFinancialDocument } from './document-engine/pipeline.js';
import { BANK_CATALOG } from './document-engine/bank-catalog.js';
import { DOCUMENT_KINDS } from './document-engine/classifier.js';
import { helperCapabilities } from './document-engine/local-helper.js';
import { reconcileReportedTotals, finalizePositions } from './document-engine/reconciliation.js';
import { buildAnalysisSnapshot, createAnalysisXlsx, createExecutivePdf } from './reports/index.js';
import { CLOSURE_STATUS, RECONCILIATION_STATUS, createQuarterClosure, quarterReconciliationSummary, reconcileQuarterControls, runAdvancedReconciliation, verifyQuarterClosure } from './reconciliation/engine.js';
import { compareReviewMetrics } from './review/review-engine.js';
import { RULE_KINDS, TEMPLATE_STATUSES, TRANSFORMS, TEMPLATE_BUNDLE_EXTENSION, activateTemplateVersion, nextTemplateVersion, normalizeCustomTemplate, parseTemplateBundle, suggestRuleFromCorrection, templateBundleBlob, testCustomTemplate } from './review/template-engine.js';
import { REVIEW_TARGET_TYPES, REVIEW_ACTIONS as ASSISTED_REVIEW_ACTIONS, applyReviewDecision, buildDocumentReviewItems, deriveEvidenceRecords } from './review/review-model.js';
import {
  BACKUP_CADENCES,
  RESTORE_STRATEGIES,
  createLocalSnapshot,
  deleteSnapshot,
  exportProjectHtaf,
  getBackupConfig,
  listSnapshots,
  maybeCreateAutomaticSnapshot,
  parseHtafFile,
  parseLegacyProjectJson,
  requestPersistentStorage,
  restoreProjectBundle,
  restoreSnapshot,
  saveBackupConfig,
  storageEstimate,
} from './backup/index.js';
import { hubAuthGate } from './hub-auth.js';
import { DEFAULT_ADMIN_LOGIN, ROLES, authenticate, changeOwnPassword, claimOrphanProjects, clearSession, createUser, getUser, hasUsers, listUsers, readSession, recoverAdmin, resetPassword, saveSession, setProjectOwner, setupFirstAdmin, updateUser, visibleProjects, withAuthPreserved } from './auth/local-auth.js';

const $ = id => document.getElementById(id);
const brl = cents => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format((cents || 0) / 100);
const dateBr = date => date ? date.slice(0, 10).split('-').reverse().join('/') : '—';
const dateTimeBr = date => date ? new Intl.DateTimeFormat('pt-BR', {dateStyle: 'short', timeStyle: 'short'}).format(new Date(date)) : '—';
const bytesLabel = value => {
  if (value == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toLocaleString('pt-BR', {maximumFractionDigits: unit ? 1 : 0})} ${units[unit]}`;
};
const esc = value => String(value ?? '').replace(/[&<>'"`=\/]/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;', '`': '&#96;', '=': '&#61;', '/': '&#47;'}[char]));
const familyLabel = value => ({FIXED_INCOME_SECURITY: 'Renda fixa individual', QUOTA_FUND: 'Fundo baseado em cotas', AUTOMATIC_CASH: 'Aplicação automática'})[value] || value;
const eventLabel = value => ({APPLICATION: 'Aplicação', REDEMPTION: 'Resgate', REDEMPTION_IRRF: 'IR no resgate', PERIODIC_IR: 'IR periódico', IOF: 'IOF', REALIZED_INCOME: 'Rendimento realizado', PERIOD_INCOME: 'Rendimento do período', UNREALIZED_INCOME: 'Rendimento não realizado', PRINCIPAL_RECOVERY: 'Principal recuperado', BALANCE_SNAPSHOT: 'Saldo', QUOTA_SNAPSHOT: 'Cotas', TAX_FORECAST: 'Previsão tributária', MANUAL_ADJUSTMENT: 'Ajuste manual', REPORTED_INCOME_TOTAL: 'Total informado de rendimento', REPORTED_IRRF_TOTAL: 'Total informado de IRRF'})[value] || value;
const evidenceClass = value => ['CONFIRMED', 'RECONCILED'].includes(value) ? 'good' : value === 'DIVERGENT' ? 'bad' : 'warn';
const statusClass = value => value === 'CLOSED' ? '' : value === 'REQUIRES_REVIEW' ? 'bad' : 'good';
// POSINFO01: rótulos em português e ciclo de vida da aplicação (código, saldo inicial, vencimento, resgate total)
const positionStatusLabel = value => ({ACTIVE:'Ativa',PARTIALLY_REDEEMED:'Parcialmente resgatada',CLOSED:'Encerrada',REQUIRES_REVIEW:'Em revisão'})[value] || value;
const evidenceLabel = value => ({CONFIRMED:'Confirmado',RECONCILED:'Conciliado',RECONSTRUCTED:'Reconstruído',ESTIMATED:'Estimado',PENDING:'Pendente',DIVERGENT:'Divergente'})[value] || value;
const lifecycleCodeLine = life => [life.code ? `Cód. ${life.code}` : '', life.maturity ? `Venc. ${life.maturity.date ? dateBr(life.maturity.date) : life.maturity.text}` : ''].filter(Boolean).join(' · ');
const initialBalanceCell = life => life.initialBalance.cents == null
  ? '<span class="muted">Não documentado</span>'
  : `${brl(life.initialBalance.cents)}<small>${esc(INITIAL_BALANCE_LABELS[life.initialBalance.basis])}${life.initialBalance.date && life.initialBalance.basis !== 'ORIGINAL_PRINCIPAL' ? ` · ${dateBr(life.initialBalance.date)}` : ''}</small>`;
const fullRedemptionCell = life => life.fullRedemption.closed ? (life.fullRedemption.date ? dateBr(life.fullRedemption.date) : 'Encerrada') : '<span class="muted">Em aberto</span>';
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_HTAF_BYTES = 750 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 100;
const ALLOWED_EXTENSIONS = new Set(['pdf', 'ofx', 'txt', 'json', 'htaf']);
const PARTIAL_LAYOUT_TEMPLATES = new Set(['SICREDI_TERM_DEPOSIT','ITAU_MONTHLY_SUMMARY','CAIXA_FUND_STATEMENT','SICOOB_RDC_STATEMENT','BANRISUL_CDB_AUTOMATIC_MONTHLY']);
const newLocalId = prefix => `${prefix}-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const moneyInput = cents => cents == null ? '' : ((Number(cents) || 0) / 100).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
const centsInput = value => { const text=String(value ?? '').trim().replace(/R\$|BRL/gi,'').replace(/\s/g,''); if(!text)return null; const normalized=text.includes(',')?text.replace(/\./g,'').replace(',','.'):text; const number=Number(normalized); if(!Number.isFinite(number))throw new TypeError(`Valor monetário inválido: ${value}`); return Math.round(number*100); };
const splitPatterns = value => String(value || '').split('||').map(item => item.trim()).filter(Boolean);
const normalizeDocumentText = value => String(value || '').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();

let repo;
let currentUser = null; // AUTH01: usuário logado nesta janela
const isAdmin = () => currentUser?.role === ROLES.ADMIN;
let state = {
  projects: [], activeProjectId: null, banks: [], accounts: [], positions: [], events: [], documents: [], issues: [], snapshots: [], evidences: [], processingRuns: [], reportedTotals: [], reportSnapshots: [],
  documentExtractions: [], reviewDecisions: [], documentLinks: [], customTemplates: [], templateTests: [], reviewItems: [], selectedReviewDocumentId: null,
  bankTransactions: [], reconciliations: [], quarterClosures: [], benchmarkRuns: [], benchmarkReference: null, pilotCases: [], pilotRuns: [],
  operationalEvents: [], performanceSamples: [], incidentReports: [], allIncidentReports: [], releaseChecks: [], releaseMeta: null, healthSummary: null, observabilityConfig: {...DEFAULT_OBSERVABILITY_CONFIG}, selectedUatSessionId: null,
  backupConfig: null, storage: {usage: null, quota: null, percent: null, persisted: null}, year: '', quarter: '', bankId: '', family: '', dashboardStatus: '', search: '',
};
let deferredInstallPrompt = null;
let pendingRestoreFile = null;
let editingDocumentId = null;
let editingReviewItemId = null;
let editingTemplateId = null;
let templateSeedItems = [];
let reviewPdfUrl = null;
let autoBackupTimer = null;
const operationalSessionId = `session-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
let runtimeCaptureInstalled = false;

async function seedGolden(force = false) {
  const current = await repo.all('projects');
  if (current.length && !force) return;
  if (force) await withAuthPreserved(repo, () => repo.clearAll({preserveTemplates:true}));
  const response = await fetch('./fixtures/golden/empresa-demo-inter-bb.json');
  const data = await response.json();
  const project = {...data.project, ownerUserId: currentUser?.id || null, companyName: data.company.name, cnpj: data.company.cnpj, taxProfile: normalizeTaxProfile(data.project.taxProfile || {regime:TAX_REGIMES.LUCRO_PRESUMIDO}), schemaVersion: 6, version: '1.9.0-offline.stage18-stable2'};
  await repo.put('projects', project);
  await repo.bulkPut('banks', data.banks);
  await repo.bulkPut('accounts', data.accounts);
  await repo.bulkPut('positions', data.positions);
  await repo.bulkPut('events', data.events);
  await repo.bulkPut('issues', data.issues);
  await repo.put('settings', {id: 'active-project', value: project.id});
}

async function reload() {
  state.projects = visibleProjects(currentUser, await repo.all('projects'));
  state.customTemplates = (await repo.all('customTemplates')).sort((a,b)=>String(a.familyId).localeCompare(String(b.familyId)) || Number(b.version||0)-Number(a.version||0));
  state.benchmarkRuns = (await repo.all('benchmarkRuns')).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,50);
  const observabilitySetting = await repo.get('settings','observability-config');
  state.observabilityConfig = {...DEFAULT_OBSERVABILITY_CONFIG,...(observabilitySetting?.value||{})};
  if(!state.releaseMeta){ try { state.releaseMeta = await (await fetch('./release.json',{cache:'no-store'})).json(); } catch { state.releaseMeta = {version:'1.9.0-offline.stage18-stable2',stage:18,releaseChannel:'INTERNAL_STABLE',dataTransmission:false,remoteBackend:false,persistence:'IndexedDB v9',stageClosure:{operationalPolicy:'MANDATORY_HUMAN_REVIEW_FOR_NON_HOMOLOGATED_LAYOUTS'}}; } }
  const activeSetting = await repo.get('settings', 'active-project');
  state.activeProjectId = activeSetting?.value && state.projects.some(project => project.id === activeSetting.value) ? activeSetting.value : state.projects[0]?.id || null;
  loadDashboardFilters();
  if (!state.activeProjectId) {
    state.banks = await repo.all('banks');
    for (const key of ['accounts','positions','events','documents','issues','snapshots','evidences','processingRuns','reportedTotals','reportSnapshots','reviewDecisions','documentLinks','documentExtractions','templateTests','bankTransactions','reconciliations','quarterClosures','pilotCases','pilotRuns','operationalEvents','performanceSamples','incidentReports']) state[key]=[];
    state.releaseChecks = await repo.all('releaseChecks'); state.allIncidentReports = await repo.all('incidentReports'); state.backupConfig = null; state.storage = await safeStorageEstimate(); return renderEmpty();
  }
  const [banks,accounts,positions,events,documents,issues,evidences,processingRuns,reportedTotals,reportSnapshots,reviewDecisions,documentLinks,documentExtractions,templateTests,bankTransactions,reconciliations,quarterClosures,pilotCases,pilotRuns,operationalEvents,performanceSamples,incidentReports,releaseChecks,snapshots,backupConfig,storage] = await Promise.all([
    repo.all('banks'),repo.allByProject('accounts',state.activeProjectId),repo.allByProject('positions',state.activeProjectId),repo.allByProject('events',state.activeProjectId),repo.allByProject('documents',state.activeProjectId),repo.allByProject('issues',state.activeProjectId),repo.allByProject('evidences',state.activeProjectId),repo.allByProject('processingRuns',state.activeProjectId),repo.allByProject('reportedTotals',state.activeProjectId),repo.allByProject('reportSnapshots',state.activeProjectId),repo.allByProject('reviewDecisions',state.activeProjectId),repo.allByProject('documentLinks',state.activeProjectId),repo.allByProject('documentExtractions',state.activeProjectId),repo.allByProject('templateTests',state.activeProjectId),repo.allByProject('bankTransactions',state.activeProjectId),repo.allByProject('reconciliations',state.activeProjectId),repo.allByProject('quarterClosures',state.activeProjectId),repo.allByProject('pilotCases',state.activeProjectId),repo.allByProject('pilotRuns',state.activeProjectId),repo.allByProject('operationalEvents',state.activeProjectId),repo.allByProject('performanceSamples',state.activeProjectId),repo.allByProject('incidentReports',state.activeProjectId),repo.all('releaseChecks'),listSnapshots(repo,state.activeProjectId),getBackupConfig(repo,state.activeProjectId),safeStorageEstimate(),
  ]);
  Object.assign(state,{banks,accounts,positions,events,issues,evidences,reportedTotals,reportSnapshots,reviewDecisions,documentLinks,documentExtractions,templateTests,bankTransactions,reconciliations,quarterClosures,pilotCases,pilotRuns,operationalEvents,performanceSamples,incidentReports,releaseChecks,snapshots,backupConfig,storage});
  state.allIncidentReports = await repo.all('incidentReports');
  state.documents=documents.sort((a,b)=>String(b.importedAt||'').localeCompare(String(a.importedAt||'')));
  state.processingRuns=processingRuns.sort((a,b)=>String(b.startedAt||'').localeCompare(String(a.startedAt||'')));
  state.reviewDecisions=reviewDecisions.sort((a,b)=>String(b.occurredAt||b.decidedAt||'').localeCompare(String(a.occurredAt||a.decidedAt||'')));
  render();
}

async function safeStorageEstimate() {
  try { return await storageEstimate(); } catch (error) { console.warn('Falha ao consultar quota:', error); return {usage: null, quota: null, percent: null, persisted: null}; }
}

function renderEmpty() {
  $('projectSelect').innerHTML = '<option>Nenhum projeto</option>';
  for (const id of ['kpiCards', 'quarterRows', 'positionRows', 'allPositionRows', 'eventRows', 'documentList', 'processingRunList', 'analysisKpis', 'reportedTotalsList', 'taxSimulation', 'issueList', 'projectCards', 'snapshotList','reviewFieldRows','reviewIssueList','reviewDecisionList','documentLinkList','templateList','bankBreakdown','closureSummary','globalSearchResults','closureKpis','closureRows','fiscalKpis','fiscalQuarterRows','fiscalMemoryRows','fiscalSourceList']) {
    $(id).innerHTML = '<div class="notice">Crie ou restaure um projeto.</div>';
  }
  renderStorage();
  renderHomologation().catch(console.error); renderPilot(); renderObservability();
}

function project() { return state.projects.find(item => item.id === state.activeProjectId); }
function selectableQuarters() { return operationalQuarters({events:state.events, quarterClosures:state.quarterClosures}); }
function dashboardYears() { return [...new Set(selectableQuarters().map(value => value.slice(0,4)))].sort(); }
function dashboardFiltersKey() { return `ht-stage17-dashboard-filters:${state.activeProjectId || 'none'}`; }
function loadDashboardFilters() {
  if (!state.activeProjectId) return;
  try {
    const saved = JSON.parse(localStorage.getItem(dashboardFiltersKey()) || '{}');
    state.year = saved.year || '';
    state.quarter = saved.quarter || '';
    state.bankId = saved.bankId || '';
    state.family = saved.family || '';
    state.dashboardStatus = saved.dashboardStatus || '';
    state.search = saved.search || '';
  } catch { /* filtros são conveniência; falha não pode bloquear o app */ }
}
function saveDashboardFilters() {
  if (!state.activeProjectId) return;
  try { localStorage.setItem(dashboardFiltersKey(), JSON.stringify({year:state.year,quarter:state.quarter,bankId:state.bankId,family:state.family,dashboardStatus:state.dashboardStatus,search:state.search})); } catch {}
}
function dashboardEventSet() {
  let events = state.events;
  if (state.year) events = events.filter(event => String(event.quarter || event.occurredAt || '').startsWith(state.year));
  return events;
}
function positionDashboardStatus(position) {
  const relatedIssues = state.issues.filter(issue => issue.positionId === position.id && !['RESOLVED','CLOSED'].includes(issue.status));
  const relatedEvents = state.events.filter(event => event.positionId === position.id && event.metadata?.excludedFromAnalysis !== true);
  if (relatedIssues.some(issue => issue.severity === 'BLOCKING') || relatedEvents.some(event => event.evidenceStatus === EVIDENCE_STATUS.DIVERGENT)) return 'BLOCKED';
  if (position.realizedIncomeStatus === EVIDENCE_STATUS.PENDING || relatedIssues.length || relatedEvents.some(event => [EVIDENCE_STATUS.PENDING,EVIDENCE_STATUS.ESTIMATED].includes(event.evidenceStatus))) return 'PENDING';
  return 'OK';
}
function quarterStatus(quarter, bankId = null) {
  const positions = state.positions.filter(position => (!bankId || position.bankId === bankId));
  const ids = new Set(positions.map(position => position.id));
  const events = state.events.filter(event => event.quarter === quarter && ids.has(event.positionId));
  const issues = state.issues.filter(issue => !['RESOLVED','CLOSED'].includes(issue.status) && (!issue.positionId || ids.has(issue.positionId)) && (!issue.quarter || issue.quarter === quarter));
  if (issues.some(issue => issue.severity === 'BLOCKING') || events.some(event => event.evidenceStatus === EVIDENCE_STATUS.DIVERGENT)) return 'BLOCKED';
  if (issues.length || events.some(event => [EVIDENCE_STATUS.PENDING,EVIDENCE_STATUS.ESTIMATED].includes(event.evidenceStatus)) || positions.some(position => position.realizedIncomeStatus === EVIDENCE_STATUS.PENDING && events.some(event => event.positionId === position.id && event.type === EVENT_TYPES.REDEMPTION))) return 'PENDING';
  return 'OK';
}
function filteredPositions() {
  const search = state.search.toLocaleLowerCase('pt-BR');
  return state.positions.filter(position =>
    (!state.bankId || position.bankId === state.bankId) &&
    (!state.family || position.productFamily === state.family) &&
    (!state.dashboardStatus || positionDashboardStatus(position) === state.dashboardStatus) &&
    (!search || `${position.name} ${position.externalReference || ''} ${state.banks.find(bank => bank.id === position.bankId)?.name || ''}`.toLocaleLowerCase('pt-BR').includes(search))
  );
}

function setFilters() {
  const years = dashboardYears();
  $('yearFilter').innerHTML = '<option value="">Todos</option>' + years.map(value => `<option value="${value}">${value}</option>`).join('');
  if (state.year && !years.includes(state.year)) state.year = '';
  $('yearFilter').value = state.year;
  const values = selectableQuarters().filter(value => !state.year || value.startsWith(state.year));
  $('quarterFilter').innerHTML = '<option value="">Todo o período</option>' + values.map(value => `<option value="${value}">${quarterLabel(value)}</option>`).join('');
  if (state.quarter && !values.includes(state.quarter)) state.quarter = '';
  $('quarterFilter').value = state.quarter;
  $('bankFilter').innerHTML = '<option value="">Todos</option>' + state.banks.filter(bank => state.positions.some(position => position.bankId === bank.id)).map(bank => `<option value="${esc(bank.id)}">${esc(bank.name)}</option>`).join('');
  if (state.bankId && !state.banks.some(bank => bank.id === state.bankId)) state.bankId = '';
  $('bankFilter').value = state.bankId;
  $('familyFilter').innerHTML = '<option value="">Todas</option>' + Object.values(PRODUCT_FAMILIES).map(family => `<option value="${family}">${familyLabel(family)}</option>`).join('');
  $('familyFilter').value = state.family;
  $('dashboardStatusFilter').value = state.dashboardStatus;
  $('searchFilter').value = state.search;
  const labels=[];
  if(state.year)labels.push(`Ano ${state.year}`); if(state.quarter)labels.push(quarterLabel(state.quarter)); if(state.bankId)labels.push(state.banks.find(b=>b.id===state.bankId)?.name||state.bankId); if(state.family)labels.push(familyLabel(state.family)); if(state.dashboardStatus)labels.push(state.dashboardStatus); if(state.search)labels.push(`Busca: “${state.search}”`);
  $('activeFilterSummary').innerHTML=labels.length?labels.map(label=>`<span class="filter-chip">${esc(label)}</span>`).join(''):'<span class="muted">Sem filtros adicionais.</span>';
  if($('closureYearFilter')){$('closureYearFilter').innerHTML='<option value="">Todos</option>'+years.map(value=>`<option value="${value}">${value}</option>`).join('');}
}

function render() {
  $('projectSelect').innerHTML = state.projects.map(item => `<option value="${esc(item.id)}" ${item.id === state.activeProjectId ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  setFilters();
  renderDashboard(); renderPositions(); renderEvents(); renderClosures(); renderDocuments(); renderProcessingRuns(); renderAnalysis(); renderFiscal(); renderReconciliation(); renderTaxProfile(); renderIssues(); renderReviewCenter().catch(console.error); renderTemplates(); renderHomologation().catch(console.error); renderPilot(); renderObservability(); renderProjects(); renderBackup();
}

function renderDashboard() {
  const positions = filteredPositions();
  const metrics = calculateDashboard({events: dashboardEventSet(), positions, quarter: state.quarter || null});
  const cards = [
    ['Valores aplicados', metrics.appliedCents, 'Aportes no filtro', 'money'], ['Resgates líquidos', metrics.netRedeemedCents, 'Créditos recebidos', 'money'],
    ['Rend. realizado', metrics.realizedIncomeTotalCents, 'Confirmado + conciliado', 'money'], ['Rend. do período', metrics.periodIncomeCents, 'Competência / valorização', 'money'],
    ['IR no resgate', metrics.redemptionIrrfCents, 'Retenção associada', 'money'], ['IR periódico', metrics.periodicIrCents, 'Cobrança sem resgate', 'money'],
    ['IR efetivo total', metrics.effectiveIrCents, 'Resgate + periódico', 'money'], ['IOF', metrics.iofCents, 'Associado aos resgates', 'money'], ['Saldo final', metrics.endingBalanceCents, 'Última posição do filtro', 'money'],
    ['Pendências', metrics.pendingCount, 'Exigem revisão', 'count'], ['Posições', metrics.positionCount, 'Aplicações e fundos', 'count'],
  ];
  $('kpiCards').innerHTML = cards.map((card, index) => `<button class="kpi ${[2, 6].includes(index) ? 'accent' : ''} ${index === 8 && card[1] ? 'warn' : ''}" data-kpi-index="${index}"><span>${card[0]}</span><strong>${card[3] === 'count' ? card[1] : brl(card[1])}</strong><small>${card[2]}</small></button>`).join('');
  $('positionCount').textContent = `${positions.length} posição(ões)`;
  $('positionRows').innerHTML = positions.map(position => {
    const summary = positionSummary(position, dashboardEventSet(), state.quarter || null);
    const bank = state.banks.find(item => item.id === position.bankId)?.name || position.bankId;
    const totalIr = summary.redemptionIrrfCents + summary.periodicIrCents;
    const pStatus=positionDashboardStatus(position);
    const life=positionLifecycle(position, state.events);const codeLine=lifecycleCodeLine(life);
    return `<tr><td class="product-cell"><strong>${esc(bank)}</strong><small>${esc(position.name)}</small>${codeLine?`<small class="position-code">${esc(codeLine)}</small>`:''}</td><td>${familyLabel(position.productFamily)}</td><td>${position.metadata?.openedAtDocumented === false ? 'Não documentada' : dateBr(position.openedAt)}</td><td class="num initial-balance">${initialBalanceCell(life)}</td><td class="num">${position.originalPrincipalCents == null ? 'Não documentado' : brl(summary.appliedCents || (!state.quarter && !state.year ? position.originalPrincipalCents : 0))}</td><td class="num">${brl(summary.netRedeemedCents)}</td><td class="num">${position.realizedIncomeStatus === 'PENDING' ? 'PENDENTE' : brl(summary.realizedIncomeCents)}</td><td class="num">${brl(summary.periodIncomeCents)}</td><td class="num">${brl(totalIr)}</td><td class="num">${brl(summary.iofCents)}</td><td class="num">${brl(summary.endingBalanceCents)}</td><td class="full-redemption">${fullRedemptionCell(life)}</td><td><span class="badge ${pStatus==='OK'?'good':pStatus==='BLOCKED'?'bad':'warn'}">${pStatus}</span></td><td><button class="button secondary mini" data-position-timeline="${esc(position.id)}">Linha do tempo</button></td></tr>`;
  }).join('') || '<tr><td colspan="14">Nenhuma aplicação para os filtros.</td></tr>';
  renderBankBreakdown(positions);
  renderDashboardClosureSummary();
  renderGlobalSearch();
  renderQuarterRows();
  document.querySelectorAll('[data-position-timeline]').forEach(button=>button.onclick=()=>openPositionTimeline(button.dataset.positionTimeline));
}

function renderBankBreakdown(positions) {
  const bankIds=[...new Set(positions.map(position=>position.bankId))];
  const items=bankIds.map(bankId=>{
    const bank=state.banks.find(item=>item.id===bankId); const bankPositions=positions.filter(position=>position.bankId===bankId);
    const metrics=calculateDashboard({events:dashboardEventSet(),positions:bankPositions,quarter:state.quarter||null});
    return {bankId,name:bank?.name||bankId,metrics,status:quarterStatus(state.quarter||selectableQuarters().at(-1),bankId)};
  }).sort((a,b)=>b.metrics.endingBalanceCents-a.metrics.endingBalanceCents);
  const max=Math.max(1,...items.map(item=>Math.max(item.metrics.endingBalanceCents,item.metrics.netRedeemedCents)));
  $('bankBreakdown').innerHTML=items.length?items.map(item=>`<button class="bank-breakdown-row" data-bank-focus="${esc(item.bankId)}"><div class="bank-breakdown-head"><strong>${esc(item.name)}</strong><span>${brl(item.metrics.endingBalanceCents)}</span></div><div class="mini-bar"><i data-bar-width="${Math.max(2,Math.round(item.metrics.endingBalanceCents/max*100))}"></i></div><div class="bank-breakdown-meta"><span>Resgates ${brl(item.metrics.netRedeemedCents)}</span><span>Rend. ${brl(item.metrics.realizedIncomeTotalCents)}</span><span>IR ${brl(item.metrics.effectiveIrCents)}</span></div></button>`).join(''):'<div class="notice small-notice">Nenhum banco no filtro.</div>';
  // POSINFO01/CSP: largura via CSSOM (style-src 'self' bloqueia atributo style inline)
  $('bankBreakdown').querySelectorAll('.mini-bar i[data-bar-width]').forEach(bar=>{bar.style.width=`${Number(bar.dataset.barWidth)||0}%`;});
  document.querySelectorAll('[data-bank-focus]').forEach(button=>button.onclick=()=>{state.bankId=button.dataset.bankFocus;saveDashboardFilters();setFilters();renderDashboard();});
}

function renderDashboardClosureSummary(){
  const qs=selectableQuarters().filter(q=>!state.year||q.startsWith(state.year)).slice(-8).reverse();
  $('closureSummary').innerHTML=qs.length?qs.map(q=>{const latest=state.quarterClosures.filter(c=>c.quarter===q).sort((a,b)=>Number(b.revision||0)-Number(a.revision||0))[0];const status=latest?'CLOSED':quarterStatus(q);return `<button class="closure-summary-row" data-closure-quarter="${q}"><span><strong>${quarterLabel(q)}</strong><small>${latest?`Fechamento r${latest.revision}`:'Período em aberto'}</small></span><span class="badge ${status==='CLOSED'||status==='OK'?'good':status==='BLOCKED'?'bad':'warn'}">${status}</span></button>`;}).join(''):'<div class="notice small-notice">Sem períodos.</div>';
  document.querySelectorAll('[data-closure-quarter]').forEach(button=>button.onclick=()=>{state.quarter=button.dataset.closureQuarter;saveDashboardFilters();setFilters();renderDashboard();showPage('closures');});
}

function moneySearchTokens(cents){const value=(Number(cents||0)/100);return [value.toFixed(2).replace('.',','),value.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),brl(cents)].join(' ');}
function renderGlobalSearch(){
  const query=state.search.trim().toLocaleLowerCase('pt-BR'); const panel=$('globalSearchPanel');
  if(query.length<2){panel.classList.add('hidden');$('globalSearchResults').innerHTML='';return;}
  const results=[];
  for(const position of state.positions){const bank=state.banks.find(b=>b.id===position.bankId)?.name||'';const hay=`${bank} ${position.name} ${position.externalReference||''} ${position.openedAt||''} ${moneySearchTokens(position.originalPrincipalCents)}`.toLocaleLowerCase('pt-BR');if(hay.includes(query))results.push({kind:'POSITION',id:position.id,title:position.name,meta:`${bank} · ${familyLabel(position.productFamily)}`,date:position.openedAt});}
  for(const event of state.events){const position=state.positions.find(p=>p.id===event.positionId);const bank=state.banks.find(b=>b.id===event.bankId)?.name||'';const doc=state.documents.find(d=>d.id===event.sourceDocumentId);const amount=event.type===EVENT_TYPES.REDEMPTION?(event.netAmountCents??event.amountCents):event.amountCents;const hay=`${bank} ${position?.name||''} ${eventLabel(event.type)} ${event.occurredAt||''} ${moneySearchTokens(amount)} ${doc?.fileName||''} ${event.metadata?.sourceSnippet||''}`.toLocaleLowerCase('pt-BR');if(hay.includes(query))results.push({kind:'EVENT',id:event.id,title:`${eventLabel(event.type)} · ${brl(amount)}`,meta:`${bank} · ${position?.name||'Sem aplicação'}${doc?` · ${doc.fileName}`:''}`,date:event.occurredAt,positionId:event.positionId});}
  for(const document of state.documents){const hay=`${document.fileName||''} ${document.bankName||''} ${document.kind||''} ${document.importedAt||''}`.toLocaleLowerCase('pt-BR');if(hay.includes(query))results.push({kind:'DOCUMENT',id:document.id,title:document.fileName,meta:`${document.bankName||document.bankId||'Instituição não definida'} · ${document.kind||'Documento'}`,date:document.importedAt});}
  const visible=results.slice(0,30); panel.classList.remove('hidden'); $('globalSearchCount').textContent=`${results.length} resultado(s)`;
  $('globalSearchResults').innerHTML=visible.length?visible.map(item=>`<button class="global-search-row" data-search-kind="${item.kind}" data-search-id="${esc(item.id)}" data-position-id="${esc(item.positionId||'')}"><span class="search-kind">${item.kind}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.meta)}</small></span><time>${dateBr(item.date)}</time></button>`).join(''):'<div class="notice small-notice">Nenhum resultado.</div>';
  document.querySelectorAll('[data-search-kind]').forEach(button=>button.onclick=()=>{if(button.dataset.searchKind==='POSITION'||button.dataset.searchKind==='EVENT')openPositionTimeline(button.dataset.positionId||button.dataset.searchId);else{state.selectedReviewDocumentId=button.dataset.searchId;showPage('reviews');renderReviewCenter().catch(console.error);}});
}

function renderQuarterRows() {
  const selectedBanks = state.bankId ? state.banks.filter(bank => bank.id === state.bankId) : state.banks.filter(bank => state.positions.some(position => position.bankId === bank.id));
  const rows = [];
  for (const quarter of selectableQuarters().filter(value=>!state.year||value.startsWith(state.year))) for (const bank of selectedBanks) {
    const positions = state.positions.filter(position => position.bankId === bank.id && (!state.family || position.productFamily === state.family) && (!state.dashboardStatus || positionDashboardStatus(position)===state.dashboardStatus));
    if (!positions.length) continue;
    const metrics = calculateDashboard({events: state.events, positions, quarter});
    if (!metrics.filteredEvents.length && !metrics.endingBalanceCents) continue;
    const qStatus=quarterStatus(quarter,bank.id); const pending = positions.some(position => position.realizedIncomeStatus === 'PENDING') && metrics.netRedeemedCents > 0;
    rows.push(`<tr class="drill-row" data-quarter-drill="${quarter}" data-bank-drill="${esc(bank.id)}" tabindex="0"><td><button class="link-button">${quarterLabel(quarter)}</button></td><td>${esc(bank.name)}</td><td class="num">${brl(metrics.appliedCents)}</td><td class="num">${brl(metrics.netRedeemedCents)}</td><td class="num">${brl(metrics.grossRedeemedCents)}</td><td class="num">${pending ? 'PENDENTE' : brl(metrics.realizedIncomeTotalCents)}</td><td class="num">${brl(metrics.periodIncomeCents)}</td><td class="num">${brl(metrics.redemptionIrrfCents)}</td><td class="num">${brl(metrics.periodicIrCents)}</td><td class="num">${brl(metrics.iofCents)}</td><td class="num">${brl(metrics.endingBalanceCents)}</td><td><span class="badge ${qStatus==='OK'?'good':qStatus==='BLOCKED'?'bad':'warn'}">${qStatus}</span></td></tr>`);
  }
  $('quarterRows').innerHTML = rows.join('') || '<tr><td colspan="11">Nenhum totalizador para os filtros.</td></tr>';
  document.querySelectorAll('[data-quarter-drill]').forEach(row=>{row.onclick=()=>openQuarterDrilldown(row.dataset.quarterDrill,row.dataset.bankDrill);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openQuarterDrilldown(row.dataset.quarterDrill,row.dataset.bankDrill);}};});
}

function evidenceForEvent(event){return state.evidences.filter(item=>item.eventId===event.id).sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0]||null;}
function eventSourceLabel(event){const evidence=evidenceForEvent(event);const document=state.documents.find(item=>item.id===(event.sourceDocumentId||evidence?.documentId));return {document,page:evidence?.pageNumber||event.metadata?.pageNumber||null,label:document?.fileName||'Fonte não vinculada'};}
function eventAmount(event){return event.type===EVENT_TYPES.REDEMPTION?(event.netAmountCents??event.amountCents):(event.amountCents??0);}
function timelineEventHtml(event){const source=eventSourceLabel(event);return `<article class="timeline-entry"><div class="timeline-dot ${evidenceClass(event.evidenceStatus)}"></div><div class="timeline-date">${dateBr(event.occurredAt)}<small>${quarterLabel(event.quarter)}</small></div><div class="timeline-content"><div class="timeline-title"><strong>${eventLabel(event.type)}</strong><span class="timeline-amount">${brl(eventAmount(event))}</span></div><p>${esc(event.metadata?.sourceSnippet||event.metadata?.note||'')}</p><div class="timeline-meta"><span class="badge ${evidenceClass(event.evidenceStatus)}">${esc(event.evidenceStatus||'—')}</span><span>${esc(source.label)}${source.page?` · p. ${source.page}`:''}</span>${source.document?`<button type="button" class="link-button" data-open-source-doc="${esc(source.document.id)}">Abrir fonte</button>`:''}</div></div></article>`;}
function bindSourceButtons(container){container.querySelectorAll('[data-open-source-doc]').forEach(button=>button.onclick=()=>{const dialog=button.closest('dialog');if(dialog?.open)dialog.close();state.selectedReviewDocumentId=button.dataset.openSourceDoc;showPage('reviews');renderReviewCenter().catch(console.error);});}
function openQuarterDrilldown(quarter,bankId){const bank=state.banks.find(item=>item.id===bankId);const positions=state.positions.filter(position=>position.bankId===bankId);const ids=new Set(positions.map(position=>position.id));const events=state.events.filter(event=>event.quarter===quarter&&ids.has(event.positionId)&&event.metadata?.excludedFromAnalysis!==true).sort((a,b)=>String(a.occurredAt).localeCompare(String(b.occurredAt))||String(a.type).localeCompare(String(b.type)));const metrics=calculateDashboard({events:state.events,positions,quarter});$('drilldownTitle').textContent=`${quarterLabel(quarter)} · ${bank?.name||bankId}`;$('drilldownSummary').innerHTML=[['Aplicações',metrics.appliedCents],['Resgates líquidos',metrics.netRedeemedCents],['Rend. realizado',metrics.realizedIncomeTotalCents],['IR efetivo',metrics.effectiveIrCents],['IOF',metrics.iofCents],['Saldo final',metrics.endingBalanceCents]].map(([label,value])=>`<div><span>${label}</span><strong>${brl(value)}</strong></div>`).join('');$('drilldownEvents').innerHTML=events.length?events.map(timelineEventHtml).join(''):'<div class="notice small-notice">Nenhum evento.</div>';bindSourceButtons($('drilldownEvents'));$('drilldownDialog').showModal();}
function openPositionTimeline(positionId){const position=state.positions.find(item=>item.id===positionId);if(!position)return;const bank=state.banks.find(item=>item.id===position.bankId);const events=state.events.filter(event=>event.positionId===positionId&&event.metadata?.excludedFromAnalysis!==true).sort((a,b)=>String(a.occurredAt).localeCompare(String(b.occurredAt))||String(a.type).localeCompare(String(b.type)));const summary=positionSummary(position,state.events);$('timelineTitle').textContent=position.name;$('timelineHeader').innerHTML=`<div><span>Instituição</span><strong>${esc(bank?.name||position.bankId)}</strong></div><div><span>Família</span><strong>${esc(familyLabel(position.productFamily))}</strong></div><div><span>Aplicado original</span><strong>${position.originalPrincipalCents==null?'Não documentado':brl(position.originalPrincipalCents)}</strong></div><div><span>Resgatado</span><strong>${brl(summary.netRedeemedCents)}</strong></div><div><span>Saldo atual</span><strong>${brl(summary.endingBalanceCents)}</strong></div><div><span>Status</span><strong>${positionDashboardStatus(position)}</strong></div>`;$('timelineEvents').innerHTML=events.length?events.map(timelineEventHtml).join(''):'<div class="notice small-notice">Nenhum evento.</div>';bindSourceButtons($('timelineEvents'));$('timelineDialog').showModal();}

function renderClosures(){
  if(!$('closureRows'))return;
  const year=$('closureYearFilter')?.value||''; const statusFilter=$('closureStatusFilter')?.value||'';
  const rows=[]; const allQuarters=selectableQuarters().filter(q=>!year||q.startsWith(year)).reverse();
  for(const q of allQuarters){const existing=state.quarterClosures.filter(c=>c.quarter===q).sort((a,b)=>Number(b.revision||0)-Number(a.revision||0));if(existing.length){for(const closure of existing){if(statusFilter&&statusFilter!=='CLOSED')continue;const m=closure.payload?.metrics||{};rows.push(`<tr><td>${quarterLabel(q)}</td><td>r${closure.revision}</td><td>${dateTimeBr(closure.closedAt)}</td><td class="num">${brl(m.appliedCents)}</td><td class="num">${brl(m.netRedeemedCents)}</td><td class="num">${brl(m.realizedIncomeTotalCents)}</td><td class="num">${brl(m.effectiveIrCents)}</td><td class="num">${brl(m.iofCents)}</td><td class="num">${brl(m.endingBalanceCents)}</td><td><span class="badge good">${esc(closure.quality||closure.status)}</span></td><td><span class="badge" data-closure-integrity="${esc(closure.id)}">SHA-256</span></td><td><button class="button secondary mini" data-closure-detail="${esc(closure.id)}">Ver detalhes</button></td></tr>`);}}else{const summary=quarterReconciliationSummary({quarter:q,reconciliations:state.reconciliations,controlResults:[],events:state.events,issues:state.issues});if(statusFilter&&statusFilter!==summary.status)continue;const positions=state.positions;const m=calculateDashboard({events:state.events,positions,quarter:q});rows.push(`<tr class="open-quarter-row"><td>${quarterLabel(q)}</td><td>—</td><td>Em aberto</td><td class="num">${brl(m.appliedCents)}</td><td class="num">${brl(m.netRedeemedCents)}</td><td class="num">${brl(m.realizedIncomeTotalCents)}</td><td class="num">${brl(m.effectiveIrCents)}</td><td class="num">${brl(m.iofCents)}</td><td class="num">${brl(m.endingBalanceCents)}</td><td><span class="badge ${summary.status===CLOSURE_STATUS.BLOCKED?'bad':'warn'}">${summary.status}</span></td><td>—</td><td><button class="button secondary mini" data-open-reconciliation="${q}">Conciliar</button></td></tr>`);}}
  $('closureRows').innerHTML=rows.join('')||'<tr><td colspan="11">Nenhum período corresponde aos filtros.</td></tr>';
  const closed=state.quarterClosures.length;const clean=state.quarterClosures.filter(c=>c.quality==='CLOSED_CLEAN').length;const withPending=state.quarterClosures.filter(c=>c.quality==='CLOSED_WITH_PENDING').length;const blocked=allQuarters.filter(q=>!state.quarterClosures.some(c=>c.quarter===q)&&quarterReconciliationSummary({quarter:q,reconciliations:state.reconciliations,controlResults:[],events:state.events,issues:state.issues}).status===CLOSURE_STATUS.BLOCKED).length;
  $('closureKpis').innerHTML=[["Fechamentos",closed],["Limpos",clean],["Com ressalvas",withPending],["Bloqueados",blocked]].map(([label,value],i)=>`<div class="kpi ${i===3&&value?'warn':''}"><span>${label}</span><strong>${value}</strong><small>Períodos / revisões</small></div>`).join('');
  document.querySelectorAll('[data-closure-detail]').forEach(button=>button.onclick=()=>openClosureDetail(button.dataset.closureDetail));
  document.querySelectorAll('[data-open-reconciliation]').forEach(button=>button.onclick=()=>{state.quarter=button.dataset.openReconciliation;saveDashboardFilters();showPage('reconciliation');renderReconciliation();});
  document.querySelectorAll('[data-closure-integrity]').forEach(async badge=>{const closure=state.quarterClosures.find(c=>c.id===badge.dataset.closureIntegrity);const ok=closure?await verifyQuarterClosure(closure):false;badge.textContent=ok?'Íntegro':'Falhou';badge.classList.add(ok?'good':'bad');});
}
async function openClosureDetail(id){const closure=state.quarterClosures.find(item=>item.id===id);if(!closure)return;const ok=await verifyQuarterClosure(closure);const m=closure.payload?.metrics||{};$('closureDetailTitle').textContent=`${quarterLabel(closure.quarter)} · revisão ${closure.revision}`;$('closureDetailBody').innerHTML=`<div class="closure-detail-grid"><div><span>Status</span><strong>${esc(closure.quality||closure.status)}</strong></div><div><span>Fechado em</span><strong>${dateTimeBr(closure.closedAt)}</strong></div><div><span>Responsável</span><strong>${esc(closure.closedBy||'Usuário local')}</strong></div><div><span>Integridade</span><strong class="${ok?'good-text':'bad-text'}">${ok?'ÍNTEGRO':'FALHA'}</strong></div></div><div class="drilldown-summary">${[['Aplicações',m.appliedCents],['Resgates líquidos',m.netRedeemedCents],['Resgates brutos',m.grossRedeemedCents],['Rend. realizado',m.realizedIncomeTotalCents],['IR efetivo',m.effectiveIrCents],['IOF',m.iofCents],['Saldo final',m.endingBalanceCents]].map(([l,v])=>`<div><span>${l}</span><strong>${brl(v)}</strong></div>`).join('')}</div><div class="integrity-box"><span>${closure.sourceIntegrityHash?'SHA-256 da cópia':'SHA-256'}</span><code>${esc(closure.integrityHash||'—')}</code>${closure.sourceIntegrityHash?`<small>SHA-256 de origem: <code>${esc(closure.sourceIntegrityHash)}</code></small>`:''}<small>${closure.payload?.eventIds?.length||0} evento(s) · ${closure.payload?.documentIds?.length||0} documento(s) · ${closure.payload?.pendingIds?.length||0} pendência(s)</small></div>`;$('closureDetailDialog').showModal();}

function renderPositions() {
  $('allPositionRows').innerHTML = state.positions.map(position => {
    const bank = state.banks.find(item => item.id === position.bankId)?.name || position.bankId;
    const summary = positionSummary(position, state.events);
    const life = positionLifecycle(position, state.events);
    return `<tr><td>${esc(bank)}</td><td class="product-cell"><strong>${esc(position.name)}</strong></td><td class="position-code">${life.code ? esc(life.code) : '<span class="muted">Sem código no documento</span>'}</td><td>${familyLabel(position.productFamily)}</td><td>${position.metadata?.openedAtDocumented === false ? 'Não documentada' : dateBr(position.openedAt)}</td><td class="num initial-balance">${initialBalanceCell(life)}</td><td>${life.maturity ? (life.maturity.date ? dateBr(life.maturity.date) : esc(life.maturity.text)) : '—'}</td><td class="num">${brl(summary.endingBalanceCents)}</td><td class="full-redemption">${fullRedemptionCell(life)}</td><td><span class="badge ${evidenceClass(position.realizedIncomeStatus)}">${esc(evidenceLabel(position.realizedIncomeStatus))}</span></td><td><span class="badge ${statusClass(position.status)}">${esc(positionStatusLabel(position.status))}</span></td></tr>`;
  }).join('');
}

function renderEvents() {
  const selectedType = $('eventTypeFilter').value;
  const selectedEvidence = $('evidenceFilter').value;
  const eventSearch = $('eventSearch').value.toLocaleLowerCase('pt-BR');
  const types = [...new Set(state.events.map(event => event.type))].sort();
  const evidences = [...new Set(state.events.map(event => event.evidenceStatus))].sort();
  $('eventTypeFilter').innerHTML = '<option value="">Todos</option>' + types.map(type => `<option value="${type}">${eventLabel(type)}</option>`).join('');
  $('evidenceFilter').innerHTML = '<option value="">Todas</option>' + evidences.map(evidence => `<option>${evidence}</option>`).join('');
  $('eventTypeFilter').value = types.includes(selectedType) ? selectedType : '';
  $('evidenceFilter').value = evidences.includes(selectedEvidence) ? selectedEvidence : '';
  const rows = state.events.filter(event =>
    (!$('eventTypeFilter').value || event.type === $('eventTypeFilter').value) &&
    (!$('evidenceFilter').value || event.evidenceStatus === $('evidenceFilter').value) &&
    (!state.bankId || event.bankId === state.bankId)
  ).filter(event => {
    const position = state.positions.find(item => item.id === event.positionId);
    return !eventSearch || `${position?.name || ''} ${event.notes || ''} ${eventLabel(event.type)}`.toLocaleLowerCase('pt-BR').includes(eventSearch);
  }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 500);
  $('eventRows').innerHTML = rows.map(event => {
    const position = state.positions.find(item => item.id === event.positionId);
    const bank = state.banks.find(item => item.id === event.bankId)?.name || event.bankId;
    const amount = event.type === EVENT_TYPES.REDEMPTION ? (event.netAmountCents ?? event.amountCents) : event.amountCents;
    return `<tr><td>${dateBr(event.occurredAt)}</td><td>${esc(bank)}</td><td>${esc(position?.name || event.positionId)}</td><td>${eventLabel(event.type)}</td><td class="num">${brl(amount)}</td><td><span class="badge ${evidenceClass(event.evidenceStatus)}">${event.evidenceStatus}</span></td><td>${esc(event.notes || '—')}</td></tr>`;
  }).join('');
}

function renderDocuments() {
  $('documentList').innerHTML = state.documents.length ? state.documents.map(document => `<div class="document-row"><div><strong>${esc(document.fileName)}</strong><br><small>${esc(document.hash?.slice(0, 16) || 'sem hash')}…</small><div class="status-detail">${esc(document.metadata?.extractionMethod || '')}${document.metadata?.extractionQuality != null ? ` · confiança ${(Number(document.metadata.extractionQuality) * 100).toFixed(0)}%` : ''}${document.metadata?.bankOverrideName || document.metadata?.bankOverrideId ? ' · classificação manual' : ''}</div></div><span class="badge">${esc(document.bankName || document.metadata?.bankOverrideName || document.bankId || 'Automático')}</span><span>${esc(document.kind || document.metadata?.documentKindOverride || 'Automático')}</span><span>${bytesLabel(document.size)}</span><span class="badge ${document.status === 'DUPLICATE' ? 'warn' : document.status?.includes('FAILED') || document.status === 'REQUIRES_REVIEW' ? 'bad' : document.status?.includes('PROCESSED') || document.status?.includes('PARSED') ? 'good' : ''}">${esc(document.status)}</span><div class="document-actions"><button class="button secondary mini" data-classify-document="${esc(document.id)}">Classificar</button><button class="button secondary mini" data-process-document="${esc(document.id)}" ${document.status === 'DUPLICATE' ? 'disabled' : ''}>Processar</button><button class="button secondary mini" data-review-document="${esc(document.id)}">Revisar</button></div></div>`).join('') : '<div class="notice">Nenhum documento importado neste dispositivo.</div>';
  document.querySelectorAll('[data-process-document]').forEach(button => button.onclick = () => processDocuments([button.dataset.processDocument]));
  document.querySelectorAll('[data-classify-document]').forEach(button => button.onclick = () => openDocumentClassification(button.dataset.classifyDocument));
  document.querySelectorAll('[data-review-document]').forEach(button => button.onclick = () => { state.selectedReviewDocumentId = button.dataset.reviewDocument; showPage('reviews'); renderReviewCenter().catch(console.error); });
}

function renderProcessingRuns() {
  $('processingRunList').innerHTML = state.processingRuns.length ? state.processingRuns.map(run => {
    const document = state.documents.find(item => item.id === run.documentId);
    return `<div class="processing-run"><div><strong>${esc(document?.fileName || run.documentId)}</strong><br><small>${dateTimeBr(run.startedAt)} · ${esc(run.templateId || 'GENERIC')}</small></div><span class="badge ${run.status === 'COMPLETED' ? 'good' : run.status === 'FAILED' ? 'bad' : 'warn'}">${esc(run.status)}</span><span>${esc(run.classification?.kind || '—')}</span><span>${run.extraction?.quality == null ? '—' : `${(run.extraction.quality * 100).toFixed(0)}%`}</span><span>${(run.eventCount || 0)} evento(s)</span></div>`;
  }).join('') : '<div class="notice">Nenhuma execução registrada.</div>';
}

function taxProfileFromControls() {
  const currentProject = project();
  const inferredYear = state.quarter
    ? Number(state.quarter.slice(0, 4))
    : Number(String(currentProject?.periodStart || '').slice(0, 4)) || null;
  const prior = normalizeTaxProfile(currentProject?.taxProfile || {});
  return normalizeTaxProfile({
    ...prior,
    regime: $('taxRegime').value,
    entityType: $('entityType').value,
    pisCofinsMode: $('pisCofinsMode').value,
    cnaePrincipal: $('cnaePrincipal').value,
    cnaesSecundarios: $('cnaesSecundarios').value,
    taxYear: inferredYear,
    positionTreatments: prior.positionTreatments,
  });
}

function renderTaxProfile() {
  const profile = normalizeTaxProfile(project()?.taxProfile || {});
  $('taxRegime').value = profile.regime;
  $('entityType').value = profile.entityType;
  $('pisCofinsMode').value = profile.pisCofinsMode === PIS_COFINS_MODES.NOT_APPLICABLE ? PIS_COFINS_MODES.NON_CUMULATIVE : profile.pisCofinsMode;
  $('cnaePrincipal').value = profile.cnaePrincipal;
  $('cnaesSecundarios').value = profile.cnaesSecundarios;
  $('pisCofinsModeLabel').classList.toggle('hidden', profile.regime !== TAX_REGIMES.LUCRO_REAL);
}

function currentSnapshot(quarterOverride = undefined) {
  if (!state.activeProjectId) return null;
  const selectedQuarter = quarterOverride === undefined ? (state.quarter || null) : (quarterOverride || null);
  return buildAnalysisSnapshot({project:project(),banks:state.banks,positions:state.positions,events:state.events,documents:state.documents,evidences:state.evidences,reportedTotals:state.reportedTotals,issues:state.issues,reviewDecisions:state.reviewDecisions,documentLinks:state.documentLinks,reconciliations:state.reconciliations,quarterClosures:state.quarterClosures,bankTransactions:state.bankTransactions,quarter:selectedQuarter});
}

function populateAnalysisQuarter() {
  const select = $('analysisQuarter');
  if (!select) return;
  const values = selectableQuarters();
  const requested = state.quarter && values.includes(state.quarter) ? state.quarter : '';
  select.innerHTML = '<option value="">Todo o período</option>' + values.map(value=>`<option value="${esc(value)}">${quarterLabel(value)}</option>`).join('');
  select.value = requested;
  $('analysisPeriodStatus').textContent = requested ? quarterLabel(requested) : 'Todo o período';
}

async function executeAnalysis() {
  const selected = $('analysisQuarter')?.value || '';
  state.quarter = selected;
  if (selected) state.year = selected.slice(0, 4);
  saveDashboardFilters();
  setFilters();
  renderAnalysis();
  await appOperationalEvent({category:'ANALYSIS',code:'ANALYSIS_RUN',message:'Análise local recalculada para o período selecionado',details:{quarter:selected||'ALL',status:'SUCCESS'}});
  const now = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const feedback = $('analysisRunFeedback');
  if (feedback) feedback.textContent = `Análise ${selected ? quarterLabel(selected) : 'de todo o período'} recalculada às ${now}.`;
}

function renderAnalysis() {
  populateAnalysisQuarter();
  const snapshot = currentSnapshot();
  if (!snapshot) return;
  const m = snapshot.metrics;
  const cards = [
    {label:'Aplicações',value:m.appliedCents,format:'money'},
    {label:'Resgates líquidos',value:m.netRedeemedCents,format:'money'},
    {label:'Rendimento do período',value:m.periodIncomeCents,format:'money',accent:true},
    {label:'Rend. realizados',value:m.realizedIncomeTotalCents,format:'money',accent:true},
    {label:'IR efetivo',value:m.effectiveIrCents,format:'money',accent:true},
    {label:'IOF',value:m.iofCents,format:'money'},
    {label:'Saldo final',value:m.endingBalanceCents,format:'money'},
    {label:'Pendências',value:snapshot.issues.length,format:'count'}
  ];
  $('analysisKpis').innerHTML = cards.map(card=>`<div class="kpi ${card.accent?'accent':''} ${card.format==='count'&&card.value?'warn':''}"><span>${card.label}</span><strong>${card.format==='count'?card.value:brl(card.value)}</strong></div>`).join('');
  const sim = snapshot.taxSimulation;
  const taxBaseLabel = sim.taxBaseCents == null ? 'Não calculada' : brl(sim.taxBaseCents);
  const taxCards = sim.mode === 'LUCRO_PRESUMIDO' ? [
    ['Base incremental elegível',taxBaseLabel],['IRPJ básico incremental',sim.irpjBasicCents==null?'Não calculado':brl(sim.irpjBasicCents)],['CSLL incremental',sim.csllCents==null?'Não calculada':brl(sim.csllCents)],['IRRF potencial crédito',brl(sim.irrfPotentialCreditCents ?? 0)]
  ] : [
    ['Insumo contábil/fiscal LR',sim.accountingInputCents==null?'Não calculado':brl(sim.accountingInputCents)],['Base PIS/Cofins',taxBaseLabel],['PIS estimado',sim.pisCents==null?'Não calculado':brl(sim.pisCents)],['Cofins estimada',sim.cofinsCents==null?'Não calculada':brl(sim.cofinsCents)],['IR retido elegível',brl(sim.irrfInformativeCents||0)]
  ];
  $('taxSimulation').innerHTML = `<p><strong>${sim.mode === 'LUCRO_PRESUMIDO' ? 'Lucro Presumido' : 'Lucro Real'} · ${sim.status}</strong>${sim.basisMethod ? ` <span class="muted">· ${esc(sim.basisMethod)}</span>` : ''}</p><div class="tax-box">${taxCards.map(card=>`<article><span>${card[0]}</span><strong>${card[1]}</strong></article>`).join('')}</div>${sim.warnings?.length?`<ul class="tax-warnings">${sim.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}<div class="notice"><strong>Reforma do consumo:</strong> o app mantém apenas um marcador futuro para CBS/IBS. Nenhum cálculo de CBS/IBS sobre rendimentos financeiros é realizado nesta versão.</div>`;
  const analysisPeriod = snapshot.quarter ? quarterLabel(snapshot.quarter) : 'todo o período';
  $('analysisStatus').innerHTML = state.processingRuns.length ? `<strong>Análise atualizada — ${esc(analysisPeriod)}:</strong> ${state.processingRuns.length} execução(ões) registrada(s), ${state.documents.filter(d=>d.status?.includes('PROCESSED')).length} documento(s) processado(s) e ${snapshot.issues.length} pendência(s).` : '<strong>Base demonstrativa:</strong> importe e processe documentos para gerar uma análise própria.';
  const reconciled = reconcileReportedTotals({projectId:state.activeProjectId,positions:state.positions,events:state.events,reportedTotals:state.reportedTotals});
  $('reportedTotalsList').innerHTML = reconciled.results.length ? `<div class="reported-row header"><span>Banco</span><span>Categoria</span><span>Rend. informe</span><span>IR informe</span><span>Rend. detalhado</span><span>IR detalhado</span><span>Status</span></div>${reconciled.results.map(item=>`<div class="reported-row"><span>${esc(state.banks.find(b=>b.id===item.bankId)?.name||item.bankId)}</span><span>${esc(item.category)}</span><span>${brl(item.incomeCents)}</span><span>${brl(item.irrfCents)}</span><span>${brl(item.detailedIncomeCents)}</span><span>${brl(item.detailedIrrfCents)}</span><span class="badge ${Math.abs(item.incomeDifferenceCents)<=1&&Math.abs(item.irrfDifferenceCents)<=1?'good':'warn'}">${Math.abs(item.incomeDifferenceCents)<=1&&Math.abs(item.irrfDifferenceCents)<=1?'CONCILIADO':'REVISAR'}</span></div>`).join('')}` : '<div class="notice">Nenhum total de informe foi extraído neste projeto.</div>';
}


function fiscalQuarterValue() {
  const values = selectableQuarters();
  const requested = $('fiscalQuarter')?.value || state.quarter;
  return values.includes(requested) ? requested : (values.at(-1) || '');
}

function pctLabel(rate) {
  if (rate == null) return '—';
  return `${(Number(rate) * 100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4})}%`;
}
function rateInput(rate) {
  if (rate == null) return '';
  return (Number(rate) * 100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4});
}
function parsePercentRate(value) {
  const text=String(value??'').trim(); if(!text)return null;
  const number=Number(text.replace(/\./g,'').replace(',','.'));
  if(!Number.isFinite(number)||number<0||number>100)throw new TypeError(`Alíquota inválida: ${value}`);
  return number/100;
}
function taxStatusClass(status){return status==='READY'?'good':status==='PARTIAL'?'warn':'bad';}
function fiscalPositionsForQuarter(quarter){const ids=new Set(state.events.filter(event=>event.quarter===quarter&&event.positionId).map(event=>event.positionId));const rows=state.positions.filter(position=>ids.has(position.id));return rows.length?rows:state.positions;}
function currentFiscalTreatment(positionId){const profile=normalizeTaxProfile(project()?.taxProfile||{});return profile.positionTreatments.find(rule=>rule.positionId===positionId)||{positionId,lpTreatment:TAX_TREATMENTS.DEFAULT,lrPisCofinsTreatment:TAX_TREATMENTS.DEFAULT,pisRateOverride:null,cofinsRateOverride:null,justification:''};}
function toggleFiscalRateFields(){const custom=$('fiscalLrTreatment')?.value===TAX_TREATMENTS.CUSTOM_RATE;if($('fiscalPisRate'))$('fiscalPisRate').disabled=!custom;if($('fiscalCofinsRate'))$('fiscalCofinsRate').disabled=!custom;}
function loadFiscalTreatmentEditor(){if(!$('fiscalTreatmentPosition'))return;const positionId=$('fiscalTreatmentPosition').value;const rule=currentFiscalTreatment(positionId);$('fiscalLpTreatment').value=rule.lpTreatment||TAX_TREATMENTS.DEFAULT;$('fiscalLrTreatment').value=rule.lrPisCofinsTreatment||TAX_TREATMENTS.DEFAULT;$('fiscalPisRate').value=rateInput(rule.pisRateOverride);$('fiscalCofinsRate').value=rateInput(rule.cofinsRateOverride);$('fiscalTreatmentJustification').value=rule.justification||'';toggleFiscalRateFields();}

function renderFiscal() {
  if(!$('fiscalQuarter')||!state.activeProjectId)return;
  const values=selectableQuarters();
  const prior=$('fiscalQuarter').value;
  $('fiscalQuarter').innerHTML=values.length?values.map(value=>`<option value="${value}">${quarterLabel(value)}</option>`).join(''):'<option value="">Sem trimestres</option>';
  const selected=values.includes(prior)?prior:(values.includes(state.quarter)?state.quarter:(values.at(-1)||''));
  $('fiscalQuarter').value=selected;
  const snapshot=currentSnapshot(selected);
  const sim=snapshot?.taxSimulation;
  if(!snapshot||!sim){$('fiscalStatusNotice').textContent='Nenhum dado disponível para a memória fiscal.';return;}
  const profile=normalizeTaxProfile(project()?.taxProfile||{});
  $('fiscalRegimeStatus').textContent=profile.regime==='LUCRO_PRESUMIDO'?'Lucro Presumido':'Lucro Real';
  $('fiscalSimulationStatus').textContent=sim.status||'—'; $('fiscalSimulationStatus').className=`status-line ${taxStatusClass(sim.status)}`;
  const pendingCount=(sim.base?.pendingCount||0)+(sim.base?.pendingPeriodIncomeCount||0)+(sim.irrfPendingCents?1:0);
  const kpis=sim.mode==='LUCRO_PRESUMIDO'?[['Base automática',sim.taxBaseCents],['IRPJ básico',sim.irpjBasicCents],['CSLL incremental',sim.csllCents],['IRRF potencial crédito',sim.irrfPotentialCreditCents??0],['Pendências',pendingCount,'count']]:[['Insumo contábil/fiscal LR',sim.accountingInputCents],['Base PIS/Cofins',sim.taxBaseCents],['PIS',sim.pisCents],['Cofins',sim.cofinsCents],['Pendências',pendingCount,'count']];
  $('fiscalKpis').innerHTML=kpis.map((item,index)=>`<div class="kpi ${[0,1].includes(index)?'accent':''} ${index===4&&item[1]?'warn':''}"><span>${item[0]}</span><strong>${item[2]==='count'?item[1]:(item[1]==null?'N/C':brl(item[1]))}</strong></div>`).join('');
  $('fiscalStatusNotice').innerHTML=`<strong>${quarterLabel(selected)} · ${sim.status}</strong> — ${sim.mode==='LUCRO_PRESUMIDO'?'Rendimentos realizados elegíveis compõem a base incremental.':'Receita financeira por competência é priorizada; rendimento realizado é fallback documental quando a série de competência não existe.'} ${pendingCount?'Há valores fora da base automática aguardando revisão.':'Não há pendências fiscais documentais na memória automática.'}`;
  $('fiscalQuarterRows').innerHTML=(snapshot.fiscalQuarterly||[]).map(row=>`<tr><td>${esc(quarterLabel(row.quarter))}</td><td>${row.regime==='LUCRO_PRESUMIDO'?'Presumido':'Real'}</td><td><span class="badge ${taxStatusClass(row.status)}">${esc(row.status)}</span></td><td class="num">${row.taxBaseCents==null?'N/C':brl(row.taxBaseCents)}</td><td class="num">${row.accountingInputCents==null?'—':brl(row.accountingInputCents)}</td><td class="num">${row.irpjBasicCents==null?'—':brl(row.irpjBasicCents)}</td><td class="num">${row.csllCents==null?'—':brl(row.csllCents)}</td><td class="num">${row.pisCents==null?'—':brl(row.pisCents)}</td><td class="num">${row.cofinsCents==null?'—':brl(row.cofinsCents)}</td><td class="num">${brl(row.irrfPotentialCreditCents||0)}</td><td>${row.pendingCount||0}</td><td>${row.futureConsumptionTax?.status||'Até 2026: PIS/Cofins'}</td></tr>`).join('')||'<tr><td colspan="12">Sem períodos.</td></tr>';
  const fiscalIsLp=sim.mode==='LUCRO_PRESUMIDO';
  $('fiscalMemoryRows').innerHTML=(snapshot.fiscalMemory||[]).map(row=>`<tr><td class="product-cell"><strong>${esc(row.bankName)}</strong><small>${esc(row.positionName)}</small></td><td>${fiscalIsLp?esc(row.lpTreatment):'—'}</td><td class="num">${fiscalIsLp?brl(row.lpTaxBaseCents):'—'}</td><td>${fiscalIsLp?'—':esc(row.lrBasisMethod)}</td><td class="num">${fiscalIsLp?'—':brl(row.lrAccountingIncomeCents)}</td><td>${fiscalIsLp?'—':`${esc(row.lrPisCofinsTreatment)}<br><small>${pctLabel(row.pisRate)} / ${pctLabel(row.cofinsRate)}</small>`}</td><td class="num">${fiscalIsLp?'—':brl(row.lrPisCofinsBaseCents)}</td><td class="num">${fiscalIsLp?'—':row.pisCents==null?'—':brl(row.pisCents)}</td><td class="num">${fiscalIsLp?'—':row.cofinsCents==null?'—':brl(row.cofinsCents)}</td><td class="num">${brl(row.irrfEligibleCents)}</td><td class="num">${fiscalIsLp?brl(row.lpIrrfPotentialCreditCents||0):'—'}</td><td><span class="badge ${row.requiresReview?'bad':row.evidencePendingCount?'warn':'good'}">${row.requiresReview?'REVISAR':row.evidencePendingCount?'PARCIAL':'OK'}</span>${row.treatmentJustification?`<div class="fiscal-rule-note">${esc(row.treatmentJustification)}</div>`:''}</td></tr>`).join('')||'<tr><td colspan="12">Nenhuma aplicação com eventos no trimestre.</td></tr>';
  const fiscalPositions=fiscalPositionsForQuarter(selected);const currentPosition=$('fiscalTreatmentPosition').value;
  $('fiscalTreatmentPosition').innerHTML=fiscalPositions.map(position=>`<option value="${esc(position.id)}">${esc(state.banks.find(bank=>bank.id===position.bankId)?.name||position.bankId)} — ${esc(position.name)}</option>`).join('');
  if(fiscalPositions.some(position=>position.id===currentPosition))$('fiscalTreatmentPosition').value=currentPosition;
  loadFiscalTreatmentEditor();
  $('fiscalSourceList').innerHTML=OFFICIAL_TAX_SOURCES.map(source=>`<div class="fiscal-source-row"><span class="badge">${esc(source.scope)}</span><strong>${esc(source.title)}</strong><code>${esc(source.url)}</code></div>`).join('');
}

async function saveFiscalTreatment(){
  const current=project(); if(!current)return;
  try{
    const positionId=$('fiscalTreatmentPosition').value;if(!positionId)throw new Error('Selecione uma aplicação.');
    const lpTreatment=$('fiscalLpTreatment').value,lrPisCofinsTreatment=$('fiscalLrTreatment').value,justification=$('fiscalTreatmentJustification').value.trim();
    const nonDefault=lpTreatment!==TAX_TREATMENTS.DEFAULT||lrPisCofinsTreatment!==TAX_TREATMENTS.DEFAULT;
    if(nonDefault&&!justification)throw new Error('Informe a justificativa do tratamento específico.');
    const prior=normalizeTaxProfile(current.taxProfile||{}),before=prior.positionTreatments.find(rule=>rule.positionId===positionId)||null;
    const rule={id:before?.id||newLocalId('tax-rule'),positionId,lpTreatment,lrPisCofinsTreatment,pisRateOverride:lrPisCofinsTreatment===TAX_TREATMENTS.CUSTOM_RATE?parsePercentRate($('fiscalPisRate').value):null,cofinsRateOverride:lrPisCofinsTreatment===TAX_TREATMENTS.CUSTOM_RATE?parsePercentRate($('fiscalCofinsRate').value):null,justification,updatedAt:new Date().toISOString()};
    if(lrPisCofinsTreatment===TAX_TREATMENTS.CUSTOM_RATE&&(rule.pisRateOverride==null||rule.cofinsRateOverride==null))throw new Error('Informe as duas alíquotas específicas.');
    const rules=prior.positionTreatments.filter(item=>item.positionId!==positionId);if(nonDefault)rules.push(rule);
    const updatedProfile=normalizeTaxProfile({...prior,positionTreatments:rules});
    await repo.put('projects',{...current,taxProfile:updatedProfile,updatedAt:new Date().toISOString(),version:'1.9.0-offline.stage18-stable2',schemaVersion:6});
    await repo.put('reviewDecisions',{id:newLocalId('tax-review'),projectId:state.activeProjectId,documentId:null,targetType:'TAX_RULE',targetId:positionId,action:nonDefault?'SET_TAX_TREATMENT':'RESET_TAX_TREATMENT',justification:justification||'Regra padrão restaurada.',decidedAt:new Date().toISOString(),before,after:nonDefault?rule:null});
    await scheduleAutomaticBackup('TAX_TREATMENT_UPDATE');await reload();showPage('fiscal');
  }catch(error){alert(error.message);}
}
async function removeFiscalTreatment(){
  const current=project();if(!current)return;const positionId=$('fiscalTreatmentPosition').value;if(!positionId)return;
  const prior=normalizeTaxProfile(current.taxProfile||{}),before=prior.positionTreatments.find(rule=>rule.positionId===positionId)||null;if(!before){loadFiscalTreatmentEditor();return;}
  if(!confirm('Restaurar o tratamento tributário padrão desta aplicação?'))return;
  const updatedProfile=normalizeTaxProfile({...prior,positionTreatments:prior.positionTreatments.filter(rule=>rule.positionId!==positionId)});
  await repo.put('projects',{...current,taxProfile:updatedProfile,updatedAt:new Date().toISOString(),version:'1.9.0-offline.stage18-stable2',schemaVersion:6});
  await repo.put('reviewDecisions',{id:newLocalId('tax-review'),projectId:state.activeProjectId,documentId:null,targetType:'TAX_RULE',targetId:positionId,action:'RESET_TAX_TREATMENT',justification:'Tratamento padrão restaurado pelo usuário.',decidedAt:new Date().toISOString(),before,after:null});
  await scheduleAutomaticBackup('TAX_TREATMENT_RESET');await reload();showPage('fiscal');
}
async function exportFiscalPdf(){const quarter=fiscalQuarterValue();const snapshot=currentSnapshot(quarter);if(!snapshot)return;const blob=createExecutivePdf(snapshot);const name=`${(project()?.name||'analise').replace(/[^a-z0-9]+/gi,'_')}_fiscal_${quarter||'periodo'}.pdf`;downloadBlob(blob,name);await repo.put('reportSnapshots',{id:newLocalId('report'),projectId:state.activeProjectId,createdAt:new Date().toISOString(),format:'PDF_FISCAL',quarter:quarter||null,metrics:snapshot.metrics,fileName:name});}
async function exportFiscalXlsx(){const quarter=fiscalQuarterValue();const snapshot=currentSnapshot(quarter);if(!snapshot)return;showBusy('Gerando XLSX fiscal','Montando visão trimestral, memória por aplicação e base normativa.');try{const blob=await createAnalysisXlsx(snapshot);const name=`${(project()?.name||'analise').replace(/[^a-z0-9]+/gi,'_')}_fiscal_${quarter||'periodo'}.xlsx`;downloadBlob(blob,name);await repo.put('reportSnapshots',{id:newLocalId('report'),projectId:state.activeProjectId,createdAt:new Date().toISOString(),format:'XLSX_FISCAL',quarter:quarter||null,metrics:snapshot.metrics,fileName:name});}finally{hideBusy();}}


function reconciliationQuarterValue() {
  const values = selectableQuarters();
  const requested = $('reconciliationQuarter')?.value || state.quarter;
  return values.includes(requested) ? requested : (values.at(-1) || '');
}

function reconciliationControlResults() {
  return reconcileQuarterControls({events:state.events,reportedTotals:state.reportedTotals});
}

function renderReconciliation() {
  if (!$('reconciliationQuarter')) return;
  const values = selectableQuarters();
  const prior = $('reconciliationQuarter').value || state.quarter;
  $('reconciliationQuarter').innerHTML = values.map(value=>`<option value="${esc(value)}">${quarterLabel(value)}</option>`).join('');
  if (!values.length) {
    $('reconciliationQuarterStatus').textContent='SEM DADOS';
    $('reconciliationClosureStatus').textContent='—';
    $('reconciliationKpis').innerHTML='';
    $('reconciliationRows').innerHTML='<tr><td colspan="14">Nenhum trimestre disponível.</td></tr>';
    $('reconciliationControlRows').innerHTML='<tr><td colspan="10">Nenhum controle disponível.</td></tr>';
    $('quarterClosureList').innerHTML='<div class="notice">Nenhum fechamento registrado.</div>';
    return;
  }
  const quarter = values.includes(prior) ? prior : values.at(-1);
  $('reconciliationQuarter').value=quarter;
  const controls = reconciliationControlResults();
  const summary = quarterReconciliationSummary({quarter,reconciliations:state.reconciliations,controlResults:controls,events:state.events,issues:state.issues});
  $('reconciliationQuarterStatus').textContent=summary.status;
  $('reconciliationQuarterStatus').className=`status-line ${summary.status===CLOSURE_STATUS.BLOCKED?'bad':summary.status===CLOSURE_STATUS.READY?'good':'warn'}`;
  const closures=state.quarterClosures.filter(item=>item.quarter===quarter).sort((a,b)=>Number(b.revision||0)-Number(a.revision||0));
  $('reconciliationClosureStatus').textContent=closures[0]?`${closures[0].quality} · r${closures[0].revision}`:'NÃO FECHADO';
  const qRecs=state.reconciliations.filter(item=>item.quarter===quarter);
  const qControls=controls.filter(item=>item.quarter===quarter);
  const metrics=calculateDashboard({events:state.events,positions:state.positions,quarter});
  const cards=[
    ['Operações',summary.operations,'Resgates individualizados'],['OFX auto',summary.autoMatched,'Correspondências ≥ 80'],['Revisão',summary.review+summary.unmatched,'Sem correspondência inequívoca'],['Bloqueios',summary.blockers.length,'Impedem fechamento'],
    ['Resgates líquidos',metrics.netRedeemedCents,'Fluxo bancário'],['Rend. realizados',metrics.realizedIncomeTotalCents,'Eventos fiscalmente realizados'],['IR efetivo',metrics.effectiveIrCents,'Resgate + periódico'],['Pendências',summary.pending.length,'Permitidas com ressalva'],
  ];
  $('reconciliationKpis').innerHTML=cards.map((card,index)=>`<div class="kpi ${[5,6].includes(index)?'accent':''} ${index===3&&card[1]?'warn':''}"><span>${card[0]}</span><strong>${index>=4&&index<=6?brl(card[1]):card[1]}</strong><small>${card[2]}</small></div>`).join('');
  const eventMap=new Map(state.events.map(item=>[item.id,item]));
  const positionMap=new Map(state.positions.map(item=>[item.id,item]));
  const bankMap=new Map(state.banks.map(item=>[item.id,item.name]));
  $('reconciliationRows').innerHTML=qRecs.length?qRecs.map(item=>{
    const redemption=eventMap.get(item.redemptionEventId);
    const position=positionMap.get(item.positionId);
    const eq2=item.equations?.grossFromFiscalDifferenceCents;
    return `<tr><td>${dateBr(redemption?.occurredAt)}</td><td>${esc(bankMap.get(item.bankId)||item.bankId)}</td><td>${esc(position?.name||item.positionId)}</td><td class="num">${brl(item.amounts?.netCents)}</td><td class="num">${brl(item.amounts?.irrfCents)}</td><td class="num">${brl(item.amounts?.iofCents)}</td><td class="num">${brl(item.amounts?.grossCents)}</td><td class="num">${item.costBasisStatus==='PENDING_HISTORICAL_COST'?'PENDENTE':brl(item.amounts?.realizedIncomeCents)}</td><td class="num">${item.costBasisStatus?.startsWith('PENDING')?'PENDENTE':brl(item.amounts?.principalRecoveryCents)}</td><td>${item.bankTransactionId?'SIM':'—'}</td><td class="num">${item.score}</td><td class="num">${brl(item.equations?.grossFromCashDifferenceCents)}</td><td class="num">${eq2==null?'N/D':brl(eq2)}</td><td><span class="badge ${item.status===RECONCILIATION_STATUS.BLOCKING?'bad':item.status===RECONCILIATION_STATUS.AUTO_MATCHED?'good':'warn'}">${item.status}</span></td></tr>`;
  }).join(''):'<tr><td colspan="14">Nenhum resgate individualizado no trimestre.</td></tr>';
  $('reconciliationControlRows').innerHTML=qControls.length?qControls.map(item=>`<tr><td>${esc(item.quarter)}</td><td>${esc(bankMap.get(item.bankId)||item.bankId)}</td><td>${esc(item.category)}</td><td class="num">${brl(item.reportedIncomeCents)}</td><td class="num">${brl(item.detailedIncomeCents)}</td><td class="num">${brl(item.incomeDifferenceCents)}</td><td class="num">${brl(item.reportedIrrfCents)}</td><td class="num">${brl(item.detailedIrrfCents)}</td><td class="num">${brl(item.irrfDifferenceCents)}</td><td><span class="badge ${item.status==='RECONCILED'?'good':'bad'}">${item.status}</span></td></tr>`).join(''):'<tr><td colspan="10">Nenhum informe trimestral estruturado para conferência.</td></tr>';
  $('quarterClosureList').innerHTML=closures.length?closures.map(item=>`<article class="issue"><h3>${quarterLabel(item.quarter)} · revisão ${item.revision}</h3><p>${esc(item.quality)} · ${dateTimeBr(item.closedAt)} · ${item.payload?.pendingIds?.length||0} pendência(s)</p><div class="issue-meta">SHA-256 ${esc(item.integrityHash||'')}</div><div class="issue-actions"><button class="button secondary mini" data-verify-closure="${esc(item.id)}">Verificar integridade</button></div></article>`).join(''):'<div class="notice">Nenhum fechamento registrado para este trimestre.</div>';
  document.querySelectorAll('[data-verify-closure]').forEach(button=>button.onclick=async()=>{const closure=state.quarterClosures.find(item=>item.id===button.dataset.verifyClosure);alert(await verifyQuarterClosure(closure)?'Integridade do fechamento confirmada.':'Falha de integridade: o snapshot não corresponde ao hash armazenado.');});
}

async function executeAdvancedReconciliation() {
  if (!state.activeProjectId) return;
  const operationStarted=performance.now(); let operationStatus='FAILED';
  showBusy('Executando conciliação','Cruzando eventos, OFX, informes e vínculos documentais.');
  try {
    const advanced=runAdvancedReconciliation({projectId:state.activeProjectId,positions:state.positions,events:state.events,reportedTotals:state.reportedTotals,bankTransactions:state.bankTransactions,documentLinks:state.documentLinks,accounts:state.accounts});
    const fingerprints=new Set(state.events.map(eventFingerprint));
    for(const event of advanced.generatedEvents||[]){const key=eventFingerprint(event);if(!fingerprints.has(key)){await repo.put('events',event);fingerprints.add(key);}}
    for(const old of state.reconciliations)await repo.delete('reconciliations',old.id);
    for(const item of advanced.reconciliations||[])await repo.put('reconciliations',item);
    const oldGenerated=state.issues.filter(issue=>issue.metadata?.reconciliationId||issue.metadata?.duplicateGroupId);
    for(const issue of oldGenerated)await repo.delete('issues',issue.id);
    for(const issue of advanced.issues||[])await repo.put('issues',issue);
    await repo.put('auditLog',{id:newLocalId('audit'),projectId:state.activeProjectId,occurredAt:new Date().toISOString(),action:'ADVANCED_RECONCILIATION',details:{operations:advanced.reconciliations.length,controls:advanced.controlResults.length,duplicates:advanced.duplicateGroups.length}});
    await scheduleAutomaticBackup('ADVANCED_RECONCILIATION');
    await reload();showPage('reconciliation'); operationStatus='SUCCESS';
  } finally {await appPerformance('RECONCILIATION',performance.now()-operationStarted,operationStatus,{count:state.reconciliations.length});hideBusy();}
}

let quarterClosureBusy=false;

async function closeReconciliationQuarter() {
  if(quarterClosureBusy)return;
  quarterClosureBusy=true;
  const closeButton=$('closeQuarterButton');
  if(closeButton)closeButton.disabled=true;
  const operationStarted=performance.now();
  try {
    const quarter=reconciliationQuarterValue();
    if(!quarter){alert('Não há trimestre disponível para fechamento.');return;}
    const mandatoryReviewDocs=unreviewedMandatoryDocumentsForQuarter(quarter);if(mandatoryReviewDocs.length){await appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.WARN,category:'CLOSURE',code:'MANDATORY_REVIEW_BLOCK',message:'Fechamento bloqueado por documento de layout não homologado sem revisão humana',details:{quarter,count:mandatoryReviewDocs.length,status:'BLOCKED'}});alert(`Fechamento bloqueado: ${mandatoryReviewDocs.length} documento(s) de layout PARTIAL, genérico ou template local ainda não possuem revisão humana integral concluída.`);return;}
    const controlResults=reconciliationControlResults();
    const result=await createQuarterClosure({project:project(),quarter,positions:state.positions,events:state.events,reconciliations:state.reconciliations,controlResults,issues:state.issues,documents:state.documents,existingClosures:state.quarterClosures});
    if(!result.created&&result.reason==='UNCHANGED'){await appPerformance('QUARTER_CLOSURE',performance.now()-operationStarted,'SUCCESS',{quarter,status:'UNCHANGED'});await appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.INFO,category:'CLOSURE',code:'QUARTER_CLOSURE_UNCHANGED',message:'Fechamento mantido porque não houve alteração material',details:{quarter,revision:result.closure?.revision||null,status:'UNCHANGED'}});alert(`Fechamento ${quarter} já está atualizado na revisão ${result.closure?.revision||'atual'}. Nenhuma nova revisão foi criada.`);return;}
    if(!result.created){await appPerformance('QUARTER_CLOSURE',performance.now()-operationStarted,'FAILED',{quarter,status:'BLOCKED'});await appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.WARN,category:'CLOSURE',code:'QUARTER_CLOSURE_BLOCKED',message:'Fechamento trimestral bloqueado por divergência material',details:{quarter,count:result.summary.blockers.length,status:'BLOCKED'}});alert(`Fechamento bloqueado. ${result.summary.blockers.length} divergência(s) material(is) precisam ser resolvidas.`);return;}
    if(result.summary.pending.length && !confirm(`O trimestre possui ${result.summary.pending.length} pendência(s) não bloqueante(s). Criar fechamento com ressalvas?`))return;
    await repo.put('quarterClosures',result.closure);
    await repo.put('auditLog',{id:newLocalId('audit'),projectId:state.activeProjectId,occurredAt:new Date().toISOString(),action:'QUARTER_CLOSURE',details:{quarter,closureId:result.closure.id,revision:result.closure.revision,integrityHash:result.closure.integrityHash}});
    await scheduleAutomaticBackup('QUARTER_CLOSURE');
    await appPerformance('QUARTER_CLOSURE',performance.now()-operationStarted,'SUCCESS',{quarter,status:'CLOSED'});
    await reload();showPage('reconciliation');
    alert(`Fechamento ${quarter} criado. Revisão ${result.closure.revision}.`);
  } finally {
    quarterClosureBusy=false;
    if(closeButton)closeButton.disabled=false;
  }
}

function renderIssues() {
  const pendingEvents = state.events.filter(event => ['PENDING', 'DIVERGENT', 'ESTIMATED'].includes(event.evidenceStatus) && !event.metadata?.excludedFromAnalysis);
  const items = [...state.issues.filter(issue => issue.status === 'OPEN'), ...pendingEvents.map(event => ({id: event.id, severity: event.evidenceStatus === 'DIVERGENT' ? 'BLOCKING' : 'REVIEW', title: `${eventLabel(event.type)} pendente`, details: event.notes || 'O evento exige validação documental.', positionId: event.positionId, documentId:event.sourceDocumentId, status: 'OPEN', synthetic:true}))];
  $('issueList').innerHTML = items.length ? items.map(issue => {
    const position = state.positions.find(item => item.id === issue.positionId);
    return `<article class="issue ${issue.severity === 'BLOCKING' ? 'blocking' : ''}"><h3>${esc(issue.title)}</h3><p>${esc(issue.details)}</p><div class="issue-meta">${esc(position?.name || '')} · ${esc(issue.severity || 'REVIEW')} · ${esc(issue.status)}</div>${issue.synthetic?'':`<div class="issue-actions"><button class="button secondary mini" data-open-review-doc="${esc(issue.documentId||'')}">Revisar documento</button><button class="button secondary mini" data-close-issue="${esc(issue.id)}">Encerrar</button></div>`}</article>`;
  }).join('') : '<div class="notice">Nenhuma pendência aberta.</div>';
  document.querySelectorAll('[data-open-review-doc]').forEach(button=>button.onclick=()=>{if(button.dataset.openReviewDoc)state.selectedReviewDocumentId=button.dataset.openReviewDoc;showPage('reviews');renderReviewCenter().catch(console.error);});
  document.querySelectorAll('[data-close-issue]').forEach(button=>button.onclick=()=>closeIssue(button.dataset.closeIssue));
}

function documentForReview() { return state.documents.find(document => document.id === state.selectedReviewDocumentId) || null; }
function extractionForDocument(documentId) { return state.documentExtractions.find(item=>item.documentId===documentId) || null; }
function reviewStore(targetType) { return ({EVENT:'events',POSITION:'positions',REPORTED_TOTAL:'reportedTotals',EVIDENCE:'evidences',ISSUE:'issues',DOCUMENT:'documents'})[targetType] || null; }
function reviewRecord(item) {
  const store=reviewStore(item.targetType); if(!store)return null;
  const collection=({events:state.events,positions:state.positions,reportedTotals:state.reportedTotals,evidences:state.evidences,issues:state.issues,documents:state.documents})[store]||[];
  return collection.find(record=>record.id===item.targetId)||null;
}
function reviewStatus(item) {
  const status=item.status||item.record?.evidenceStatus||'PENDING';
  if(['CONFIRMED','RECONCILED','APPROVED','CLOSED'].includes(status))return 'CONFIRMED';
  if(['DIVERGENT','REJECTED','BLOCKING'].includes(status))return 'DIVERGENT';
  return 'PENDING';
}
function reviewValueLabel(field) {
  if(field.value==null||field.value==='')return 'Não informado';
  if(field.type==='money')return brl(field.value);
  if(field.type==='date')return dateBr(field.value);
  if(field.type==='eventType')return eventLabel(field.value);
  if(field.type==='productFamily')return familyLabel(field.value);
  return String(field.value);
}
function reviewItemValue(item) { return item.fields?.slice(0,3).map(field=>`${field.label}: ${reviewValueLabel(field)}`).join(' · ') || item.snippet || '—'; }
function reviewSummary(items, documentId) {
  const counts={confirmed:0,pending:0,divergent:0}; for(const item of items){const s=reviewStatus(item);if(s==='CONFIRMED')counts.confirmed+=1;else if(s==='DIVERGENT')counts.divergent+=1;else counts.pending+=1;}
  counts.decisions=state.reviewDecisions.filter(d=>d.documentId===documentId).length; return counts;
}
async function ensureExtraction(document) {
  const existing=extractionForDocument(document.id); if(existing)return existing;
  if(!(document.blob instanceof Blob))throw new Error('O documento original não está disponível. Restaure um .htaf com documentos.');
  let extraction;
  if(/pdf/i.test(document.mimeType)||/\.pdf$/i.test(document.fileName)) extraction=await extractPdfLocally(document.blob,document.fileName,{});
  else {const text=await document.blob.text();extraction={method:'PLAIN_TEXT',quality:1,fullText:text,pages:[{pageNumber:1,text,method:'PLAIN_TEXT'}],warnings:[]};}
  const record={id:`extraction-${document.id}`,projectId:state.activeProjectId,documentId:document.id,method:extraction.method,quality:extraction.quality,fullText:normalizeDocumentText(extraction.fullText||''),pages:(extraction.pages||[]).map(page=>({pageNumber:page.pageNumber||1,text:normalizeDocumentText(page.text||''),method:page.method||extraction.method})),createdAt:new Date().toISOString(),templateId:document.metadata?.templateId||null};
  await repo.put('documentExtractions',record); state.documentExtractions.push(record); return record;
}
async function extractedTextForDocument(document) { const extraction=await ensureExtraction(document); return {text:extraction.fullText||'',extraction}; }
async function renderReviewDocumentViewer(document,page=1) {
  const viewer=$('reviewDocumentViewer'); if(!viewer)return;
  if(reviewPdfUrl){URL.revokeObjectURL(reviewPdfUrl);reviewPdfUrl=null;}
  if(!document){viewer.innerHTML='<div class="notice">Selecione um documento.</div>';return;}
  if(!(document.blob instanceof Blob)){viewer.innerHTML='<div class="notice">Arquivo original indisponível. Restaure um backup com documentos.</div>';return;}
  if(/pdf/i.test(document.mimeType)||/\.pdf$/i.test(document.fileName)){reviewPdfUrl=URL.createObjectURL(document.blob);viewer.innerHTML=`<iframe id="reviewPdfFrame" title="${esc(document.fileName)}" src="${reviewPdfUrl}#page=${Math.max(1,Number(page)||1)}&zoom=page-width"></iframe>`;return;}
  try{viewer.innerHTML=`<pre>${esc(await document.blob.text())}</pre>`;}catch{viewer.innerHTML='<div class="notice">Não foi possível visualizar este formato.</div>';}
}
function jumpReviewPage(){const frame=$('reviewPdfFrame');if(frame&&reviewPdfUrl)frame.src=`${reviewPdfUrl}#page=${Math.max(1,Number($('reviewPageNumber').value)||1)}&zoom=page-width`;}
function reviewMetricCells(metrics){return {Aplicações:metrics.appliedCents,Resgates:metrics.netRedeemedCents,'Rendimento realizado':metrics.realizedIncomeTotalCents,'IR no resgate':metrics.redemptionIrrfCents,'IR periódico':metrics.periodicIrCents,'IOF':metrics.iofCents,'Saldo final':metrics.endingBalanceCents};}
function renderReviewDelta(){
  const comparison=compareReviewMetrics({events:state.events,positions:state.positions,decisions:state.reviewDecisions});const before=reviewMetricCells(comparison.before),after=reviewMetricCells(comparison.after);
  $('reviewDeltaPanel').innerHTML=Object.keys(after).map(label=>`<div class="delta-item"><span>${label}</span><small>${brl(before[label])} →</small><strong>${brl(after[label])}</strong><em class="${after[label]===before[label]?'':'changed'}">${after[label]===before[label]?'sem alteração':`${after[label]>before[label]?'+':''}${brl(after[label]-before[label])}`}</em></div>`).join('');
}
async function renderReviewCenter(){
  if(!$('reviewDocumentSelect'))return;
  $('reviewDocumentSelect').innerHTML=state.documents.length?state.documents.map(doc=>`<option value="${esc(doc.id)}">${esc(doc.fileName)} · ${esc(doc.status||'')}</option>`).join(''):'<option value="">Nenhum documento</option>';
  if(!state.documents.some(doc=>doc.id===state.selectedReviewDocumentId))state.selectedReviewDocumentId=state.documents[0]?.id||null;$('reviewDocumentSelect').value=state.selectedReviewDocumentId||'';
  const selectedDocument=documentForReview();
  if(!selectedDocument){state.reviewItems=[];$('reviewFieldRows').innerHTML='<tr><td colspan="7">Nenhum documento.</td></tr>';$('reviewIssueList').innerHTML='';$('reviewDecisionList').innerHTML='';$('documentLinkList').innerHTML='';await renderReviewDocumentViewer(null);return;}
  const items=buildDocumentReviewItems({document:selectedDocument,documentId:selectedDocument.id,positions:state.positions,events:state.events,reportedTotals:state.reportedTotals,evidences:state.evidences,issues:state.issues});state.reviewItems=items;
  const filter=$('reviewStatusFilter').value;const search=$('reviewSearch').value.toLocaleLowerCase('pt-BR');const visible=items.filter(item=>item.targetType!==REVIEW_TARGET_TYPES.ISSUE&&(!filter||reviewStatus(item)===filter)&&(!search||`${item.label} ${reviewItemValue(item)} ${item.snippet}`.toLocaleLowerCase('pt-BR').includes(search)));
  const summary=reviewSummary(items,selectedDocument.id);$('reviewSummaryBadge').textContent=`${summary.pending} pendente(s) · ${summary.confirmed} confirmado(s) · ${summary.divergent} divergente(s)`;$('reviewSummaryBadge').className=`badge ${summary.pending||summary.divergent?'warn':'good'}`;
  $('reviewDocumentName').textContent=selectedDocument.fileName;$('reviewDocumentMeta').textContent=`${selectedDocument.bankName||selectedDocument.bankId||'Instituição não confirmada'} · ${selectedDocument.kind||'Tipo não confirmado'} · ${selectedDocument.metadata?.templateId||'Sem template'} · ${selectedDocument.metadata?.extractionQuality==null?'confiança não informada':`${Math.round(Number(selectedDocument.metadata.extractionQuality)*100)}%`}`;
  $('reviewFieldRows').innerHTML=visible.length?visible.map(item=>`<tr class="field-status-row-${reviewStatus(item).toLowerCase()}"><td><input class="review-row-check" type="checkbox" value="${esc(item.id)}"></td><td><strong>${esc(item.label)}</strong><br><small>${esc(item.category)} · ${esc(item.targetType)}</small></td><td class="review-value">${esc(reviewItemValue(item))}</td><td class="review-snippet"><button class="link-button" data-review-page="${item.pageNumber||1}">p. ${item.pageNumber||1}</button> ${esc(item.snippet||'Sem trecho associado')}</td><td>${item.confidence==null?'—':`${Math.round(item.confidence*100)}%`}</td><td><span class="badge ${evidenceClass(item.status)}">${esc(item.status||'PENDING')}</span></td><td><div class="review-actions"><button class="button secondary mini" data-review-approve="${esc(item.id)}">Aprovar</button><button class="button secondary mini" data-review-edit="${esc(item.id)}">Editar</button><button class="button danger mini" data-review-reject="${esc(item.id)}">Rejeitar</button></div></td></tr>`).join(''):'<tr><td colspan="7">Nenhum campo corresponde aos filtros.</td></tr>';
  const documentIssues=state.issues.filter(issue=>issue.documentId===selectedDocument.id);$('reviewIssueList').innerHTML=documentIssues.length?documentIssues.map(issue=>`<article class="issue ${issue.severity==='BLOCKING'?'blocking':''}"><h3>${esc(issue.title)}</h3><p>${esc(issue.details)}</p><div class="issue-meta">${esc(issue.severity||'REVIEW')} · ${esc(issue.status||'OPEN')}</div><div class="issue-actions"><button class="button secondary mini" data-review-page="${issue.pageNumber||1}">Ver página</button>${['RESOLVED','CLOSED'].includes(issue.status)?`<button class="button secondary mini" data-reopen-review-issue="${esc(issue.id)}">Reabrir</button>`:`<button class="button secondary mini" data-close-review-issue="${esc(issue.id)}">Encerrar com justificativa</button>`}</div></article>`).join(''):'<div class="notice small-notice">Nenhuma pendência deste documento.</div>';
  $('linkSourceDocument').innerHTML=`<option value="${esc(selectedDocument.id)}">${esc(selectedDocument.fileName)}</option>`;$('linkTargetDocument').innerHTML=state.documents.filter(doc=>doc.id!==selectedDocument.id).map(doc=>`<option value="${esc(doc.id)}">${esc(doc.fileName)}</option>`).join('');
  renderDocumentLinks(selectedDocument.id);renderReviewDecisions(selectedDocument.id);renderReviewDelta();$('reviewSelectAll').checked=false;
  document.querySelectorAll('[data-review-page]').forEach(button=>button.onclick=()=>{$('reviewPageNumber').value=button.dataset.reviewPage;jumpReviewPage();});
  document.querySelectorAll('[data-review-approve]').forEach(button=>button.onclick=()=>applyReviewItem(button.dataset.reviewApprove,ASSISTED_REVIEW_ACTIONS.APPROVE));
  document.querySelectorAll('[data-review-edit]').forEach(button=>button.onclick=()=>openReviewEdit(button.dataset.reviewEdit));
  document.querySelectorAll('[data-review-reject]').forEach(button=>button.onclick=()=>openReviewEdit(button.dataset.reviewReject,true));
  document.querySelectorAll('[data-close-review-issue]').forEach(button=>button.onclick=()=>changeIssueStatus(button.dataset.closeReviewIssue,false));
  document.querySelectorAll('[data-reopen-review-issue]').forEach(button=>button.onclick=()=>changeIssueStatus(button.dataset.reopenReviewIssue,true));
  await renderReviewDocumentViewer(selectedDocument,Number($('reviewPageNumber').value)||1);
}
function fieldInput(field){
  const id=`review-field-${field.path.replace(/[^a-z0-9]/gi,'-')}`;const value=field.type==='money'?moneyInput(field.value):field.type==='date'?dateBr(field.value):String(field.value??'');
  if(field.type==='eventType')return `<label>${esc(field.label)}<select data-review-field="${esc(field.path)}" data-review-type="eventType">${Object.values(EVENT_TYPES).map(type=>`<option value="${type}" ${type===field.value?'selected':''}>${esc(eventLabel(type))}</option>`).join('')}</select></label>`;
  if(field.type==='productFamily')return `<label>${esc(field.label)}<select data-review-field="${esc(field.path)}" data-review-type="productFamily">${Object.values(PRODUCT_FAMILIES).map(type=>`<option value="${type}" ${type===field.value?'selected':''}>${esc(familyLabel(type))}</option>`).join('')}</select></label>`;
  if(field.type==='evidenceStatus')return `<label>${esc(field.label)}<select data-review-field="${esc(field.path)}" data-review-type="evidenceStatus">${Object.values(EVIDENCE_STATUS).map(type=>`<option value="${type}" ${type===field.value?'selected':''}>${type}</option>`).join('')}</select></label>`;
  if(field.type==='positionStatus')return `<label>${esc(field.label)}<select data-review-field="${esc(field.path)}" data-review-type="positionStatus">${Object.values(POSITION_STATUS).map(type=>`<option value="${type}" ${type===field.value?'selected':''}>${type}</option>`).join('')}</select></label>`;
  if(field.type==='textarea')return `<label>${esc(field.label)}<textarea id="${id}" data-review-field="${esc(field.path)}" data-review-type="text">${esc(value)}</textarea></label>`;
  return `<label>${esc(field.label)}<input id="${id}" data-review-field="${esc(field.path)}" data-review-type="${esc(field.type)}" value="${esc(value)}"></label>`;
}
function openReviewEdit(itemId,rejectMode=false){
  const item=state.reviewItems.find(value=>value.id===itemId);if(!item)return;editingReviewItemId=itemId;
  $('reviewEditLabel').textContent=item.label;$('reviewEditSnippet').textContent=item.snippet||'Sem trecho associado';
  $('reviewEditFields').innerHTML=(item.fields||[]).map(fieldInput).join('');
  const reconstructedIncome=item.targetType===REVIEW_TARGET_TYPES.EVENT&&item.record.type===EVENT_TYPES.REALIZED_INCOME&&item.record.evidenceStatus===EVIDENCE_STATUS.RECONSTRUCTED;
  $('reviewTaxApprovalLabel').classList.toggle('hidden',!reconstructedIncome);
  $('reviewTaxApproval').checked=Boolean(item.record.metadata?.approvedForTaxSimulation);
  $('reviewEditJustification').value='';$('reviewRejectButton').classList.toggle('primary-reject',rejectMode);$('reviewEditDialog').showModal();
}
function readReviewChanges(item){
  const changes={};document.querySelectorAll('[data-review-field]').forEach(input=>{let value=input.value;const type=input.dataset.reviewType;if(type==='money')value=centsInput(value);else if(type==='date'){const parts=value.includes('/')?value.split('/'):null;value=parts&&parts.length===3?`${parts[2]}-${parts[1]}-${parts[0]}`:value;}changes[input.dataset.reviewField]=value;});
  if(item.targetType===REVIEW_TARGET_TYPES.EVENT)changes.metadata={...(item.record.metadata||{}),approvedForTaxSimulation:$('reviewTaxApproval').checked};return changes;
}
async function persistReviewItem(itemId,action,changes=null,justification='Aprovação documental individual.',options={}){
  const item=state.reviewItems.find(value=>value.id===itemId);if(!item)throw new Error('Item de revisão não encontrado.');const record=reviewRecord(item);if(!record)throw new Error('Registro original não encontrado.');
  const result=applyReviewDecision({targetType:item.targetType,record,action,changes:changes||{},justification,decisionId:newLocalId('review')});const store=reviewStore(item.targetType);if(!store)throw new Error('Tipo de registro não editável.');
  await repo.put(store,result.updated);await repo.put('reviewDecisions',{...result.decision,documentId:item.documentId,createdAt:result.decision.decidedAt});
  for(const evidenceId of item.evidenceIds||[]){const evidence=await repo.get('evidences',evidenceId);if(evidence)await repo.put('evidences',{...evidence,status:action===ASSISTED_REVIEW_ACTIONS.REJECT?'REJECTED':action===ASSISTED_REVIEW_ACTIONS.KEEP_PENDING?'REVIEW':'APPROVED',reviewedAt:new Date().toISOString(),reviewDecisionId:result.decision.id});}
  if(options.reload!==false){await scheduleAutomaticBackup('REVIEW_DECISION');await reload();showPage('reviews');}
  return result;
}
async function applyReviewItem(itemId,action,changes=null,justification='Aprovação documental individual.'){return persistReviewItem(itemId,action,changes,justification);}
async function applyReviewDialogAction(action){
  try{
    const item=state.reviewItems.find(value=>value.id===editingReviewItemId);if(!item)throw new Error('Item não encontrado.');
    const justification=$('reviewEditJustification').value;
    let effectiveAction=action;
    if(action===ASSISTED_REVIEW_ACTIONS.APPROVE&&item.targetType===REVIEW_TARGET_TYPES.EVENT&&item.record.type===EVENT_TYPES.REALIZED_INCOME&&$('reviewTaxApproval').checked)effectiveAction=ASSISTED_REVIEW_ACTIONS.APPROVE_FOR_TAX;
    const changes=[ASSISTED_REVIEW_ACTIONS.CORRECT,ASSISTED_REVIEW_ACTIONS.KEEP_PENDING].includes(effectiveAction)?readReviewChanges(item):{};
    await applyReviewItem(item.id,effectiveAction,changes,justification||(effectiveAction===ASSISTED_REVIEW_ACTIONS.KEEP_PENDING?'Mantido pendente para complementação documental.':'Aprovação documental individual.'));
    $('reviewEditDialog').close();editingReviewItemId=null;
  }catch(error){alert(error.message);}
}
async function approveSelectedReviewItems(){
  const ids=[...document.querySelectorAll('.review-row-check:checked')].map(input=>input.value);if(!ids.length)return alert('Selecione ao menos um item.');
  showBusy('Aprovando seleção','Registrando decisões e evidências no projeto local.');
  try{for(const id of ids)await persistReviewItem(id,ASSISTED_REVIEW_ACTIONS.APPROVE,{},'Aprovação documental em lote.',{reload:false});await scheduleAutomaticBackup('REVIEW_BATCH');await reload();showPage('reviews');}
  catch(error){alert(error.message);}finally{hideBusy();}
}
async function changeIssueStatus(issueId,reopen=false){
  const issue=state.issues.find(item=>item.id===issueId);if(!issue)return;const reason=prompt(reopen?'Justificativa para reabrir a pendência:':'Justificativa para encerrar a pendência:');if(!reason)return;
  const action=reopen?ASSISTED_REVIEW_ACTIONS.REOPEN_ISSUE:ASSISTED_REVIEW_ACTIONS.CLOSE_ISSUE;
  const result=applyReviewDecision({targetType:REVIEW_TARGET_TYPES.ISSUE,record:issue,action,justification:reason,decisionId:newLocalId('review')});
  await repo.put('issues',result.updated);await repo.put('reviewDecisions',{...result.decision,documentId:issue.documentId||null,createdAt:result.decision.decidedAt});await scheduleAutomaticBackup(reopen?'ISSUE_REOPENED':'ISSUE_CLOSED');await reload();showPage('reviews');
}
async function closeIssue(issueId){return changeIssueStatus(issueId,false);}
function renderReviewDecisions(documentId){const decisions=state.reviewDecisions.filter(item=>item.documentId===documentId).slice(0,100);$('reviewDecisionList').innerHTML=decisions.length?decisions.map(decision=>`<div class="review-decision-row"><span>${dateTimeBr(decision.decidedAt||decision.occurredAt)}<br><small>${esc(decision.action)}</small></span><span><strong>${esc(decision.targetType||decision.entityType||'Registro')}</strong><br><small>registro local auditável</small></span><span>${esc(decision.justification||decision.reason||'—')}</span></div>`).join(''):'<div class="notice small-notice">Nenhuma decisão registrada.</div>';}
function renderDocumentLinks(documentId){const links=state.documentLinks.filter(link=>link.sourceDocumentId===documentId||link.targetDocumentId===documentId);$('documentLinkList').innerHTML=links.length?links.map(link=>{const source=state.documents.find(doc=>doc.id===link.sourceDocumentId),target=state.documents.find(doc=>doc.id===link.targetDocumentId);return `<div class="document-link-row"><span>${esc(source?.fileName||link.sourceDocumentId)}</span><span class="badge">${esc(link.relation)}</span><span>${esc(target?.fileName||link.targetDocumentId)}</span><button class="button danger mini" data-delete-link="${esc(link.id)}">Excluir</button></div>`;}).join(''):'<div class="notice small-notice">Nenhum vínculo cadastrado.</div>';document.querySelectorAll('[data-delete-link]').forEach(button=>button.onclick=async()=>{const link=state.documentLinks.find(value=>value.id===button.dataset.deleteLink);if(!link)return;if(!confirm('Remover este vínculo documental?'))return;await repo.delete('documentLinks',link.id);await repo.put('reviewDecisions',{id:newLocalId('review'),projectId:state.activeProjectId,documentId:link.sourceDocumentId,targetType:'DOCUMENT_LINK',targetId:link.id,action:'UNLINK_DOCUMENTS',justification:'Vínculo documental removido pelo usuário.',decidedAt:new Date().toISOString(),before:link,after:null});await reload();showPage('reviews');});}
async function saveDocumentLink(){const sourceDocumentId=$('linkSourceDocument').value,targetDocumentId=$('linkTargetDocument').value;if(!sourceDocumentId||!targetDocumentId||sourceDocumentId===targetDocumentId)return alert('Selecione documentos distintos.');const relation=$('linkRelation').value;const id=`link-${state.activeProjectId}-${[sourceDocumentId,targetDocumentId].sort().join('-')}-${relation}`;await repo.put('documentLinks',{id,projectId:state.activeProjectId,documentId:sourceDocumentId,sourceDocumentId,targetDocumentId,relation,notes:$('linkNotes').value.trim().slice(0,500),createdAt:new Date().toISOString(),status:'CONFIRMED'});await repo.put('reviewDecisions',{id:newLocalId('review'),projectId:state.activeProjectId,documentId:sourceDocumentId,targetType:'DOCUMENT_LINK',targetId:id,action:'LINK_DOCUMENTS',justification:$('linkNotes').value.trim()||'Vínculo documental confirmado pelo usuário.',decidedAt:new Date().toISOString(),before:null,after:{sourceDocumentId,targetDocumentId,relation}});await reload();}

const FIELD_TARGETS=['document.bankName','document.kind','account.agency','account.accountNumber','position.name','position.openedAt','position.originalPrincipalCents','position.externalReference','position.productFamily'];
const TOTAL_TARGETS=['reportedTotal.quarter','reportedTotal.category','reportedTotal.incomeCents','reportedTotal.irrfCents'];
function templateTargetOptions(kind,current=''){const values=kind===RULE_KINDS.EVENT?Object.values(EVENT_TYPES):kind===RULE_KINDS.REPORTED_TOTAL?TOTAL_TARGETS:FIELD_TARGETS;return values.map(value=>`<option value="${value}" ${value===current?'selected':''}>${kind===RULE_KINDS.EVENT?eventLabel(value):value}</option>`).join('');}
function renderTemplateRuleRows(rules=[]){$('templateRuleRows').innerHTML=rules.length?rules.map((rule,index)=>`<tr data-rule-index="${index}"><td><select class="template-rule-kind"><option value="FIELD" ${rule.kind==='FIELD'?'selected':''}>Campo</option><option value="EVENT" ${rule.kind==='EVENT'?'selected':''}>Evento</option><option value="REPORTED_TOTAL" ${rule.kind==='REPORTED_TOTAL'?'selected':''}>Total</option></select></td><td><input class="template-rule-label" value="${esc(rule.label||'')}"><select class="template-rule-target">${templateTargetOptions(rule.kind,rule.target||rule.eventType)}</select></td><td><input class="template-rule-regex" value="${esc(rule.regex||'')}"><small>Em evento: grupo 1 = data; grupo 2 = valor.</small></td><td><select class="template-rule-transform">${Object.values(TRANSFORMS).map(value=>`<option value="${value}" ${value===(rule.transform||rule.amountTransform)?'selected':''}>${value}</option>`).join('')}</select></td><td><input class="template-rule-required" type="checkbox" ${rule.required?'checked':''}></td><td><button type="button" class="button danger mini" data-remove-rule="${index}">×</button></td></tr>`).join(''):'<tr><td colspan="6">Adicione ao menos uma regra.</td></tr>';document.querySelectorAll('.template-rule-kind').forEach(select=>select.onchange=()=>{const row=select.closest('tr');row.querySelector('.template-rule-target').innerHTML=templateTargetOptions(select.value);});document.querySelectorAll('[data-remove-rule]').forEach(button=>button.onclick=()=>{const rules=readRulesFromForm();rules.splice(Number(button.dataset.removeRule),1);renderTemplateRuleRows(rules);});}
function readRulesFromForm(){return [...document.querySelectorAll('#templateRuleRows tr[data-rule-index]')].map((row,index)=>{const kind=row.querySelector('.template-rule-kind').value,target=row.querySelector('.template-rule-target').value,transform=row.querySelector('.template-rule-transform').value;const base={id:`rule-${index+1}`,label:row.querySelector('.template-rule-label').value||`Regra ${index+1}`,kind,regex:row.querySelector('.template-rule-regex').value,flags:kind===RULE_KINDS.EVENT?'gim':'im',required:row.querySelector('.template-rule-required').checked,confidence:.85,transform};return kind===RULE_KINDS.EVENT?{...base,eventType:target,dateGroup:1,amountGroup:2,dateTransform:TRANSFORMS.DATE_BR,amountTransform:TRANSFORMS.MONEY_BR}:{...base,target,captureGroup:1};});}
function currentTemplate(){return state.customTemplates.find(item=>item.id===editingTemplateId)||null;}
function templateFromForm(){const current=currentTemplate();return normalizeCustomTemplate({...(current||{}),id:current?.id,familyId:current?.familyId,name:$('templateName').value,institutionName:$('templateInstitutionName').value,institutionId:$('templateInstitutionId').value,status:$('templateStatus').value,priority:$('templatePriority').value,productFamily:$('templateProductFamily').value,documentKinds:$('templateDocumentKind').value?[$('templateDocumentKind').value]:[],requiredTextPatterns:splitPatterns($('templateRequiredPatterns').value),optionalTextPatterns:splitPatterns($('templateOptionalPatterns').value),fileNamePatterns:splitPatterns($('templateFilePatterns').value),description:$('templateDescription').value,rules:readRulesFromForm(),updatedAt:new Date().toISOString()});}
function populateTemplateEditor(template){$('templateEditorEmpty').classList.toggle('hidden',Boolean(template));$('templateEditor').classList.toggle('hidden',!template);if(!template)return;$('templateEditorTitle').textContent=`${template.name} · v${template.version}`;$('templateEditorMeta').textContent=`${template.status} · ${template.familyId}`;$('templateName').value=template.name;$('templateInstitutionName').value=template.institutionName||'';$('templateInstitutionId').value=template.institutionId||'';$('templateStatus').value=template.status;$('templatePriority').value=template.priority;$('templateProductFamily').value=template.productFamily;$('templateDocumentKind').innerHTML='<option value="">Qualquer</option>'+Object.values(DOCUMENT_KINDS).map(kind=>`<option value="${kind}">${kind}</option>`).join('');$('templateDocumentKind').value=template.documentKinds?.[0]||'';$('templateRequiredPatterns').value=(template.requiredTextPatterns||[]).join(' || ');$('templateOptionalPatterns').value=(template.optionalTextPatterns||[]).join(' || ');$('templateFilePatterns').value=(template.fileNamePatterns||[]).join(' || ');$('templateDescription').value=template.description||'';renderTemplateRuleRows(template.rules||[]);$('templateTestDocument').innerHTML=state.documents.map(doc=>`<option value="${esc(doc.id)}">${esc(doc.fileName)}</option>`).join('');const tests=state.templateTests.filter(test=>test.templateId===template.id).slice(0,5);$('templateTestHistory').innerHTML=tests.map(test=>`<li>${dateTimeBr(test.createdAt)} · ${test.matched?'compatível':'não compatível'} · ${test.eventMatches||0} evento(s)</li>`).join('')||'<li>Nenhum teste registrado.</li>';}
function renderTemplates(){if(!$('templateList'))return;if(editingTemplateId&&!state.customTemplates.some(item=>item.id===editingTemplateId))editingTemplateId=null;if(!editingTemplateId)editingTemplateId=state.customTemplates[0]?.id||null;$('templateList').innerHTML=state.customTemplates.length?state.customTemplates.map(template=>`<article class="template-card ${template.id===editingTemplateId?'active':''}" data-open-template="${esc(template.id)}"><h3>${esc(template.name)} · v${template.version}</h3><p>${esc(template.institutionName||'Instituição genérica')} · ${familyLabel(template.productFamily)}</p><footer><span class="badge ${template.status==='ACTIVE'?'good':template.status==='ARCHIVED'?'':'warn'}">${template.status}</span><small>${template.rules.length} regra(s)</small></footer></article>`).join(''):'<div class="notice small-notice">Nenhum template local.</div>';document.querySelectorAll('[data-open-template]').forEach(card=>card.onclick=()=>{editingTemplateId=card.dataset.openTemplate;renderTemplates();});populateTemplateEditor(currentTemplate());}
async function saveTemplate(){try{let template=templateFromForm();await repo.put('customTemplates',template);editingTemplateId=template.id;if(template.status===TEMPLATE_STATUSES.ACTIVE)await activateSelectedTemplate(false);await reload();showPage('templates');}catch(error){alert(error.message);}}
async function activateSelectedTemplate(reloadAfter=true){const target=currentTemplate()||templateFromForm();let templates=state.customTemplates.some(item=>item.id===target.id)?state.customTemplates:[...state.customTemplates,target];templates=activateTemplateVersion(templates,target.id);await repo.bulkPut('customTemplates',templates);editingTemplateId=target.id;if(reloadAfter){await reload();showPage('templates');}}
async function createNewTemplateVersion(){const template=currentTemplate();if(!template)return;const next=nextTemplateVersion(template);await repo.put('customTemplates',next);editingTemplateId=next.id;await reload();showPage('templates');}
function newBlankTemplate(){const familyId=`template-local-${Date.now()}`;const draft=normalizeCustomTemplate({id:`${familyId}-v1`,familyId,name:'Novo template',status:TEMPLATE_STATUSES.DRAFT,institutionId:'',institutionName:'',productFamily:PRODUCT_FAMILIES.FIXED_INCOME_SECURITY,rules:[]});state.customTemplates=[draft,...state.customTemplates];editingTemplateId=draft.id;renderTemplates();}
async function runTemplateTest(){try{const template=templateFromForm(),document=state.documents.find(doc=>doc.id===$('templateTestDocument').value);if(!document)throw new Error('Selecione um documento.');showBusy('Testando template','Extraindo texto e aplicando as regras sem alterar a análise.');const {text,extraction}=await extractedTextForDocument(document);const result=testCustomTemplate(template,{projectId:state.activeProjectId,documentId:document.id,fileName:document.fileName,text,bank:{id:document.bankId||template.institutionId||'generic',name:document.bankName||template.institutionName||'Instituição'},classification:{kind:document.kind||template.documentKinds?.[0]||DOCUMENT_KINDS.UNKNOWN},method:extraction.method});const summary={id:newLocalId('template-test'),projectId:state.activeProjectId,documentId:document.id,templateId:template.id,createdAt:new Date().toISOString(),matched:result.matched,matchScore:result.match?.score||0,fieldMatches:result.fields?.filter(item=>item.status==='MATCHED').length||0,eventMatches:result.events?.length||0,issueCount:result.issues?.length||0};await repo.put('templateTests',summary);$('templateTestResult').innerHTML=`<div class="template-test-result"><strong>${result.matched?'Template compatível':'Template não compatível'}</strong><pre>${esc(JSON.stringify(result,null,2))}</pre></div>`;await reload();showPage('templates');}catch(error){alert(error.message);}finally{hideBusy();}}
async function applyTemplateToSelectedDocument(){const template=templateFromForm(),document=state.documents.find(doc=>doc.id===$('templateTestDocument').value);if(!document)return alert('Selecione um documento.');if(!confirm(`Reprocessar ${document.fileName} com ${template.name} v${template.version}? Os eventos anteriores derivados deste documento serão substituídos.`))return;await repo.put('customTemplates',template);await repo.put('documents',{...document,status:'READY_TO_REPROCESS',metadata:{...(document.metadata||{}),forcedTemplateId:template.id}});await reload();await processDocuments([document.id]);}
function exportActiveTemplates(){const selected=currentTemplate()?[currentTemplate()]:state.customTemplates.filter(item=>item.status===TEMPLATE_STATUSES.ACTIVE);if(!selected.length)return alert('Não há template selecionado.');downloadBlob(templateBundleBlob(selected),`${selected[0].familyId}_templates${TEMPLATE_BUNDLE_EXTENSION}`);}
async function importTemplatesFile(file){try{const templates=parseTemplateBundle(await file.text());let imported=0,skipped=0;for(const template of templates){const existing=state.customTemplates.find(item=>item.id===template.id);if(existing&&JSON.stringify(existing)===JSON.stringify(template)){skipped+=1;continue;}let candidate=template;if(existing){const family=state.customTemplates.filter(item=>item.familyId===template.familyId).sort((a,b)=>Number(b.version||0)-Number(a.version||0));candidate=nextTemplateVersion(family[0]||template);candidate={...candidate,...template,id:candidate.id,version:candidate.version,status:TEMPLATE_STATUSES.DRAFT,origin:'IMPORTED_COLLISION'};}await repo.put('customTemplates',candidate);imported+=1;}await reload();showPage('templates');alert(`${imported} template(s) importado(s); ${skipped} já existente(s).`);}catch(error){alert(error.message);}}
function openTemplateSeedDialog(){
  const checked=[...document.querySelectorAll('.review-row-check:checked')].map(input=>state.reviewItems.find(item=>item.id===input.value)).filter(Boolean);
  templateSeedItems=checked.length?checked:state.reviewItems.filter(item=>item.snippet&&reviewStatus(item)!=='CONFIRMED').slice(0,12);
  if(!templateSeedItems.length)return alert('Selecione campos ou eventos para criar o rascunho.');const doc=documentForReview();$('templateSeedName').value=`Template ${doc?.bankName||'instituição local'}`;$('templateSeedInstitution').value=doc?.bankName||'';$('templateSeedDialog').showModal();
}
async function confirmTemplateSeed(){
  try{
    const doc=documentForReview();const rules=[];const eventTypes=new Set();const fieldTargets=new Set();
    for(const item of templateSeedItems){
      if(item.targetType===REVIEW_TARGET_TYPES.EVENT){const event=state.events.find(value=>value.id===item.targetId);if(!event||eventTypes.has(event.type))continue;eventTypes.add(event.type);rules.push(suggestRuleFromCorrection({label:eventLabel(event.type),kind:RULE_KINDS.EVENT,eventType:event.type}));}
      else if(item.targetType===REVIEW_TARGET_TYPES.POSITION){for(const field of item.fields||[]){if(!['openedAt','originalPrincipalCents','name','productFamily'].includes(field.path)||fieldTargets.has(field.path))continue;fieldTargets.add(field.path);rules.push(suggestRuleFromCorrection({label:field.label,target:`position.${field.path}`,transform:field.type==='money'?TRANSFORMS.MONEY_BR:field.type==='date'?TRANSFORMS.DATE_BR:TRANSFORMS.TEXT}));}}
      else if(item.targetType===REVIEW_TARGET_TYPES.REPORTED_TOTAL){for(const field of item.fields||[]){const target=`reportedTotal.${field.path}`;if(fieldTargets.has(target))continue;fieldTargets.add(target);rules.push(suggestRuleFromCorrection({label:field.label,target,kind:RULE_KINDS.REPORTED_TOTAL,transform:field.type==='money'?TRANSFORMS.MONEY_BR:TRANSFORMS.TEXT}));}}
    }
    if(!rules.length)throw new Error('Não foi possível gerar regras genéricas a partir da seleção.');
    const slug=($('templateSeedInstitution').value||'instituicao-local').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'instituicao-local';
    const familyId=`template-${slug}-${Date.now()}`;
    const template=normalizeCustomTemplate({id:`${familyId}-v1`,familyId,name:$('templateSeedName').value,institutionName:$('templateSeedInstitution').value,institutionId:doc?.bankId&&doc.bankId!=='generic'?doc.bankId:'',status:TEMPLATE_STATUSES.DRAFT,documentKinds:doc?.kind?[doc.kind]:[],requiredTextPatterns:[],optionalTextPatterns:doc?.bankName?[doc.bankName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')]:[],productFamily:state.positions.find(position=>position.metadata?.sourceDocumentId===doc?.id)?.productFamily||PRODUCT_FAMILIES.FIXED_INCOME_SECURITY,rules,description:'Rascunho criado localmente a partir de tipos de campo e evento. Não contém documentos, CNPJ, contas, nomes de clientes, trechos ou valores extraídos.'});
    await repo.put('customTemplates',template);editingTemplateId=template.id;$('templateSeedDialog').close();await reload();showPage('templates');
  }catch(error){alert(error.message);}
}



async function loadBenchmarkReference(force=false) {
  if (state.benchmarkReference && !force) return state.benchmarkReference;
  try {
    const response=await fetch('./fixtures/benchmark/reference-summary.json',{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    state.benchmarkReference=await response.json();
  } catch(error) {
    state.benchmarkReference={status:'UNAVAILABLE',executedAt:null,corpus:{overallScore:0,caseCount:0,status:'REVIEW',dimensions:{}},coverage:[],stress:{},gates:{},limitations:[`Referência indisponível: ${error.message}`]};
  }
  return state.benchmarkReference;
}
function benchmarkPct(value){return `${Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2})}%`;}
function benchmarkStatusBadge(ok,labelOk='OK',labelFail='REVISAR'){return `<span class="badge ${ok?'good':'bad'}">${ok?labelOk:labelFail}</span>`;}
async function renderHomologation(force=false) {
  if(!$('benchmarkKpis'))return;
  const ref=await loadBenchmarkReference(force);
  const corpus=ref.corpus||{}; const stress=ref.stress||{}; const large=stress.largeProject||{}; const parser=stress.parser||{};
  const kpis=[
    ['Score corpus',`${Number(corpus.overallScore||0).toLocaleString('pt-BR',{maximumFractionDigits:2})}%`,'Precisão ponderada'],
    ['Casos',String(corpus.caseCount||0),'Textos e OFX'],
    ['Lote parser',String(parser.documentsProcessed||0),'Documentos processados'],
    ['Throughput',parser.docsPerSecond?`${Number(parser.docsPerSecond).toLocaleString('pt-BR',{maximumFractionDigits:1})}/s`:'—','Máquina de homologação'],
    ['Projeto stress',String(large.positions||0),'Posições sintéticas'],
    ['Eventos stress',String(large.events||0),'Eventos estruturados'],
    ['XLSX stress',large.xlsxMb!=null?`${large.xlsxMb} MB`:'—','Exportação grande'],
    ['HTAF stress',large.htafMb!=null?`${large.htafMb} MB`:'—','Round-trip local'],
  ];
  $('benchmarkKpis').innerHTML=kpis.map((item,index)=>`<div class="kpi ${index===0?'accent':''}"><span>${esc(item[0])}</span><strong>${esc(item[1])}</strong><small>${esc(item[2])}</small></div>`).join('');
  const gates=ref.gates||{};
  const gateRows=[
    ['Corpus universal sintético',gates.corpus,`Gate geral ≥ ${BENCHMARK_GATES.overallScore}%`],
    ['Parser - latência p95',gates.parserP95,parser.p95Ms!=null?`${parser.p95Ms} ms por documento`:'Sem medição'],
    ['Parser - throughput',gates.parserThroughput,parser.docsPerSecond!=null?`${parser.docsPerSecond} docs/s`:'Sem medição'],
    ['PDF digital local',gates.pdfDigital,stress.pdf?.digital?`${stress.pdf.digital.method} · ${stress.pdf.digital.elapsedMs} ms`:'Sem medição'],
    ['OCR local',gates.ocr,stress.pdf?.ocr?`${stress.pdf.ocr.method} · ${stress.pdf.ocr.elapsedMs} ms`:'Sem medição'],
    ['Exportação XLSX grande',gates.largeXlsx,large.xlsxMs!=null?`${large.xlsxMs} ms · ${large.xlsxMb} MB`:'Sem medição'],
    ['Exportação PDF grande',gates.largePdf,large.pdfMs!=null?`${large.pdfMs} ms · ${large.pdfMb} MB`:'Sem medição'],
    ['Backup/restauração HTAF',gates.htafRoundtrip,large.htafExportMs!=null?`export ${large.htafExportMs} ms · restore ${large.htafRestoreMs} ms`:'Sem medição'],
  ];
  $('benchmarkGates').innerHTML=gateRows.map(([label,ok,detail])=>`<div class="benchmark-gate"><strong>${esc(label)}</strong>${benchmarkStatusBadge(Boolean(ok))}<small>${esc(detail)}</small></div>`).join('');
  $('benchmarkStress').innerHTML=[
    ['Footprint serializado',large.serializedMb!=null?`${large.serializedMb} MB`:'—','Estimativa dos dados estruturados do projeto grande'],
    ['Memória parser',parser.rssDeltaMb!=null?`${parser.rssDeltaMb} MB`:'—','Variação de RSS durante o lote sintético'],
    ['PDF digital',stress.pdf?.digital?`${stress.pdf.digital.pages} pág. · qualidade ${stress.pdf.digital.quality}`:'—','Extração com pdftotext local'],
    ['OCR imagem',stress.pdf?.ocr?`${stress.pdf.ocr.pages} pág. · qualidade ${stress.pdf.ocr.quality}`:'—','Extração com Tesseract local'],
    ['Round-trip HTAF',large.roundtripOk?'ÍNTEGRO':'REVISAR','Contagens de posições, eventos e documentos preservadas'],
  ].map(([label,value,detail])=>`<div class="benchmark-metric"><strong>${esc(label)}</strong><span class="benchmark-score">${esc(value)}</span><small>${esc(detail)}</small></div>`).join('');
  $('benchmarkReferenceTime').textContent=ref.executedAt?`Referência ${dateTimeBr(ref.executedAt)}`:'Sem referência';
  const rows=ref.coverage||[];
  $('benchmarkCaseRows').innerHTML=rows.length?rows.map(item=>`<tr><td><strong>${esc(item.institution||item.id)}</strong><small>${esc(item.id)}</small></td><td>${esc(item.templateId||'—')}</td><td class="num">${benchmarkPct(item.dimensions?.classification)}</td><td class="num">${benchmarkPct(item.dimensions?.bank)}</td><td class="num">${benchmarkPct(item.dimensions?.structure)}</td><td class="num">${benchmarkPct(item.dimensions?.events)}</td><td class="num">${benchmarkPct(item.dimensions?.amounts)}</td><td class="num"><strong>${benchmarkPct(item.score)}</strong></td><td>${benchmarkStatusBadge(item.status==='HOMOLOGADO',item.status,item.status)}</td></tr>`).join(''):'<tr><td colspan="9">Referência de cobertura não disponível.</td></tr>';
  const history=state.benchmarkRuns||[];
  $('benchmarkRunHistory').innerHTML=history.length?history.slice(0,12).map(run=>`<div class="benchmark-history-row"><strong>${dateTimeBr(run.createdAt)}</strong><span>${esc(run.version||'')}</span><span>${benchmarkStatusBadge(run.status==='PASSED',run.status,run.status)}</span><span>Score ${benchmarkPct(run.overallScore)} · ${run.caseCount||0} casos · p95 ${run.p95Ms??'—'} ms</span></div>`).join(''):'<div class="notice small-notice">Nenhum autoteste executado neste navegador.</div>';
  const checklist=[
    [Boolean(gates.corpus),'Pipeline genérico validado no corpus sintético externo aos modelos Inter/BB.'],
    [Boolean(gates.pdfDigital)&&Boolean(gates.ocr),'Extração local de PDF digital e OCR verificada nesta máquina de homologação.'],
    [Boolean(gates.largeXlsx)&&Boolean(gates.largePdf),'Exportações de grande volume concluídas sem falha estrutural.'],
    [Boolean(gates.htafRoundtrip),'Backup e restauração HTAF preservaram as coleções do projeto grande.'],
    [true,'Uso real permanece controlado: novo layout bancário deve passar pela Central de Revisão antes de ser promovido a template homologado.'],
    [false,'Benchmark com layouts oficiais de 4 a 6 bancos adicionais ainda depende de documentos reais anonimizados fornecidos para homologação específica.'],
  ];
  $('releaseChecklist').innerHTML=checklist.map(([ok,text])=>`<li class="${ok?'':'warn'}">${esc(text)}</li>`).join('');
}

async function runLocalBenchmark(){
  showBusy('Executando autoteste local','Validando corpus sintético, classificação, eventos, valores e OFX neste navegador.');
  try{
    const response=await fetch('./fixtures/benchmark/corpus.json',{cache:'no-store'});if(!response.ok)throw new Error(`Corpus indisponível: HTTP ${response.status}`);
    const corpus=await response.json(); const run=runCorpusBenchmark(corpus); const createdAt=new Date().toISOString();
    const record={id:newLocalId('benchmark'),createdAt,version:'1.9.0-offline.stage18-stable2',status:run.summary.status,overallScore:run.summary.overallScore,caseCount:run.summary.caseCount,p95Ms:run.summary.p95Ms,summary:run.summary,results:run.results.map(item=>({id:item.id,score:item.score,elapsedMs:item.elapsedMs,templateId:item.templateId,failed:item.checks.filter(c=>!c.ok).map(c=>c.label)}))};
    await repo.put('benchmarkRuns',record); state.benchmarkRuns=[record,...state.benchmarkRuns].slice(0,50); await renderHomologation();
    alert(run.summary.status==='PASSED'?`Autoteste concluído: ${run.summary.overallScore}% de score.`:`Autoteste requer revisão: ${run.summary.overallScore}% de score.`);
  } finally {hideBusy();}
}


const PILOT_APP_VERSION='1.9.0-offline.stage18-stable2';
function pilotPct(value){return `${Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2})}%`;}
function pilotStatusBadge(status){const good=status==='HOMOLOGATED_REAL'||status==='PILOT_ACCEPTED_REAL';const warn=status==='PARTIAL'||status==='CONTROL_ONLY'||status==='PILOT_INFRASTRUCTURE_READY'||status==='PILOT_REAL_CORPUS_PARTIAL';return `<span class="badge ${good?'good':warn?'warn':'bad'}">${esc(status)}</span>`;}
function pilotLatestRun(){return [...(state.pilotRuns||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0]||null;}
function pilotSummary(){const latest=pilotLatestRun();if(latest?.summary)return latest.summary;return summarizePilot({cases:state.pilotCases||[],results:[],parserVersion:PILOT_APP_VERSION});}

function renderPilot(){
  if(!$('pilotKpis'))return;
  const summary=pilotSummary(); const latest=pilotLatestRun();
  const cases=state.pilotCases||[]; const real=cases.filter(c=>[PILOT_SOURCE_TYPES.REAL_ANONYMIZED,PILOT_SOURCE_TYPES.REAL_PRIVATE_LOCAL].includes(c.sourceType));
  const kpis=[
    ['Casos congelados',String(cases.length),'Verdades revisadas'],
    ['Casos reais',String(real.length),'Autorizados; privados ou anonimizados'],
    ['Instituições externas',String(summary.externalInstitutionCount||0),`Meta mínima: ${PILOT_GATES.minExternalInstitutions}`],
    ['Layouts homologados',String((summary.layouts||[]).filter(l=>l.status==='HOMOLOGATED_REAL').length),'Somente corpus real'],
    ['Status',summary.status||'PILOT_INFRASTRUCTURE_READY','Sem promoção automática'],
    ['Última execução',latest?dateTimeBr(latest.createdAt):'—',latest?`${latest.results?.length||0} caso(s)`:'Nenhuma execução'],
  ];
  $('pilotKpis').innerHTML=kpis.map((item,index)=>`<div class="kpi ${index===4?'accent':''}"><span>${esc(item[0])}</span><strong>${esc(item[1])}</strong><small>${esc(item[2])}</small></div>`).join('');
  const options=state.documents.filter(d=>d.status!=='DUPLICATE'&&d.hash).map(d=>`<option value="${esc(d.id)}">${esc(d.bankName||d.bankId||'Instituição')} · ${esc(d.kind||'Documento')} · ${esc(d.fileName)}</option>`).join('');
  $('pilotDocumentSelect').innerHTML=options||'<option value="">Nenhum documento elegível</option>';
  const latestByCase=new Map((latest?.results||[]).map(r=>[r.caseId,r]));
  $('pilotCaseRows').innerHTML=cases.length?cases.map(item=>{const result=latestByCase.get(item.id);return `<tr><td>${esc(item.institutionName)}</td><td>${esc(item.layoutLabel)}</td><td>${esc(item.sourceType)}</td><td>${esc(item.documentHash.slice(0,14))}…</td><td class="num">${item.manualCorrectionCount||0}</td><td class="num">${result?pilotPct(result.score):'—'}</td><td>${result?pilotStatusBadge(result.pass?'PARTIAL':'NOT_HOMOLOGATED'):'<span class="badge warn">AGUARDA TESTE</span>'}</td><td><button class="button danger mini" data-delete-pilot-case="${esc(item.id)}">Remover</button></td></tr>`;}).join(''):'<tr><td colspan="8">Nenhum caso piloto foi congelado neste projeto.</td></tr>';
  document.querySelectorAll('[data-delete-pilot-case]').forEach(button=>button.onclick=()=>deletePilotCase(button.dataset.deletePilotCase));
  $('pilotLayoutRows').innerHTML=(summary.layouts||[]).length?summary.layouts.map(layout=>`<tr><td>${esc(layout.institutionName)}</td><td>${esc(layout.layoutLabel)}</td><td class="num">${layout.documentCount}</td><td class="num">${pilotPct(layout.metrics.bankPct)}</td><td class="num">${pilotPct(layout.metrics.classificationPct)}</td><td class="num">${pilotPct(layout.metrics.eventRecallPct)}</td><td class="num">${pilotPct(layout.metrics.eventPrecisionPct)}</td><td class="num">${pilotPct(layout.metrics.amountExactPct)}</td><td class="num">${pilotPct(layout.metrics.dateExactPct)}</td><td class="num">${pilotPct(layout.metrics.humanCorrectionPct)}</td><td class="num">${layout.metrics.falsePositives}</td><td class="num">${layout.metrics.falseNegatives}</td><td>${pilotStatusBadge(layout.status)}</td></tr>`).join(''):'<tr><td colspan="13">Execute o piloto para gerar métricas por layout.</td></tr>';
  const gates=summary.gates||{};
  const gateRows=[
    [gates.enoughExternalInstitutions,`Pelo menos ${PILOT_GATES.minExternalInstitutions} instituições reais adicionais`,`${summary.externalInstitutionCount||0} registradas`],
    [gates.allRealAuthorized,'Todos os casos reais autorizados','Corpus privado permanece local; REAL_ANONYMIZED tamb\u00e9m exige anonimiza\u00e7\u00e3o'],
    [gates.noCriticalFalsePositives,'Zero falso positivo crítico','Aplicação, resgate, rendimento e IR indevidos bloqueiam o layout'],
    [gates.allExternalLayoutsHomologated,`Cada layout com ≥ ${PILOT_GATES.minDocumentsPerLayout} documentos e métricas mínimas`,'Sem homologação por documento único'],
    [gates.parserVersionPinned,'Versão do parser fixada',PILOT_APP_VERSION],
  ];
  $('pilotGates').innerHTML=gateRows.map(([ok,label,detail])=>`<div class="benchmark-gate"><div><strong>${esc(label)}</strong><small>${esc(detail)}</small></div>${pilotStatusBadge(ok?'HOMOLOGATED_REAL':'NOT_HOMOLOGATED')}</div>`).join('');
  $('pilotRunHistory').innerHTML=(state.pilotRuns||[]).length?[...state.pilotRuns].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,10).map(run=>`<div class="benchmark-history-row"><strong>${dateTimeBr(run.createdAt)}</strong><span>${esc(run.version||'')}</span><span>${pilotStatusBadge(run.summary?.status||run.status)}</span><span>${run.results?.length||0} caso(s) · ${run.summary?.externalInstitutionCount||0} instituição(ões) externa(s)</span></div>`).join(''):'<div class="notice small-notice">Nenhuma execução piloto registrada.</div>';
}

async function freezePilotGroundTruth(){
  try{
    const document=state.documents.find(d=>d.id===$('pilotDocumentSelect').value); if(!document)throw new Error('Selecione um documento processado e revisado.');
    if(!$('pilotAuthorized').checked)throw new Error('Confirme a autoriza\u00e7\u00e3o de uso antes de registrar um caso real.');
    if(!document.blob)throw new Error('O documento original não está disponível neste navegador. Restaure um backup .htaf com documentos.');
    const layout=$('pilotLayoutLabel').value.trim(); if(!layout)throw new Error('Informe um rótulo de layout estável.');
    const openIssues=state.issues.filter(issue=>issue.documentId===document.id&&issue.status!=='RESOLVED');
    if(openIssues.length&&!confirm(`Há ${openIssues.length} pendência(s) aberta(s) neste documento. Congelar mesmo assim como verdade revisada?`))return;
    const record=createGroundTruthCase({projectId:state.activeProjectId,document,bankName:document.bankName,documentKind:document.kind,positions:state.positions,events:state.events,reportedTotals:state.reportedTotals,bankTransactions:state.bankTransactions,reviewDecisions:state.reviewDecisions,layoutLabel:layout,sourceType:$('pilotAnonymized').checked?PILOT_SOURCE_TYPES.REAL_ANONYMIZED:PILOT_SOURCE_TYPES.REAL_PRIVATE_LOCAL,authorized:true,anonymized:$('pilotAnonymized').checked,parserVersion:PILOT_APP_VERSION,templateId:document.metadata?.templateId||''});
    const duplicate=state.pilotCases.find(c=>c.documentHash===record.documentHash&&c.layoutLabel===record.layoutLabel);if(duplicate&&!confirm('Já existe um caso para este hash/layout. Criar nova revisão congelada?'))return;
    await repo.put('pilotCases',record);await repo.put('auditLog',{id:newLocalId('audit'),projectId:state.activeProjectId,occurredAt:new Date().toISOString(),action:'PILOT_GROUND_TRUTH_FROZEN',documentId:document.id,documentHash:document.hash,layoutLabel:layout,sourceType:record.sourceType,appVersion:PILOT_APP_VERSION});
    await reload(); showPage('pilot'); alert('Verdade de referência congelada. O documento original não é copiado para o registro piloto.');
  }catch(error){alert(error.message);}
}

async function runRealPilot(){
  if(!state.pilotCases.length)return alert('Registre pelo menos um caso revisado antes de executar o piloto.');
  showBusy('Executando piloto controlado','Reprocessando os documentos sem alterar a análise atual e comparando contra a verdade humana congelada.');
  try{
    const results=[];
    for(const pilotCase of state.pilotCases){
      const document=state.documents.find(d=>d.id===pilotCase.documentId||d.hash===pilotCase.documentHash);
      if(!document?.blob){results.push({caseId:pilotCase.id,documentId:pilotCase.documentId,institutionName:pilotCase.institutionName,institutionKey:pilotCase.institutionKey,layoutLabel:pilotCase.layoutLabel,sourceType:pilotCase.sourceType,parserVersion:PILOT_APP_VERSION,templateId:pilotCase.templateId||'',evaluatedAt:new Date().toISOString(),score:0,pass:false,metrics:{bankPct:0,classificationPct:0,structurePct:0,eventRecallPct:0,eventPrecisionPct:0,amountExactPct:0,dateExactPct:0,ofxExactPct:0,reportedTotalsPct:0,falseNegatives:pilotCase.groundTruth?.events?.length||0,falsePositives:0,criticalFalsePositives:0,issueCount:1},falseNegatives:[],falsePositives:[],error:'Documento original indisponível'});continue;}
      let actual;
      if(/\.ofx$/i.test(document.fileName)||/ofx/i.test(document.mimeType||'')){
        const parsed=parseOfx(await document.blob.text(),document.fileName);
        actual={bank:{id:document.bankId||parsed.bankId,name:document.bankName||document.bankId||parsed.bankId},classification:{kind:'OFX'},positions:[],events:[],reportedTotals:[],bankTransactions:parsed.transactions,issues:[],templateId:'OFX_GENERIC'};
      }else{
        actual=await processFinancialDocument({projectId:state.activeProjectId,document,options:{customTemplates:state.customTemplates,projectCnpj:project()?.cnpj,forcedTemplateId:document.metadata?.forcedTemplateId||null}});
      }
      results.push(evaluatePilotCase(pilotCase,actual,{parserVersion:PILOT_APP_VERSION}));
    }
    const summary=summarizePilot({cases:state.pilotCases,results,parserVersion:PILOT_APP_VERSION});
    const run={id:newLocalId('pilot-run'),projectId:state.activeProjectId,createdAt:new Date().toISOString(),version:PILOT_APP_VERSION,status:summary.status,summary,results};
    await repo.put('pilotRuns',run);await repo.put('auditLog',{id:newLocalId('audit'),projectId:state.activeProjectId,occurredAt:new Date().toISOString(),action:'PILOT_RUN',pilotRunId:run.id,status:summary.status,caseCount:results.length,externalInstitutionCount:summary.externalInstitutionCount,appVersion:PILOT_APP_VERSION});
    await reload(); showPage('pilot'); alert(summary.status==='PILOT_ACCEPTED_REAL'?'Piloto real atingiu os gates de aceite.':'Piloto executado. A infraestrutura está pronta, mas os gates de homologação real ainda não foram integralmente atendidos.');
  }catch(error){alert(error.message);}finally{hideBusy();}
}

async function deletePilotCase(id){if(!confirm('Remover este caso piloto congelado? O documento e a análise financeira não serão alterados.'))return;await repo.delete('pilotCases',id);await reload();showPage('pilot');}
function exportPilotDossier(){const run=pilotLatestRun();const summary=pilotSummary();const dossier=buildPilotDossier(summary,run||{});downloadBlob(new Blob([JSON.stringify(dossier,null,2)],{type:'application/json'}),`dossie_piloto_etapa16_${new Date().toISOString().slice(0,10)}.json`);}
async function createPrePilotSnapshot(){if(!state.activeProjectId)return;showBusy('Criando snapshot pré-piloto','Preservando uma cópia local antes de testes com documentos reais.');try{await createLocalSnapshot(repo,state.activeProjectId,{reason:'PRE_PILOT_STAGE16',includeDocuments:true});await reload();showPage('pilot');alert('Snapshot pré-piloto criado.');}finally{hideBusy();}}


// Etapa 17 - release interno estavel e observabilidade estritamente local.
function operationalEnvironment(){return {online:navigator.onLine,indexedDb:Boolean(globalThis.indexedDB),serviceWorker:'serviceWorker' in navigator,secureContext:Boolean(globalThis.isSecureContext),locale:navigator.language||'pt-BR',hardwareConcurrency:navigator.hardwareConcurrency||null};}
async function appOperationalEvent({severity=OBSERVABILITY_SEVERITIES.INFO,category='RUNTIME',code='EVENT',message='',details={}}={}){if(!repo)return null;try{return await recordOperationalEvent(repo,{projectId:state.activeProjectId,severity,category,code,message,details,sessionId:operationalSessionId});}catch(error){console.warn('Falha ao registrar evento operacional:',error);return null;}}
async function appPerformance(operation,durationMs,status='SUCCESS',details={}){if(!repo)return null;try{return await recordPerformanceSample(repo,{projectId:state.activeProjectId,operation,durationMs,status,details});}catch(error){console.warn('Falha ao registrar desempenho:',error);return null;}}
function installRuntimeErrorCapture(){if(runtimeCaptureInstalled)return;runtimeCaptureInstalled=true;addEventListener('error',event=>{appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.ERROR,category:'RUNTIME',code:'WINDOW_ERROR',message:event.error?.message||event.message||'Erro de execução',details:{errorName:event.error?.name||'Error'}});});addEventListener('unhandledrejection',event=>{const reason=event.reason;appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.ERROR,category:'RUNTIME',code:'UNHANDLED_REJECTION',message:reason?.message||String(reason||'Promise rejeitada'),details:{errorName:reason?.name||'Error'}});});}

function currentHealthSummary(){return buildHealthSummary({events:state.operationalEvents,performanceSamples:state.performanceSamples,incidents:state.incidentReports,storage:state.storage,snapshots:state.snapshots,release:state.releaseMeta||{},environment:operationalEnvironment()});}
async function runOperationalHealthCheck({silent=false}={}){
  state.storage=await safeStorageEstimate();
  if(state.activeProjectId){
    [state.operationalEvents,state.performanceSamples,state.incidentReports,state.snapshots]=await Promise.all([repo.allByProject('operationalEvents',state.activeProjectId),repo.allByProject('performanceSamples',state.activeProjectId),repo.allByProject('incidentReports',state.activeProjectId),listSnapshots(repo,state.activeProjectId)]);
  }
  const health=currentHealthSummary(); state.healthSummary=health;
  const record={id:newLocalId('release-check'),createdAt:new Date().toISOString(),projectId:state.activeProjectId||null,status:health.status,version:state.releaseMeta?.version||'1.9.0-offline.stage18-stable2',channel:state.releaseMeta?.releaseChannel||'INTERNAL_STABLE',summary:{status:health.status,criticalCount:health.criticalCount,errorCount:health.errorCount,warningCount:health.warningCount,openIncidentCount:health.openIncidentCount,storagePercent:health.storagePercent,gates:health.gates}};
  await repo.put('releaseChecks',record); state.releaseChecks=(await repo.all('releaseChecks')).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,100);
  await appOperationalEvent({category:'RELEASE',code:'HEALTH_CHECK',message:`Diagnóstico local concluído: ${health.status}`,details:{status:health.status,count:health.gates.length,version:record.version,channel:record.channel}});
  state.operationalEvents=state.activeProjectId?await repo.allByProject('operationalEvents',state.activeProjectId):[];
  renderObservability();
  if(!silent)alert(`Diagnóstico concluído: ${health.status}. ${health.gates.filter(g=>!g.pass).length} gate(s) requer(em) atenção.`);
  return health;
}

function performanceLabel(operation){return ({DOCUMENT_PROCESSING:'Processamento documental',PDF_EXPORT:'Relatório PDF',XLSX_EXPORT:'Relatório XLSX',HTAF_EXPORT:'Backup HTAF',RECONCILIATION:'Conciliação',QUARTER_CLOSURE:'Fechamento trimestral',IMPORT_BATCH:'Importação de arquivos'})[operation]||operation;}
function renderObservability(){
  if(!$('operationalKpis'))return;
  const health=state.healthSummary||currentHealthSummary(); state.healthSummary=health;
  const openIncidents=(state.incidentReports||[]).filter(x=>x.status!==INCIDENT_STATUSES.RESOLVED);
  const recentErrors=(state.operationalEvents||[]).filter(x=>['ERROR','CRITICAL'].includes(x.severity)&&Date.parse(x.occurredAt)>=Date.now()-7*86400000).length;
  const statusClassName=health.status==='GREEN'?'health-green':health.status==='RED'?'health-red':'health-yellow';
  const kpis=[['Saúde',health.status,'Gates do release'],['Incidentes abertos',openIncidents.length,'Registro local'],['Erros 7 dias',recentErrors,'ERROR + CRITICAL'],['Armazenamento',`${Number(health.storagePercent||0).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`,'Uso estimado'],['Release',state.releaseMeta?.version||'1.9.0','Canal interno']];
  $('operationalKpis').innerHTML=kpis.map((item,index)=>`<div class="kpi ${index===0?statusClassName:index===4?'accent':''}"><span>${esc(item[0])}</span><strong>${esc(item[1])}</strong><small>${esc(item[2])}</small></div>`).join('');
  $('releaseChannelBadge').textContent=state.releaseMeta?.releaseChannel||'INTERNAL_STABLE';
  $('operationalGates').innerHTML=(health.gates||[]).map(g=>`<div class="benchmark-gate"><div><strong>${esc(g.label)}</strong><small>${g.actual!=null?`Valor observado: ${esc(g.actual)}`:'Verificação local'}</small></div><span class="badge ${g.pass?'good':g.severity==='CRITICAL'?'bad':'warn'}">${g.pass?'OK':'ATENÇÃO'}</span></div>`).join('');
  const perf=summarizePerformance(state.performanceSamples||[]);
  $('performanceSummary').innerHTML=perf.length?perf.slice(0,12).map(item=>`<div class="performance-row"><strong>${esc(performanceLabel(item.operation))}</strong><span>${item.count} amostra(s)</span><span>p50 ${item.p50Ms==null?'—':`${Math.round(item.p50Ms)} ms`}</span><span>p95 ${item.p95Ms==null?'—':`${Math.round(item.p95Ms)} ms`}</span><span>${item.failureCount} falha(s)</span></div>`).join(''):'<div class="notice small-notice">Nenhuma amostra de desempenho registrada ainda.</div>';
  $('incidentOpenCount').textContent=`${openIncidents.length} aberto(s)`;
  $('incidentRows').innerHTML=(state.incidentReports||[]).length?[...state.incidentReports].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,100).map(item=>`<tr><td>${dateTimeBr(item.createdAt)}</td><td><span class="badge ${item.severity==='CRITICAL'||item.severity==='ERROR'?'bad':item.severity==='WARN'?'warn':'good'}">${esc(item.severity)}</span></td><td>${esc(item.category)}</td><td>${esc(item.title)}</td><td><span class="badge ${item.status===INCIDENT_STATUSES.RESOLVED?'good':'warn'}">${esc(item.status)}</span></td><td>${item.status===INCIDENT_STATUSES.RESOLVED?'—':`<button class="button secondary mini" data-resolve-incident="${esc(item.id)}">Resolver</button>`}</td></tr>`).join(''):'<tr><td colspan="6">Nenhum incidente registrado.</td></tr>';
  document.querySelectorAll('[data-resolve-incident]').forEach(button=>button.onclick=()=>resolveOperationalIncident(button.dataset.resolveIncident));
  $('operationalEventRows').innerHTML=(state.operationalEvents||[]).length?[...state.operationalEvents].sort((a,b)=>String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0,100).map(item=>`<tr><td>${dateTimeBr(item.occurredAt)}</td><td><span class="badge ${item.severity==='CRITICAL'||item.severity==='ERROR'?'bad':item.severity==='WARN'?'warn':'good'}">${esc(item.severity)}</span></td><td>${esc(item.category)}</td><td><code>${esc(item.code)}</code></td><td class="message-cell">${esc(item.message||'—')}</td></tr>`).join(''):'<tr><td colspan="5">Nenhum evento operacional registrado.</td></tr>';
  $('observabilityRetention').value=String(state.observabilityConfig?.retentionDays||30);
  const policy=state.releaseMeta?.releasePolicy||{};
  const policyItems=[['Canal',state.releaseMeta?.releaseChannel||'INTERNAL_STABLE'],['Layouts parciais',policy.partialLayouts||'MANDATORY_HUMAN_REVIEW'],['Telemetria remota',policy.remoteTelemetry===false?'DESATIVADA':'REVISAR'],['Diagnóstico',policy.diagnosticExport||'SANITIZED_LOCAL_ONLY']];
  $('releasePolicySummary').innerHTML=policyItems.map(([label,value])=>`<div class="release-policy-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  renderStage18Uat();
}

async function saveOperationalIncident(){
  if(!state.activeProjectId)return alert('Selecione um projeto para registrar o incidente.');
  const title=$('incidentTitle').value.trim(); if(!title)return alert('Informe um título.');
  const incident=createIncident({projectId:state.activeProjectId,severity:$('incidentSeverity').value,category:$('incidentCategory').value,title,description:$('incidentDescription').value});
  await repo.put('incidentReports',incident); await appOperationalEvent({severity:incident.severity,category:'INCIDENT',code:'INCIDENT_RECORDED',message:incident.title,details:{status:incident.status}});
  $('incidentDialog').close();$('incidentTitle').value='';$('incidentDescription').value='';await reload();showPage('observability');
}
async function resolveOperationalIncident(id){const incident=await repo.get('incidentReports',id);if(!incident)return;const note=prompt('Informe uma nota curta de resolução. Não inclua dados de clientes.','Resolvido após validação local.');if(note===null)return;await repo.put('incidentReports',resolveIncidentRecord(incident,note));await appOperationalEvent({category:'INCIDENT',code:'INCIDENT_RESOLVED',message:'Incidente operacional resolvido',details:{status:'RESOLVED'}});await reload();showPage('observability');}
async function pruneOperationalLogs(){const days=Math.max(7,Math.min(90,Number($('observabilityRetention').value)||30));state.observabilityConfig={...state.observabilityConfig,retentionDays:days};await repo.put('settings',{id:'observability-config',value:state.observabilityConfig});const result=await pruneObservability(repo,state.observabilityConfig);await appOperationalEvent({category:'OBSERVABILITY',code:'LOG_RETENTION_APPLIED',message:'Política de retenção aplicada',details:{count:(result.operationalEvents||0)+(result.performanceSamples||0)}});await reload();showPage('observability');alert(`${result.operationalEvents} evento(s) e ${result.performanceSamples} amostra(s) removido(s).`);}
async function diagnosticStoreCounts(){const names=['projects','banks','accounts','positions','events','documents','issues','snapshots','processingRuns','reviewDecisions','reconciliations','quarterClosures','pilotCases','pilotRuns','operationalEvents','performanceSamples','incidentReports'];const entries=await Promise.all(names.map(async name=>[name,await repo.count(name)]));return Object.fromEntries(entries);}
async function exportOperationalDiagnostic(){
  const health=state.healthSummary||await runOperationalHealthCheck({silent:true});
  const bundle=buildDiagnosticBundle({release:state.releaseMeta||{},health,events:state.operationalEvents||[],performanceSamples:state.performanceSamples||[],incidents:state.incidentReports||[],environment:operationalEnvironment(),storeCounts:await diagnosticStoreCounts()});
  if(diagnosticContainsSensitivePatterns(bundle)){await appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.CRITICAL,category:'OBSERVABILITY',code:'DIAGNOSTIC_PRIVACY_BLOCKED',message:'Exportação de diagnóstico bloqueada pelo filtro de privacidade'});throw new Error('O filtro de privacidade detectou conteúdo potencialmente sensível. O diagnóstico não foi exportado.');}
  const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});downloadBlob(blob,`diagnostico_ht_stage18_${new Date().toISOString().slice(0,10)}.json`);await appOperationalEvent({category:'OBSERVABILITY',code:'DIAGNOSTIC_EXPORTED',message:'Pacote de diagnóstico sanitizado exportado',details:{format:'HTDIAG',version:1}});await reload();showPage('observability');
}


function currentStage18UatSession(){
  const sessions=stage18UatSessions(state.releaseChecks||[]).filter(item=>item.version===(state.releaseMeta?.version||'1.9.0-offline.stage18-stable2'));
  if(!sessions.length)return null;
  if(!state.selectedUatSessionId||!sessions.some(item=>item.id===state.selectedUatSessionId))state.selectedUatSessionId=sessions[0].id;
  return sessions.find(item=>item.id===state.selectedUatSessionId)||sessions[0];
}
async function refreshStage18ReleaseChecks(){state.releaseChecks=(await repo.all('releaseChecks')).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));state.allIncidentReports=await repo.all('incidentReports');}
async function createStage18UatStation(){
  if(state.releaseMeta?.releaseChannel==='INTERNAL_STABLE')return alert('O aceite da Etapa 18 ja foi concluido neste release INTERNAL_STABLE.');
  const alias=$('uatStationAlias')?.value.trim(); if(!alias)return alert('Informe um apelido para a estação, por exemplo: Estação 1.');
  const version=state.releaseMeta?.version||'1.9.0-offline.stage18-stable2';
  const existing=stage18UatSessions(state.releaseChecks||[]).find(item=>item.version===version&&item.stationAlias.toLocaleLowerCase('pt-BR')===alias.toLocaleLowerCase('pt-BR'));
  if(existing){state.selectedUatSessionId=existing.id;renderObservability();return;}
  const session=createStage18UatSession({id:newLocalId('stage18-uat'),stationAlias:alias,version});
  await repo.put('releaseChecks',session);state.selectedUatSessionId=session.id;await refreshStage18ReleaseChecks();
  await appOperationalEvent({category:'RELEASE',code:'STAGE18_UAT_STATION_CREATED',message:'Estação adicionada ao UAT interno da Etapa 18',details:{status:'PENDING',stage:18}});
  renderObservability();
}
async function setStage18UatCheck(checkId,status,{note=''}={}){
  if(state.releaseMeta?.releaseChannel==='INTERNAL_STABLE')return alert('O checklist de aceite e somente leitura no release INTERNAL_STABLE.');
  const session=currentStage18UatSession();if(!session)return alert('Crie ou selecione uma estação de UAT primeiro.');
  const updated=updateStage18UatCheck(session,checkId,status,{note});await repo.put('releaseChecks',updated);await refreshStage18ReleaseChecks();
  await appOperationalEvent({category:'RELEASE',code:'STAGE18_UAT_CHECK_UPDATED',message:'Checklist de UAT atualizado',details:{status,stage:18,checkId}});renderObservability();return updated;
}
async function runStage18AutomaticUatChecks(){
  if(state.releaseMeta?.releaseChannel==='INTERNAL_STABLE')return alert('Os checks de aceite ja foram concluidos na UAT14 aceita.');
  const session=currentStage18UatSession();if(!session)return alert('Crie ou selecione uma estação de UAT primeiro.');
  const platform=String(navigator.userAgentData?.platform||navigator.platform||navigator.userAgent||'');
  const capabilities=await helperCapabilities();
  const migration=await runIsolatedV8ToV9MigrationCheck();
  const tests=[
    ['WINDOWS_STATION',/windows|win32|win64/i.test(platform),/windows|win32|win64/i.test(platform)?'Windows detectado localmente.':'Esta execução não foi detectada como Windows.'],
    ['INDEXEDDB_V8_TO_V9',migration.status==='PASSED',migration.status==='PASSED'?'Banco temporário v8 migrado para v9 com registros preservados.':`Falha: ${migration.code||'migração não concluída'}.`],
    ['POPPLER_AVAILABLE',Boolean(capabilities.available&&capabilities.pdfText&&capabilities.pdfRender),capabilities.available?'pdftotext/pdftoppm verificados pelo helper local.':'Helper local indisponível.'],
    ['TESSERACT_AVAILABLE',Boolean(capabilities.available&&capabilities.ocr),capabilities.ocr?'Tesseract detectado.':'Tesseract não detectado.'],
    ['OCR_PORTUGUESE',Boolean(capabilities.available&&capabilities.ocr&&capabilities.ocrLanguages?.includes('por')),capabilities.ocrLanguages?.includes('por')?'Idioma por disponível no Tesseract.':'Idioma por não detectado.'],
    ['OPERATION_PAGE',Boolean($('observability')&&$('incidentRows')&&$('operationalGates')),'Página Operação carregada com observabilidade e incidentes locais.'],
  ];
  let updated=session;
  for(const [checkId,ok,note] of tests)updated=updateStage18UatCheck(updated,checkId,ok?UAT_STATUSES.PASSED:UAT_STATUSES.FAILED,{note});
  await repo.put('releaseChecks',updated);await refreshStage18ReleaseChecks();
  await appOperationalEvent({category:'RELEASE',code:'STAGE18_UAT_AUTOMATIC_CHECKS',message:'Checks automáticos do UAT da Etapa 18 executados',details:{status:tests.every(item=>item[1])?'PASSED':'FAILED',count:tests.length,stage:18}});
  renderObservability();alert(`Checks automáticos concluídos. Migração v8→v9: ${migration.status}.`);
}
function renderStage18Uat(){
  if(!$('uatChecklist'))return;
  const isStable=state.releaseMeta?.releaseChannel==='INTERNAL_STABLE'&&state.releaseMeta?.stablePromotion?.status==='APPROVED';
  const toolbar=$('uatStationAlias')?.closest('.uat-toolbar');
  if(isStable){
    const promotion=state.releaseMeta.stablePromotion||{};
    const summary=promotion.summary||{};
    if(toolbar)toolbar.classList.add('hidden');
    $('uatPromotionBadge').textContent='INTERNAL_STABLE';
    $('uatPromotionBadge').className='pill good';
    $('uatPromotionSummary').innerHTML=`<div class="uat-summary-card"><span>Estações aprovadas no aceite</span><strong>${Number(summary.passedStations||0)}/${Number(summary.minimumStations||1)}</strong><small>UAT14 aceito</small></div><div class="uat-summary-card"><span>Falhas no aceite</span><strong>${Number(summary.failedStations||0)}</strong><small>${Number(summary.pendingStations||0)} pendente(s)</small></div><div class="uat-summary-card"><span>Incidentes críticos no aceite</span><strong>${Number(summary.openCriticalIncidents||0)}</strong><small>0 no momento da promoção</small></div><div class="uat-summary-card"><span>Canal atual</span><strong>INTERNAL_STABLE</strong><small>Promoção manual concluída</small></div>`;
    $('uatSessionSelect').innerHTML=`<option value="">${esc(promotion.stationAlias||'Estação Principal')} · PASSED</option>`;
    $('uatSessionSelect').disabled=true;
    $('uatStationsSummary').innerHTML=`<span class="badge good">${esc(promotion.stationAlias||'Estação Principal')} · PASSED</span> <span class="badge warn">Segunda estação · WAIVED_NOT_EXECUTED</span>`;
    const acceptedChecks=promotion.checks||{};
    $('uatChecklist').innerHTML=`<div class="notice small-notice"><strong>Evidência de promoção:</strong> ${esc(promotion.evidenceFormat||'HTUAT v1')} · origem ${esc(promotion.sourceVersion||'UAT14')} · SHA-256 ${esc(String(promotion.evidenceSha256||'').slice(0,16))}…</div><div class="table-wrap"><table class="stage18-uat-table"><thead><tr><th>Controle</th><th>Obrigatório</th><th>Status aceito</th></tr></thead><tbody>${STAGE18_UAT_CHECKS.map(def=>{const status=acceptedChecks[def.id]||UAT_STATUSES.PENDING;return `<tr><td><strong>${esc(def.label)}</strong><br><code>${esc(def.id)}</code></td><td>${def.required?'SIM':'NÃO'}</td><td><span class="badge ${status===UAT_STATUSES.PASSED?'good':status===UAT_STATUSES.WAIVED_NOT_EXECUTED?'warn':'bad'}">${esc(status)}</span></td></tr>`;}).join('')}</tbody></table></div>`;
    return;
  }
  if(toolbar)toolbar.classList.remove('hidden');
  $('uatSessionSelect').disabled=false;
  const version=state.releaseMeta?.version||'1.9.0-offline.stage18-stable2';
  const sessions=stage18UatSessions(state.releaseChecks||[]).filter(item=>item.version===version);
  const summary=summarizeStage18Uat({releaseChecks:sessions,incidents:state.allIncidentReports||[],version});
  const selected=currentStage18UatSession();
  $('uatPromotionBadge').textContent=summary.readyForStablePromotion?'PRONTO PARA PROMOÇÃO':'UAT PENDENTE';
  $('uatPromotionBadge').className=`pill ${summary.readyForStablePromotion?'good':'warn'}`;
  $('uatPromotionSummary').innerHTML=`<div class="uat-summary-card"><span>Estações aprovadas</span><strong>${summary.passedStations}/${STAGE18_MIN_STATIONS}</strong><small>${summary.totalStations} registrada(s)</small></div><div class="uat-summary-card"><span>Falhas</span><strong>${summary.failedStations}</strong><small>${summary.pendingStations} pendente(s)</small></div><div class="uat-summary-card"><span>Incidentes críticos abertos</span><strong>${summary.openCriticalIncidents}</strong><small>Devem ser zero</small></div><div class="uat-summary-card"><span>Canal atual</span><strong>${esc(state.releaseMeta?.releaseChannel||'INTERNAL_STABLE')}</strong><small>Canal estável aprovado</small></div>`;
  $('uatSessionSelect').innerHTML=sessions.length?sessions.map(item=>`<option value="${esc(item.id)}" ${item.id===selected?.id?'selected':''}>${esc(item.stationAlias)} · ${esc(item.status)}</option>`).join(''):'<option value="">Nenhuma estação</option>';
  $('uatStationsSummary').innerHTML=sessions.length?sessions.map(item=>`<span class="badge ${item.status===UAT_STATUSES.PASSED?'good':item.status===UAT_STATUSES.FAILED?'bad':'warn'}">${esc(item.stationAlias)} · ${esc(item.status)}</span>`).join(' '):'<span class="muted">Cadastre 1 estação Windows representativa. O teste em outra máquina foi dispensado por decisão de escopo e ficará registrado como WAIVED_NOT_EXECUTED.</span>';
  if(!selected){$('uatChecklist').innerHTML='<div class="notice small-notice">Cadastre a primeira estação para iniciar o checklist.</div>';return;}
  $('uatChecklist').innerHTML=`<div class="table-wrap"><table class="stage18-uat-table"><thead><tr><th>Controle</th><th>Obrigatório</th><th>Status</th><th>Atualizado</th><th>Observação sanitizada</th></tr></thead><tbody>${STAGE18_UAT_CHECKS.map(def=>{const check=selected.checks?.[def.id]||{status:UAT_STATUSES.PENDING};const waiverOption=def.waiverAllowed?`<option value="WAIVED_NOT_EXECUTED" ${check.status==='WAIVED_NOT_EXECUTED'?'selected':''}>WAIVED_NOT_EXECUTED</option>`:'';return `<tr><td><strong>${esc(def.label)}</strong><br><code>${esc(def.id)}</code></td><td>${def.required?'SIM':'NÃO'}</td><td><select data-uat-check="${esc(def.id)}"><option value="PENDING" ${check.status==='PENDING'?'selected':''}>PENDING</option><option value="PASSED" ${check.status==='PASSED'?'selected':''}>PASSED</option><option value="FAILED" ${check.status==='FAILED'?'selected':''}>FAILED</option><option value="NOT_APPLICABLE" ${check.status==='NOT_APPLICABLE'?'selected':''}>NOT_APPLICABLE</option>${waiverOption}</select></td><td>${dateTimeBr(check.updatedAt)}</td><td class="message-cell">${esc(check.note||'—')}</td></tr>`;}).join('')}</tbody></table></div>`;
  document.querySelectorAll('[data-uat-check]').forEach(select=>select.onchange=()=>setStage18UatCheck(select.dataset.uatCheck,select.value).catch(error=>{console.error(error);alert(error.message||'Falha ao atualizar UAT.');}));
}
async function exportStage18UatEvidence(){
  if(state.releaseMeta?.releaseChannel==='INTERNAL_STABLE')return alert('A evidencia HTUAT aceita ja esta incorporada aos metadados de promocao deste release.');
  await refreshStage18ReleaseChecks();const bundle=buildStage18UatEvidence({release:state.releaseMeta||{},releaseChecks:state.releaseChecks||[],incidents:state.allIncidentReports||[]});
  if(uatEvidenceContainsSensitivePatterns(bundle)){await appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.CRITICAL,category:'RELEASE',code:'STAGE18_UAT_EXPORT_BLOCKED',message:'Exportação de evidência UAT bloqueada pelo filtro de privacidade'});throw new Error('O filtro de privacidade detectou conteúdo potencialmente sensível no UAT.');}
  downloadBlob(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}),`uat_etapa18_${new Date().toISOString().slice(0,10)}.json`);await appOperationalEvent({category:'RELEASE',code:'STAGE18_UAT_EXPORTED',message:'Evidência sanitizada do UAT exportada',details:{format:'HTUAT',version:1,stage:18}});await refreshStage18ReleaseChecks();renderObservability();
}

function renderProjects() {
  $('projectCards').innerHTML = state.projects.map(item => `<article class="project-card ${item.id === state.activeProjectId ? 'active' : ''}"><h3>${esc(item.name)}</h3><p>${esc(item.companyName || '')}<br>${esc(item.cnpj || '')}</p><div class="project-meta">${item.taxProfile?.regime === 'LUCRO_REAL' ? 'Lucro Real' : 'Lucro Presumido'} · Schema ${esc(item.schemaVersion || 1)} · ${esc(item.version || 'local')}</div><footer><span class="badge ${item.id === state.activeProjectId ? 'good' : ''}">${item.id === state.activeProjectId ? 'ATIVO' : 'LOCAL'}</span><div class="project-actions"><button class="button secondary mini" data-open-project="${esc(item.id)}">Abrir</button><button class="button danger mini" data-delete-project="${esc(item.id)}">Excluir</button></div></footer></article>`).join('');
  document.querySelectorAll('[data-open-project]').forEach(button => button.onclick = () => activateProject(button.dataset.openProject));
  document.querySelectorAll('[data-delete-project]').forEach(button => button.onclick = () => deleteProject(button.dataset.deleteProject));
}

function renderStorage() {
  const storage = state.storage || {};
  $('storageUsage').textContent = storage.usage == null ? 'Não disponível' : bytesLabel(storage.usage);
  $('storageQuota').textContent = storage.quota == null ? 'O navegador não informou a quota.' : `${storage.percent?.toLocaleString('pt-BR', {maximumFractionDigits: 1}) || 0}% de ${bytesLabel(storage.quota)}`;
  $('storageProgress').style.width = `${Math.min(100, storage.percent || 0)}%`;
  $('storagePersistence').textContent = storage.persisted == null ? 'Não informado' : storage.persisted ? 'Persistente' : 'Não persistente';
  $('snapshotCount').textContent = String(state.snapshots?.length || 0);
  const threshold = state.backupConfig?.quotaWarningPercent || 80;
  const warning = storage.percent != null && storage.percent >= threshold;
  $('quotaWarning').classList.toggle('hidden', !warning);
  if (warning) $('quotaWarning').innerHTML = `<strong>Atenção à quota:</strong> o uso local atingiu ${storage.percent.toLocaleString('pt-BR', {maximumFractionDigits: 1})}%. Exporte um .htaf e remova snapshots antigos.`;
}

function renderBackup() {
  renderStorage();
  const config = state.backupConfig || {cadence: 'OFF', includeDocuments: true, maxSnapshots: 3};
  $('backupCadence').value = config.cadence;
  $('backupIncludeDocuments').checked = config.includeDocuments !== false;
  $('backupMaxSnapshots').value = String(config.maxSnapshots || 3);
  $('snapshotList').innerHTML = state.snapshots.length ? state.snapshots.map(snapshot => `<div class="snapshot-row"><div><strong>${esc(snapshot.reason || 'SNAPSHOT')}</strong><br><small>${dateTimeBr(snapshot.createdAt)} · ${esc(snapshot.archiveHash?.slice(0, 16) || '')}…</small></div><span>${bytesLabel(snapshot.size)}</span><span class="badge ${snapshot.includeDocuments ? 'good' : 'warn'}">${snapshot.includeDocuments ? 'COM DOCS' : 'SEM DOCS'}</span><span>${esc(snapshot.appVersion || '')}</span><div class="snapshot-actions"><button class="button secondary mini" data-download-snapshot="${esc(snapshot.id)}">Baixar</button><button class="button secondary mini" data-duplicate-snapshot="${esc(snapshot.id)}">Criar cópia</button><button class="button secondary mini" data-restore-snapshot="${esc(snapshot.id)}">Substituir</button><button class="button danger mini" data-delete-snapshot="${esc(snapshot.id)}">Excluir</button></div></div>`).join('') : '<div class="notice">Nenhum snapshot local foi criado.</div>';
  document.querySelectorAll('[data-download-snapshot]').forEach(button => button.onclick = () => downloadSnapshotById(button.dataset.downloadSnapshot));
  document.querySelectorAll('[data-duplicate-snapshot]').forEach(button => button.onclick = () => restoreSnapshotById(button.dataset.duplicateSnapshot, RESTORE_STRATEGIES.DUPLICATE));
  document.querySelectorAll('[data-restore-snapshot]').forEach(button => button.onclick = () => restoreSnapshotById(button.dataset.restoreSnapshot, RESTORE_STRATEGIES.REPLACE));
  document.querySelectorAll('[data-delete-snapshot]').forEach(button => button.onclick = () => removeSnapshot(button.dataset.deleteSnapshot));
}

async function activateProject(id) {
  await repo.put('settings', {id: 'active-project', value: id});
  state.activeProjectId = id;
  state.quarter = ''; state.bankId = ''; state.family = ''; state.search = '';
  await reload();
}


function openDocumentClassification(documentId) {
  const document = state.documents.find(item => item.id === documentId);
  if (!document) return;
  editingDocumentId = documentId;
  const bankOptions = ['<option value="AUTO">Detectar automaticamente</option>', ...BANK_CATALOG.map(bank => `<option value="${esc(bank.id)}">${esc(bank.name)}</option>`), '<option value="CUSTOM">Outro banco / instituição</option>'];
  $('documentBankOverride').innerHTML = bankOptions.join('');
  const currentBank = document.metadata?.bankOverrideId || 'AUTO';
  $('documentBankOverride').value = BANK_CATALOG.some(bank => bank.id === currentBank) ? currentBank : (document.metadata?.bankOverrideName ? 'CUSTOM' : 'AUTO');
  $('documentBankCustomName').value = document.metadata?.bankOverrideName || '';
  $('documentBankCustomNameLabel').classList.toggle('hidden', $('documentBankOverride').value !== 'CUSTOM');
  $('documentKindOverride').innerHTML = '<option value="AUTO">Detectar automaticamente</option>' + Object.values(DOCUMENT_KINDS).map(kind => `<option value="${esc(kind)}">${esc(kind)}</option>`).join('');
  $('documentKindOverride').value = document.metadata?.documentKindOverride || 'AUTO';
  $('documentTemplateOverride').innerHTML = '<option value="AUTO">Selecionar automaticamente</option>' + state.customTemplates.filter(template=>template.status===TEMPLATE_STATUSES.ACTIVE).map(template=>`<option value="${esc(template.id)}">${esc(template.name)} · v${template.version}</option>`).join('');
  $('documentTemplateOverride').value = document.metadata?.forcedTemplateId || 'AUTO';
  $('documentClassificationName').textContent = document.fileName;
  $('documentClassificationDialog').showModal();
}

async function saveDocumentClassification() {
  const document = state.documents.find(item => item.id === editingDocumentId);
  if (!document) return;
  const bankChoice = $('documentBankOverride').value;
  const metadata = {...(document.metadata || {})};
  delete metadata.bankOverrideId;
  delete metadata.bankOverrideName;
  delete metadata.documentKindOverride;
  delete metadata.forcedTemplateId;
  if (bankChoice === 'CUSTOM') {
    const name = $('documentBankCustomName').value.trim();
    if (!name) throw new Error('Informe o nome da instituição.');
    metadata.bankOverrideName = name.slice(0, 120);
    metadata.bankOverrideId = `bank-custom-${name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'instituicao'}`;
  } else if (bankChoice !== 'AUTO') metadata.bankOverrideId = bankChoice;
  if ($('documentKindOverride').value !== 'AUTO') metadata.documentKindOverride = $('documentKindOverride').value;
  if ($('documentTemplateOverride').value !== 'AUTO') metadata.forcedTemplateId = $('documentTemplateOverride').value;
  const updated = {...document, metadata, bankId: metadata.bankOverrideId || document.bankId, bankName: metadata.bankOverrideName || BANK_CATALOG.find(bank => bank.id === metadata.bankOverrideId)?.name || document.bankName, kind: metadata.documentKindOverride || document.kind, status: document.status === 'DUPLICATE' ? document.status : 'READY_TO_REPROCESS'};
  await repo.put('documents', updated);
  editingDocumentId = null;
  $('documentClassificationDialog').close();
  await reload();
}

async function importFiles(files) {
  if (files.length > MAX_FILES_PER_BATCH) throw new Error(`O lote excede o limite de ${MAX_FILES_PER_BATCH} arquivos.`);
  const htafFiles = files.filter(file => file.name.toLowerCase().endsWith('.htaf'));
  if (htafFiles.length > 1) throw new Error('Restaure um arquivo .htaf por vez.');
  if (htafFiles.length === 1) {
    openRestoreDialog(htafFiles[0]);
    files = files.filter(file => file !== htafFiles[0]);
  }
  const legacyJsonFiles = files.filter(file => file.name.toLowerCase().endsWith('.json'));
  for (const file of legacyJsonFiles) await importLegacyJson(file);
  files = files.filter(file => !file.name.toLowerCase().endsWith('.json'));
  if (!files.length) return;
  if (!state.activeProjectId) throw new Error('Crie ou selecione um projeto antes de importar documentos financeiros.');
  const knownHashes = new Map(state.documents.map(document => [document.hash, document]));
  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`Formato não aceito: ${file.name}`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`Arquivo acima de 50 MB: ${file.name}`);
    const hash = await sha256(file);
    const duplicate = knownHashes.get(hash);
    const bank = identifyBank({fileName: file.name});
    const kind = identifyDocumentKind({fileName: file.name});
    if (duplicate) {
      await repo.put('documents', {id: `dup-${hash}-${Date.now()}`, projectId: state.activeProjectId, fileName: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', hash, bankId: duplicate.bankId, bankName: duplicate.bankName, kind, status: 'DUPLICATE', importedAt: new Date().toISOString(), blob: null, metadata: {originalDocumentId: duplicate.id}});
      continue;
    }
    if (bank.id !== 'generic' && !state.banks.some(item => item.id === bank.id)) await repo.put('banks', bank);
    const document = {id: `doc-${state.activeProjectId}-${hash}`, projectId: state.activeProjectId, fileName: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', hash, bankId: bank.id, bankName: bank.name, kind, status: 'STORED_LOCAL', importedAt: new Date().toISOString(), blob: file};
    await repo.put('documents', document);
    knownHashes.set(hash, document);
    if (extension === 'txt') { document.status = 'TEXT_READY_TO_PROCESS'; await repo.put('documents', document); }
    if (extension === 'ofx') {
      try {
        const parsed = parseOfx(await file.text(), file.name);
        document.status = 'OFX_PARSED'; document.metadata = {transactionCount: parsed.transactions.length, duplicates: parsed.duplicates, period: parsed.period};
      } catch (error) { document.status = 'REQUIRES_REVIEW'; document.metadata = {error: error.message}; }
      await repo.put('documents', document);
    }
    if (extension === 'pdf') {
      document.status = 'PDF_READY_TO_PROCESS';
      await repo.put('documents', document);
    }
    // A identificação definitiva da instituição ocorre após a leitura do conteúdo.
  }
  await scheduleAutomaticBackup('IMPORT');
  await reload();
}

async function importLegacyJson(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`Projeto JSON acima do limite: ${file.name}`);
  const payload = JSON.parse(await file.text());
  const bundle = parseLegacyProjectJson(payload);
  const summary = await restoreProjectBundle(repo, bundle, {strategy: RESTORE_STRATEGIES.DUPLICATE});
  await setProjectOwner(repo, summary.projectId, currentUser.id);
  await activateProject(summary.projectId);
  alert('Projeto JSON legado migrado e restaurado como cópia independente.');
}

async function processNormalizedText(document, text) {
  const bank = identifyBank({fileName: document.fileName, text});
  const adapter = adapterFor({fileName: document.fileName, text});
  let position = state.positions.find(item => item.bankId === bank.id);
  if (!position) {
    position = {id: `position-${document.hash.slice(0, 12)}`, projectId: state.activeProjectId, bankId: bank.id, accountId: state.accounts.find(account => account.bankId === bank.id)?.id || 'unknown', name: `Posição importada — ${bank.name}`, externalReference: document.fileName.slice(0, 180), productFamily: bank.id === 'bb' ? 'QUOTA_FUND' : 'FIXED_INCOME_SECURITY', openedAt: new Date().toISOString().slice(0, 10), originalPrincipalCents: null, status: 'REQUIRES_REVIEW', realizedIncomeStatus: 'PENDING'};
    validatePosition(position);
    await repo.put('positions', position);
    state.positions.push(position);
  }
  if (adapter) {
    const result = adapter.parseNormalizedText({projectId: state.activeProjectId, positionId: position.id, accountId: position.accountId, documentId: document.id, text});
    await repo.bulkPut('events', result.events);
    document.status = result.events.length ? 'TEXT_PARSED' : 'REQUIRES_REVIEW';
    document.metadata = {warnings: result.warnings, eventCount: result.events.length};
    await repo.put('documents', document);
  }
}


function eventFingerprint(event) {
  return [event.bankId,event.positionId,event.type,event.occurredAt,event.amountCents,event.netAmountCents ?? '',event.grossAmountCents ?? '',event.quotaQuantity ?? '',event.quotaValue ?? ''].join('|');
}

function evidenceRank(status) {
  return ({CONFIRMED:6,RECONCILED:5,RECONSTRUCTED:4,ESTIMATED:3,PENDING:2,DIVERGENT:1})[status] || 0;
}

async function saveTaxProfile() {
  const current = project();
  if (!current) return;
  const updated = {...current,taxProfile:taxProfileFromControls(),updatedAt:new Date().toISOString(),version:'1.9.0-offline.stage18-stable2',schemaVersion:6};
  await repo.put('projects',updated);
  await reload();
  await scheduleAutomaticBackup('TAX_PROFILE_UPDATE');
}


async function ensureAutomaticCashControls() {
  const totals = await repo.allByProject('reportedTotals', state.activeProjectId);
  const positions = await repo.allByProject('positions', state.activeProjectId);
  const events = await repo.allByProject('events', state.activeProjectId);
  const fingerprints = new Set(events.map(eventFingerprint));
  for (const total of totals.filter(item => item.category === 'AUTOMATIC_CASH' && item.quarter)) {
    let position = positions.find(item => item.bankId === total.bankId && item.productFamily === PRODUCT_FAMILIES.AUTOMATIC_CASH);
    if (!position) {
      position = {id:`position-${state.activeProjectId}-automatic-${total.bankId}`,projectId:state.activeProjectId,bankId:total.bankId,accountId:'unknown',name:'Aplicações automáticas de renda fixa',externalReference:`automatic-${total.bankId}`,productFamily:PRODUCT_FAMILIES.AUTOMATIC_CASH,openedAt:quarterEnd(total.quarter),originalPrincipalCents:null,status:POSITION_STATUS.ACTIVE,realizedIncomeStatus:EVIDENCE_STATUS.CONFIRMED,metadata:{source:'INCOME_REPORT_CONTROL'}};
      validatePosition(position); await repo.put('positions',position); positions.push(position);
    }
    const base={projectId:state.activeProjectId,positionId:position.id,bankId:position.bankId,accountId:position.accountId,occurredAt:quarterEnd(total.quarter),evidenceStatus:EVIDENCE_STATUS.CONFIRMED,sourceDocumentId:total.documentId,metadata:{reportedTotalId:total.id}};
    const candidates=[];
    if(total.incomeCents)candidates.push(createEvent({id:`event-${total.id}-auto-income`,...base,type:EVENT_TYPES.REALIZED_INCOME,amountCents:total.incomeCents,notes:'Rendimento de aplicação automática conforme informe fiscal.'}));
    if(total.irrfCents)candidates.push(createEvent({id:`event-${total.id}-auto-irrf`,...base,type:EVENT_TYPES.REDEMPTION_IRRF,amountCents:total.irrfCents,notes:'IRRF de aplicação automática conforme informe fiscal.'}));
    for(const candidate of candidates){const key=eventFingerprint(candidate);if(!fingerprints.has(key)){await repo.put('events',candidate);fingerprints.add(key);}}
  }
}

async function purgeDocumentDerivedData(documentId) {
  const oldEvents=(await repo.allByProject('events',state.activeProjectId)).filter(event=>event.sourceDocumentId===documentId);
  const oldBankTransactions=(await repo.allByProject('bankTransactions',state.activeProjectId)).filter(item=>item.documentId===documentId);
  for(const item of oldBankTransactions)await repo.delete('bankTransactions',item.id);
  const candidatePositionIds=new Set(oldEvents.map(event=>event.positionId));
  for(const event of oldEvents)await repo.delete('events',event.id);
  for(const store of ['evidences','reportedTotals','issues','documentExtractions','reviewDecisions']){
    const records=(await repo.allByProject(store,state.activeProjectId)).filter(record=>record.documentId===documentId && !record.metadata?.manual);
    for(const record of records)await repo.delete(store,record.id);
  }
  const remainingEvents=await repo.allByProject('events',state.activeProjectId);
  for(const positionId of candidatePositionIds){
    if(remainingEvents.some(event=>event.positionId===positionId))continue;
    const position=await repo.get('positions',positionId);
    if(position && (position.metadata?.sourceDocumentId===documentId || position.metadata?.template || position.metadata?.templateId))await repo.delete('positions',positionId);
  }
}

function documentRequiresMandatoryReview(document){const templateId=String(document?.metadata?.templateId||'');return Boolean(document?.metadata?.reviewRequired||document?.bankId==='generic'||templateId.startsWith('CUSTOM:')||PARTIAL_LAYOUT_TEMPLATES.has(templateId));}
async function enforceStage17ReviewPolicy(){if(!state.activeProjectId)return false;let changed=false;for(const document of state.documents){const templateId=String(document.metadata?.templateId||'');const requires=(PARTIAL_LAYOUT_TEMPLATES.has(templateId)||templateId.startsWith('CUSTOM:')||(document.bankId==='generic'&&document.kind!=='OFX'));if(!requires||document.metadata?.reviewCompletedAt)continue;if(!document.metadata?.reviewRequired||document.metadata?.layoutOperationalStatus!=='PARTIAL_OR_UNHOMOLOGATED'||document.status==='PROCESSED'){await repo.put('documents',{...document,status:String(document.status||'').startsWith('PROCESSED')?'PROCESSED_REQUIRES_REVIEW':document.status,metadata:{...(document.metadata||{}),reviewRequired:true,layoutOperationalStatus:'PARTIAL_OR_UNHOMOLOGATED',stage17PolicyAppliedAt:new Date().toISOString()}});changed=true;}for(const event of state.events.filter(event=>event.sourceDocumentId===document.id&&event.evidenceStatus===EVIDENCE_STATUS.CONFIRMED)){await repo.put('events',{...event,evidenceStatus:EVIDENCE_STATUS.RECONSTRUCTED,metadata:{...(event.metadata||{}),mandatoryHumanReview:true,sourceLayoutStatus:'PARTIAL_OR_UNHOMOLOGATED',stage17PolicyApplied:true}});changed=true;}}if(changed)await appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.WARN,category:'RELEASE',code:'STAGE17_REVIEW_POLICY_APPLIED',message:'Política de revisão obrigatória aplicada a layouts não homologados existentes',details:{status:'MANDATORY_HUMAN_REVIEW'}});return changed;}
function documentHasCompletedReview(document){return Boolean(document?.metadata?.reviewCompletedAt);}
function unreviewedMandatoryDocumentsForQuarter(quarter){const sourceIds=new Set(state.events.filter(event=>event.quarter===quarter&&event.metadata?.excludedFromAnalysis!==true).map(event=>event.sourceDocumentId).filter(Boolean));for(const total of state.reportedTotals.filter(item=>item.quarter===quarter))if(total.documentId)sourceIds.add(total.documentId);return state.documents.filter(doc=>sourceIds.has(doc.id)&&documentRequiresMandatoryReview(doc)&&!documentHasCompletedReview(doc));}
async function completeCurrentDocumentReview(){const document=state.documents.find(doc=>doc.id===state.selectedReviewDocumentId);if(!document)return alert('Selecione um documento.');const blockers=state.issues.filter(issue=>issue.documentId===document.id&&issue.status==='OPEN'&&issue.severity==='BLOCKING');const divergent=state.events.filter(event=>event.sourceDocumentId===document.id&&event.metadata?.excludedFromAnalysis!==true&&[EVIDENCE_STATUS.DIVERGENT,EVIDENCE_STATUS.PENDING,EVIDENCE_STATUS.ESTIMATED].includes(event.evidenceStatus));if(blockers.length||divergent.length)return alert(`A revisão não pode ser concluída: ${blockers.length} bloqueio(s) e ${divergent.length} evento(s) pendente(s)/divergente(s).`);if(!confirm('Confirmar que este documento foi revisado integralmente por uma pessoa? Eventos reconstruídos sem divergência serão promovidos a CONFIRMED.'))return;const reviewedAt=new Date().toISOString();for(const event of state.events.filter(event=>event.sourceDocumentId===document.id&&event.evidenceStatus===EVIDENCE_STATUS.RECONSTRUCTED)){await repo.put('events',{...event,evidenceStatus:EVIDENCE_STATUS.CONFIRMED,metadata:{...(event.metadata||{}),humanReviewed:true,reviewedAt,reviewVersion:'1.9.0-offline.stage18-stable2'}});}for(const evidence of state.evidences.filter(item=>item.documentId===document.id&&item.status!=='REJECTED'))await repo.put('evidences',{...evidence,status:'APPROVED',reviewedAt});const updated={...document,status:String(document.status||'').startsWith('PROCESSED')?'PROCESSED_REVIEWED':document.status,metadata:{...(document.metadata||{}),reviewRequired:false,reviewCompletedAt:reviewedAt,reviewCompletedVersion:'1.9.0-offline.stage18-stable2'}};await repo.put('documents',updated);await repo.put('reviewDecisions',{id:newLocalId('review'),projectId:state.activeProjectId,documentId:document.id,targetType:'DOCUMENT',targetId:document.id,action:'COMPLETE_DOCUMENT_REVIEW',justification:'Revisão humana integral concluída no release interno estavel.',decidedAt:reviewedAt,before:{status:document.status,reviewRequired:document.metadata?.reviewRequired||false},after:{status:updated.status,reviewCompletedAt:reviewedAt}});await appOperationalEvent({category:'REVIEW',code:'DOCUMENT_REVIEW_COMPLETED',message:'Revisão humana integral concluída',details:{status:'CONFIRMED',version:'1.9.0-offline.stage18-stable2'}});await scheduleAutomaticBackup('DOCUMENT_REVIEW_COMPLETED');await reload();showPage('reviews');}

async function processDocuments(documentIds = null) {
  if (!state.activeProjectId) throw new Error('Selecione um projeto.');
  await saveTaxProfile();
  const selected = state.documents.filter(document => {
    if (document.status === 'DUPLICATE') return false;
    if (documentIds) return documentIds.includes(document.id);
    return !String(document.status || '').startsWith('PROCESSED') && document.status !== 'OFX_PROCESSED';
  });
  if (!selected.length) return alert('Não há documentos para processar.');
  const operationStarted=performance.now(); let operationStatus='FAILED';
  showBusy('Processando documentos', 'Extração local, classificação, normalização e conciliação.');
  let completed = 0;
  let failed = 0;
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const document = selected[index];
      $('busyMessage').textContent = `${index + 1}/${selected.length} — ${document.fileName}`;
      const startedAt = new Date().toISOString();
      const runId = `run-${document.id}-${Date.now()}`;
      try {
        if (!(document.blob instanceof Blob)) throw new Error('O documento original não está disponível neste dispositivo. Restaure um backup com documentos.');
        if (documentIds || String(document.status||'').includes('REPROCESS')) await purgeDocumentDerivedData(document.id);
        const fingerprintMap = new Map((await repo.allByProject('events', state.activeProjectId)).map(event => [eventFingerprint(event), event]));
        if (/\.ofx$/i.test(document.fileName)) {
          const parsed = parseOfx(await document.blob.text(), document.fileName);
          const documentBankId = document.metadata?.bankOverrideId || document.bankId || parsed.bankId || 'unknown';
          const mappedAccount = state.accounts.find(account => String(account.number || '').replace(/\D/g,'') === String(parsed.accountId || '').replace(/\D/g,''));
          const priorTransactions=(await repo.allByProject('bankTransactions',state.activeProjectId)).filter(item=>item.documentId===document.id);
          for(const prior of priorTransactions) await repo.delete('bankTransactions',prior.id);
          for (const [txIndex, transaction] of parsed.transactions.entries()) {
            const txId = `banktx-${document.id}-${transaction.fitid || txIndex}`;
            await repo.put('bankTransactions',{id:txId,projectId:state.activeProjectId,documentId:document.id,bankId:parsed.bankId||documentBankId,documentBankId,accountId:mappedAccount?.id||null,accountNumber:parsed.accountId||'',fitid:transaction.fitid,postedAt:transaction.postedAt,signedAmountCents:transaction.signedAmountCents,amountCents:transaction.amountCents,direction:transaction.direction,history:transaction.history||'',sourceName:document.fileName,createdAt:new Date().toISOString()});
          }
          document.bankId=documentBankId;
          document.status = 'OFX_PROCESSED';
          document.metadata = {...document.metadata,transactionCount:parsed.transactions.length,duplicates:parsed.duplicates,period:parsed.period,extractionMethod:'OFX_LOCAL',ofxBankId:parsed.bankId,ofxAccountId:parsed.accountId};
          await repo.put('documents',document);
          await repo.put('processingRuns',{id:runId,projectId:state.activeProjectId,documentId:document.id,startedAt,completedAt:new Date().toISOString(),status:'COMPLETED',templateId:'OFX_GENERIC',classification:{kind:'OFX'},extraction:{method:'OFX_LOCAL',quality:1},eventCount:0,transactionCount:parsed.transactions.length,warningCount:1,warnings:['O OFX confirma fluxos bancários; a classificação tributária depende da conciliação com extratos e informes.']});
          completed += 1;
          continue;
        }
        const result = await processFinancialDocument({projectId:state.activeProjectId,document,options:{projectCnpj:project()?.cnpj || '',customTemplates:state.customTemplates,forcedTemplateId:document.metadata?.forcedTemplateId||null,positionIdOverride:document.metadata?.positionIdOverride||null}});
        const effectiveBankId=result.positions?.[0]?.bankId || result.bank.id;
        const effectiveBankName=result.documentOverrides?.bankName || result.bank.name;
        const bankRecord = {id:effectiveBankId,name:effectiveBankName,source:result.templateId?.startsWith('CUSTOM:')?'CUSTOM_TEMPLATE':result.bank.source,confidence:result.templateMatch?.score?result.templateMatch.score/100:result.bank.confidence};
        if (bankRecord.id !== 'generic') await repo.put('banks',bankRecord);
        await repo.put('documentExtractions',{id:`extraction-${document.id}`,projectId:state.activeProjectId,documentId:document.id,method:result.extraction.method,quality:result.extraction.quality,fullText:normalizeDocumentText(result.extraction.fullText||''),pages:(result.extraction.pages||[]).map(page=>({pageNumber:page.pageNumber||1,text:normalizeDocumentText(page.text||''),method:page.method||result.extraction.method})),createdAt:new Date().toISOString(),templateId:result.templateId});
        for (const account of result.accounts || []) await repo.put('accounts',account);
        for (const position of result.positions || []) {
          const prior = await repo.get('positions',position.id);
          await repo.put('positions',prior ? {...prior,...position,metadata:{...(prior.metadata||{}),...(position.metadata||{})}} : position);
        }
        const mandatoryReview=effectiveBankId==='generic'||String(result.templateId||'').startsWith('CUSTOM:')||PARTIAL_LAYOUT_TEMPLATES.has(result.templateId);
        let duplicateEvents = 0;
        for (const rawCandidate of result.events || []) {
          const candidate=mandatoryReview&&rawCandidate.evidenceStatus===EVIDENCE_STATUS.CONFIRMED?{...rawCandidate,evidenceStatus:EVIDENCE_STATUS.RECONSTRUCTED,metadata:{...(rawCandidate.metadata||{}),mandatoryHumanReview:true,sourceLayoutStatus:'PARTIAL_OR_UNHOMOLOGATED'}}:rawCandidate;
          const key = eventFingerprint(candidate);
          const prior = fingerprintMap.get(key);
          if (prior && prior.id !== candidate.id) {
            duplicateEvents += 1;
            if (evidenceRank(candidate.evidenceStatus) > evidenceRank(prior.evidenceStatus)) {
              await repo.put('events',{...prior,evidenceStatus:candidate.evidenceStatus,notes:[prior.notes,candidate.notes].filter(Boolean).join(' | ')});
            }
            continue;
          }
          await repo.put('events',candidate);
          fingerprintMap.set(key,candidate);
        }
        const explicitEvidenceIds=new Set();
        for (const evidence of result.evidences || []) { explicitEvidenceIds.add(evidence.id); await repo.put('evidences',{...evidence,projectId:state.activeProjectId}); }
        const derivedEvidences=deriveEvidenceRecords({projectId:state.activeProjectId,documentId:document.id,extraction:result.extraction,positions:result.positions||[],events:result.events||[]});
        for(const evidence of derivedEvidences) if(!explicitEvidenceIds.has(evidence.id)) await repo.put('evidences',evidence);
        for (const issue of result.issues || []) await repo.put('issues',issue);
        for (const total of result.reportedTotals || []) await repo.put('reportedTotals',total);
        if (effectiveBankId === 'generic') await repo.put('issues',{id:`issue-bank-${document.id}`,projectId:state.activeProjectId,documentId:document.id,positionId:null,severity:'REVIEW',title:'Instituição não identificada com segurança',details:`O arquivo ${document.fileName} foi processado pelo adaptador genérico. Confirme a instituição e os campos extraídos.`,status:'OPEN'});
        document.bankId=effectiveBankId;document.bankName=effectiveBankName;document.kind=result.documentOverrides?.kind||result.classification.kind;document.status=(result.issues||[]).length||mandatoryReview?'PROCESSED_REQUIRES_REVIEW':'PROCESSED';document.metadata={...(document.metadata||{}),extractionMethod:result.extraction.method,extractionQuality:result.extraction.quality,templateId:result.templateId,pageCount:result.extraction.pages?.length||0,eventCount:(result.events||[]).length,duplicateEvents,warnings:[...(result.extraction.warnings||[]),...(result.warnings||[])],reviewRequired:(result.issues||[]).length>0||mandatoryReview,layoutOperationalStatus:mandatoryReview?'PARTIAL_OR_UNHOMOLOGATED':'HOMOLOGATED_OR_CONTROLLED'};delete document.metadata.forcedTemplateId;delete document.metadata.positionIdOverride;
        await repo.put('documents',document);
        await repo.put('processingRuns',{id:runId,projectId:state.activeProjectId,documentId:document.id,startedAt,completedAt:new Date().toISOString(),status:'COMPLETED',templateId:result.templateId,classification:result.classification,bank:{id:result.bank.id,name:result.bank.name},extraction:{method:result.extraction.method,quality:result.extraction.quality,pageCount:result.extraction.pages?.length||0},eventCount:(result.events||[]).length,positionCount:(result.positions||[]).length,duplicateEvents,warningCount:(result.extraction.warnings||[]).length+(result.warnings||[]).length,warnings:[...(result.extraction.warnings||[]),...(result.warnings||[])]});
        completed += 1;
      } catch (error) {
        failed += 1;
        document.status='PROCESSING_FAILED';document.metadata={...(document.metadata||{}),error:error.message};await repo.put('documents',document);
        await repo.put('processingRuns',{id:runId,projectId:state.activeProjectId,documentId:document.id,startedAt,completedAt:new Date().toISOString(),status:'FAILED',templateId:null,classification:null,extraction:null,eventCount:0,warnings:[error.message]});
        await repo.put('issues',{id:`issue-processing-${document.id}`,projectId:state.activeProjectId,documentId:document.id,positionId:null,severity:'BLOCKING',title:'Falha no processamento local',details:`${document.fileName}: ${error.message}`,status:'OPEN'});
      }
    }
    await ensureAutomaticCashControls();
    const [allEvents,allTotals,allPositions,allTransactions,allLinks,allAccounts] = await Promise.all([
      repo.allByProject('events',state.activeProjectId),repo.allByProject('reportedTotals',state.activeProjectId),repo.allByProject('positions',state.activeProjectId),repo.allByProject('bankTransactions',state.activeProjectId),repo.allByProject('documentLinks',state.activeProjectId),repo.allByProject('accounts',state.activeProjectId),
    ]);
    const advanced = runAdvancedReconciliation({projectId:state.activeProjectId,positions:allPositions,events:allEvents,reportedTotals:allTotals,bankTransactions:allTransactions,documentLinks:allLinks,accounts:allAccounts});
    const fingerprintSet = new Set(allEvents.map(eventFingerprint));
    for (const candidate of advanced.generatedEvents || []) { const key=eventFingerprint(candidate); if(!fingerprintSet.has(key)){await repo.put('events',candidate);fingerprintSet.add(key);} }
    const finalEvents = await repo.allByProject('events',state.activeProjectId);
    for (const position of finalizePositions({positions:allPositions,events:finalEvents})) await repo.put('positions',position);
    for (const control of advanced.reportedTotals || []) await repo.put('reportedTotals',control);
    const priorReconciliations=await repo.allByProject('reconciliations',state.activeProjectId); for(const item of priorReconciliations)await repo.delete('reconciliations',item.id);
    for (const item of advanced.reconciliations || []) await repo.put('reconciliations',{...item,createdAt:item.createdAt||new Date().toISOString()});
    for (const issue of advanced.issues || []) await repo.put('issues',issue);
    $('processingSummary').textContent=`${completed} concluído(s), ${failed} falha(s).`;
    await scheduleAutomaticBackup('DOCUMENT_PROCESSING');
    await reload();
    showPage('analysis'); operationStatus=failed?'FAILED':'SUCCESS';
    if(failed)await appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.WARN,category:'PROCESSING',code:'DOCUMENT_PROCESSING_PARTIAL',message:'Processamento concluído com falhas',details:{completedCount:completed,failedCount:failed,documentCount:selected.length}});
  } finally { await appPerformance('DOCUMENT_PROCESSING',performance.now()-operationStarted,operationStatus,{completedCount:completed,failedCount:failed,documentCount:selected.length}); hideBusy(); }
}

async function exportAnalysisPdf() {
  const snapshot=currentSnapshot();if(!snapshot)return; const operationStarted=performance.now(); let operationStatus='FAILED';
  try{const blob=createExecutivePdf(snapshot);const name=`${(project()?.name||'analise').replace(/[^a-z0-9]+/gi,'_')}_${state.quarter||'completo'}.pdf`;
  downloadBlob(blob,name);
  await repo.put('reportSnapshots',{id:newLocalId('report'),projectId:state.activeProjectId,createdAt:new Date().toISOString(),format:'PDF',quarter:state.quarter||null,metrics:snapshot.metrics,fileName:name});operationStatus='SUCCESS';}
  finally{await appPerformance('PDF_EXPORT',performance.now()-operationStarted,operationStatus,{format:'PDF',quarter:state.quarter||'ALL'});}
}

async function exportAnalysisXlsx() {
  const snapshot=currentSnapshot();if(!snapshot)return;const operationStarted=performance.now();let operationStatus='FAILED';showBusy('Gerando XLSX','Montando as abas com o mesmo snapshot do painel.');try{const blob=await createAnalysisXlsx(snapshot);const name=`${(project()?.name||'analise').replace(/[^a-z0-9]+/gi,'_')}_${state.quarter||'completo'}.xlsx`;downloadBlob(blob,name);await repo.put('reportSnapshots',{id:newLocalId('report'),projectId:state.activeProjectId,createdAt:new Date().toISOString(),format:'XLSX',quarter:state.quarter||null,metrics:snapshot.metrics,fileName:name});operationStatus='SUCCESS';}finally{await appPerformance('XLSX_EXPORT',performance.now()-operationStarted,operationStatus,{format:'XLSX',quarter:state.quarter||'ALL'});hideBusy();}
}

async function updateHelperStatus() {
  const capabilities=await helperCapabilities();
  if(!$('helperStatus'))return;
  $('helperStatus').textContent=capabilities.available?(capabilities.ocr?'PDF + OCR local':'PDF digital local'):'Fallback do navegador';
  $('helperStatus').className=`badge ${capabilities.available?'good':'warn'}`;
}

function downloadBlob(blob, fileName) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
}

function showBusy(title, message = 'Aguarde.') {
  $('busyTitle').textContent = title;
  $('busyMessage').textContent = message;
  $('busyOverlay').classList.remove('hidden');
}
function hideBusy() { $('busyOverlay').classList.add('hidden'); }

function openBackupDialog() {
  if (!state.activeProjectId) return alert('Selecione um projeto.');
  $('exportIncludeDocuments').checked = true;
  $('exportPassword').value = '';
  $('exportPasswordConfirm').value = '';
  $('backupDialogStatus').textContent = '';
  $('backupDialogStatus').className = 'dialog-status';
  $('backupDialog').showModal();
}

async function createManualBackup() {
  const operationStarted=performance.now(); let operationStatus='FAILED';
  const password = $('exportPassword').value;
  const confirmation = $('exportPasswordConfirm').value;
  if (password && password.length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');
  if (password !== confirmation) throw new Error('A confirmação da senha não coincide.');
  showBusy('Gerando backup .htaf', 'Validando dados, documentos e hashes SHA-256.');
  try {
    const result = await exportProjectHtaf(repo, state.activeProjectId, {includeDocuments: $('exportIncludeDocuments').checked, password});
    downloadBlob(result.blob, result.fileName);
    $('backupDialog').close(); operationStatus='SUCCESS';
    alert(`Backup gerado com sucesso.\nSHA-256: ${result.archiveHash}`);
  } finally {
    await appPerformance('HTAF_EXPORT',performance.now()-operationStarted,operationStatus,{format:'HTAF'});
    $('exportPassword').value = ''; $('exportPasswordConfirm').value = ''; hideBusy();
  }
}

function openRestoreDialog(file) {
  if (file.size > MAX_HTAF_BYTES) return alert('O arquivo .htaf excede o limite suportado de 750 MB.');
  pendingRestoreFile = file;
  $('restoreFileName').textContent = file.name;
  $('restoreFileInfo').textContent = `${bytesLabel(file.size)} · validação integral antes de qualquer alteração`;
  $('restorePassword').value = '';
  $('restoreStrategy').value = 'duplicate';
  $('restoreTargetProject').innerHTML = state.projects.map(item => `<option value="${esc(item.id)}" ${item.id === state.activeProjectId ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  $('restoreTargetProject').disabled = true;
  $('restoreDialogStatus').textContent = '';
  $('restoreDialogStatus').className = 'dialog-status';
  $('restoreDialog').showModal();
}

async function performRestore() {
  if (!pendingRestoreFile) throw new Error('Nenhum arquivo foi selecionado.');
  const strategy = $('restoreStrategy').value;
  const targetProjectId = strategy === RESTORE_STRATEGIES.DUPLICATE ? undefined : $('restoreTargetProject').value;
  if (strategy !== RESTORE_STRATEGIES.DUPLICATE && !targetProjectId) throw new Error('Selecione o projeto de destino.');
  showBusy('Validando backup', 'Verificando criptografia, manifesto, ZIP, SHA-256 e referências.');
  try {
    const parsed = await parseHtafFile(pendingRestoreFile, {password: $('restorePassword').value});
    if ([RESTORE_STRATEGIES.REPLACE, RESTORE_STRATEGIES.MERGE].includes(strategy) && targetProjectId) {
      try { await createLocalSnapshot(repo, targetProjectId, {reason: 'PRE_RESTORE', includeDocuments: true}); }
      catch (snapshotError) {
        console.warn('Snapshot pré-restauração falhou:', snapshotError);
        if (!confirm(`Não foi possível criar o snapshot pré-restauração: ${snapshotError.message}\nProsseguir mesmo assim?`)) return;
      }
    }
    $('busyMessage').textContent = 'Aplicando a estratégia selecionada e preservando a deduplicação.';
    const previousOwner = targetProjectId ? (await repo.get('projects', targetProjectId))?.ownerUserId : null;
    const summary = await restoreProjectBundle(repo, parsed, {strategy, targetProjectId});
    await setProjectOwner(repo, summary.projectId, (!isAdmin() || strategy === RESTORE_STRATEGIES.DUPLICATE || !previousOwner) ? currentUser.id : previousOwner);
    $('restoreDialog').close();
    pendingRestoreFile = null;
    await activateProject(summary.projectId);
    alert(`Restauração concluída.\nPosições: ${summary.positions}\nEventos: ${summary.events}\nDocumentos novos: ${summary.documents}\nConflitos controlados: ${summary.conflicts.length}`);
  } finally { hideBusy(); $('restorePassword').value = ''; }
}

async function createProject() {
  const name = $('newProjectName').value.trim();
  if (!name) return;
  const id = newLocalId('project');
  const cleanName = name.slice(0, 180);
  const value = {id, ownerUserId: currentUser?.id || null, name: cleanName, companyName: cleanName.split('—')[0].trim(), cnpj: $('newProjectCnpj').value.trim().slice(0, 24), taxProfile: normalizeTaxProfile({regime:$('newProjectRegime').value,cnaePrincipal:$('newProjectCnae').value}), periodStart: new Date().toISOString().slice(0, 10), periodEnd: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), schemaVersion: 6, version: '1.9.0-offline.stage18-stable2'};
  await repo.put('projects', value);
  await activateProject(id);
  await scheduleAutomaticBackup('PROJECT_CREATE');
}

async function deleteProject(projectId) {
  const value = state.projects.find(item => item.id === projectId);
  if (!value) return;
  const answer = prompt(`Esta ação excluirá o projeto, documentos e snapshots locais.\nGere um backup .htaf antes de continuar.\n\nDigite EXCLUIR para apagar “${value.name}”.`);
  if (answer !== 'EXCLUIR') return;
  await repo.deleteProject(projectId);
  await reload();
}

async function clearLocal() {
  if (!isAdmin()) return alert('Somente o administrador pode apagar todos os dados locais.');
  const answer = prompt('Esta ação apaga TODOS os projetos, documentos e snapshots deste navegador.\nDigite APAGAR TUDO para continuar.');
  if (answer !== 'APAGAR TUDO') return;
  await withAuthPreserved(repo, () => repo.clearAll());
  state.activeProjectId = null;
  await reload();
}

async function saveBackupSettings() {
  if (!state.activeProjectId) return;
  state.backupConfig = await saveBackupConfig(repo, state.activeProjectId, {cadence: $('backupCadence').value, includeDocuments: $('backupIncludeDocuments').checked, maxSnapshots: $('backupMaxSnapshots').value, quotaWarningPercent: 80});
  await reload();
  alert('Configuração de backup automático salva.');
}

async function createSnapshotNow() {
  if (!state.activeProjectId) return;
  showBusy('Criando snapshot local', 'O snapshot permanecerá somente neste navegador.');
  try { await createLocalSnapshot(repo, state.activeProjectId, {reason: 'MANUAL', includeDocuments: state.backupConfig?.includeDocuments !== false}); await reload(); }
  finally { hideBusy(); }
}

async function downloadSnapshotById(id) {
  const snapshot = await repo.get('snapshots', id);
  if (!snapshot?.blob) return alert('Snapshot não encontrado.');
  downloadBlob(snapshot.blob, snapshot.fileName || `${project()?.name || 'projeto'}.htaf`);
}

async function restoreSnapshotById(id, strategy) {
  const snapshot = await repo.get('snapshots', id);
  if (!snapshot) return;
  const message = strategy === RESTORE_STRATEGIES.REPLACE ? 'Substituir o projeto atual por este snapshot?' : 'Criar uma cópia independente a partir deste snapshot?';
  if (!confirm(message)) return;
  showBusy('Restaurando snapshot', 'Validando e aplicando a cópia local.');
  try {
    const previousOwner = (await repo.get('projects', snapshot.projectId))?.ownerUserId;
    const summary = await restoreSnapshot(repo, id, {strategy, targetProjectId: strategy === RESTORE_STRATEGIES.REPLACE ? snapshot.projectId : undefined});
    await setProjectOwner(repo, summary.projectId, strategy === RESTORE_STRATEGIES.REPLACE && previousOwner ? previousOwner : currentUser.id);
    await activateProject(summary.projectId);
  } finally { hideBusy(); }
}

async function removeSnapshot(id) {
  if (!confirm('Excluir este snapshot local? Esta ação não altera o projeto.')) return;
  await deleteSnapshot(repo, id);
  await reload();
}

async function scheduleAutomaticBackup(reason) {
  clearTimeout(autoBackupTimer);
  if (!state.activeProjectId) return;
  autoBackupTimer = setTimeout(async () => {
    try { const value = await maybeCreateAutomaticSnapshot(repo, state.activeProjectId, reason); if (value) await reload(); }
    catch (error) { console.warn('Backup automático não foi criado:', error); }
  }, 1200);
}

async function handleImport(files) {
  const operationStarted=performance.now();let operationStatus='FAILED';
  try { await importFiles(files); operationStatus='SUCCESS'; }
  catch (error) { console.error(error); await appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.ERROR,category:'IMPORT',code:'IMPORT_BATCH_FAILED',message:error.message||'Falha ao importar arquivos',details:{documentCount:files?.length||0}}); alert(error.message || 'Falha ao importar os arquivos.'); }
  finally{await appPerformance('IMPORT_BATCH',performance.now()-operationStarted,operationStatus,{documentCount:files?.length||0});}
}

function bind() {
  document.querySelectorAll('#nav button').forEach(button => button.onclick = () => showPage(button.dataset.page));
  $('projectSelect').onchange = event => activateProject(event.target.value);
  $('yearFilter').onchange = event => { state.year = event.target.value; if(state.quarter&&!state.quarter.startsWith(state.year))state.quarter=''; saveDashboardFilters(); setFilters(); renderDashboard(); };
  $('quarterFilter').onchange = event => { state.quarter = event.target.value; if(state.quarter)state.year=state.quarter.slice(0,4); saveDashboardFilters(); setFilters(); renderDashboard(); };
  $('bankFilter').onchange = event => { state.bankId = event.target.value; saveDashboardFilters(); renderDashboard(); renderEvents(); };
  $('familyFilter').onchange = event => { state.family = event.target.value; saveDashboardFilters(); renderDashboard(); };
  $('dashboardStatusFilter').onchange = event => { state.dashboardStatus=event.target.value; saveDashboardFilters(); renderDashboard(); };
  $('searchFilter').oninput = event => { state.search = event.target.value; saveDashboardFilters(); renderDashboard(); };
  $('clearDashboardFilters').onclick=()=>{state.year='';state.quarter='';state.bankId='';state.family='';state.dashboardStatus='';state.search='';saveDashboardFilters();setFilters();renderDashboard();};
  $('closureYearFilter').onchange=renderClosures; $('closureStatusFilter').onchange=renderClosures;
  $('eventTypeFilter').onchange = renderEvents; $('evidenceFilter').onchange = renderEvents; $('eventSearch').oninput = renderEvents;
  $('dropZone').onclick = () => $('fileInput').click();
  $('fileInput').onchange = event => handleImport([...event.target.files]);
  $('taxRegime').onchange = () => $('pisCofinsModeLabel').classList.toggle('hidden', $('taxRegime').value !== TAX_REGIMES.LUCRO_REAL);
  $('saveTaxProfileButton').onclick = saveTaxProfile;
  $('documentBankOverride').onchange = () => $('documentBankCustomNameLabel').classList.toggle('hidden', $('documentBankOverride').value !== 'CUSTOM');
  $('saveDocumentClassificationButton').onclick = async event => { event.preventDefault(); try { await saveDocumentClassification(); } catch (error) { alert(error.message); } };
  $('processDocumentsButton').onclick = () => processDocuments();
  $('runAnalysisButton').onclick = () => executeAnalysis().catch(error=>{console.error(error);alert(error.message||'Falha ao executar a análise.');});
  $('exportPdfButton').onclick = exportAnalysisPdf;
  $('exportXlsxButton').onclick = exportAnalysisXlsx;
  $('fiscalQuarter').onchange = renderFiscal;
  $('fiscalTreatmentPosition').onchange = loadFiscalTreatmentEditor;
  $('fiscalLrTreatment').onchange = toggleFiscalRateFields;
  $('saveFiscalTreatmentButton').onclick = event => { event.preventDefault(); saveFiscalTreatment(); };
  $('removeFiscalTreatmentButton').onclick = event => { event.preventDefault(); removeFiscalTreatment(); };
  $('fiscalExportPdfButton').onclick = exportFiscalPdf;
  $('fiscalExportXlsxButton').onclick = exportFiscalXlsx;
  $('runReconciliationButton').onclick = executeAdvancedReconciliation;
  $('closeQuarterButton').onclick = closeReconciliationQuarter;
  $('reconciliationQuarter').onchange = renderReconciliation;
  $('dropZone').ondragover = event => { event.preventDefault(); $('dropZone').classList.add('drag'); };
  $('dropZone').ondragleave = () => $('dropZone').classList.remove('drag');
  $('dropZone').ondrop = event => { event.preventDefault(); $('dropZone').classList.remove('drag'); handleImport([...event.dataTransfer.files]); };
  $('exportButton').onclick = openBackupDialog; $('backupPageExportButton').onclick = openBackupDialog;
  $('restoreTopButton').onclick = () => $('restoreFileInput').click(); $('backupPageRestoreButton').onclick = () => $('restoreFileInput').click();
  $('restoreFileInput').onchange = event => { const file = event.target.files[0]; if (file) openRestoreDialog(file); event.target.value = ''; };
  $('newProjectButton').onclick = () => $('projectDialog').showModal();
  $('saveProjectButton').onclick = async event => { event.preventDefault(); await createProject(); $('projectDialog').close(); };
  $('createBackupButton').onclick = async event => { event.preventDefault(); try { await createManualBackup(); } catch (error) { $('backupDialogStatus').textContent = error.message; $('backupDialogStatus').className = 'dialog-status bad'; } };
  $('performRestoreButton').onclick = async event => { event.preventDefault(); try { await performRestore(); } catch (error) { $('restoreDialogStatus').textContent = error.message; $('restoreDialogStatus').className = 'dialog-status bad'; } };
  $('restoreStrategy').onchange = () => { $('restoreTargetProject').disabled = $('restoreStrategy').value === RESTORE_STRATEGIES.DUPLICATE; };
  $('resetDemoButton').onclick = async () => { if (!isAdmin()) return alert('Somente o administrador pode restaurar a base de demonstração.'); if (confirm('Substituir todos os dados locais pela base ouro Inter + BB?')) { await seedGolden(true); await reload(); } };
  $('clearButton').onclick = clearLocal;
  $('saveBackupConfigButton').onclick = saveBackupSettings;
  $('createSnapshotButton').onclick = createSnapshotNow;
  $('persistStorageButton').onclick = async () => { const granted = await requestPersistentStorage(); state.storage = await safeStorageEstimate(); renderStorage(); alert(granted ? 'Persistência concedida pelo navegador.' : 'O navegador não concedeu persistência. Mantenha backups externos.'); };
  $('reviewDocumentSelect').onchange = event => { state.selectedReviewDocumentId=event.target.value; renderReviewCenter().catch(console.error); };
  $('reviewStatusFilter').onchange = () => renderReviewCenter().catch(console.error); $('reviewSearch').oninput = () => renderReviewCenter().catch(console.error);
  $('reviewPageNumber').onchange = jumpReviewPage;
  $('reviewSelectAll').onchange = event => document.querySelectorAll('.review-row-check').forEach(input=>input.checked=event.target.checked);
  $('approveSelectedReviewButton').onclick = approveSelectedReviewItems;
  $('completeDocumentReviewButton').onclick=()=>completeCurrentDocumentReview().catch(error=>{console.error(error);alert(error.message||'Falha ao concluir revisão.');});
  $('createTemplateFromReviewButton').onclick = openTemplateSeedDialog;
  $('saveDocumentLinkButton').onclick = saveDocumentLink;
  $('reviewSaveButton').onclick = event => {event.preventDefault(); applyReviewDialogAction(ASSISTED_REVIEW_ACTIONS.CORRECT);};
  $('reviewApproveButton').onclick = event => {event.preventDefault(); applyReviewDialogAction(ASSISTED_REVIEW_ACTIONS.APPROVE);};
  $('reviewRejectButton').onclick = event => {event.preventDefault(); applyReviewDialogAction(ASSISTED_REVIEW_ACTIONS.REJECT);};
  $('reviewPendingButton').onclick = event => {event.preventDefault(); applyReviewDialogAction(ASSISTED_REVIEW_ACTIONS.KEEP_PENDING);};
  $('newTemplateButton').onclick = newBlankTemplate; $('saveTemplateButton').onclick=saveTemplate; $('activateTemplateButton').onclick=activateSelectedTemplate; $('newTemplateVersionButton').onclick=createNewTemplateVersion;
  $('addTemplateRuleButton').onclick=()=>{const rules=readRulesFromForm();rules.push({kind:RULE_KINDS.FIELD,label:'Nova regra',target:'position.name',regex:'',transform:TRANSFORMS.TEXT});renderTemplateRuleRows(rules);};
  $('testTemplateButton').onclick=runTemplateTest; $('applyTemplateButton').onclick=applyTemplateToSelectedDocument; $('exportTemplatesButton').onclick=exportActiveTemplates;
  $('importTemplatesButton').onclick=()=>$('templateImportInput').click(); $('templateImportInput').onchange=event=>{const file=event.target.files[0];if(file)importTemplatesFile(file);event.target.value='';};
  $('runBenchmarkButton').onclick=()=>runLocalBenchmark().catch(error=>{console.error(error);alert(error.message||'Falha no benchmark local.');});
  $('reloadBenchmarkReferenceButton').onclick=()=>{state.benchmarkReference=null;renderHomologation(true).catch(console.error);};
  $('freezePilotCaseButton').onclick=freezePilotGroundTruth;
  $('runPilotButton').onclick=()=>runRealPilot().catch(error=>{console.error(error);alert(error.message||'Falha no piloto controlado.');});
  $('exportPilotDossierButton').onclick=exportPilotDossier;
  $('createPrePilotSnapshotButton').onclick=createPrePilotSnapshot;
  $('runHealthCheckButton').onclick=()=>runOperationalHealthCheck().catch(error=>{console.error(error);alert(error.message||'Falha no diagnóstico local.');});
  $('exportDiagnosticButton').onclick=()=>exportOperationalDiagnostic().catch(error=>{console.error(error);alert(error.message||'Falha ao exportar diagnóstico.');});
  $('newIncidentButton').onclick=()=>{$('incidentSeverity').value='WARN';$('incidentCategory').value='OTHER';$('incidentTitle').value='';$('incidentDescription').value='';$('incidentDialog').showModal();};
  $('saveIncidentButton').onclick=event=>{event.preventDefault();saveOperationalIncident().catch(error=>{console.error(error);alert(error.message||'Falha ao registrar incidente.');});};
  $('pruneObservabilityButton').onclick=()=>pruneOperationalLogs().catch(error=>{console.error(error);alert(error.message||'Falha ao aplicar retenção.');});
  $('uatAddStationButton').onclick=()=>createStage18UatStation().catch(error=>{console.error(error);alert(error.message||'Falha ao criar estação UAT.');});
  $('uatSessionSelect').onchange=event=>{state.selectedUatSessionId=event.target.value||null;renderObservability();};
  $('uatAutomaticChecksButton').onclick=()=>runStage18AutomaticUatChecks().catch(error=>{console.error(error);alert(error.message||'Falha nos checks automáticos do UAT.');});
  $('uatExportButton').onclick=()=>exportStage18UatEvidence().catch(error=>{console.error(error);alert(error.message||'Falha ao exportar evidência do UAT.');});
  $('templateSeedConfirmButton').onclick=event=>{event.preventDefault();confirmTemplateSeed();};
  $('menuToggle').onclick = () => document.querySelector('.sidebar').classList.toggle('open');
  $('installButton').onclick = async () => { if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $('installButton').classList.add('hidden'); } };
  addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; $('installButton').classList.remove('hidden'); });
  addEventListener('online', renderConnection); addEventListener('offline', renderConnection);
}

function showPage(id) {
  if (id === 'users' && !isAdmin()) id = 'dashboard';
  document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === id));
  document.querySelectorAll('#nav button').forEach(button => button.classList.toggle('active', button.dataset.page === id));
  document.querySelector('.sidebar').classList.remove('open');
  if (id === 'backup') reload().catch(console.error);
  if (id === 'reviews') renderReviewCenter().catch(console.error);
  if (id === 'templates') renderTemplates();
  if (id === 'analysis') renderAnalysis();
  if (id === 'reconciliation') renderReconciliation();
  if (id === 'closures') renderClosures();
  if (id === 'fiscal') renderFiscal();
  if (id === 'homologation') renderHomologation().catch(console.error);
  if (id === 'pilot') renderPilot();
  if (id === 'observability') renderObservability();
  if (id === 'users') renderUsers().catch(error => alert(error.message));
}
function renderConnection() {
  const online = navigator.onLine;
  $('connectionDot').classList.toggle('online', online);
  $('connectionText').textContent = online ? 'Online — dados continuam locais' : 'Offline — app disponível';
}

// ---------------------------------------------------------------------------------------------
// AUTH01 — login local da estação, gestão de usuários pelo ADM e sessão por janela.
function unlockApp(user) { document.body.classList.remove('auth-locked'); return user; }

async function authGate() {
  const panes = {setup:$('setupForm'), recovery:$('recoveryPanel'), login:$('loginForm'), recover:$('recoverForm'), force:$('forceChangeForm')};
  const show = (key, subtitle, message = '', ok = false) => {
    for (const [name, element] of Object.entries(panes)) element.classList.toggle('hidden', name !== key);
    $('authSubtitle').textContent = subtitle; $('authMessage').textContent = message; $('authMessage').className = `auth-message${ok ? ' ok' : ''}`;
  };
  const fail = error => { $('authMessage').className = 'auth-message'; $('authMessage').textContent = error?.message || String(error); };
  const session = readSession();
  if (session?.userId) { const user = await getUser(repo, session.userId); if (user?.active && !user.mustChangePassword) return unlockApp(user); }
  return new Promise(resolve => {
    let pendingUser = null; let pendingPassword = null;
    const finish = user => { saveSession(user); resolve(unlockApp(user)); };
    $('setupForm').onsubmit = async event => {
      event.preventDefault();
      try {
        if ($('setupPassword').value !== $('setupPasswordConfirm').value) throw new Error('As senhas não coincidem.');
        const {user, recoveryKey} = await setupFirstAdmin(repo, {name:$('setupName').value, login:$('setupLogin').value || DEFAULT_ADMIN_LOGIN, email:$('setupLogin').value, password:$('setupPassword').value});
        $('setupPassword').value = ''; $('setupPasswordConfirm').value = '';
        pendingUser = user; $('recoveryKeyValue').textContent = recoveryKey;
        show('recovery', 'Administrador criado.');
      } catch (error) { fail(error); }
    };
    $('downloadRecoveryButton').onclick = () => downloadBlob(new Blob([`Analista de Aplicações Financeiras - chave de recuperação do administrador\r\nLogin: ${pendingUser?.login || ''}\r\nChave: ${$('recoveryKeyValue').textContent}\r\nGerada em: ${new Date().toLocaleString('pt-BR')}\r\nGuarde em local seguro. Vale somente para este computador/navegador.\r\n`], {type:'text/plain'}), 'chave_recuperacao_aplicacoes_financeiras.txt');
    $('recoveryDoneButton').onclick = () => { $('recoveryKeyValue').textContent = ''; finish(pendingUser); };
    $('loginForm').onsubmit = async event => {
      event.preventDefault();
      try {
        const password = $('loginPassword').value;
        const user = await authenticate(repo, $('loginUser').value, password);
        $('loginPassword').value = '';
        if (user.mustChangePassword) { pendingUser = user; pendingPassword = password; return show('force', `Olá, ${user.name}.`); }
        finish(user);
      } catch (error) { fail(error); }
    };
    $('forceChangeForm').onsubmit = async event => {
      event.preventDefault();
      try {
        const next = $('forceNewPassword').value;
        if (next !== $('forceNewPasswordConfirm').value) throw new Error('As senhas não coincidem.');
        if (next === pendingPassword) throw new Error('Escolha uma senha diferente da senha inicial.');
        const user = await changeOwnPassword(repo, pendingUser.id, pendingPassword, next);
        pendingPassword = null; $('forceNewPassword').value = ''; $('forceNewPasswordConfirm').value = '';
        finish(user);
      } catch (error) { fail(error); }
    };
    $('showRecoverButton').onclick = () => show('recover', 'Recuperar o acesso do administrador');
    $('backToLoginButton').onclick = () => show('login', 'Entre com seu usuário.');
    $('recoverForm').onsubmit = async event => {
      event.preventDefault();
      try {
        if ($('recoverPassword').value !== $('recoverPasswordConfirm').value) throw new Error('As senhas não coincidem.');
        await recoverAdmin(repo, $('recoverKey').value, $('recoverLogin').value, $('recoverPassword').value);
        $('loginUser').value = $('recoverLogin').value;
        for (const id of ['recoverKey','recoverPassword','recoverPasswordConfirm']) $(id).value = '';
        show('login', 'Entre com seu usuário.', 'Senha redefinida. Entre com a nova senha.', true);
      } catch (error) { fail(error); }
    };
    hasUsers(repo).then(any => any ? show('login', 'Entre com seu usuário.') : show('setup', 'Configuração inicial desta estação')).catch(fail);
  });
}

function renderUserBadge() {
  $('currentUserBadge').innerHTML = currentUser ? `<strong>${esc(currentUser.name)}</strong> · ${isAdmin() ? 'Administrador' : 'Usuário'}` : '';
  $('usersNavButton').classList.toggle('hidden', !isAdmin());
  document.querySelectorAll('.admin-only').forEach(element => element.classList.toggle('hidden', !isAdmin()));
}

function bindAuthControls() {
  renderUserBadge();
  $('logoutButton').onclick = () => { clearSession(); location.reload(); };
  $('changePasswordButton').onclick = () => {
    for (const id of ['currentPasswordInput','newPasswordInput','newPasswordConfirmInput']) $(id).value = '';
    $('changePasswordMessage').textContent = ''; $('changePasswordDialog').showModal();
  };
  $('saveOwnPasswordButton').onclick = async event => {
    event.preventDefault();
    try {
      if ($('newPasswordInput').value !== $('newPasswordConfirmInput').value) throw new Error('As senhas não coincidem.');
      currentUser = await changeOwnPassword(repo, currentUser.id, $('currentPasswordInput').value, $('newPasswordInput').value);
      $('changePasswordDialog').close(); alert('Senha alterada.');
    } catch (error) { $('changePasswordMessage').textContent = error.message; }
  };
  $('newUserForm').onsubmit = async event => {
    event.preventDefault();
    try {
      const user = await createUser(repo, currentUser, {name:$('newUserName').value, login:$('newUserLogin').value, email:$('newUserEmail').value, password:$('newUserPassword').value, role:$('newUserRole').value});
      $('newUserForm').reset(); $('newUserMessage').textContent = `Usuário ${user.login} criado. A senha é trocada no primeiro acesso.`;
      await renderUsers();
    } catch (error) { $('newUserMessage').textContent = error.message; }
  };
}

async function renderUsers() {
  if (!isAdmin()) return;
  const users = await listUsers(repo); const projects = await repo.all('projects');
  const owned = id => projects.filter(item => item.ownerUserId === id).length;
  const status = user => !user.active ? '<span class="badge warn">Desativado</span>' : user.mustChangePassword ? '<span class="badge warn">Ativo · troca de senha pendente</span>' : '<span class="badge good">Ativo</span>';
  $('userRows').innerHTML = users.map(user => `<tr><td>${esc(user.name)}${user.id === currentUser.id ? ' <span class="badge good">você</span>' : ''}</td><td>${esc(user.login)}</td><td>${user.role === ROLES.ADMIN ? 'Administrador' : 'Usuário'}</td><td>${status(user)}</td><td>${user.lastLoginAt ? dateTimeBr(user.lastLoginAt) : '—'}</td><td>${owned(user.id)}</td><td><div class="user-actions"><button class="button secondary mini" data-user-reset="${esc(user.id)}">Redefinir senha</button><button class="button secondary mini" data-user-role="${esc(user.id)}">${user.role === ROLES.ADMIN ? 'Tornar usuário' : 'Tornar administrador'}</button><button class="button ${user.active ? 'danger' : 'secondary'} mini" data-user-active="${esc(user.id)}">${user.active ? 'Desativar' : 'Reativar'}</button></div></td></tr>`).join('');
  const ownerOptions = selected => users.filter(user => user.active || user.id === selected).map(user => `<option value="${esc(user.id)}" ${user.id === selected ? 'selected' : ''}>${esc(user.name)} (${esc(user.login)})</option>`).join('');
  $('projectOwnerRows').innerHTML = projects.length ? projects.map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.cnpj || '—')}</td><td><select class="owner-select" data-project-owner="${esc(item.id)}">${ownerOptions(item.ownerUserId)}</select></td></tr>`).join('') : '<tr><td colspan="3">Nenhum projeto.</td></tr>';
  const action = handler => async event => { try { await handler(event.currentTarget); await renderUsers(); } catch (error) { alert(error.message); } };
  document.querySelectorAll('[data-user-reset]').forEach(button => button.onclick = action(async target => {
    const password = prompt('Senha provisória (mínimo 6 caracteres). O usuário cria a própria senha no próximo acesso:');
    if (password == null) return;
    await resetPassword(repo, currentUser, target.dataset.userReset, password); alert('Senha redefinida.');
  }));
  document.querySelectorAll('[data-user-role]').forEach(button => button.onclick = action(async target => {
    const user = users.find(item => item.id === target.dataset.userRole);
    await updateUser(repo, currentUser, user.id, {role: user.role === ROLES.ADMIN ? ROLES.USER : ROLES.ADMIN});
    if (user.id === currentUser.id) { currentUser = await getUser(repo, user.id); renderUserBadge(); if (!isAdmin()) { await reload(); showPage('dashboard'); } }
  }));
  document.querySelectorAll('[data-user-active]').forEach(button => button.onclick = action(async target => {
    const user = users.find(item => item.id === target.dataset.userActive);
    if (user.id === currentUser.id && user.active) throw new Error('Você não pode desativar o próprio acesso.');
    await updateUser(repo, currentUser, user.id, {active: !user.active});
  }));
  document.querySelectorAll('[data-project-owner]').forEach(select => select.onchange = action(async target => { await setProjectOwner(repo, target.dataset.projectOwner, target.value); await reload(); }));
}

async function init() {
  repo = await createRepository();
  installRuntimeErrorCapture();
  await seedGolden();
  currentUser = await hubAuthGate(repo);
  await claimOrphanProjects(repo);
  bindAuthControls(); bind(); renderConnection(); await reload(); if(await enforceStage17ReviewPolicy())await reload(); await updateHelperStatus();
  await appOperationalEvent({category:'SESSION',code:'APP_START',message:'Aplicativo iniciado em release interno estavel',details:{stage:18,version:'1.9.0-offline.stage18-stable2',channel:'INTERNAL_STABLE',offline:!navigator.onLine}});
  await maybeCreateAutomaticSnapshot(repo, state.activeProjectId, 'APP_START').catch(error => console.warn(error));
  if (false) try { await navigator.serviceWorker.register('./sw.js'); } catch (error) { console.warn('Service worker não registrado:', error); await appOperationalEvent({severity:OBSERVABILITY_SEVERITIES.WARN,category:'PWA',code:'SERVICE_WORKER_REGISTRATION_FAILED',message:error.message||'Falha ao registrar service worker'}); }
  await runOperationalHealthCheck({silent:true}).catch(error=>console.warn('Diagnóstico inicial não executado:',error));
}

init().catch(error => {
  console.error(error);
  const pre = document.createElement('pre');
  pre.textContent = `Falha ao iniciar o aplicativo: ${error.message}`;
  document.body.replaceChildren(pre);
});
