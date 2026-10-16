import {
  syncTestRunToSupabase,
  syncArchivedRunToSupabase,
  syncBugLogToSupabase,
  patchBugWorkerColumns,
  type BugWorkerField,
  deleteTestRunFromSupabase,
  deleteArchivedRunFromSupabase,
  syncDevicesListToCloud
} from './supabaseService';
import { TestRun, BugLog, DeviceProfile } from '../types';

export type OfflineMutationType = 
  | 'syncTestRun'
  | 'syncArchivedRun'
  | 'syncBugLog'
  | 'patchBugColumns'
  | 'deleteTestRun'
  | 'deleteArchivedRun'
  | 'syncDevices';

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
    default:
      return null;
  }
}

function deduplicateMutations(queue: OfflineMutation[]): OfflineMutation[] {
  const latestIndexByKey = new Map<string, number>();
  queue.forEach((mut, idx) => {
    const key = getMutationEntityKey(mut);
    if (key) latestIndexByKey.set(key, idx);
  });
  return queue.filter((mut, idx) => {
    const key = getMutationEntityKey(mut);
    if (!key) return true;
    return latestIndexByKey.get(key) === idx;
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

let isDraining = false;

export const drainOfflineQueue = async () => {
  if (isDraining) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const initialQueue = deduplicateMutations(getOfflineQueue());
  if (initialQueue.length === 0) return;

  isDraining = true;
  const snapshotIds = new Set(initialQueue.map(m => m.id));
  const failedToRetain: OfflineMutation[] = [];

  try {
    for (const mut of initialQueue) {
      try {
        switch (mut.type) {
          case 'syncTestRun':
            await syncTestRunToSupabase(mut.payload as TestRun);
            break;
          case 'syncArchivedRun':
            await syncArchivedRunToSupabase(mut.payload as TestRun);
            break;
          case 'syncBugLog':
            await syncBugLogToSupabase(mut.payload as BugLog);
            break;
          case 'patchBugColumns':
            await patchBugWorkerColumns(mut.payload.bug as BugLog, mut.payload.fields as BugWorkerField[]);
            break;
          case 'deleteTestRun':
            await deleteTestRunFromSupabase(mut.payload as string);
            break;
          case 'deleteArchivedRun':
            await deleteArchivedRunFromSupabase(mut.payload as string);
            break;
          case 'syncDevices':
            await syncDevicesListToCloud(mut.payload as DeviceProfile[]);
            break;
        }
      } catch (err: any) {
        const nextRetry = (mut.retryCount || 0) + 1;
        const status = Number(err?.status || err?.statusCode || 0);
        const isPermanentClientError = status >= 400 && status < 500 && status !== 408 && status !== 429;
        if (!isPermanentClientError && nextRetry < MAX_RETRY_COUNT) {
          console.warn(`Failed to sync offline mutation (attempt ${nextRetry}/${MAX_RETRY_COUNT}), retaining in queue:`, mut.type, err);
          failedToRetain.push({ ...mut, retryCount: nextRetry });
        } else {
          console.error('Dropping poison-pill offline mutation after max retries or permanent error:', mut.type, err);
        }
      }
    }
  } finally {
    // Re-read current queue so any mutations enqueued while draining are preserved
    const latestQueue = getOfflineQueue();
    const enqueuedDuringDrain = latestQueue.filter(m => !snapshotIds.has(m.id));
    saveOfflineQueue([...failedToRetain, ...enqueuedDuringDrain]);
    isDraining = false;
  }
};

// Safe wrappers that automatically queue mutations if offline or network fails
export const safeSyncTestRun = async (run: TestRun) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('syncTestRun', run);
    return;
  }
  try {
    await syncTestRunToSupabase(run);
  } catch (e) {
    enqueueOfflineMutation('syncTestRun', run);
  }
};

export const safeSyncArchivedRun = async (run: TestRun) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('syncArchivedRun', run);
    return;
  }
  try {
    await syncArchivedRunToSupabase(run);
  } catch (e) {
    enqueueOfflineMutation('syncArchivedRun', run);
  }
};

export const safeSyncBugLog = async (bug: BugLog) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('syncBugLog', bug);
    return;
  }
  try {
    await syncBugLogToSupabase(bug);
  } catch (e) {
    enqueueOfflineMutation('syncBugLog', bug);
  }
};

/** Targeted write of worker-owned bug columns (filed, file_pending, bundle, ...), queued when offline. */
export const safePatchBugColumns = async (bug: BugLog, fields: BugWorkerField[]) => {
  if (!fields.length) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('patchBugColumns', { bug, fields });
    return;
  }
  try {
    await patchBugWorkerColumns(bug, fields);
  } catch (e) {
    enqueueOfflineMutation('patchBugColumns', { bug, fields });
  }
};

export const safeDeleteTestRun = async (runId: string) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('deleteTestRun', runId);
    return;
  }
  try {
    await deleteTestRunFromSupabase(runId);
  } catch (e) {
    enqueueOfflineMutation('deleteTestRun', runId);
  }
};

export const safeSyncDevices = async (devices: DeviceProfile[]) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOfflineMutation('syncDevices', devices);
    return;
  }
  try {
    await syncDevicesListToCloud(devices);
  } catch (e) {
    enqueueOfflineMutation('syncDevices', devices);
  }
};

// Global network listener to automatically drain queue upon reconnect
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    drainOfflineQueue();
  });
}
