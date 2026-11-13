import { createEvent, validatePosition } from '../domain/model.js';
import { normalizeTaxProfile } from '../domain/tax-profile.js';

export const HTAF_FORMAT_VERSION = 1;
export const CURRENT_PROJECT_SCHEMA_VERSION = 6;
export const STAGE11_APP_VERSION = '1.9.0-offline.stage18-stable2';
// Aliases mantidos para compatibilidade com módulos e backups anteriores.
export const STAGE10_APP_VERSION = STAGE11_APP_VERSION;
export const STAGE9_APP_VERSION = STAGE11_APP_VERSION;

const COLLECTIONS = ['banks','accounts','positions','events','documents','issues','evidences','processingRuns','reportedTotals','reportSnapshots','documentExtractions','reviewDecisions','documentLinks','templateTests','bankTransactions','reconciliations','quarterClosures','pilotCases','pilotRuns'];
function clone(value) { return structuredClone(value); }
function normalizeCollections(bundle) { const output=clone(bundle); for(const key of COLLECTIONS) if(!Array.isArray(output[key])) output[key]=[]; return output; }

function migrateSchema1To2(bundle) {
  const output=normalizeCollections(bundle); output.schemaVersion=2;
  output.project={...output.project,version:STAGE10_APP_VERSION,schemaVersion:2,updatedAt:output.project?.updatedAt||output.exportedAt||new Date().toISOString()};
  output.documents=output.documents.map(document=>({...document,archivePath:document.archivePath||null,binaryIncluded:Boolean(document.archivePath||document.binaryIncluded),metadata:document.metadata&&typeof document.metadata==='object'?document.metadata:{}}));
  output.exportedAt=output.exportedAt||new Date().toISOString(); return output;
}
function migrateSchema2To3(bundle) {
  const output=normalizeCollections(bundle); output.schemaVersion=3;
  output.project={...output.project,version:STAGE10_APP_VERSION,schemaVersion:3,taxProfile:normalizeTaxProfile(output.project?.taxProfile||{}),updatedAt:output.project?.updatedAt||output.exportedAt||new Date().toISOString()};
  return output;
}

function migrateSchema3To4(bundle) {
  const output=normalizeCollections(bundle); output.schemaVersion=4;
  output.project={...output.project,version:STAGE10_APP_VERSION,schemaVersion:4,updatedAt:output.project?.updatedAt||output.exportedAt||new Date().toISOString()};
  return output;
}

function migrateSchema4To5(bundle) {
  const output=normalizeCollections(bundle); output.schemaVersion=5;
  output.project={...output.project,version:STAGE10_APP_VERSION,schemaVersion:5,updatedAt:output.project?.updatedAt||output.exportedAt||new Date().toISOString()};
  return output;
}
function migrateSchema5To6(bundle) {
  const output=normalizeCollections(bundle); output.schemaVersion=6;
  output.project={...output.project,version:STAGE10_APP_VERSION,schemaVersion:6,updatedAt:output.project?.updatedAt||output.exportedAt||new Date().toISOString()};
  return output;
}

export function legacyStage8PayloadToBundle(payload) {
  if(!payload||typeof payload!=='object')throw new Error('Legacy project payload is invalid');
  if(payload.format&&payload.format!=='HTAF_STAGE8_JSON')throw new Error('Unsupported legacy project format');
  return migrateProjectBundle({schemaVersion:1,project:payload.project,banks:payload.banks||[],accounts:payload.accounts||[],positions:payload.positions||[],events:payload.events||[],documents:payload.documents||[],issues:payload.issues||[],exportedAt:payload.exportedAt});
}

export function migrateProjectBundle(bundle) {
  if(!bundle||typeof bundle!=='object')throw new Error('Project bundle is invalid');
  let output=clone(bundle); let version=Number(output.schemaVersion||output.project?.schemaVersion||1);
  if(!Number.isSafeInteger(version)||version<1)throw new Error('Invalid project schema version');
  if(version>CURRENT_PROJECT_SCHEMA_VERSION)throw new Error(`Project schema ${version} is newer than this app supports`);
  while(version<CURRENT_PROJECT_SCHEMA_VERSION){if(version===1)output=migrateSchema1To2(output);else if(version===2)output=migrateSchema2To3(output);else if(version===3)output=migrateSchema3To4(output);else if(version===4)output=migrateSchema4To5(output);else if(version===5)output=migrateSchema5To6(output);else throw new Error(`No migration path from project schema ${version}`);version=Number(output.schemaVersion);}
  output=normalizeCollections(output);output.schemaVersion=CURRENT_PROJECT_SCHEMA_VERSION;output.project={...output.project,schemaVersion:CURRENT_PROJECT_SCHEMA_VERSION,version:STAGE10_APP_VERSION,taxProfile:normalizeTaxProfile(output.project?.taxProfile||{})};validateProjectBundle(output);return output;
}

