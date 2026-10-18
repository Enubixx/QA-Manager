import {
  TestPlan,
  TestRun,
  BugLog,
  DeviceProfile,
  TesterProfile,
  DevicePlanQuota,
} from '../types';
import {
  unmarkTestRunDeleted,
  unmarkArchivedRunDeleted,
  unmarkDeviceAsDeleted,
  unmarkTesterAsDeleted,
} from '../services/supabaseService';

export const UNDO_WINDOW_MS = 10_000;
export const RECENTLY_DELETED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const RECENTLY_DELETED_STORAGE_KEY = 'qa_recently_deleted';
export const RECENTLY_DELETED_MAX_ITEMS = 50;

export type DeletedEntityType = 'bug' | 'run' | 'plan' | 'device' | 'tester';

export interface DeleteDeviceDelta {
  deviceId: string;
  previousQuotas?: DevicePlanQuota[];
  activeRunId?: string;
  activeTesterName?: string;
}

export interface DeleteSnapshotPayload {
  plans?: TestPlan[];
  testRuns?: TestRun[];
  archivedRuns?: TestRun[];
  modifiedTestRuns?: TestRun[];
  modifiedArchivedRuns?: TestRun[];
  bugs?: BugLog[];
  modifiedBugs?: BugLog[];
  devices?: DeviceProfile[];
  deviceDeltas?: DeleteDeviceDelta[];
  populatedDevices?: string[];
  testers?: TesterProfile[];
  selectedPlanId?: string;
  inProgressCache?: { key: string; value: string }[];
}

export interface PendingDeleteEntry {
  id: string;
  type: DeletedEntityType;
  targetId: string;
  label: string;
  deletedAt: string;
  expiresAtMs: number;
  snapshot: DeleteSnapshotPayload;
}

export interface RecentlyDeletedEntry {
  id: string;
  type: DeletedEntityType;
  targetId: string;
  label: string;
  deletedAt: string;
  snapshot: DeleteSnapshotPayload;
}

export interface QAStateSlice {
  testPlans: TestPlan[];
  testRuns: TestRun[];
  archivedRuns: TestRun[];
  bugLogs: BugLog[];
  devices: DeviceProfile[];
  testers: TesterProfile[];
  populatedDevices: string[];
  selectedPlanId?: string;
}

const stripBugBase64 = (b: BugLog): BugLog => {
  if (!b || typeof b !== 'object') return b;
  if (typeof b.imageUrl === 'string' && b.imageUrl.startsWith('data:')) {
    return { ...b, imageUrl: undefined };
  }
  return b;
};

const stripRunBase64 = (r: TestRun): TestRun => {
  if (!r || typeof r !== 'object') return r;
  if (!Array.isArray(r.bugLogs) || r.bugLogs.length === 0) return r;
  const hasBase64 = r.bugLogs.some(b => typeof b?.imageUrl === 'string' && b.imageUrl.startsWith('data:'));
  if (!hasBase64) return r;
  return {
    ...r,
    bugLogs: r.bugLogs.map(stripBugBase64),
  };
};

/**
 * Strip base64 `data:` image URLs from a delete snapshot before persisting to `localStorage`
 * so `qa_recently_deleted` stays compact and avoids `QuotaExceededError`.
 */
export const stripBase64FromSnapshot = (snapshot: DeleteSnapshotPayload): DeleteSnapshotPayload => {
  if (!snapshot || typeof snapshot !== 'object') return {};
  return {
    ...snapshot,
    bugs: snapshot.bugs ? snapshot.bugs.map(stripBugBase64) : undefined,
    modifiedBugs: snapshot.modifiedBugs ? snapshot.modifiedBugs.map(stripBugBase64) : undefined,
    testRuns: snapshot.testRuns ? snapshot.testRuns.map(stripRunBase64) : undefined,
    archivedRuns: snapshot.archivedRuns ? snapshot.archivedRuns.map(stripRunBase64) : undefined,
    modifiedTestRuns: snapshot.modifiedTestRuns ? snapshot.modifiedTestRuns.map(stripRunBase64) : undefined,
    modifiedArchivedRuns: snapshot.modifiedArchivedRuns ? snapshot.modifiedArchivedRuns.map(stripRunBase64) : undefined,
    inProgressCache: undefined,
  };
};

