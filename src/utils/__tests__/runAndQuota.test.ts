import { describe, it, expect, beforeEach } from 'vitest';
import {
  isRecordedResult,
  buildStepFirstSeenIndex,
  hasAllLiveStepsRecorded,
  isRunFullyCompleted,
  getEffectiveRunStatus,
  computeLiveInProgressRuns,
  computeTodayRunsMap,
  computeFleetProgress,
  filterCloudArchivedRuns,
  filterCloudTestRuns,
  filterBugsAfterRunDelete,
} from '../runUtils';
import { mergeRunsById } from '../cujReportUtils';
import {
  isTestRunDeleted,
  isArchivedRunDeleted,
  markArchivedRunDeleted,
  unmarkArchivedRunDeleted,
  unmarkTestRunDeleted,
  getDeletedArchivedRunIds,
} from '../../services/supabaseService';
import {
  safeDeleteTestRun,
  safeSyncArchivedRun,
  safeDeleteArchivedRun,
  getOfflineQueue,
} from '../../services/offlineSyncQueue';
import type { TestPlan, TestRun, DeviceProfile } from '../../types';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
});

const samplePlan: TestPlan = {
  id: 'plan-core',
  name: 'Core Sanity',
  description: '',
  createdAt: '2026-10-01T00:00:00.000Z',
  steps: [
    { id: 's1', title: 'Step 1', feature: 'Notifications', description: '', expectedOutcome: '' },
    { id: 's2', title: 'Step 2', feature: 'Camera', description: '', expectedOutcome: '' },
  ],
};

const sampleDevice: DeviceProfile = {
  id: 'dev-1',
  name: 'WP01',
  isReady: true,
  quotas: [{ planId: 'plan-core', targetRunsPerDay: 2 }],
};

