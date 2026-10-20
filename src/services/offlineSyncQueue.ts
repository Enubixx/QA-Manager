import {
  syncTestRunToSupabase,
  syncArchivedRunToSupabase,
  syncBugLogToSupabase,
  patchBugWorkerColumns,
  type BugWorkerField,
  deleteTestRunFromSupabase,
  deleteArchivedRunFromSupabase,
  syncDevicesListToCloud,
  patchDevicesToCloud,
  patchTestersToCloud,
  type DevicePatch,
  type TesterPatch,
  isTestRunDeleted,
  markTestRunDeleted,
  isArchivedRunDeleted,
  markArchivedRunDeleted,
  isBugDeleted,
  getDeletedBugIds,
  isDeviceDeleted,
  isTesterDeleted,
  setCloudSyncStatus
} from './supabaseService';
import { isSupabaseConfigured } from '../lib/supabase';
import { TestRun, BugLog, DeviceProfile } from '../types';

export type OfflineMutationType = 
  | 'syncTestRun'
  | 'syncArchivedRun'
  | 'syncBugLog'
  | 'patchBugColumns'
  | 'deleteTestRun'
  | 'deleteArchivedRun'
  | 'syncDevices'
  | 'patchDevices'
  | 'patchTesters';

export interface OfflineMutation {
  id: string;
  type: OfflineMutationType;
  payload: any;
  timestamp: number;
  retryCount?: number;
}

const STORAGE_KEY = 'qa_offline_mutation_queue';
const MAX_RETRY_COUNT = 5;

export const getOfflineQueue = (): OfflineMutation[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(m => m && typeof m === 'object' && typeof m.type === 'string') : [];
  } catch (e) {
    return [];
  }
};

function getMutationEntityKey(mut: OfflineMutation): string | null {
  if (!mut || !mut.type) return null;
  switch (mut.type) {
    case 'syncTestRun':
      return mut.payload?.id ? `testRun:${mut.payload.id}` : null;
    case 'deleteTestRun':
      return mut.payload ? `testRun:${String(mut.payload)}` : null;
    case 'syncArchivedRun':
      return mut.payload?.id ? `archivedRun:${mut.payload.id}` : null;
    case 'deleteArchivedRun':
      return mut.payload ? `archivedRun:${String(mut.payload)}` : null;
    case 'syncBugLog':
      return mut.payload?.id ? `bugLog:${mut.payload.id}` : null;
    case 'patchBugColumns':
      // One entry per bug + field set, so the latest value of those columns wins
      return mut.payload?.bug?.id ? `bugCols:${mut.payload.bug.id}:${[...(mut.payload.fields || [])].sort().join(',')}` : null;
    case 'syncDevices':
      return 'devices:all';
    case 'patchDevices':
      return mut.payload?.id ? `devicePatch:${mut.payload.id}:${mut.payload.lockOnly ? 'lock' : 'edit'}` : null;
    case 'patchTesters':
      return mut.payload?.id ? `testerPatch:${mut.payload.id}` : null;
    default:
      return null;
  }
}