/**
 * Load and prune `qa_recently_deleted` entries from `localStorage`.
 * Any entry older than 7 days (`RECENTLY_DELETED_TTL_MS`) is purged automatically.
 */
export const loadRecentlyDeleted = (nowMs: number = Date.now()): RecentlyDeletedEntry[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(RECENTLY_DELETED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    let prunedAny = false;
    const valid: RecentlyDeletedEntry[] = [];
    for (const item of parsed) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.id !== 'string' ||
        typeof item.type !== 'string' ||
        typeof item.deletedAt !== 'string' ||
        !item.snapshot
      ) {
        prunedAny = true;
        continue;
      }
      const deletedMs = new Date(item.deletedAt).getTime();
      if (!Number.isFinite(deletedMs) || nowMs - deletedMs > RECENTLY_DELETED_TTL_MS) {
        prunedAny = true;
        continue;
      }
      valid.push(item as RecentlyDeletedEntry);
    }

    if (prunedAny) {
      try {
        localStorage.setItem(RECENTLY_DELETED_STORAGE_KEY, JSON.stringify(valid));
      } catch {}
    }

    return valid;
  } catch {
    return [];
  }
};

/**
 * Save a committed delete entry into `qa_recently_deleted` (pruning >7d and capping size).
 */
export const saveRecentlyDeletedEntry = (
  entry: RecentlyDeletedEntry,
  nowMs: number = Date.now()
): RecentlyDeletedEntry[] => {
  const existing = loadRecentlyDeleted(nowMs).filter(e => e.id !== entry.id);
  const sanitized: RecentlyDeletedEntry = {
    ...entry,
    snapshot: stripBase64FromSnapshot(entry.snapshot),
  };
  const next = [sanitized, ...existing].slice(0, RECENTLY_DELETED_MAX_ITEMS);
  try {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(RECENTLY_DELETED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Fallback: keep most recent 10 items if storage is tight
        const smaller = next.slice(0, 10);
        localStorage.setItem(RECENTLY_DELETED_STORAGE_KEY, JSON.stringify(smaller));
        return smaller;
      }
    }
  } catch {}
  return next;
};

/**
 * Remove a single entry from `qa_recently_deleted` (e.g. after restoring it).
 */
export const removeRecentlyDeletedEntry = (
  entryId: string,
  nowMs: number = Date.now()
): RecentlyDeletedEntry[] => {
  const existing = loadRecentlyDeleted(nowMs);
  const next = existing.filter(e => e.id !== entryId);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RECENTLY_DELETED_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {}
  return next;
};

/**
 * Clear localStorage / in-memory delete tombstones for all entities inside a snapshot
 * so subsequent cloud polls do not hide restored items.
 */
export const clearSnapshotTombstones = (snapshot: DeleteSnapshotPayload): void => {
  if (!snapshot) return;
  (snapshot.testRuns || []).forEach(r => {
    if (r?.id) unmarkTestRunDeleted(r.id);
  });
  (snapshot.archivedRuns || []).forEach(r => {
    if (r?.id) {
      unmarkTestRunDeleted(r.id);
      unmarkArchivedRunDeleted(r.id);
    }
  });
  (snapshot.devices || []).forEach(d => {
    if (d?.id) unmarkDeviceAsDeleted(d.id);
  });
  (snapshot.testers || []).forEach(t => {
    if (t?.id) unmarkTesterAsDeleted(t.id);
  });
};

/**
 * Pure state restoration helper used by both 10s Undo and 7-day Recently Deleted Restore.
 * Restores deleted items and pre-delete modifications without clobbering unrelated concurrent changes.
 */