describe('runUtils & quota / active-session logic', () => {
  it('recognizes valid recorded step results and rejects _meta / pending', () => {
    expect(isRecordedResult('s1', { status: 'green' })).toBe(true);
    expect(isRecordedResult('s1', { status: 'yellow' })).toBe(true);
    expect(isRecordedResult('s1', { status: 'red' })).toBe(true);
    expect(isRecordedResult('_meta', { status: 'green' })).toBe(false);
    expect(isRecordedResult('s1', { status: 'pending' })).toBe(false);
    expect(isRecordedResult('s1', null)).toBe(false);
  });

  it('counts the very first completed run toward daily quota and meets quota at target', () => {
    const todayIso = '2026-10-18T10:00:00.000Z';
    const todayStr = '2026-10-18';
    const run1: TestRun = {
      id: 'run-1',
      planId: 'plan-core',
      planName: 'Core Sanity',
      deviceId: 'dev-1',
      deviceName: 'WP01',
      testerName: 'Alice',
      status: 'completed',
      currentStepIndex: 2,
      startedAt: todayIso,
      completedAt: todayIso,
      results: {
        s1: { stepId: 's1', status: 'green', timestamp: todayIso },
        s2: { stepId: 's2', status: 'yellow', timestamp: todayIso },
      },
      bugLogs: [],
    };

    const merged1 = mergeRunsById([run1], []);
    const firstSeen1 = buildStepFirstSeenIndex(merged1);
    expect(isRunFullyCompleted(run1, [samplePlan], firstSeen1)).toBe(true);

    const todayMap1 = computeTodayRunsMap(merged1, [sampleDevice], [samplePlan], firstSeen1, todayStr);
    expect(todayMap1['dev-1']?.['plan-core']).toBe(1);
    const fleet1 = computeFleetProgress([sampleDevice], todayMap1, [samplePlan]);
    expect(fleet1).toEqual({ totalCompleted: 1, totalTarget: 2, pct: 50 });

    const run2: TestRun = { ...run1, id: 'run-2' };
    const merged2 = mergeRunsById([run1, run2], [run1]); // duplicate run1 in active & archived deduplicated
    expect(merged2.length).toBe(2);
    const todayMap2 = computeTodayRunsMap(merged2, [sampleDevice], [samplePlan], firstSeen1, todayStr);
    expect(todayMap2['dev-1']?.['plan-core']).toBe(2);
    const fleet2 = computeFleetProgress([sampleDevice], todayMap2, [samplePlan]);
    expect(fleet2).toEqual({ totalCompleted: 2, totalTarget: 2, pct: 100 });
  });

  it('does not count terminated or incomplete runs toward daily quota', () => {
    const todayIso = '2026-10-18T10:00:00.000Z';
    const todayStr = '2026-10-18';
    const terminatedRun: TestRun = {
      id: 'run-term',
      planId: 'plan-core',
      planName: 'Core Sanity',
      deviceId: 'dev-1',
      deviceName: 'WP01',
      testerName: 'Alice',
      status: 'terminated',
      currentStepIndex: 2,
      startedAt: todayIso,
      completedAt: todayIso,
      results: {
        s1: { stepId: 's1', status: 'green', timestamp: todayIso },
        s2: { stepId: 's2', status: 'green', timestamp: todayIso },
      },
      bugLogs: [],
    };
    const partialRun: TestRun = {
      id: 'run-partial',
      planId: 'plan-core',
      planName: 'Core Sanity',
      deviceId: 'dev-1',
      deviceName: 'WP01',
      testerName: 'Alice',
      status: 'completed',
      currentStepIndex: 1,
      startedAt: todayIso,
      completedAt: todayIso,
      results: {
        s1: { stepId: 's1', status: 'green', timestamp: todayIso },
      },
      bugLogs: [],
    };

    expect(isRunFullyCompleted(terminatedRun, [samplePlan])).toBe(false);
    expect(isRunFullyCompleted(partialRun, [samplePlan])).toBe(false);
    expect(hasAllLiveStepsRecorded(terminatedRun, [samplePlan])).toBe(false);

    const todayMap = computeTodayRunsMap([terminatedRun, partialRun], [sampleDevice], [samplePlan], undefined, todayStr);
    expect(todayMap['dev-1']?.['plan-core']).toBeUndefined();
  });

  it('computes live in-progress runs excluding archived, completed, terminated, and prior-day runs', () => {
    const todayStr = '2026-10-18';
    const liveRun: TestRun = {
      id: 'run-live',
      planId: 'plan-core',
      planName: 'Core Sanity',
      testerName: 'Bob',
      deviceName: 'WP01',
      status: 'in_progress',
      currentStepIndex: 0,
      startedAt: '2026-10-18T12:00:00',
      results: {},
      bugLogs: [],
    };
    const alreadyArchivedRun: TestRun = { ...liveRun, id: 'run-arch' };
    const yesterdayRun: TestRun = { ...liveRun, id: 'run-yest', startedAt: '2026-10-17T12:00:00' };
    const terminatedRun: TestRun = { ...liveRun, id: 'run-term', status: 'terminated' };

    const result = computeLiveInProgressRuns(
      [liveRun, alreadyArchivedRun, yesterdayRun, terminatedRun],
      new Set(['run-arch']),
      [samplePlan],
      todayStr
    );
    expect(result.map(r => r.id)).toEqual(['run-live']);
    expect(getEffectiveRunStatus(terminatedRun, [samplePlan])).toBe('terminated');
  });

  it('survives complete -> archive -> cloud poll without dropping the completed run (D6 regression guard)', async () => {
    const runId = 'run-complete-d6-check';
    unmarkTestRunDeleted(runId);
    unmarkArchivedRunDeleted(runId);

    const completedRun: TestRun = {
      id: runId,
      planId: 'plan-core',
      planName: 'Core Sanity',
      testerName: 'Alice',
      deviceId: 'dev-1',
      deviceName: 'WP01',
      status: 'completed',
      currentStepIndex: 2,
      startedAt: '2026-10-18T10:00:00.000Z',
      completedAt: '2026-10-18T10:05:00.000Z',
      results: {
        s1: { stepId: 's1', status: 'green', timestamp: '2026-10-18T10:01:00.000Z' },
        s2: { stepId: 's2', status: 'green', timestamp: '2026-10-18T10:04:00.000Z' },
      },
      bugLogs: [],
    };

    // Simulate App.tsx run completion: remove from test_runs + save to archived_runs
    await safeDeleteTestRun(completedRun.id);
    await safeSyncArchivedRun(completedRun);

    expect(isTestRunDeleted(completedRun.id)).toBe(true);
    expect(isArchivedRunDeleted(completedRun.id)).toBe(false);

    // Simulate cloud poll returning completedRun in archivedRuns and stale copy in testRuns
    const deletedArchivedSet = getDeletedArchivedRunIds();
    expect(deletedArchivedSet.has(completedRun.id)).toBe(false);

    const validArchived = filterCloudArchivedRuns([completedRun], isArchivedRunDeleted);
    expect(validArchived).toHaveLength(1);
    expect(validArchived[0].id).toBe(completedRun.id);

    const validTestRuns = filterCloudTestRuns(
      [completedRun],
      new Set(validArchived.map(r => r.id)),
      isTestRunDeleted,
      isArchivedRunDeleted
    );
    expect(validTestRuns).toHaveLength(0);

    // Quota still counts the completed run after cloud poll
    const todayMap = computeTodayRunsMap(validArchived, [sampleDevice], [samplePlan], undefined, '2026-10-18');
    expect(todayMap['dev-1']?.['plan-core']).toBe(1);

    // Explicit user delete tombstones both lists and enqueues deleteArchivedRun
    await safeDeleteArchivedRun(completedRun.id);
    expect(isArchivedRunDeleted(completedRun.id)).toBe(true);
    expect(filterCloudArchivedRuns([completedRun], isArchivedRunDeleted)).toHaveLength(0);
    expect(getOfflineQueue().some(m => m.type === 'deleteArchivedRun' && m.payload === completedRun.id)).toBe(true);

    // Unmarking restores visibility
    unmarkArchivedRunDeleted(completedRun.id);
    markArchivedRunDeleted('temp-id');
    expect(isArchivedRunDeleted('temp-id')).toBe(true);
    unmarkArchivedRunDeleted('temp-id');
    expect(isArchivedRunDeleted('temp-id')).toBe(false);
  });

  it('preserves bugs when an in_progress run is superseded (keepBugs: true) and cascade-deletes on explicit delete', () => {
    const bug1 = {
      id: 'bug-sup-1',
      testRunId: 'run-sup-1',
      planId: 'plan-core',
      stepId: 's1',
      stepTitle: 'Step 1',
      feature: 'Notifications',
      testerName: 'Alice',
      deviceName: 'WP01',
      severity: 'high' as const,
      note: 'Logged before switching device',
      timestamp: '2026-10-18T10:00:00.000Z',
      formattedTime: '10:00 AM',
    };
    const bug2 = { ...bug1, id: 'bug-other-2', testRunId: 'run-other-2' };
    const supersededRun: TestRun = {
      id: 'run-sup-1',
      planId: 'plan-core',
      planName: 'Core Sanity',
      testerName: 'Alice',
      deviceName: 'WP01',
      status: 'in_progress',
      currentStepIndex: 0,
      startedAt: '2026-10-18T09:59:00.000Z',
      results: {},
      bugLogs: [bug1],
    };

    const kept = filterBugsAfterRunDelete([bug1, bug2], 'run-sup-1', supersededRun, { keepBugs: true });
    expect(kept.remaining).toHaveLength(2);
    expect(kept.toDelete).toHaveLength(0);

    const cascaded = filterBugsAfterRunDelete([bug1, bug2], 'run-sup-1', supersededRun);
    expect(cascaded.remaining.map(b => b.id)).toEqual(['bug-other-2']);
    expect(cascaded.toDelete.map(b => b.id)).toEqual(['bug-sup-1']);
  });
});
