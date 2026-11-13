import { bytesOf, safeArchivePath, safeFileName, stableStringify, toUint8Array, utf8Decode, utf8Encode } from './bytes.js';
import { decryptHtafPayload, encryptHtafPayload, isEncryptedHtaf, sha256Hex } from './crypto.js';
import { createZip, parseZip } from './zip-store.js';
import { CURRENT_PROJECT_SCHEMA_VERSION, HTAF_FORMAT_VERSION, STAGE9_APP_VERSION, legacyStage8PayloadToBundle, migrateProjectBundle, validateProjectBundle } from './migrations.js';

export const HTAF_MIME_TYPE = 'application/x-hteixeira-financial-archive';
export const HTAF_EXTENSION = '.htaf';
export const MAX_HTAF_BYTES = 750 * 1024 * 1024;

const PROJECT_STORES = ['accounts', 'positions', 'events', 'documents', 'issues', 'evidences', 'processingRuns', 'reportedTotals', 'reportSnapshots', 'documentExtractions', 'reviewDecisions', 'documentLinks', 'templateTests', 'bankTransactions', 'reconciliations', 'quarterClosures', 'pilotCases', 'pilotRuns'];
const DATA_FILES = Object.freeze({
  project: 'data/project.json',
  banks: 'data/banks.json',
  accounts: 'data/accounts.json',
  positions: 'data/positions.json',
  events: 'data/events.json',
  documents: 'data/documents.json',
  issues: 'data/issues.json',
  evidences: 'data/evidences.json',
  processingRuns: 'data/processing-runs.json',
  reportedTotals: 'data/reported-totals.json',
  reportSnapshots: 'data/report-snapshots.json',
  documentExtractions: 'data/document-extractions.json',
  reviewDecisions: 'data/review-decisions.json',
  documentLinks: 'data/document-links.json',
  templateTests: 'data/template-tests.json',
  bankTransactions: 'data/bank-transactions.json',
  reconciliations: 'data/reconciliations.json',
  quarterClosures: 'data/quarter-closures.json',
  pilotCases: 'data/pilot-cases.json',
  pilotRuns: 'data/pilot-runs.json',
});
const RESERVED_FILES = new Set(['manifest.json', 'checksums.sha256', 'README.txt']);

function cloneWithoutBlob(document) {
  const {blob, ...metadata} = document;
  return structuredClone(metadata);
}

