import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  UNDO_WINDOW_MS,
  RECENTLY_DELETED_TTL_MS,
  RECENTLY_DELETED_STORAGE_KEY,
  createPendingDeleteQueue,
  loadRecentlyDeleted,
  saveRecentlyDeletedEntry,
  removeRecentlyDeletedEntry,
  applySnapshotRestore,
  clearSnapshotTombstones,
  stripBase64FromSnapshot,
  QAStateSlice,
  PendingDeleteEntry,
} from '../undoDeleteStore';
import {
  markTestRunDeleted,
  markArchivedRunDeleted,
  markDeviceAsDeleted,
  markTesterAsDeleted,
  isTestRunDeleted,
  isArchivedRunDeleted,
  getDeletedDeviceIds,
  getDeletedTesterIds,
} from '../../services/supabaseService';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile } from '../../types';

const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
};

const samplePlan: TestPlan = {
  id: 'plan-1',
  name: 'Core Sanity Plan',
  description: 'Sanity checks',
  createdAt: '2026-10-18T08:00:00.000Z',
  steps: [{ id: 's1', title: 'Step 1', feature: 'Notifications', description: '', expectedOutcome: '' }],
};

const sampleRun: TestRun = {
  id: 'run-1',
  planId: 'plan-1',
  planName: 'Core Sanity Plan',
  testerName: 'Alice',
  deviceId: 'dev-1',
  deviceName: 'WP01',
  status: 'in_progress',
  currentStepIndex: 0,
  startedAt: '2026-10-18T09:00:00.000Z',
  results: { s1: { stepId: 's1', status: 'green', timestamp: '2026-10-18T09:05:00.000Z' } },
  bugLogs: [],
};

const sampleBug: BugLog = {
  id: 'bug-1',
  testRunId: 'run-1',
  planId: 'plan-1',
  stepId: 's1',
  stepTitle: 'Step 1',
  feature: 'Notifications',
  testerName: 'Alice',
  deviceName: 'WP01',
  severity: 'high',
  note: 'Audio drops on notification',
  imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
  timestamp: '2026-10-18T09:06:00.000Z',
  formattedTime: '9:06 AM',
};

const sampleDevice: DeviceProfile = {
  id: 'dev-1',
  name: 'WP01',
  isReady: true,
  quotas: [{ planId: 'plan-1', targetRunsPerDay: 3 }],
  activeRunId: 'run-1',
  activeTesterName: 'Alice',
};

const sampleTester: TesterProfile = {
  id: 'tester-1',
  name: 'Alice',
  role: 'QA Lead',
};