function deduplicateMutations(queue: OfflineMutation[]): OfflineMutation[] {
  const latestIndexByKey = new Map<string, number>();
  const mergedPayloadByKey = new Map<string, any>();
  queue.forEach((mut, idx) => {
    const key = getMutationEntityKey(mut);
    if (key) {
      if ((mut.type === 'patchDevices' || mut.type === 'patchTesters') && mergedPayloadByKey.has(key)) {
        const prev = mergedPayloadByKey.get(key);
        const prevFields = prev?.fieldUpdatedAt || prev?.changes?.fieldUpdatedAt || {};
        const nextFields = mut.payload?.fieldUpdatedAt || mut.payload?.changes?.fieldUpdatedAt || {};
        const mergedFieldUpdatedAt = { ...prevFields };
        for (const [k, v] of Object.entries(nextFields)) {
          if (v && (!mergedFieldUpdatedAt[k] || Date.parse(String(v)) >= Date.parse(String(mergedFieldUpdatedAt[k])))) {
            mergedFieldUpdatedAt[k] = v;
          } else if (!(k in mergedFieldUpdatedAt)) {
            mergedFieldUpdatedAt[k] = v;
          }
        }
        const hasFieldMap = Object.keys(mergedFieldUpdatedAt).length > 0;
        mergedPayloadByKey.set(key, {
          ...prev,
          ...mut.payload,
          changes: {
            ...(prev?.changes || {}),
            ...(mut.payload?.changes || {}),
            ...(hasFieldMap ? { fieldUpdatedAt: mergedFieldUpdatedAt } : {}),
          },
          updatedAt: mut.payload?.updatedAt || prev?.updatedAt,
          ...(hasFieldMap ? { fieldUpdatedAt: mergedFieldUpdatedAt } : {}),
        });
      } else {
        mergedPayloadByKey.set(key, mut.payload);
      }
      latestIndexByKey.set(key, idx);
    }
  });
  return queue
    .filter((mut, idx) => {
      const key = getMutationEntityKey(mut);
      if (!key) return true;
      return latestIndexByKey.get(key) === idx;
    })
    .map(mut => {
      const key = getMutationEntityKey(mut);
      if (key && (mut.type === 'patchDevices' || mut.type === 'patchTesters') && mergedPayloadByKey.has(key)) {
        return { ...mut, payload: mergedPayloadByKey.get(key) };
      }
      return mut;
    });
}

function stripBase64ImagesFromMutation(mut: OfflineMutation): OfflineMutation {
  if (!mut || !mut.payload || typeof mut.payload !== 'object') return mut;
  if (mut.type === 'syncBugLog' && typeof mut.payload.imageUrl === 'string' && mut.payload.imageUrl.startsWith('data:image')) {
    return { ...mut, payload: { ...mut.payload, imageUrl: undefined } };
  }
  if (mut.type === 'patchBugColumns' && typeof mut.payload.bug?.imageUrl === 'string' && mut.payload.bug.imageUrl.startsWith('data:image')) {
    return { ...mut, payload: { ...mut.payload, bug: { ...mut.payload.bug, imageUrl: undefined } } };
  }
  if ((mut.type === 'syncTestRun' || mut.type === 'syncArchivedRun') && Array.isArray(mut.payload.bugLogs)) {
    return {
      ...mut,
      payload: {
        ...mut.payload,
        bugLogs: mut.payload.bugLogs.map((b: any) =>
          b && typeof b.imageUrl === 'string' && b.imageUrl.startsWith('data:image')
            ? { ...b, imageUrl: undefined }
            : b
        ),
      },
    };
  }
  return mut;
}

const saveOfflineQueue = (queue: OfflineMutation[]) => {
  const deduped = deduplicateMutations(queue);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));
    notifyQueueChange(deduped.length);
  } catch (e) {
    try {
      // Strip heavy base64 screenshots on QuotaExceededError so metadata is never lost
      const slimmed = deduped.map(stripBase64ImagesFromMutation);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slimmed));
      notifyQueueChange(slimmed.length);
    } catch (innerErr) {
      console.error('Failed to save offline queue even after stripping images', innerErr);
    }
  }
};

let queueListeners: Array<(count: number) => void> = [];

export const onQueueCountChange = (listener: (count: number) => void) => {
  queueListeners.push(listener);
  listener(getOfflineQueue().length);
  return () => {
    queueListeners = queueListeners.filter(l => l !== listener);
  };
};

const notifyQueueChange = (count: number) => {
  queueListeners.forEach(l => {
    try { l(count); } catch (e) {}
  });
};