export function validateProjectBundle(bundle) {
  if(!bundle||typeof bundle!=='object')throw new Error('Project bundle is required');
  if(Number(bundle.schemaVersion)!==CURRENT_PROJECT_SCHEMA_VERSION)throw new Error('Project bundle has not been migrated to the current schema');
  if(!bundle.project||typeof bundle.project.id!=='string'||typeof bundle.project.name!=='string')throw new Error('Project identification is invalid');
  if(bundle.project.name.length>180)throw new Error('Project name exceeds the supported length');normalizeTaxProfile(bundle.project.taxProfile);
  const limits={banks:1000,accounts:10000,positions:10000,events:100000,documents:10000,issues:10000,evidences:250000,processingRuns:10000,reportedTotals:10000,reportSnapshots:1000,documentExtractions:10000,reviewDecisions:100000,documentLinks:20000,templateTests:20000,bankTransactions:200000,reconciliations:100000,quarterClosures:1000,pilotCases:10000,pilotRuns:5000};
  for(const [key,limit] of Object.entries(limits)){if(!Array.isArray(bundle[key]))throw new Error(`Project bundle is missing collection ${key}`);if(bundle[key].length>limit)throw new Error(`Project collection ${key} exceeds the supported limit`);}
  for(const position of bundle.positions)validatePosition(position);for(const event of bundle.events)createEvent(event);
  const positionIds=new Set(bundle.positions.map(item=>item.id));const accountIds=new Set(bundle.accounts.map(item=>item.id));const documentIds=new Set(bundle.documents.map(item=>item.id));
  for(const event of bundle.events){if(!positionIds.has(event.positionId))throw new Error(`Event references unknown position: ${event.id}`);if(event.accountId&&event.accountId!=='unknown'&&!accountIds.has(event.accountId))throw new Error(`Event references unknown account: ${event.id}`);if(event.sourceDocumentId&&!documentIds.has(event.sourceDocumentId))throw new Error(`Event references unknown document: ${event.id}`);}
  for(const evidence of bundle.evidences){if(evidence.documentId&&!documentIds.has(evidence.documentId))throw new Error(`Evidence references unknown document: ${evidence.id}`);}
  for(const extraction of bundle.documentExtractions){if(extraction.documentId&&!documentIds.has(extraction.documentId))throw new Error(`Extraction references unknown document: ${extraction.id}`);}
  for(const link of bundle.documentLinks){if(link.sourceDocumentId&&!documentIds.has(link.sourceDocumentId))throw new Error(`Document link references unknown source: ${link.id}`);if(link.targetDocumentId&&!documentIds.has(link.targetDocumentId))throw new Error(`Document link references unknown target: ${link.id}`);}
  for(const transaction of bundle.bankTransactions){if(transaction.documentId&&!documentIds.has(transaction.documentId))throw new Error(`Bank transaction references unknown document: ${transaction.id}`);}
  for(const rec of bundle.reconciliations){if(rec.positionId&&!positionIds.has(rec.positionId))throw new Error(`Reconciliation references unknown position: ${rec.id}`);if(rec.redemptionEventId&&!bundle.events.some(event=>event.id===rec.redemptionEventId))throw new Error(`Reconciliation references unknown redemption: ${rec.id}`);}
  for(const closure of bundle.quarterClosures){if(!/^\d{4}-Q[1-4]$/.test(String(closure.quarter||'')))throw new Error(`Quarter closure has invalid quarter: ${closure.id}`);if(!closure.integrityHash)throw new Error(`Quarter closure lacks integrity hash: ${closure.id}`);}
  for(const pilotCase of bundle.pilotCases){if(pilotCase.documentId&&!documentIds.has(pilotCase.documentId))throw new Error(`Pilot case references unknown document: ${pilotCase.id}`);if(!/^[0-9a-f]{64}$/i.test(String(pilotCase.documentHash||'')))throw new Error(`Pilot case has invalid document hash: ${pilotCase.id}`);}
  return bundle;
}
