import { createEvent, validatePosition } from '../domain/model.js';
import { safeFileName } from './bytes.js';
import { STAGE9_APP_VERSION, migrateProjectBundle } from './migrations.js';
import { parseHtafFile } from './htaf.js';
import { quarterClosureIntegrityHash, verifyQuarterClosure } from '../reconciliation/engine.js';

export const RESTORE_STRATEGIES = Object.freeze({DUPLICATE: 'duplicate', MERGE: 'merge', REPLACE: 'replace'});

const safeIdPart = value => String(value ?? '').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
const defaultIdFactory = prefix => `${prefix}-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;

function contentKey(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function accountKey(account) {
  return [account.bankId || '', account.agency || '', account.number || '', account.name || ''].join('|').toLowerCase();
}
function positionKey(position) {
  return [position.bankId || '', position.externalReference || '', position.openedAt || '', position.name || ''].join('|').toLowerCase();
}
function eventKey(event, documentHash = '') {
  return [event.positionId, event.type, event.occurredAt, event.amountCents, event.netAmountCents ?? '', event.grossAmountCents ?? '', event.quotaQuantity ?? '', event.quotaValue ?? '', documentHash].join('|');
}
function issueKey(issue) {
  return [issue.positionId || '', issue.title || '', issue.details || '', issue.status || ''].join('|').toLowerCase();
}

async function allProject(repo, store, projectId) {
  try {
    if (typeof repo.allByProject === 'function') return await repo.allByProject(store, projectId);
    return (await repo.all(store)).filter(record => record.projectId === projectId);
  } catch { return []; }
}

function remappedId(projectId, kind, sourceId, idFactory, forceRandom = false) {
  if (forceRandom) return idFactory(`${projectId}-${kind}-${safeIdPart(sourceId)}`);
  return `${projectId}-${kind}-${safeIdPart(sourceId)}`;
}


async function rebaseQuarterClosure(item, {projectId, id, eventMap = new Map(), reconciliationMap = new Map(), documentMap = new Map()}) {
  if (!(await verifyQuarterClosure(item))) throw new Error(`Quarter closure integrity mismatch before restore: ${item.id || item.quarter || 'unknown'}`);
  const remapReference = value => eventMap.get(value) || reconciliationMap.get(value) || documentMap.get(value) || value;
  const payload = {
    ...(item.payload || {}),
    projectId,
    eventIds: (item.payload?.eventIds || []).map(id => eventMap.get(id) || id),
    reconciliationIds: (item.payload?.reconciliationIds || []).map(id => reconciliationMap.get(id) || id),
    documentIds: (item.payload?.documentIds || []).map(id => documentMap.get(id) || id),
    pendingIds: (item.payload?.pendingIds || []).map(remapReference),
  };
  const sourceIntegrityHash = item.integrityHash;
  return {
    ...item,
    id,
    projectId,
    payload,
    integrityHash: await quarterClosureIntegrityHash(payload),
    restoredFromClosureId: item.id,
    sourceProjectId: item.projectId || item.payload?.projectId || null,
    sourceIntegrityHash,
  };
}

async function upsertBanks(repo, banks) {
  const existing = new Map((await repo.all('banks')).map(bank => [bank.id, bank]));
  const conflicts = [];
  for (const bank of banks) {
    const prior = existing.get(bank.id);
    if (!prior) await repo.put('banks', bank);
    else if (prior.name !== bank.name) conflicts.push(`Banco ${bank.id}: nome local "${prior.name}" preservado em vez de "${bank.name}".`);
  }
  return conflicts;
}

async function writeRestoredRecords(repo, records) {
  await repo.put('projects', records.project);
  await repo.bulkPut('accounts', records.accounts);
  await repo.bulkPut('positions', records.positions);
  await repo.bulkPut('documents', records.documents);
  await repo.bulkPut('events', records.events);
  await repo.bulkPut('issues', records.issues);
  await repo.bulkPut('evidences', records.evidences || []);
  await repo.bulkPut('processingRuns', records.processingRuns || []);
  await repo.bulkPut('reportedTotals', records.reportedTotals || []);
  await repo.bulkPut('reportSnapshots', records.reportSnapshots || []);
  await repo.bulkPut('documentExtractions', records.documentExtractions || []);
  await repo.bulkPut('reviewDecisions', records.reviewDecisions || []);
  await repo.bulkPut('documentLinks', records.documentLinks || []);
  await repo.bulkPut('templateTests', records.templateTests || []);
  await repo.bulkPut('bankTransactions', records.bankTransactions || []);
  await repo.bulkPut('reconciliations', records.reconciliations || []);
  await repo.bulkPut('quarterClosures', records.quarterClosures || []);
  await repo.bulkPut('pilotCases', records.pilotCases || []);
  await repo.bulkPut('pilotRuns', records.pilotRuns || []);
  await repo.put('auditLog', records.audit);
}

function createProjectRecord(sourceProject, projectId, strategy, existingProject = null) {
  const now = new Date().toISOString();
  if (strategy === RESTORE_STRATEGIES.MERGE && existingProject) {
    return {...existingProject, updatedAt: now, lastMergedAt: now, version: STAGE9_APP_VERSION, schemaVersion: 6};
  }
  const duplicateSuffix = strategy === RESTORE_STRATEGIES.DUPLICATE ? ' — cópia restaurada' : '';
  return {
    ...sourceProject,
    id: projectId,
    name: `${String(sourceProject.name || 'Projeto restaurado').slice(0, 150)}${duplicateSuffix}`.slice(0, 180),
    companyName: String(sourceProject.companyName || sourceProject.name || '').slice(0, 180),
    cnpj: String(sourceProject.cnpj || '').slice(0, 24),
    restoredAt: now,
    updatedAt: now,
    version: STAGE9_APP_VERSION,
    schemaVersion: 6,
  };
}

async function buildFreshRecords({bundle, documentBinaries, projectId, strategy, idFactory}) {
  const accountMap = new Map();
  const positionMap = new Map();
  const documentMap = new Map();
  const issueMap = new Map();
  const eventMap = new Map();
  const forceRandom = strategy === RESTORE_STRATEGIES.DUPLICATE;
  for (const account of bundle.accounts) accountMap.set(account.id, remappedId(projectId, 'account', account.id, idFactory, forceRandom));
  for (const position of bundle.positions) positionMap.set(position.id, remappedId(projectId, 'position', position.id, idFactory, forceRandom));
  for (const document of bundle.documents) documentMap.set(document.id, remappedId(projectId, 'document', document.id, idFactory, forceRandom));
  for (const issue of bundle.issues) issueMap.set(issue.id, remappedId(projectId, 'issue', issue.id, idFactory, forceRandom));
  for (const event of bundle.events) eventMap.set(event.id, remappedId(projectId, 'event', event.id, idFactory, forceRandom));

  const accounts = bundle.accounts.map(account => ({...account, id: accountMap.get(account.id), projectId, name: String(account.name || 'Conta restaurada').slice(0, 180)}));
  const positions = bundle.positions.map(position => validatePosition({...position, id: positionMap.get(position.id), projectId, accountId: accountMap.get(position.accountId) || 'unknown', name: String(position.name || 'Posição restaurada').slice(0, 180), externalReference: String(position.externalReference || '').slice(0, 180)}));
  const documents = bundle.documents.map(document => ({
    ...document,
    id: documentMap.get(document.id),
    projectId,
    fileName: safeFileName(document.fileName, 'documento.bin'),
    blob: documentBinaries.get(document.id) || null,
    restoredFromDocumentId: document.id,
  }));
  const events = bundle.events.map(event => createEvent({...event, id: eventMap.get(event.id), projectId, positionId: positionMap.get(event.positionId), accountId: accountMap.get(event.accountId) || 'unknown', sourceDocumentId: event.sourceDocumentId ? documentMap.get(event.sourceDocumentId) : null, notes: String(event.notes || '').slice(0, 5000)}));
  const issues = bundle.issues.map(issue => ({...issue, id: issueMap.get(issue.id), projectId, positionId: issue.positionId ? positionMap.get(issue.positionId) : null, documentId: issue.documentId ? documentMap.get(issue.documentId) : null, title: String(issue.title || 'Pendência restaurada').slice(0, 240), details: String(issue.details || '').slice(0, 5000), status: ['OPEN', 'RESOLVED'].includes(issue.status) ? issue.status : 'OPEN'}));
  const evidences = bundle.evidences.map(item => ({...item, id: remappedId(projectId, 'evidence', item.id, idFactory, forceRandom), projectId, documentId: item.documentId ? documentMap.get(item.documentId) : null, positionId: item.positionId ? positionMap.get(item.positionId) : null, eventId: item.eventId ? eventMap.get(item.eventId) || null : null}));
  const processingRuns = bundle.processingRuns.map(item => ({...item, id: remappedId(projectId, 'run', item.id, idFactory, forceRandom), projectId, documentId: item.documentId ? documentMap.get(item.documentId) : null}));
  const reportedTotals = bundle.reportedTotals.map(item => ({...item, id: remappedId(projectId, 'reported', item.id, idFactory, forceRandom), projectId, documentId: item.documentId ? documentMap.get(item.documentId) : null}));
  const reportSnapshots = bundle.reportSnapshots.map(item => ({...item, id: remappedId(projectId, 'report', item.id, idFactory, forceRandom), projectId}));
  const documentExtractions = bundle.documentExtractions.map(item => ({...item,id:remappedId(projectId,'extraction',item.id,idFactory,forceRandom),projectId,documentId:item.documentId?documentMap.get(item.documentId):null}));
  const reviewDecisions = bundle.reviewDecisions.map(item => ({...item,id:remappedId(projectId,'decision',item.id,idFactory,forceRandom),projectId,documentId:item.documentId?documentMap.get(item.documentId):null,positionId:item.positionId?positionMap.get(item.positionId):null,eventId:item.eventId?eventMap.get(item.eventId):null}));
  const documentLinks = bundle.documentLinks.map(item => ({...item,id:remappedId(projectId,'link',item.id,idFactory,forceRandom),projectId,sourceDocumentId:item.sourceDocumentId?documentMap.get(item.sourceDocumentId):null,targetDocumentId:item.targetDocumentId?documentMap.get(item.targetDocumentId):null}));
  const templateTests = bundle.templateTests.map(item => ({...item,id:remappedId(projectId,'template-test',item.id,idFactory,forceRandom),projectId,documentId:item.documentId?documentMap.get(item.documentId):null}));
  const bankTransactions = bundle.bankTransactions.map(item => ({...item,id:remappedId(projectId,'bank-tx',item.id,idFactory,forceRandom),projectId,documentId:item.documentId?documentMap.get(item.documentId):null,accountId:item.accountId?accountMap.get(item.accountId)||item.accountId:null}));
  const transactionMap = new Map(bundle.bankTransactions.map((item,index)=>[item.id,bankTransactions[index].id]));
  const reconciliations = bundle.reconciliations.map(item => ({...item,id:remappedId(projectId,'reconciliation',item.id,idFactory,forceRandom),projectId,positionId:item.positionId?positionMap.get(item.positionId):null,redemptionEventId:item.redemptionEventId?eventMap.get(item.redemptionEventId):null,bankTransactionId:item.bankTransactionId?transactionMap.get(item.bankTransactionId)||null:null,sourceDocumentIds:(item.sourceDocumentIds||[]).map(id=>documentMap.get(id)).filter(Boolean)}));
  const reconciliationMap = new Map(bundle.reconciliations.map((item,index)=>[item.id,reconciliations[index].id]));
  const quarterClosures = [];
  for (const item of bundle.quarterClosures) quarterClosures.push(await rebaseQuarterClosure(item,{projectId,id:remappedId(projectId,'closure',item.id,idFactory,forceRandom),eventMap,reconciliationMap,documentMap}));
  const pilotCaseMap = new Map(bundle.pilotCases.map(item=>[item.id,remappedId(projectId,'pilot-case',item.id,idFactory,forceRandom)]));
  const pilotCases = bundle.pilotCases.map(item=>({...item,id:pilotCaseMap.get(item.id),projectId,documentId:item.documentId?documentMap.get(item.documentId):null,groundTruth:{...(item.groundTruth||{}),events:(item.groundTruth?.events||[]).map(event=>({...event,positionId:event.positionId?positionMap.get(event.positionId)||null:null}))}}));
  const pilotRuns = bundle.pilotRuns.map(item=>({...item,id:remappedId(projectId,'pilot-run',item.id,idFactory,forceRandom),projectId,results:(item.results||[]).map(result=>({...result,caseId:pilotCaseMap.get(result.caseId)||result.caseId,documentId:result.documentId?documentMap.get(result.documentId)||null:null}))}));
  return {accounts, positions, documents, events, issues, evidences, processingRuns, reportedTotals, reportSnapshots, documentExtractions, reviewDecisions, documentLinks, templateTests, bankTransactions, reconciliations, quarterClosures, pilotCases, pilotRuns};
}

async function buildMergedRecords({repo, bundle, documentBinaries, projectId, idFactory}) {
  const [existingAccounts, existingPositions, existingDocuments, existingEvents, existingIssues, existingEvidences, existingRuns, existingReported, existingReports, existingExtractions, existingDecisions, existingLinks, existingTemplateTests, existingBankTransactions, existingReconciliations, existingQuarterClosures, existingPilotCases, existingPilotRuns] = await Promise.all([
    allProject(repo, 'accounts', projectId),
    allProject(repo, 'positions', projectId),
    allProject(repo, 'documents', projectId),
    allProject(repo, 'events', projectId),
    allProject(repo, 'issues', projectId),
    allProject(repo, 'evidences', projectId),
    allProject(repo, 'processingRuns', projectId),
    allProject(repo, 'reportedTotals', projectId),
    allProject(repo, 'reportSnapshots', projectId),
    allProject(repo, 'documentExtractions', projectId),
    allProject(repo, 'reviewDecisions', projectId),
    allProject(repo, 'documentLinks', projectId),
    allProject(repo, 'templateTests', projectId),
    allProject(repo, 'bankTransactions', projectId),
    allProject(repo, 'reconciliations', projectId),
    allProject(repo, 'quarterClosures', projectId),
    allProject(repo, 'pilotCases', projectId),
    allProject(repo, 'pilotRuns', projectId),
  ]);
  const accountByKey = new Map(existingAccounts.map(item => [accountKey(item), item]));
  const positionByKey = new Map(existingPositions.map(item => [positionKey(item), item]));
  const documentByHash = new Map(existingDocuments.filter(item => item.hash).map(item => [item.hash, item]));
  const accountMap = new Map();
  const positionMap = new Map();
  const documentMap = new Map();
  const added = {accounts: [], positions: [], documents: [], events: [], issues: [], evidences: [], processingRuns: [], reportedTotals: [], reportSnapshots: [], documentExtractions: [], reviewDecisions: [], documentLinks: [], templateTests: [], bankTransactions: [], reconciliations: [], quarterClosures: [], pilotCases: [], pilotRuns: []};
  const conflicts = [];

  for (const account of bundle.accounts) {
    const match = accountByKey.get(accountKey(account));
    if (match) accountMap.set(account.id, match.id);
    else {
      const id = remappedId(projectId, 'account', account.id, idFactory, true);
      accountMap.set(account.id, id);
      const value = {...account, id, projectId};
      added.accounts.push(value);
      accountByKey.set(accountKey(value), value);
    }
  }
  for (const position of bundle.positions) {
    const match = positionByKey.get(positionKey(position));
    if (match) positionMap.set(position.id, match.id);
    else {
      const id = remappedId(projectId, 'position', position.id, idFactory, true);
      positionMap.set(position.id, id);
      const value = validatePosition({...position, id, projectId, accountId: accountMap.get(position.accountId) || 'unknown'});
      added.positions.push(value);
      positionByKey.set(positionKey(value), value);
    }
  }
  for (const document of bundle.documents) {
    const match = document.hash ? documentByHash.get(document.hash) : null;
    if (match) {
      documentMap.set(document.id, match.id);
      if (documentBinaries.has(document.id) && !match.blob) {
        match.blob = documentBinaries.get(document.id);
        await repo.put('documents', match);
      }
    } else {
      const id = remappedId(projectId, 'document', document.id, idFactory, true);
      documentMap.set(document.id, id);
      const value = {...document, id, projectId, fileName: safeFileName(document.fileName, 'documento.bin'), blob: documentBinaries.get(document.id) || null, restoredFromDocumentId: document.id};
      added.documents.push(value);
      if (value.hash) documentByHash.set(value.hash, value);
    }
  }

  const existingDocumentHashById = new Map([...existingDocuments, ...added.documents].map(item => [item.id, item.hash || '']));
  const eventKeys = new Set(existingEvents.map(event => eventKey(event, existingDocumentHashById.get(event.sourceDocumentId) || '')));
  for (const event of bundle.events) {
    const mapped = createEvent({...event, id: remappedId(projectId, 'event', event.id, idFactory, true), projectId, positionId: positionMap.get(event.positionId), accountId: accountMap.get(event.accountId) || 'unknown', sourceDocumentId: event.sourceDocumentId ? documentMap.get(event.sourceDocumentId) : null});
    const key = eventKey(mapped, existingDocumentHashById.get(mapped.sourceDocumentId) || bundle.documents.find(item => item.id === event.sourceDocumentId)?.hash || '');
    if (!eventKeys.has(key)) { added.events.push(mapped); eventKeys.add(key); }
  }
  const issueKeys = new Set(existingIssues.map(issueKey));
  for (const issue of bundle.issues) {
    const value = {...issue, id: remappedId(projectId, 'issue', issue.id, idFactory, true), projectId, positionId: issue.positionId ? positionMap.get(issue.positionId) : null, documentId: issue.documentId ? documentMap.get(issue.documentId) : null};
    const key = issueKey(value);
    if (!issueKeys.has(key)) { added.issues.push(value); issueKeys.add(key); }
  }
  const existingEvidenceKeys = new Set(existingEvidences.map(item => contentKey({documentId:item.documentId,fieldPath:item.fieldPath,value:item.value,snippet:item.snippet})));
  for (const item of bundle.evidences) { const value={...item,id:remappedId(projectId,'evidence',item.id,idFactory,true),projectId,documentId:item.documentId?documentMap.get(item.documentId):null,positionId:item.positionId?positionMap.get(item.positionId):null}; const key=contentKey({documentId:value.documentId,fieldPath:value.fieldPath,value:value.value,snippet:value.snippet}); if(!existingEvidenceKeys.has(key)){added.evidences.push(value);existingEvidenceKeys.add(key);} }
  const mergeSimple=(source,existing,target,prefix,mapper=item=>item)=>{const keys=new Set(existing.map(item=>contentKey(item)));for(const item of source){const value=mapper({...item,id:remappedId(projectId,prefix,item.id,idFactory,true),projectId});const key=contentKey(value);if(!keys.has(key)){target.push(value);keys.add(key);}}};
  mergeSimple(bundle.processingRuns,existingRuns,added.processingRuns,'run',item=>({...item,documentId:item.documentId?documentMap.get(item.documentId):null}));
  mergeSimple(bundle.reportedTotals,existingReported,added.reportedTotals,'reported',item=>({...item,documentId:item.documentId?documentMap.get(item.documentId):null}));
  mergeSimple(bundle.reportSnapshots,existingReports,added.reportSnapshots,'report');
  mergeSimple(bundle.documentExtractions,existingExtractions,added.documentExtractions,'extraction',item=>({...item,documentId:item.documentId?documentMap.get(item.documentId):null}));
  mergeSimple(bundle.reviewDecisions,existingDecisions,added.reviewDecisions,'decision',item=>({...item,documentId:item.documentId?documentMap.get(item.documentId):null,positionId:item.positionId?positionMap.get(item.positionId):null,eventId:item.eventId?item.eventId:null}));
  mergeSimple(bundle.documentLinks,existingLinks,added.documentLinks,'link',item=>({...item,sourceDocumentId:item.sourceDocumentId?documentMap.get(item.sourceDocumentId):null,targetDocumentId:item.targetDocumentId?documentMap.get(item.targetDocumentId):null}));
  mergeSimple(bundle.templateTests,existingTemplateTests,added.templateTests,'template-test',item=>({...item,documentId:item.documentId?documentMap.get(item.documentId):null}));
  mergeSimple(bundle.bankTransactions,existingBankTransactions,added.bankTransactions,'bank-tx',item=>({...item,documentId:item.documentId?documentMap.get(item.documentId):null,accountId:item.accountId?accountMap.get(item.accountId)||item.accountId:null}));
  mergeSimple(bundle.reconciliations,existingReconciliations,added.reconciliations,'reconciliation',item=>({...item,positionId:item.positionId?positionMap.get(item.positionId):null,redemptionEventId:item.redemptionEventId||null,bankTransactionId:item.bankTransactionId||null,sourceDocumentIds:(item.sourceDocumentIds||[]).map(id=>documentMap.get(id)).filter(Boolean)}));
  const existingClosureKeys = new Set(existingQuarterClosures.map(item=>contentKey({quarter:item.quarter,revision:item.revision,integrityHash:item.integrityHash})));
  for (const item of bundle.quarterClosures) {
    const key = contentKey({quarter:item.quarter,revision:item.revision,integrityHash:item.integrityHash});
    if (existingClosureKeys.has(key)) continue;
    const restored = await rebaseQuarterClosure(item,{projectId,id:remappedId(projectId,'closure',item.id,idFactory,true)});
    added.quarterClosures.push(restored);
    existingClosureKeys.add(key);
  }
  mergeSimple(bundle.pilotCases,existingPilotCases,added.pilotCases,'pilot-case',item=>({...item,documentId:item.documentId?documentMap.get(item.documentId):null}));
  mergeSimple(bundle.pilotRuns,existingPilotRuns,added.pilotRuns,'pilot-run');
  if (added.events.length < bundle.events.length) conflicts.push(`${bundle.events.length - added.events.length} evento(s) já existentes foram ignorados para evitar dupla contagem.`);
  if (added.documents.length < bundle.documents.length) conflicts.push(`${bundle.documents.length - added.documents.length} documento(s) foram deduplicados por SHA-256.`);
  return {...added, conflicts};
}

export async function restoreProjectBundle(repo, input, options = {}) {
  const bundle = migrateProjectBundle(input.bundle || input);
  const documentBinaries = input.documentBinaries || new Map();
  const strategy = options.strategy || RESTORE_STRATEGIES.DUPLICATE;
  if (!Object.values(RESTORE_STRATEGIES).includes(strategy)) throw new Error(`Invalid restore strategy: ${strategy}`);
  const idFactory = options.idFactory || defaultIdFactory;
  const existingProjects = await repo.all('projects');
  const existingById = new Map(existingProjects.map(item => [item.id, item]));
  let projectId;
  if (strategy === RESTORE_STRATEGIES.DUPLICATE) projectId = options.targetProjectId || idFactory('project');
  else projectId = options.targetProjectId || bundle.project.id;
  const existingProject = existingById.get(projectId);
  if (strategy === RESTORE_STRATEGIES.MERGE && !existingProject) throw new Error('Merge requires an existing target project');

  const bankConflicts = await upsertBanks(repo, bundle.banks);
  let records;
  let mergeConflicts = [];
  if (strategy === RESTORE_STRATEGIES.MERGE) {
    records = await buildMergedRecords({repo, bundle, documentBinaries, projectId, idFactory});
    mergeConflicts = records.conflicts || [];
  } else {
    if (strategy === RESTORE_STRATEGIES.REPLACE && existingProject) await repo.deleteProject(projectId, {preserveSnapshots: true});
    records = await buildFreshRecords({bundle, documentBinaries, projectId, strategy, idFactory});
  }
  const project = createProjectRecord(bundle.project, projectId, strategy, existingProject);
  const summary = {
    strategy,
    projectId,
    accounts: records.accounts.length,
    positions: records.positions.length,
    documents: records.documents.length,
    events: records.events.length,
    issues: records.issues.length,
    evidences: (records.evidences || []).length,
    processingRuns: (records.processingRuns || []).length,
    reportedTotals: (records.reportedTotals || []).length,
    reportSnapshots: (records.reportSnapshots || []).length,
    documentExtractions: (records.documentExtractions || []).length,
    reviewDecisions: (records.reviewDecisions || []).length,
    documentLinks: (records.documentLinks || []).length,
    templateTests: (records.templateTests || []).length,
    bankTransactions: (records.bankTransactions || []).length,
    reconciliations: (records.reconciliations || []).length,
    quarterClosures: (records.quarterClosures || []).length,
    pilotCases: (records.pilotCases || []).length,
    pilotRuns: (records.pilotRuns || []).length,
    conflicts: [...bankConflicts, ...mergeConflicts],
  };
  const audit = {
    id: idFactory('audit'), projectId, occurredAt: new Date().toISOString(), action: 'PROJECT_RESTORE', strategy,
    summary, sourceProjectId: bundle.project.id, sourceProjectName: bundle.project.name, appVersion: STAGE9_APP_VERSION,
  };
  await writeRestoredRecords(repo, {...records, project, audit});
  await repo.put('settings', {id: 'active-project', value: projectId});
  return summary;
}

export async function restoreHtafFile(repo, file, options = {}) {
  const parsed = await parseHtafFile(file, {password: options.password || ''});
  const summary = await restoreProjectBundle(repo, parsed, options);
  return {...summary, encrypted: parsed.encrypted, manifest: parsed.manifest};
}