export const enqueueOfflineMutation = (type: OfflineMutationType, payload: any) => {
  if (type === 'syncTestRun' && (!payload?.id || isTestRunDeleted(payload.id) || isArchivedRunDeleted(payload.id) || payload.status === 'completed')) {
    return;
  }
  if (type === 'syncArchivedRun' && (!payload?.id || isArchivedRunDeleted(payload.id))) {
    return;
  }
  if (type === 'syncBugLog' && (!payload?.id || isBugDeleted(payload.id))) {
    return;
  }
  if (type === 'patchBugColumns' && (!payload?.bug?.id || isBugDeleted(payload.bug.id))) {
    return;
  }
  if (type === 'patchDevices' && (!payload?.id || isDeviceDeleted(payload.id))) {
    return;
  }
  if (type === 'patchTesters' && (!payload?.id || isTesterDeleted(payload.id))) {
    return;
  }
  const queue = getOfflineQueue();
  const mutation: OfflineMutation = {
    id: 'mut-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
    type,
    payload,
    timestamp: Date.now(),
    retryCount: 0,
  };
  queue.push(mutation);
  saveOfflineQueue(queue);
};

/**
 * Errors that will fail the same way on every retry: HTTP 4xx (except 408/429), and Postgres
 * data/constraint/schema errors (22xxx e.g. 22P05 NUL in text, 23xxx, 42xxx). A missing optional
 * column (42703 / PGRST204) stays retryable: the sync functions drop that column and the retry succeeds.
 */
export function isPermanentSyncError(err: any): boolean {
  const code = String(err?.code || '').toUpperCase();
  // Checked before the 4xx rule: PostgREST reports a missing column as HTTP 400, but the sync functions
  // drop that column (optionalBugColumns) so the retry succeeds. MAX_RETRY_COUNT still bounds it.
  if (code === '42703' || code === 'PGRST204') return false;
  const status = Number(err?.status || err?.statusCode || 0);
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return true;
  return /^(22|23|42)[0-9A-Z]{3}$/.test(code);
}

/** Dropped mutations are kept here (last 20, images stripped) for diagnosis instead of vanishing silently. */
const FAILED_SYNCS_KEY = 'qa_failed_syncs';
const MAX_FAILED_SYNCS = 20;
const MAX_FAILED_PAYLOAD_CHARS = 50_000;

