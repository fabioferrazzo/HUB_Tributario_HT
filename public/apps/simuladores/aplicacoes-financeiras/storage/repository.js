const DB_NAME = 'ht-financial-applications-offline';
export const DB_VERSION = 9;
export const INDEXEDDB_MIGRATIONS = Object.freeze([
  {version: 1, description: 'Estrutura local original da PWA offline'},
  {version: 2, description: 'Índices por projeto e deduplicação documental por SHA-256'},
  {version: 3, description: 'Snapshots locais e trilha de auditoria da Etapa 9'},
  {version: 4, description: 'Evidências, execuções de processamento, controles de informes e relatórios da Etapa 10'},
  {version: 5, description: 'Central de revisão, extrações, vínculos documentais e templates locais da Etapa 11'},
  {version: 6, description: 'Conciliação multidocumental, transações OFX e fechamentos trimestrais imutáveis da Etapa 12'},
  {version: 7, description: 'Execuções de benchmark, homologação multibanco e métricas de stress da Etapa 15'},
  {version: 8, description: 'Casos e execuções do piloto real controlado da Etapa 16'},
  {version: 9, description: 'Observabilidade local, métricas de desempenho, incidentes e checks de release da Etapa 17'},
]);
export const STORES = Object.freeze([
  'projects', 'banks', 'accounts', 'positions', 'events', 'documents', 'issues', 'settings', 'snapshots', 'auditLog',
  'evidences', 'processingRuns', 'reportedTotals', 'reportSnapshots',
  'documentExtractions', 'reviewDecisions', 'documentLinks', 'customTemplates', 'templateTests',
  'bankTransactions', 'reconciliations', 'quarterClosures', 'benchmarkRuns', 'pilotCases', 'pilotRuns',
  'operationalEvents', 'performanceSamples', 'incidentReports', 'releaseChecks',
]);
const PROJECT_SCOPED_STORES = Object.freeze([
  'accounts', 'positions', 'events', 'documents', 'issues', 'snapshots', 'auditLog',
  'evidences', 'processingRuns', 'reportedTotals', 'reportSnapshots',
  'documentExtractions', 'reviewDecisions', 'documentLinks', 'templateTests',
  'bankTransactions', 'reconciliations', 'quarterClosures', 'pilotCases', 'pilotRuns',
  'operationalEvents', 'performanceSamples', 'incidentReports',
]);

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}
function ensureIndexes(store, name) {
  if (PROJECT_SCOPED_STORES.includes(name) && !store.indexNames.contains('projectId')) store.createIndex('projectId', 'projectId', {unique: false});
  if (name === 'documents' && !store.indexNames.contains('hash')) store.createIndex('hash', 'hash', {unique: false});
  if (['snapshots', 'processingRuns', 'reportSnapshots', 'reviewDecisions', 'templateTests', 'reconciliations', 'quarterClosures', 'benchmarkRuns', 'pilotCases', 'pilotRuns', 'incidentReports', 'releaseChecks'].includes(name) && !store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt', {unique: false});
  if (['operationalEvents', 'performanceSamples'].includes(name) && !store.indexNames.contains('occurredAt')) store.createIndex('occurredAt', 'occurredAt', {unique: false});
  if (name === 'operationalEvents' && !store.indexNames.contains('severity')) store.createIndex('severity', 'severity', {unique: false});
  if (name === 'performanceSamples' && !store.indexNames.contains('operation')) store.createIndex('operation', 'operation', {unique: false});
  if (name === 'incidentReports' && !store.indexNames.contains('status')) store.createIndex('status', 'status', {unique: false});
  if (name === 'releaseChecks' && !store.indexNames.contains('status')) store.createIndex('status', 'status', {unique: false});
  if (name === 'processingRuns' && !store.indexNames.contains('startedAt')) store.createIndex('startedAt', 'startedAt', {unique: false});
  if (name === 'auditLog' && !store.indexNames.contains('occurredAt')) store.createIndex('occurredAt', 'occurredAt', {unique: false});
  if (['evidences', 'reviewDecisions', 'documentLinks', 'templateTests', 'documentExtractions'].includes(name) && !store.indexNames.contains('documentId')) store.createIndex('documentId', 'documentId', {unique: false});
  if (name === 'customTemplates' && !store.indexNames.contains('familyId')) store.createIndex('familyId', 'familyId', {unique: false});
  if (name === 'customTemplates' && !store.indexNames.contains('status')) store.createIndex('status', 'status', {unique: false});
  if (name === 'templateTests' && !store.indexNames.contains('templateId')) store.createIndex('templateId', 'templateId', {unique: false});
  if (name === 'bankTransactions' && !store.indexNames.contains('documentId')) store.createIndex('documentId', 'documentId', {unique: false});
  if (name === 'bankTransactions' && !store.indexNames.contains('postedAt')) store.createIndex('postedAt', 'postedAt', {unique: false});
  if (name === 'reconciliations' && !store.indexNames.contains('quarter')) store.createIndex('quarter', 'quarter', {unique: false});
  if (name === 'quarterClosures' && !store.indexNames.contains('quarter')) store.createIndex('quarter', 'quarter', {unique: false});
  if (name === 'pilotCases' && !store.indexNames.contains('documentId')) store.createIndex('documentId', 'documentId', {unique: false});
  if (name === 'pilotCases' && !store.indexNames.contains('institutionKey')) store.createIndex('institutionKey', 'institutionKey', {unique: false});
  if (name === 'pilotRuns' && !store.indexNames.contains('status')) store.createIndex('status', 'status', {unique: false});
}
function objectStore(db, tx, name) {
  return db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, {keyPath: 'id'});
}
function migrateToVersion1(db, tx) { for (const name of ['projects','banks','accounts','positions','events','documents','issues','settings']) objectStore(db, tx, name); }
function migrateToVersion2(db, tx) { for (const name of ['accounts','positions','events','documents','issues']) ensureIndexes(objectStore(db, tx, name), name); }
function migrateToVersion3(db, tx) { for (const name of ['snapshots','auditLog']) ensureIndexes(objectStore(db, tx, name), name); }
function migrateToVersion4(db, tx) { for (const name of ['evidences','processingRuns','reportedTotals','reportSnapshots']) ensureIndexes(objectStore(db, tx, name), name); }
function migrateToVersion5(db, tx) { for (const name of ['documentExtractions','reviewDecisions','documentLinks','customTemplates','templateTests']) ensureIndexes(objectStore(db, tx, name), name); }
function migrateToVersion6(db, tx) { for (const name of ['bankTransactions','reconciliations','quarterClosures']) ensureIndexes(objectStore(db, tx, name), name); }
function migrateToVersion7(db, tx) { for (const name of ['benchmarkRuns']) ensureIndexes(objectStore(db, tx, name), name); }
function migrateToVersion8(db, tx) { for (const name of ['pilotCases','pilotRuns']) ensureIndexes(objectStore(db, tx, name), name); }
function migrateToVersion9(db, tx) { for (const name of ['operationalEvents','performanceSamples','incidentReports','releaseChecks']) ensureIndexes(objectStore(db, tx, name), name); }
function upgradeDatabase(request, event) {
  const db=request.result; const tx=request.transaction; const oldVersion=event.oldVersion||0; const targetVersion=event.newVersion||DB_VERSION;
  if(oldVersion<1&&targetVersion>=1)migrateToVersion1(db,tx);
  if(oldVersion<2&&targetVersion>=2)migrateToVersion2(db,tx);
  if(oldVersion<3&&targetVersion>=3)migrateToVersion3(db,tx);
  if(oldVersion<4&&targetVersion>=4)migrateToVersion4(db,tx);
  if(oldVersion<5&&targetVersion>=5)migrateToVersion5(db,tx);
  if(oldVersion<6&&targetVersion>=6)migrateToVersion6(db,tx);
  if(oldVersion<7&&targetVersion>=7)migrateToVersion7(db,tx);
  if(oldVersion<8&&targetVersion>=8)migrateToVersion8(db,tx);
  if(oldVersion<9&&targetVersion>=9)migrateToVersion9(db,tx);
  for(const name of Array.from(db.objectStoreNames))ensureIndexes(tx.objectStore(name),name);
}


