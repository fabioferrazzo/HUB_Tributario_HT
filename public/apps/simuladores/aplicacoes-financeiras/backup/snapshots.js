import { exportProjectHtaf, parseHtafBytes } from './htaf.js';
import { STAGE11_APP_VERSION } from './migrations.js';
import { restoreProjectBundle, RESTORE_STRATEGIES } from './restore.js';

export const BACKUP_CADENCES = Object.freeze({OFF: 'OFF', AFTER_CHANGE: 'AFTER_CHANGE', DAILY: 'DAILY', WEEKLY: 'WEEKLY'});
export const DEFAULT_BACKUP_CONFIG = Object.freeze({
  cadence: BACKUP_CADENCES.OFF,
  includeDocuments: true,
  maxSnapshots: 3,
  quotaWarningPercent: 80,
});

const configId = projectId => `backup-config:${projectId}`;

export async function getBackupConfig(repo, projectId) {
  const record = await repo.get('settings', configId(projectId));
  return {...DEFAULT_BACKUP_CONFIG, ...(record?.value || {})};
}

export async function saveBackupConfig(repo, projectId, config) {
  const normalized = {
    cadence: Object.values(BACKUP_CADENCES).includes(config.cadence) ? config.cadence : BACKUP_CADENCES.OFF,
    includeDocuments: config.includeDocuments !== false,
    maxSnapshots: Math.min(20, Math.max(1, Number(config.maxSnapshots) || DEFAULT_BACKUP_CONFIG.maxSnapshots)),
    quotaWarningPercent: Math.min(95, Math.max(50, Number(config.quotaWarningPercent) || DEFAULT_BACKUP_CONFIG.quotaWarningPercent)),
  };
  await repo.put('settings', {id: configId(projectId), value: normalized, updatedAt: new Date().toISOString()});
  return normalized;
}

export async function listSnapshots(repo, projectId) {
  const values = typeof repo.allByProject === 'function' ? await repo.allByProject('snapshots', projectId) : (await repo.all('snapshots')).filter(item => item.projectId === projectId);
  return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createLocalSnapshot(repo, projectId, options = {}) {
  const exported = await exportProjectHtaf(repo, projectId, {includeDocuments: options.includeDocuments !== false, createdAt: options.createdAt});
  const snapshot = {
    id: options.id || `snapshot-${projectId}-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    projectId,
    createdAt: options.createdAt || new Date().toISOString(),
    reason: String(options.reason || 'MANUAL').slice(0, 80),
    archiveHash: exported.archiveHash,
    size: exported.bytes.byteLength,
    encrypted: false,
    includeDocuments: options.includeDocuments !== false,
    blob: exported.blob,
    fileName: exported.fileName,
    appVersion: STAGE11_APP_VERSION,
  };
  await repo.put('snapshots', snapshot);
  const config = options.config || await getBackupConfig(repo, projectId);
  await pruneSnapshots(repo, projectId, config.maxSnapshots);
  return snapshot;
}

export async function pruneSnapshots(repo, projectId, maxSnapshots = 3) {
  const values = await listSnapshots(repo, projectId);
  const remove = values.slice(Math.max(1, maxSnapshots));
  for (const snapshot of remove) await repo.delete('snapshots', snapshot.id);
  return remove.length;
}

function elapsedMs(date) { return Date.now() - new Date(date).valueOf(); }

export async function maybeCreateAutomaticSnapshot(repo, projectId, reason = 'CHANGE') {
  const config = await getBackupConfig(repo, projectId);
  if (config.cadence === BACKUP_CADENCES.OFF) return null;
  const latest = (await listSnapshots(repo, projectId))[0];
  if (config.cadence === BACKUP_CADENCES.DAILY && latest && elapsedMs(latest.createdAt) < 24 * 60 * 60 * 1000) return null;
  if (config.cadence === BACKUP_CADENCES.WEEKLY && latest && elapsedMs(latest.createdAt) < 7 * 24 * 60 * 60 * 1000) return null;
  if (config.cadence === BACKUP_CADENCES.AFTER_CHANGE && latest && elapsedMs(latest.createdAt) < 60 * 1000) return null;
  return createLocalSnapshot(repo, projectId, {reason: `AUTO_${reason}`, includeDocuments: config.includeDocuments, config});
}

export async function deleteSnapshot(repo, snapshotId) {
  await repo.delete('snapshots', snapshotId);
}

export async function restoreSnapshot(repo, snapshotId, options = {}) {
  const snapshot = await repo.get('snapshots', snapshotId);
  if (!snapshot?.blob) throw new Error('Local snapshot not found');
  const parsed = await parseHtafBytes(new Uint8Array(await snapshot.blob.arrayBuffer()));
  const strategy = options.strategy || RESTORE_STRATEGIES.REPLACE;
  // SNAPDUP01: 'Criar cópia' não pode reutilizar o id do projeto de origem (a cópia sobrescrevia o original e duplicava eventos).
  const targetProjectId = strategy === RESTORE_STRATEGIES.DUPLICATE ? options.targetProjectId : (options.targetProjectId || snapshot.projectId);
  return restoreProjectBundle(repo, parsed, {strategy, targetProjectId});
}

export async function storageEstimate() {
  if (!globalThis.navigator?.storage?.estimate) return {usage: null, quota: null, percent: null, persisted: null};
  const estimate = await globalThis.navigator.storage.estimate();
  const persisted = globalThis.navigator.storage.persisted ? await globalThis.navigator.storage.persisted() : null;
  return {
    usage: estimate.usage ?? null,
    quota: estimate.quota ?? null,
    percent: estimate.quota ? (estimate.usage / estimate.quota) * 100 : null,
    persisted,
  };
}

export async function requestPersistentStorage() {
  if (!globalThis.navigator?.storage?.persist) return false;
  return globalThis.navigator.storage.persist();
}