export const getFailedSyncs = (): any[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(FAILED_SYNCS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

function recordFailedSync(mut: OfflineMutation, err: any, reason: 'permanent' | 'max-retries') {
  try {
    const stripped = stripBase64ImagesFromMutation(mut);
    let payload: any = stripped.payload;
    const json = JSON.stringify(payload ?? null);
    if (json.length > MAX_FAILED_PAYLOAD_CHARS) payload = { truncated: true, chars: json.length, id: payload?.id ?? payload?.bug?.id };
    const entry = {
      at: new Date().toISOString(),
      reason,
      type: mut.type,
      entity: getMutationEntityKey(mut),
      code: err?.code ?? null,
      status: err?.status ?? err?.statusCode ?? null,
      message: String(err?.message || err || '').slice(0, 500),
      retryCount: mut.retryCount || 0,
      payload,
    };
    const next = [...getFailedSyncs(), entry].slice(-MAX_FAILED_SYNCS);
    localStorage.setItem(FAILED_SYNCS_KEY, JSON.stringify(next));
  } catch { /* storage full - the console.error below still records it */ }
}

/**
 * A newer save of the same entity just succeeded: drop older queued copies so a later drain can't
 * overwrite the fresh cloud data with a stale snapshot.
 */
function supersedeQueued(type: OfflineMutationType, payload: any, since: number) {
  try {
    const key = getMutationEntityKey({ id: '', type, payload, timestamp: since });
    if (!key) return;
    const queue = getOfflineQueue();
    const next = queue.filter(m => !(getMutationEntityKey(m) === key && m.timestamp <= since));
    if (next.length !== queue.length) saveOfflineQueue(next);
  } catch { /* ignore */ }
}

let isDraining = false;
let activeSyncCount = 0;
let syncActivityListeners: Array<(active: boolean) => void> = [];

export const getIsSyncing = (): boolean => isDraining || activeSyncCount > 0;

export const onSyncActivityChange = (listener: (active: boolean) => void) => {
  syncActivityListeners.push(listener);
  listener(getIsSyncing());
  return () => {
    syncActivityListeners = syncActivityListeners.filter(l => l !== listener);
  };
};

const notifySyncActivity = () => {
  const active = getIsSyncing();
  syncActivityListeners.forEach(l => {
    try { l(active); } catch (e) {}
  });
};

const withSyncActivity = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (!isSupabaseConfigured) return fn();
  activeSyncCount++;
  notifySyncActivity();
  try {
    const res = await fn();
    setCloudSyncStatus(true);
    return res;
  } catch (err) {
    setCloudSyncStatus(false);
    throw err;
  } finally {
    activeSyncCount = Math.max(0, activeSyncCount - 1);
    notifySyncActivity();
  }
};

export const drainOfflineQueue = async () => {
  if (isDraining) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const initialQueue = deduplicateMutations(getOfflineQueue());
  if (initialQueue.length === 0) return;

  isDraining = true;
  notifySyncActivity();
  const snapshotIds = new Set(initialQueue.map(m => m.id));
  const failedToRetain: OfflineMutation[] = [];

  try {
    let anySucceeded = false;
    for (const mut of initialQueue) {
      try {
        switch (mut.type) {
          case 'syncTestRun': {
            if (!mut.payload?.id || isTestRunDeleted(mut.payload.id) || isArchivedRunDeleted(mut.payload.id) || mut.payload.status === 'completed') {
              break;
            }
            const deletedBugs = getDeletedBugIds();
            const cleanedRun: TestRun = {
              ...(mut.payload as TestRun),
              bugLogs: Array.isArray(mut.payload.bugLogs)
                ? mut.payload.bugLogs.filter((b: BugLog) => b && b.id && !deletedBugs.has(b.id))
                : [],
            };
            await syncTestRunToSupabase(cleanedRun);
            anySucceeded = true;
            break;
          }
          case 'syncArchivedRun': {
            if (!mut.payload?.id || isArchivedRunDeleted(mut.payload.id)) {
              break;
            }
            markTestRunDeleted(mut.payload.id);
            const deletedBugs = getDeletedBugIds();
            const cleanedRun: TestRun = {
              ...(mut.payload as TestRun),
              bugLogs: Array.isArray(mut.payload.bugLogs)
                ? mut.payload.bugLogs.filter((b: BugLog) => b && b.id && !deletedBugs.has(b.id))
                : [],
            };
            await syncArchivedRunToSupabase(cleanedRun);
            anySucceeded = true;
            break;
          }
          case 'syncBugLog':
            if (!mut.payload?.id || isBugDeleted(mut.payload.id)) {
              break;
            }
            await syncBugLogToSupabase(mut.payload as BugLog);
            anySucceeded = true;
            break;
          case 'patchBugColumns':
            if (!mut.payload?.bug?.id || isBugDeleted(mut.payload.bug.id)) {
              break;
            }
            await patchBugWorkerColumns(mut.payload.bug as BugLog, mut.payload.fields as BugWorkerField[]);
            anySucceeded = true;
            break;
          case 'deleteTestRun':
            await deleteTestRunFromSupabase(mut.payload as string);
            anySucceeded = true;
            break;
          case 'deleteArchivedRun':
            await deleteArchivedRunFromSupabase(mut.payload as string);
            anySucceeded = true;
            break;
          case 'syncDevices':
            await syncDevicesListToCloud(mut.payload as DeviceProfile[]);
            anySucceeded = true;
            break;
          case 'patchDevices':
            if (!mut.payload?.id || isDeviceDeleted(mut.payload.id)) {
              break;
            }
            await patchDevicesToCloud(mut.payload as DevicePatch);
            anySucceeded = true;
            break;
          case 'patchTesters':
            if (!mut.payload?.id || isTesterDeleted(mut.payload.id)) {
              break;
            }
            await patchTestersToCloud(mut.payload as TesterPatch);
            anySucceeded = true;
            break;
        }
      } catch (err: any) {
        const nextRetry = (mut.retryCount || 0) + 1;
        const permanent = isPermanentSyncError(err);
        if (!permanent && nextRetry < MAX_RETRY_COUNT) {
          console.warn(`Failed to sync offline mutation (attempt ${nextRetry}/${MAX_RETRY_COUNT}), retaining in queue:`, mut.type, err);
          failedToRetain.push({ ...mut, retryCount: nextRetry });
        } else {
          console.error(`Dropping offline mutation (${permanent ? 'permanent error' : 'max retries'}); kept in localStorage '${FAILED_SYNCS_KEY}':`, mut.type, err);
          recordFailedSync({ ...mut, retryCount: nextRetry }, err, permanent ? 'permanent' : 'max-retries');
        }
      }
    }
    if (anySucceeded && failedToRetain.length === 0) {
      setCloudSyncStatus(true);
    } else if (failedToRetain.length > 0) {
      setCloudSyncStatus(false);
    }
  } finally {
    // Re-read current queue so any mutations enqueued while draining are preserved
    const latestQueue = getOfflineQueue();
    const enqueuedDuringDrain = latestQueue.filter(m => !snapshotIds.has(m.id));
    saveOfflineQueue([...failedToRetain, ...enqueuedDuringDrain]);
    isDraining = false;
    notifySyncActivity();
  }
};

// Safe wrappers that automatically queue mutations if offline or network fails
export const safeSyncTestRun = async (run: TestRun) => {
  if (!run?.id || isTestRunDeleted(run.id) || isArchivedRunDeleted(run.id) || run.status === 'completed') {
    return;
  }
  const deletedBugs = getDeletedBugIds();
  const cleanRun: TestRun = {
    ...run,
    bugLogs: Array.isArray(run.bugLogs) ? run.bugLogs.filter(b => b && b.id && !deletedBugs.has(b.id)) : [],
  };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('syncTestRun', cleanRun);
    return;
  }
  const startedAt = Date.now();
  try {
    await withSyncActivity(() => syncTestRunToSupabase(cleanRun));
    supersedeQueued('syncTestRun', cleanRun, startedAt);
  } catch (e) {
    if (!isTestRunDeleted(cleanRun.id) && !isArchivedRunDeleted(cleanRun.id) && (cleanRun.status as string) !== 'completed') {
      enqueueOfflineMutation('syncTestRun', cleanRun);
    }
  }
};