export async function runIsolatedV8ToV9MigrationCheck({name}={}) {
  if (!globalThis.indexedDB) return {status:'FAILED', code:'INDEXEDDB_UNAVAILABLE', preserved:false, databaseVersion:DB_VERSION};
  const dbName = name || `${DB_NAME}-stage18-uat-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  const sentinelId = 'stage18-migration-sentinel';
  let db8 = null; let db9 = null;
  const deleteDatabase = () => new Promise(resolve => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  try {
    const request8 = indexedDB.open(dbName, 8);
    request8.onupgradeneeded = event => upgradeDatabase(request8, event);
    db8 = await requestToPromise(request8);
    const v8HasStage9Stores = ['operationalEvents','performanceSamples','incidentReports','releaseChecks'].some(store => db8.objectStoreNames.contains(store));
    if (v8HasStage9Stores) throw new Error('V8_TEMP_CONTAINS_STAGE9_STORES');
    const seedTx = db8.transaction(['projects','pilotRuns'], 'readwrite');
    seedTx.objectStore('projects').put({id:sentinelId,name:'UAT synthetic project',schemaVersion:6,createdAt:'2026-08-11T00:00:00.000Z'});
    seedTx.objectStore('pilotRuns').put({id:'stage18-pilot-sentinel',projectId:sentinelId,status:'SYNTHETIC',createdAt:'2026-08-11T00:00:00.000Z'});
    await transactionToPromise(seedTx);
    db8.close(); db8 = null;

    const request9 = indexedDB.open(dbName, 9);
    request9.onupgradeneeded = event => upgradeDatabase(request9, event);
    db9 = await requestToPromise(request9);
    const requiredStores = ['operationalEvents','performanceSamples','incidentReports','releaseChecks'];
    const storesCreated = requiredStores.every(store => db9.objectStoreNames.contains(store));
    const readTx = db9.transaction(['projects','pilotRuns'], 'readonly');
    const [projectRecord,pilotRecord] = await Promise.all([
      requestToPromise(readTx.objectStore('projects').get(sentinelId)),
      requestToPromise(readTx.objectStore('pilotRuns').get('stage18-pilot-sentinel')),
    ]);
    const indexTx = db9.transaction(requiredStores, 'readonly');
    const indexesOk = indexTx.objectStore('operationalEvents').indexNames.contains('occurredAt')
      && indexTx.objectStore('performanceSamples').indexNames.contains('operation')
      && indexTx.objectStore('incidentReports').indexNames.contains('status')
      && indexTx.objectStore('releaseChecks').indexNames.contains('status');
    const preserved = Boolean(projectRecord && pilotRecord);
    const status = storesCreated && indexesOk && preserved ? 'PASSED' : 'FAILED';
    return {status, code:status==='PASSED'?'V8_TO_V9_OK':'V8_TO_V9_VALIDATION_FAILED', preserved, storesCreated, indexesOk, oldVersion:8, databaseVersion:9};
  } catch (error) {
    return {status:'FAILED', code:error?.message || 'V8_TO_V9_FAILED', preserved:false, oldVersion:8, databaseVersion:9};
  } finally {
    try { db8?.close(); } catch {}
    try { db9?.close(); } catch {}
    await deleteDatabase();
  }
}

export class IndexedDbRepository {
  constructor(name = DB_NAME) { this.name = name; this.db = null; }
  async open() {
    if (!globalThis.indexedDB) throw new Error('IndexedDB is not available');
    const request = indexedDB.open(this.name, DB_VERSION);
    request.onupgradeneeded = event => upgradeDatabase(request, event);
    this.db = await requestToPromise(request);
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  transaction(store, mode = 'readonly') {
    if (!this.db) throw new Error('Repository is not open');
    return this.db.transaction(store, mode).objectStore(store);
  }
  async put(store, value) { await requestToPromise(this.transaction(store, 'readwrite').put(value)); return value; }
  async bulkPut(store, values) {
    if (!values?.length) return values || [];
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const value of values) os.put(value);
    await transactionToPromise(tx);
    return values;
  }
  async get(store, id) { return requestToPromise(this.transaction(store).get(id)); }
  async all(store) { return requestToPromise(this.transaction(store).getAll()); }
  async count(store) { return requestToPromise(this.transaction(store).count()); }
  async allByProject(store, projectId) {
    const os = this.transaction(store);
    if (os.indexNames.contains('projectId')) return requestToPromise(os.index('projectId').getAll(projectId));
    return (await requestToPromise(os.getAll())).filter(record => record.projectId === projectId);
  }
  async allByIndex(store, index, value) {
    const os = this.transaction(store);
    if (!os.indexNames.contains(index)) return [];
    return requestToPromise(os.index(index).getAll(value));
  }
  async delete(store, id) { await requestToPromise(this.transaction(store, 'readwrite').delete(id)); }
  async clear(store) { await requestToPromise(this.transaction(store, 'readwrite').clear()); }
  async deleteByProject(store, projectId) {
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const source = os.indexNames.contains('projectId') ? os.index('projectId') : os;
    const request = source.openCursor(os.indexNames.contains('projectId') ? IDBKeyRange.only(projectId) : undefined);
    request.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) return;
      if (os.indexNames.contains('projectId') || cursor.value?.projectId === projectId) cursor.delete();
      cursor.continue();
    };
    await transactionToPromise(tx);
  }
  async deleteProject(projectId, options = {}) {
    for (const store of PROJECT_SCOPED_STORES) { if (options.preserveSnapshots && store === 'snapshots') continue; await this.deleteByProject(store, projectId); }
    await this.delete('projects', projectId);
    const active = await this.get('settings', 'active-project');
    if (active?.value === projectId) await this.delete('settings', 'active-project');
  }
  async clearAll(options = {}) {
    for (const store of STORES) {
      if (options.preserveTemplates && store === 'customTemplates') continue;
      await this.clear(store);
    }
  }
  close() { this.db?.close(); this.db = null; }
}

export class MemoryRepository {
  constructor() { this.data = Object.fromEntries(STORES.map(store => [store, new Map()])); }
  async open() { return this; }
  async put(store, value) { if (!this.data[store]) this.data[store] = new Map(); this.data[store].set(value.id, structuredClone(value)); return value; }
  async bulkPut(store, values) { for (const value of values || []) await this.put(store, value); return values || []; }
  async get(store, id) { const value = this.data[store]?.get(id); return value == null ? undefined : structuredClone(value); }
  async all(store) { return [...(this.data[store]?.values() || [])].map(value => structuredClone(value)); }
  async count(store) { return this.data[store]?.size || 0; }
  async allByProject(store, projectId) { return (await this.all(store)).filter(record => record.projectId === projectId); }
  async allByIndex(store, index, value) { return (await this.all(store)).filter(record => record[index] === value); }
  async delete(store, id) { this.data[store]?.delete(id); }
  async clear(store) { this.data[store]?.clear(); }
  async deleteByProject(store, projectId) { for (const [id, value] of (this.data[store] || new Map())) if (value.projectId === projectId) this.data[store].delete(id); }
  async deleteProject(projectId, options = {}) {
    for (const store of PROJECT_SCOPED_STORES) { if (options.preserveSnapshots && store === 'snapshots') continue; await this.deleteByProject(store, projectId); }
    await this.delete('projects', projectId);
    const active = await this.get('settings', 'active-project');
    if (active?.value === projectId) await this.delete('settings', 'active-project');
  }
  async clearAll(options = {}) { for (const store of STORES) { if (options.preserveTemplates && store === 'customTemplates') continue; await this.clear(store); } }
  close() {}
}

export async function createRepository(options = {}) {
  const repo = globalThis.indexedDB ? new IndexedDbRepository(options.name) : new MemoryRepository();
  return repo.open();
}

export async function sha256(fileOrBuffer) {
  const bytes = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : fileOrBuffer instanceof Uint8Array ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export const PROJECT_STORES = PROJECT_SCOPED_STORES;