describe('Undo delete queue and Recently deleted store (M4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const mem = createMemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mem,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides deleted plan immediately and restores full state including cascaded runs and quotas on Undo within 10s', () => {
    let state: QAStateSlice = {
      testPlans: [samplePlan],
      testRuns: [{ ...sampleRun, bugLogs: [sampleBug] }],
      archivedRuns: [],
      bugLogs: [sampleBug],
      devices: [sampleDevice],
      testers: [sampleTester],
      populatedDevices: ['WP01'],
      selectedPlanId: 'plan-1',
    };

    const committed: PendingDeleteEntry[] = [];
    const undone: PendingDeleteEntry[] = [];

    const queue = createPendingDeleteQueue({
      onCommit: entry => committed.push(entry),
      onUndo: entry => {
        undone.push(entry);
        state = applySnapshotRestore(state, entry.snapshot);
      },
    });

    // Simulate deleting plan-1: capture snapshot and hide immediately in state
    const entry = queue.enqueue({
      type: 'plan',
      targetId: samplePlan.id,
      label: samplePlan.name,
      snapshot: {
        plans: [samplePlan],
        testRuns: state.testRuns,
        deviceDeltas: [
          {
            deviceId: sampleDevice.id,
            previousQuotas: sampleDevice.quotas,
            activeRunId: sampleDevice.activeRunId,
            activeTesterName: sampleDevice.activeTesterName,
          },
        ],
        selectedPlanId: 'plan-1',
      },
    });

    state = {
      ...state,
      testPlans: [],
      testRuns: [],
      devices: [{ ...sampleDevice, quotas: [], activeRunId: undefined, activeTesterName: undefined }],
      selectedPlanId: '',
    };

    expect(state.testPlans).toHaveLength(0);
    expect(state.testRuns).toHaveLength(0);
    expect(state.devices[0].quotas).toHaveLength(0);
    expect(committed).toHaveLength(0);

    // Advance 5s (within 10s window) and click Undo
    vi.advanceTimersByTime(5000);
    expect(committed).toHaveLength(0);

    queue.undo(entry.id);
    expect(undone).toHaveLength(1);
    expect(state.testPlans).toEqual([samplePlan]);
    expect(state.testRuns).toHaveLength(1);
    expect(state.testRuns[0].id).toBe('run-1');
    expect(state.devices[0].quotas).toEqual([{ planId: 'plan-1', targetRunsPerDay: 3 }]);
    expect(state.devices[0].activeRunId).toBe('run-1');
    expect(state.selectedPlanId).toBe('plan-1');

    // Advancing past 10s after Undo does NOT fire onCommit
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(committed).toHaveLength(0);
  });

  it('supports multiple independent pending deletes and commits only the non-undone delete on expiry', () => {
    const bugA: BugLog = { ...sampleBug, id: 'bug-a', title: 'Bug A' };
    const bugB: BugLog = { ...sampleBug, id: 'bug-b', title: 'Bug B' };

    let state: QAStateSlice = {
      testPlans: [samplePlan],
      testRuns: [{ ...sampleRun, bugLogs: [bugA, bugB] }],
      archivedRuns: [],
      bugLogs: [bugA, bugB],
      devices: [sampleDevice],
      testers: [sampleTester],
      populatedDevices: ['WP01'],
    };

    const committedIds: string[] = [];
    const queue = createPendingDeleteQueue({
      onCommit: entry => {
        committedIds.push(entry.targetId);
        saveRecentlyDeletedEntry({
          id: entry.id,
          type: entry.type,
          targetId: entry.targetId,
          label: entry.label,
          deletedAt: entry.deletedAt,
          snapshot: entry.snapshot,
        });
      },
      onUndo: entry => {
        state = applySnapshotRestore(state, entry.snapshot);
      },
    });

    // Delete Bug A at t=0
    const entryA = queue.enqueue({
      type: 'bug',
      targetId: 'bug-a',
      label: 'Bug A',
      snapshot: { bugs: [bugA] },
    });
    state = {
      ...state,
      bugLogs: state.bugLogs.filter(b => b.id !== 'bug-a'),
      testRuns: state.testRuns.map(r => ({ ...r, bugLogs: r.bugLogs.filter(b => b.id !== 'bug-a') })),
    };

    // Delete Bug B at t=3s
    vi.advanceTimersByTime(3000);
    queue.enqueue({
      type: 'bug',
      targetId: 'bug-b',
      label: 'Bug B',
      snapshot: { bugs: [bugB] },
    });
    state = {
      ...state,
      bugLogs: state.bugLogs.filter(b => b.id !== 'bug-b'),
      testRuns: state.testRuns.map(r => ({ ...r, bugLogs: r.bugLogs.filter(b => b.id !== 'bug-b') })),
    };

    expect(state.bugLogs).toHaveLength(0);

    // Undo Bug A at t=5s -> only Bug A is restored, Bug B stays deleted
    vi.advanceTimersByTime(2000);
    queue.undo(entryA.id);
    expect(state.bugLogs.map(b => b.id)).toEqual(['bug-a']);
    expect(state.testRuns[0].bugLogs.map(b => b.id)).toEqual(['bug-a']);

    // Advance to t=13s -> Bug B expires and commits
    vi.advanceTimersByTime(8000);
    expect(committedIds).toEqual(['bug-b']);
    const recent = loadRecentlyDeleted();
    expect(recent).toHaveLength(1);
    expect(recent[0].targetId).toBe('bug-b');
    // Base64 image was stripped when saving to localStorage
    expect(recent[0].snapshot.bugs?.[0].imageUrl).toBeUndefined();
  });

  it('restores from Recently deleted, clears all tombstones, and prunes items older than 7 days', () => {
    const nowMs = new Date('2026-10-18T12:00:00.000Z').getTime();
    const eightDaysAgoIso = new Date(nowMs - RECENTLY_DELETED_TTL_MS - 60_000).toISOString();
    const twoDaysAgoIso = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Seed an expired 8-day-old entry and a valid 2-day-old entry directly
    localStorage.setItem(
      RECENTLY_DELETED_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'del-old',
          type: 'device',
          targetId: 'dev-old',
          label: 'Old Device',
          deletedAt: eightDaysAgoIso,
          snapshot: { devices: [{ id: 'dev-old', name: 'Old Device', isReady: true, quotas: [] }] },
        },
        {
          id: 'del-recent-run',
          type: 'run',
          targetId: 'run-1',
          label: 'Core Sanity Plan (Alice)',
          deletedAt: twoDaysAgoIso,
          snapshot: {
            archivedRuns: [sampleRun],
            bugs: [stripBase64FromSnapshot({ bugs: [sampleBug] }).bugs![0]],
            devices: [sampleDevice],
            testers: [sampleTester],
          },
        },
      ])
    );

    // Pruning on load drops the 8-day-old entry and keeps the 2-day-old entry
    const loaded = loadRecentlyDeleted(nowMs);
    expect(loaded.map(e => e.id)).toEqual(['del-recent-run']);

    // Mark tombstones as if the permanent delete had occurred
    markTestRunDeleted('run-1');
    markArchivedRunDeleted('run-1');
    markDeviceAsDeleted('dev-1');
    markTesterAsDeleted('tester-1');
    expect(isTestRunDeleted('run-1')).toBe(true);
    expect(isArchivedRunDeleted('run-1')).toBe(true);
    expect(getDeletedDeviceIds().has('dev-1')).toBe(true);
    expect(getDeletedTesterIds().has('tester-1')).toBe(true);

    // Restore the entry
    const entryToRestore = loaded[0];
    clearSnapshotTombstones(entryToRestore.snapshot);
    expect(isTestRunDeleted('run-1')).toBe(false);
    expect(isArchivedRunDeleted('run-1')).toBe(false);
    expect(getDeletedDeviceIds().has('dev-1')).toBe(false);
    expect(getDeletedTesterIds().has('tester-1')).toBe(false);

    const emptyState: QAStateSlice = {
      testPlans: [samplePlan],
      testRuns: [],
      archivedRuns: [],
      bugLogs: [],
      devices: [],
      testers: [],
      populatedDevices: [],
    };
    const restoredState = applySnapshotRestore(emptyState, entryToRestore.snapshot);
    expect(restoredState.archivedRuns).toHaveLength(1);
    expect(restoredState.archivedRuns[0].id).toBe('run-1');
    expect(restoredState.bugLogs).toHaveLength(1);
    expect(restoredState.bugLogs[0].id).toBe('bug-1');
    expect(restoredState.devices).toHaveLength(1);
    expect(restoredState.testers).toHaveLength(1);

    const afterRemove = removeRecentlyDeletedEntry(entryToRestore.id, nowMs);
    expect(afterRemove).toHaveLength(0);
  });
});