export const applySnapshotRestore = (
  state: QAStateSlice,
  snapshot: DeleteSnapshotPayload
): QAStateSlice => {
  let {
    testPlans,
    testRuns,
    archivedRuns,
    bugLogs,
    devices,
    testers,
    populatedDevices,
    selectedPlanId,
  } = state;

  if (snapshot.plans && snapshot.plans.length > 0) {
    const existingIds = new Set(testPlans.map(p => p.id));
    const toAdd = snapshot.plans.filter(p => p && !existingIds.has(p.id));
    if (toAdd.length > 0) {
      testPlans = [...testPlans, ...toAdd];
    }
  }

  if (snapshot.modifiedTestRuns && snapshot.modifiedTestRuns.length > 0) {
    const modMap = new Map(snapshot.modifiedTestRuns.map(r => [r.id, r]));
    testRuns = testRuns.map(r => modMap.get(r.id) || r);
  }

  if (snapshot.testRuns && snapshot.testRuns.length > 0) {
    const existingIds = new Set(testRuns.map(r => r.id));
    const toAdd = snapshot.testRuns.filter(r => r && !existingIds.has(r.id));
    if (toAdd.length > 0) {
      testRuns = [...toAdd, ...testRuns];
    }
  }

  if (snapshot.modifiedArchivedRuns && snapshot.modifiedArchivedRuns.length > 0) {
    const modMap = new Map(snapshot.modifiedArchivedRuns.map(r => [r.id, r]));
    archivedRuns = archivedRuns.map(r => modMap.get(r.id) || r);
  }

  if (snapshot.archivedRuns && snapshot.archivedRuns.length > 0) {
    const existingIds = new Set(archivedRuns.map(r => r.id));
    const toAdd = snapshot.archivedRuns.filter(r => r && !existingIds.has(r.id));
    if (toAdd.length > 0) {
      archivedRuns = [...toAdd, ...archivedRuns];
    }
  }

  if (snapshot.modifiedBugs && snapshot.modifiedBugs.length > 0) {
    const modMap = new Map(snapshot.modifiedBugs.map(b => [b.id, b]));
    bugLogs = bugLogs.map(b => modMap.get(b.id) || b);
    const patchRunBugs = (r: TestRun): TestRun => {
      if (!r.bugLogs || !r.bugLogs.some(b => modMap.has(b.id))) return r;
      return {
        ...r,
        bugLogs: r.bugLogs.map(b => modMap.get(b.id) || b),
      };
    };
    testRuns = testRuns.map(patchRunBugs);
    archivedRuns = archivedRuns.map(patchRunBugs);
  }

  if (snapshot.bugs && snapshot.bugs.length > 0) {
    const existingIds = new Set(bugLogs.map(b => b.id));
    const toAdd = snapshot.bugs.filter(b => b && !existingIds.has(b.id));
    if (toAdd.length > 0) {
      bugLogs = [...toAdd, ...bugLogs];
    }
    const bugsByRunId = new Map<string, BugLog[]>();
    snapshot.bugs.forEach(b => {
      if (!b?.testRunId) return;
      const list = bugsByRunId.get(b.testRunId) || [];
      list.push(b);
      bugsByRunId.set(b.testRunId, list);
    });
    if (bugsByRunId.size > 0) {
      const attachToRun = (r: TestRun): TestRun => {
        const list = bugsByRunId.get(r.id);
        if (!list || list.length === 0) return r;
        const haveIds = new Set((r.bugLogs || []).map(b => b.id));
        const missing = list.filter(b => !haveIds.has(b.id));
        if (missing.length === 0) return r;
        return { ...r, bugLogs: [...(r.bugLogs || []), ...missing] };
      };
      testRuns = testRuns.map(attachToRun);
      archivedRuns = archivedRuns.map(attachToRun);
    }
  }

  if (snapshot.devices && snapshot.devices.length > 0) {
    const existingIds = new Set(devices.map(d => d.id));
    const toAdd = snapshot.devices.filter(d => d && !existingIds.has(d.id));
    if (toAdd.length > 0) {
      devices = [...devices, ...toAdd];
    }
  }

  if (snapshot.deviceDeltas && snapshot.deviceDeltas.length > 0) {
    const deltaMap = new Map(snapshot.deviceDeltas.map(d => [d.deviceId, d]));
    devices = devices.map(d => {
      const delta = deltaMap.get(d.id);
      if (!delta) return d;
      return {
        ...d,
        quotas: delta.previousQuotas !== undefined ? delta.previousQuotas : d.quotas,
        activeRunId: d.activeRunId ?? delta.activeRunId,
        activeTesterName: d.activeTesterName ?? delta.activeTesterName,
      };
    });
  }

  if (snapshot.populatedDevices && snapshot.populatedDevices.length > 0) {
    const existingLower = new Set(populatedDevices.map(n => n.toLowerCase().trim()));
    const toAdd = snapshot.populatedDevices.filter(n => n && !existingLower.has(n.toLowerCase().trim()));
    if (toAdd.length > 0) {
      populatedDevices = [...populatedDevices, ...toAdd];
    }
  }

  if (snapshot.testers && snapshot.testers.length > 0) {
    const existingIds = new Set(testers.map(t => t.id));
    const existingNames = new Set(testers.map(t => t.name.toLowerCase().trim()));
    const toAdd = snapshot.testers.filter(
      t => t && !existingIds.has(t.id) && !existingNames.has(t.name.toLowerCase().trim())
    );
    if (toAdd.length > 0) {
      testers = [...testers, ...toAdd];
    }
  }

  if (snapshot.selectedPlanId) {
    selectedPlanId = snapshot.selectedPlanId;
  }

  return {
    testPlans,
    testRuns,
    archivedRuns,
    bugLogs,
    devices,
    testers,
    populatedDevices,
    selectedPlanId,
  };
};

