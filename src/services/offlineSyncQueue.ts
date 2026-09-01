import {
  syncTestRunToSupabase,
  syncArchivedRunToSupabase,
  syncBugLogToSupabase,
  deleteTestRunFromSupabase,
  deleteArchivedRunFromSupabase,
  syncDevicesListToCloud
} from './supabaseService';
import { TestRun, BugLog, DeviceProfile } from '../types';

export type OfflineMutationType = 
  | 'syncTestRun'
  | 'syncArchivedRun'
  | 'syncBugLog'
  | 'deleteTestRun'
  | 'deleteArchivedRun'
  | 'syncDevices';

export interface OfflineMutation {
  id: string;
  type: OfflineMutationType;
  payload: any;
  timestamp: number;
}

const STORAGE_KEY = 'qa_offline_mutation_queue';

export const getOfflineQueue = (): OfflineMutation[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

const saveOfflineQueue = (queue: OfflineMutation[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    notifyQueueChange(queue.length);
  } catch (e) {
    console.error('Failed to save offline queue', e);
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
    timestamp: Date.now()
  };
  queue.push(mutation);
  saveOfflineQueue(queue);
};

let isDraining = false;

export const drainOfflineQueue = async () => {
  if (isDraining) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const queue = getOfflineQueue();
  if (queue.length === 0) return;

  isDraining = true;
  const remaining: OfflineMutation[] = [];

  for (const mut of queue) {
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
    } catch (err) {
      console.warn('Failed to sync offline mutation, retaining in queue:', mut.type, err);
      remaining.push(mut);
    }
  }

  saveOfflineQueue(remaining);
  isDraining = false;
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