export const safeSyncArchivedRun = async (run: TestRun) => {
  if (!run?.id || isArchivedRunDeleted(run.id)) {
    return;
  }
  markTestRunDeleted(run.id);
  supersedeQueued('syncTestRun', { id: run.id }, Date.now());
  const deletedBugs = getDeletedBugIds();
  const cleanRun: TestRun = {
    ...run,
    bugLogs: Array.isArray(run.bugLogs) ? run.bugLogs.filter(b => b && b.id && !deletedBugs.has(b.id)) : [],
  };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('syncArchivedRun', cleanRun);
    return;
  }
  const startedAt = Date.now();
  try {
    await withSyncActivity(() => syncArchivedRunToSupabase(cleanRun));
    supersedeQueued('syncArchivedRun', cleanRun, startedAt);
  } catch (e) {
    if (!isArchivedRunDeleted(cleanRun.id)) {
      enqueueOfflineMutation('syncArchivedRun', cleanRun);
    }
  }
};

export const safeSyncBugLog = async (bug: BugLog) => {
  if (!bug?.id || isBugDeleted(bug.id)) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('syncBugLog', bug);
    return;
  }
  const startedAt = Date.now();
  try {
    await withSyncActivity(() => syncBugLogToSupabase(bug));
    supersedeQueued('syncBugLog', bug, startedAt);
  } catch (e) {
    if (!isBugDeleted(bug.id)) {
      enqueueOfflineMutation('syncBugLog', bug);
    }
  }
};

/** Targeted write of worker-owned bug columns (filed, file_pending, bundle, ...), queued when offline. */
export const safePatchBugColumns = async (bug: BugLog, fields: BugWorkerField[]) => {
  if (!bug?.id || isBugDeleted(bug.id) || !fields.length) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('patchBugColumns', { bug, fields });
    return;
  }
  const startedAt = Date.now();
  try {
    await withSyncActivity(() => patchBugWorkerColumns(bug, fields));
    supersedeQueued('patchBugColumns', { bug, fields }, startedAt);
  } catch (e) {
    if (!isBugDeleted(bug.id)) {
      enqueueOfflineMutation('patchBugColumns', { bug, fields });
    }
  }
};