export interface PendingDeleteQueueCallbacks {
  onCommit: (entry: PendingDeleteEntry) => void;
  onUndo: (entry: PendingDeleteEntry) => void;
  onChange?: (entries: PendingDeleteEntry[]) => void;
}

/**
 * Manages multiple independent 10-second pending deletes.
 * Each delete gets its own timer; Undo cancels only that entry's timer and restores its snapshot;
 * Expiry or `flushAll()` (e.g. on `beforeunload`) commits only the remaining pending entries.
 */
export const createPendingDeleteQueue = (
  callbacks: PendingDeleteQueueCallbacks,
  windowMs: number = UNDO_WINDOW_MS
) => {
  const entries = new Map<string, PendingDeleteEntry>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const notify = () => {
    callbacks.onChange?.(Array.from(entries.values()));
  };

  const enqueue = (
    params: {
      id?: string;
      type: DeletedEntityType;
      targetId: string;
      label: string;
      snapshot: DeleteSnapshotPayload;
    },
    nowMs: number = Date.now()
  ): PendingDeleteEntry => {
    const id = params.id || `del-${params.type}-${params.targetId}-${nowMs}-${Math.random().toString(36).slice(2, 7)}`;
    const entry: PendingDeleteEntry = {
      id,
      type: params.type,
      targetId: params.targetId,
      label: params.label,
      deletedAt: new Date(nowMs).toISOString(),
      expiresAtMs: nowMs + windowMs,
      snapshot: params.snapshot,
    };
    entries.set(id, entry);
    const timer = setTimeout(() => {
      flush(id);
    }, windowMs);
    timers.set(id, timer);
    notify();
    return entry;
  };

  const undo = (id: string): PendingDeleteEntry | null => {
    const entry = entries.get(id);
    if (!entry) return null;
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    entries.delete(id);
    callbacks.onUndo(entry);
    notify();
    return entry;
  };

  const flush = (id: string): PendingDeleteEntry | null => {
    const entry = entries.get(id);
    if (!entry) return null;
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    entries.delete(id);
    callbacks.onCommit(entry);
    notify();
    return entry;
  };

  const flushAll = (): PendingDeleteEntry[] => {
    const allIds = Array.from(entries.keys());
    const committed: PendingDeleteEntry[] = [];
    for (const id of allIds) {
      const res = flush(id);
      if (res) committed.push(res);
    }
    return committed;
  };

  const getEntries = (): PendingDeleteEntry[] => Array.from(entries.values());

  return {
    enqueue,
    undo,
    flush,
    flushAll,
    getEntries,
  };
};