function safeDocumentPath(document) {
  const hash = String(document.hash || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Document has invalid SHA-256 hash: ${document.fileName || document.id}`);
  return safeArchivePath(`documents/${hash.slice(0, 2)}/${hash}-${safeFileName(document.fileName, 'documento.bin')}`);
}

async function recordsForProject(repo, store, projectId) {
  try {
    if (typeof repo.allByProject === 'function') return await repo.allByProject(store, projectId);
    return (await repo.all(store)).filter(record => record.projectId === projectId);
  } catch { return []; }
}

export async function collectProjectBundle(repo, projectId, options = {}) {
  const includeDocuments = options.includeDocuments !== false;
  const project = await repo.get('projects', projectId);
  if (!project) throw new Error('Project not found');
  const [accounts, positions, events, documents, issues, evidences, processingRuns, reportedTotals, reportSnapshots, documentExtractions, reviewDecisions, documentLinks, templateTests, bankTransactions, reconciliations, quarterClosures, pilotCases, pilotRuns, allBanks] = await Promise.all([
    ...PROJECT_STORES.map(store => recordsForProject(repo, store, projectId)),
    repo.all('banks'),
  ]);
  const bankIds = new Set([
    ...accounts.map(item => item.bankId),
    ...positions.map(item => item.bankId),
    ...events.map(item => item.bankId),
    ...documents.map(item => item.bankId),
  ].filter(Boolean));
  const banks = allBanks.filter(bank => bankIds.has(bank.id));
  const documentBinaries = [];
  const documentMetadata = [];
  for (const document of documents) {
    const metadata = cloneWithoutBlob(document);
    metadata.archivePath = null;
    metadata.binaryIncluded = false;
    if (includeDocuments && document.blob instanceof Blob) {
      const bytes = await bytesOf(document.blob);
      const actualHash = await sha256Hex(bytes);
      if (metadata.hash && metadata.hash !== actualHash) throw new Error(`Document hash mismatch before export: ${metadata.fileName}`);
      metadata.hash = actualHash;
      metadata.size = bytes.byteLength;
      metadata.archivePath = safeDocumentPath(metadata);
      metadata.binaryIncluded = true;
      documentBinaries.push({documentId: metadata.id, path: metadata.archivePath, bytes, mimeType: metadata.mimeType || document.blob.type || 'application/octet-stream'});
    }
    documentMetadata.push(metadata);
  }
  const bundle = migrateProjectBundle({
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    project: {...project, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, version: STAGE9_APP_VERSION},
    banks,
    accounts,
    positions,
    events,
    documents: documentMetadata,
    issues,
    evidences,
    processingRuns,
    reportedTotals,
    reportSnapshots,
    documentExtractions,
    reviewDecisions,
    documentLinks,
    templateTests,
    bankTransactions,
    reconciliations,
    quarterClosures,
    pilotCases,
    pilotRuns,
    exportedAt: options.exportedAt || new Date().toISOString(),
  });
  return {bundle, documentBinaries};
}

function readmeText() {
  return `Analista Tributário de Aplicações Financeiras by fff - HT\n\nEste arquivo .htaf contém um projeto criado e armazenado localmente.\nOs dados estruturados estão em /data e os documentos originais, quando incluídos, em /documents.\nA integridade é verificada por SHA-256 antes da restauração.\nNão edite manualmente o conteúdo do pacote.\n`;
}

export async function buildHtafBytes({bundle, documentBinaries = [], password = '', createdAt, appVersion = STAGE9_APP_VERSION}) {
  const migrated = migrateProjectBundle(bundle);
  const timestamp = createdAt || migrated.exportedAt || new Date().toISOString();
  const payloadEntries = [];
  const addJson = (path, value) => payloadEntries.push({name: path, data: utf8Encode(stableStringify(value, 2)), category: 'structured-data', mimeType: 'application/json'});
  addJson(DATA_FILES.project, migrated.project);
  addJson(DATA_FILES.banks, migrated.banks);
  addJson(DATA_FILES.accounts, migrated.accounts);
  addJson(DATA_FILES.positions, migrated.positions);
  addJson(DATA_FILES.events, migrated.events);
  addJson(DATA_FILES.documents, migrated.documents);
  addJson(DATA_FILES.issues, migrated.issues);
  addJson(DATA_FILES.evidences, migrated.evidences);
  addJson(DATA_FILES.processingRuns, migrated.processingRuns);
  addJson(DATA_FILES.reportedTotals, migrated.reportedTotals);
  addJson(DATA_FILES.reportSnapshots, migrated.reportSnapshots);
  addJson(DATA_FILES.documentExtractions, migrated.documentExtractions);
  addJson(DATA_FILES.reviewDecisions, migrated.reviewDecisions);
  addJson(DATA_FILES.documentLinks, migrated.documentLinks);
  addJson(DATA_FILES.templateTests, migrated.templateTests);
  addJson(DATA_FILES.bankTransactions, migrated.bankTransactions);
  addJson(DATA_FILES.reconciliations, migrated.reconciliations);
  addJson(DATA_FILES.quarterClosures, migrated.quarterClosures);
  addJson(DATA_FILES.pilotCases, migrated.pilotCases);
  addJson(DATA_FILES.pilotRuns, migrated.pilotRuns);

  const binariesByPath = new Map(documentBinaries.map(item => [safeArchivePath(item.path), item]));
  for (const document of migrated.documents) {
    if (!document.binaryIncluded) continue;
    if (!document.archivePath) throw new Error(`Document marked as included without archive path: ${document.id}`);
    const binary = binariesByPath.get(safeArchivePath(document.archivePath));
    if (!binary) throw new Error(`Document bytes are missing: ${document.fileName}`);
    const hash = await sha256Hex(binary.bytes);
    if (hash !== document.hash) throw new Error(`Document bytes do not match metadata hash: ${document.fileName}`);
    payloadEntries.push({name: document.archivePath, data: toUint8Array(binary.bytes), category: 'document', mimeType: binary.mimeType || document.mimeType || 'application/octet-stream', documentId: document.id});
  }

  const fileManifest = [];
  for (const entry of payloadEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    const bytes = await bytesOf(entry.data);
    fileManifest.push({path: entry.name, size: bytes.byteLength, sha256: await sha256Hex(bytes), category: entry.category, mimeType: entry.mimeType, documentId: entry.documentId || null});
  }
  const manifest = {
    format: 'HTAF',
    formatVersion: HTAF_FORMAT_VERSION,
    projectSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    appVersion,
    createdAt: timestamp,
    project: {
      id: migrated.project.id,
      name: migrated.project.name,
      companyName: migrated.project.companyName || null,
      cnpj: migrated.project.cnpj || null,
      periodStart: migrated.project.periodStart || null,
      periodEnd: migrated.project.periodEnd || null,
    },
    counts: {
      banks: migrated.banks.length,
      accounts: migrated.accounts.length,
      positions: migrated.positions.length,
      events: migrated.events.length,
      documents: migrated.documents.length,
      includedDocumentBinaries: migrated.documents.filter(item => item.binaryIncluded).length,
      issues: migrated.issues.length,
      evidences: migrated.evidences.length,
      processingRuns: migrated.processingRuns.length,
      reportedTotals: migrated.reportedTotals.length,
      reportSnapshots: migrated.reportSnapshots.length,
      documentExtractions: migrated.documentExtractions.length,
      reviewDecisions: migrated.reviewDecisions.length,
      documentLinks: migrated.documentLinks.length,
      templateTests: migrated.templateTests.length,
      bankTransactions: migrated.bankTransactions.length,
      reconciliations: migrated.reconciliations.length,
      quarterClosures: migrated.quarterClosures.length,
      pilotCases: migrated.pilotCases.length,
      pilotRuns: migrated.pilotRuns.length,
    },
    files: fileManifest,
  };
  const checksums = fileManifest.map(item => `${item.sha256}  ${item.path}`).join('\n') + '\n';
  const zipEntries = [
    ...payloadEntries.map(item => ({name: item.name, data: item.data, modifiedAt: new Date(timestamp)})),
    {name: 'README.txt', data: readmeText(), modifiedAt: new Date(timestamp)},
    {name: 'checksums.sha256', data: checksums, modifiedAt: new Date(timestamp)},
    {name: 'manifest.json', data: stableStringify(manifest, 2), modifiedAt: new Date(timestamp)},
  ];
  const zipBytes = await createZip(zipEntries, {modifiedAt: new Date(timestamp), maxEntries: 20050, maxTotalBytes: MAX_HTAF_BYTES});
  if (password) return encryptHtafPayload(zipBytes, password, {createdAt: timestamp});
  return zipBytes;
}

export async function exportProjectHtaf(repo, projectId, options = {}) {
  const {bundle, documentBinaries} = await collectProjectBundle(repo, projectId, options);
  const bytes = await buildHtafBytes({bundle, documentBinaries, password: options.password || '', createdAt: options.createdAt});
  const archiveHash = await sha256Hex(bytes);
  const name = safeFileName(bundle.project.name, 'projeto').replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
  return {
    bytes,
    blob: new Blob([bytes], {type: HTAF_MIME_TYPE}),
    fileName: `${name}${HTAF_EXTENSION}`,
    encrypted: Boolean(options.password),
    archiveHash,
    bundle,
  };
}

function parseJsonFile(files, path) {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`Required HTAF file is missing: ${path}`);
  try { return JSON.parse(utf8Decode(bytes)); } catch { throw new Error(`Invalid JSON in HTAF file: ${path}`); }
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== 'HTAF') throw new Error('Invalid HTAF manifest');
  if (manifest.formatVersion !== HTAF_FORMAT_VERSION) throw new Error(`Unsupported HTAF format version: ${manifest.formatVersion}`);
  if (!Number.isSafeInteger(manifest.projectSchemaVersion) || manifest.projectSchemaVersion < 1) throw new Error('Invalid HTAF project schema version');
  if (!Array.isArray(manifest.files) || manifest.files.length > 20000) throw new Error('Invalid HTAF file manifest');
  const paths = new Set();
  for (const item of manifest.files) {
    const path = safeArchivePath(item.path);
    if (paths.has(path)) throw new Error(`Duplicate path in HTAF manifest: ${path}`);
    paths.add(path);
    if (!/^[0-9a-f]{64}$/i.test(item.sha256)) throw new Error(`Invalid SHA-256 in HTAF manifest: ${path}`);
    if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_HTAF_BYTES) throw new Error(`Invalid size in HTAF manifest: ${path}`);
  }
  return paths;
}

export async function parseHtafBytes(input, options = {}) {
  let bytes = toUint8Array(input);
  if (bytes.byteLength > MAX_HTAF_BYTES) throw new Error('HTAF file exceeds the supported size limit');
  let encrypted = false;
  let encryptionHeader = null;
  if (isEncryptedHtaf(bytes)) {
    encrypted = true;
    const decrypted = await decryptHtafPayload(bytes, options.password || '');
    bytes = decrypted.bytes;
    encryptionHeader = decrypted.header;
  }
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('The file is not a valid HTAF archive');
  const zip = parseZip(bytes, {maxEntries: 20050, maxTotalBytes: MAX_HTAF_BYTES, maxEntryBytes: 100 * 1024 * 1024});
  const manifest = parseJsonFile(zip.files, 'manifest.json');
  const expectedPaths = validateManifest(manifest);
  for (const entry of manifest.files) {
    const data = zip.files.get(entry.path);
    if (!data) throw new Error(`HTAF payload file is missing: ${entry.path}`);
    if (data.byteLength !== entry.size) throw new Error(`HTAF file size mismatch: ${entry.path}`);
    const hash = await sha256Hex(data);
    if (hash !== entry.sha256) throw new Error(`HTAF SHA-256 mismatch: ${entry.path}`);
  }
  for (const path of zip.files.keys()) {
    if (!expectedPaths.has(path) && !RESERVED_FILES.has(path)) throw new Error(`Unexpected file in HTAF archive: ${path}`);
  }
  const checksumBytes = zip.files.get('checksums.sha256');
  if (!checksumBytes) throw new Error('HTAF checksums file is missing');
  const checksumLines = utf8Decode(checksumBytes).trim().split(/\r?\n/).filter(Boolean);
  if (checksumLines.length !== manifest.files.length) throw new Error('HTAF checksums count mismatch');
  const checksumMap = new Map(checksumLines.map(line => {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/i);
    if (!match) throw new Error('Invalid HTAF checksums format');
    return [safeArchivePath(match[2]), match[1].toLowerCase()];
  }));
  for (const item of manifest.files) if (checksumMap.get(item.path) !== item.sha256.toLowerCase()) throw new Error(`HTAF checksums mismatch: ${item.path}`);

  const bundle = migrateProjectBundle({
    schemaVersion: manifest.projectSchemaVersion,
    project: parseJsonFile(zip.files, DATA_FILES.project),
    banks: parseJsonFile(zip.files, DATA_FILES.banks),
    accounts: parseJsonFile(zip.files, DATA_FILES.accounts),
    positions: parseJsonFile(zip.files, DATA_FILES.positions),
    events: parseJsonFile(zip.files, DATA_FILES.events),
    documents: parseJsonFile(zip.files, DATA_FILES.documents),
    issues: parseJsonFile(zip.files, DATA_FILES.issues),
    evidences: manifest.projectSchemaVersion >= 3 ? parseJsonFile(zip.files, DATA_FILES.evidences) : [],
    processingRuns: manifest.projectSchemaVersion >= 3 ? parseJsonFile(zip.files, DATA_FILES.processingRuns) : [],
    reportedTotals: manifest.projectSchemaVersion >= 3 ? parseJsonFile(zip.files, DATA_FILES.reportedTotals) : [],
    reportSnapshots: manifest.projectSchemaVersion >= 3 ? parseJsonFile(zip.files, DATA_FILES.reportSnapshots) : [],
    documentExtractions: manifest.projectSchemaVersion >= 4 ? parseJsonFile(zip.files, DATA_FILES.documentExtractions) : [],
    reviewDecisions: manifest.projectSchemaVersion >= 4 ? parseJsonFile(zip.files, DATA_FILES.reviewDecisions) : [],
    documentLinks: manifest.projectSchemaVersion >= 4 ? parseJsonFile(zip.files, DATA_FILES.documentLinks) : [],
    templateTests: manifest.projectSchemaVersion >= 4 ? parseJsonFile(zip.files, DATA_FILES.templateTests) : [],
    bankTransactions: manifest.projectSchemaVersion >= 5 ? parseJsonFile(zip.files, DATA_FILES.bankTransactions) : [],
    reconciliations: manifest.projectSchemaVersion >= 5 ? parseJsonFile(zip.files, DATA_FILES.reconciliations) : [],
    quarterClosures: manifest.projectSchemaVersion >= 5 ? parseJsonFile(zip.files, DATA_FILES.quarterClosures) : [],
    pilotCases: manifest.projectSchemaVersion >= 6 ? parseJsonFile(zip.files, DATA_FILES.pilotCases) : [],
    pilotRuns: manifest.projectSchemaVersion >= 6 ? parseJsonFile(zip.files, DATA_FILES.pilotRuns) : [],
    exportedAt: manifest.createdAt,
  });
  const documentBinaries = new Map();
  for (const document of bundle.documents) {
    if (!document.binaryIncluded) continue;
    if (!document.archivePath) throw new Error(`HTAF document is missing archive path: ${document.id}`);
    const data = zip.files.get(document.archivePath);
    if (!data) throw new Error(`HTAF document bytes are missing: ${document.fileName}`);
    const hash = await sha256Hex(data);
    if (hash !== document.hash) throw new Error(`HTAF document hash mismatch: ${document.fileName}`);
    documentBinaries.set(document.id, new Blob([data], {type: document.mimeType || 'application/octet-stream'}));
  }
  validateProjectBundle(bundle);
  return {
    bundle,
    manifest,
    documentBinaries,
    encrypted,
    encryptionHeader,
    plainZipHash: await sha256Hex(bytes),
  };
}

export async function parseHtafFile(file, options = {}) {
  const bytes = await bytesOf(file);
  return parseHtafBytes(bytes, options);
}

export function parseLegacyProjectJson(payload) {
  return legacyStage8PayloadToBundle(payload);
}