export const safeDeleteTestRun = async (runId: string) => {
  if (!runId) return;
  markTestRunDeleted(runId);
  const startedAt = Date.now();
  supersedeQueued('syncTestRun', { id: runId }, startedAt);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('deleteTestRun', runId);
    return;
  }
  try {
    await withSyncActivity(() => deleteTestRunFromSupabase(runId));
    supersedeQueued('deleteTestRun', runId, Date.now());
  } catch (e) {
    enqueueOfflineMutation('deleteTestRun', runId);
  }
};

export const safeDeleteArchivedRun = async (runId: string) => {
  if (!runId) return;
  markTestRunDeleted(runId);
  markArchivedRunDeleted(runId);
  const startedAt = Date.now();
  supersedeQueued('syncTestRun', { id: runId }, startedAt);
  supersedeQueued('syncArchivedRun', { id: runId }, startedAt);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('deleteArchivedRun', runId);
    return;
  }
  try {
    await withSyncActivity(() => deleteArchivedRunFromSupabase(runId));
    supersedeQueued('deleteArchivedRun', runId, Date.now());
  } catch (e) {
    enqueueOfflineMutation('deleteArchivedRun', runId);
  }
};

export const safePatchDevices = async (patchesInput: DevicePatch | DevicePatch[]) => {
  const patches = (Array.isArray(patchesInput) ? patchesInput : [patchesInput]).filter(
    p => p && p.id && !isDeviceDeleted(p.id)
  );
  if (patches.length === 0) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    patches.forEach(p => enqueueOfflineMutation('patchDevices', p));
    return;
  }
  const startedAt = Date.now();
  try {
    await withSyncActivity(() => patchDevicesToCloud(patches));
    patches.forEach(p => supersedeQueued('patchDevices', p, startedAt));
  } catch (e) {
    patches.forEach(p => {
      if (!isDeviceDeleted(p.id)) enqueueOfflineMutation('patchDevices', p);
    });
  }
};

export const safePatchTesters = async (patchesInput: TesterPatch | TesterPatch[]) => {
  const patches = (Array.isArray(patchesInput) ? patchesInput : [patchesInput]).filter(
    p => p && p.id && !isTesterDeleted(p.id)
  );
  if (patches.length === 0) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    patches.forEach(p => enqueueOfflineMutation('patchTesters', p));
    return;
  }
  const startedAt = Date.now();
  try {
    await withSyncActivity(() => patchTestersToCloud(patches));
    patches.forEach(p => supersedeQueued('patchTesters', p, startedAt));
  } catch (e) {
    patches.forEach(p => {
      if (!isTesterDeleted(p.id)) enqueueOfflineMutation('patchTesters', p);
    });
  }
};

export const safeSyncDevices = async (devices: DeviceProfile[]) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('syncDevices', devices);
    return;
  }
  try {
    await withSyncActivity(() => syncDevicesListToCloud(devices));
  } catch (e) {
    enqueueOfflineMutation('syncDevices', devices);
  }
};

export type NavbarSyncState = 'synced' | 'syncing' | 'offline';

export function computeNavbarSyncState(params: {
  isOnline: boolean;
  isSupabaseConfigured: boolean;
  cloudSyncOk: boolean;
  pendingCount: number;
  isSyncing: boolean;
}): { state: NavbarSyncState; label: string } {
  const { isOnline, isSupabaseConfigured: configured, cloudSyncOk, pendingCount, isSyncing } = params;
  if (!isOnline || !configured || (!cloudSyncOk && !isSyncing)) {
    return { state: 'offline', label: 'Offline · saved on this device' };
  }
  if (isSyncing || pendingCount > 0) {
    return { state: 'syncing', label: 'Syncing…' };
  }
  return { state: 'synced', label: 'Synced' };
}

// Global network listener to automatically drain queue upon reconnect
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    drainOfflineQueue();
  });
}
