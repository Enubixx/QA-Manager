import { describe, it, expect, beforeEach } from 'vitest';
import type { DeviceProfile, TesterProfile, TestRun, TestPlan } from '../../types';
import {
  extractDeviceIdFromRunId,
  isDeviceNameUnique,
  hasDuplicateDeviceName,
  getDuplicateDeviceIds,
  resolveRunDeviceId,
  reconcileDeviceLocks,
  computeTodayRunsMap,
} from '../runUtils';
import {
  compareUpdatedAt,
  applyDevicePatches,
  mergeDevicesLists,
  applyTesterPatches,
  mergeTestersLists,
  markDeviceDeleted,
  unmarkDeviceDeleted,
  isDeviceDeleted,
  markTesterDeleted,
  unmarkTesterDeleted,
  isTesterDeleted,
  markBugDeleted,
  unmarkBugDeleted,
  isBugDeleted,
  markTestRunDeleted,
  unmarkTestRunDeleted,
  isTestRunDeleted,
} from '../../services/supabaseService';

describe('Items A & B: Per-device and per-tester patches & updatedAt reconciliation', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {}
  });

  it('compareUpdatedAt orders ISO timestamps and treats missing as oldest', () => {
    expect(compareUpdatedAt(undefined, undefined)).toBe(0);
    expect(compareUpdatedAt('2026-10-20T00:00:01.000Z', undefined)).toBeGreaterThan(0);
    expect(compareUpdatedAt(undefined, '2026-10-20T00:00:01.000Z')).toBeLessThan(0);
    expect(
      compareUpdatedAt('2026-10-20T00:00:02.000Z', '2026-10-20T00:00:01.000Z')
    ).toBeGreaterThan(0);
  });

  it('applyDevicePatches merges concurrent edits on different devices without clobbering', () => {
    const cloudDevices: DeviceProfile[] = [
      { id: 'dev-1', name: 'WP01', isReady: true, quotas: [] },
      { id: 'dev-2', name: 'GM01', isReady: true, quotas: [] },
    ];

    // Client A activates WP01 at t=1
    const afterA = applyDevicePatches(cloudDevices, [
      {
        id: 'dev-1',
        updatedAt: '2026-10-20T01:00:01.000Z',
        changes: {
          isReady: true,
          quotas: [{ planId: 'plan-1', targetRunsPerDay: 3 }],
          updatedAt: '2026-10-20T01:00:01.000Z',
        },
      },
    ]);

    // Client B activates GM01 at t=2 against the cloud list
    const afterB = applyDevicePatches(afterA, [
      {
        id: 'dev-2',
        updatedAt: '2026-10-20T01:00:02.000Z',
        changes: {
          isReady: true,
          quotas: [{ planId: 'plan-2', targetRunsPerDay: 5 }],
          updatedAt: '2026-10-20T01:00:02.000Z',
        },
      },
    ]);

    expect(afterB.find(d => d.id === 'dev-1')?.quotas).toEqual([
      { planId: 'plan-1', targetRunsPerDay: 3 },
    ]);
    expect(afterB.find(d => d.id === 'dev-2')?.quotas).toEqual([
      { planId: 'plan-2', targetRunsPerDay: 5 },
    ]);
  });

  it('lockOnly patches never overwrite name, isReady, quotas, or updatedAt', () => {
    const base: DeviceProfile[] = [
      {
        id: 'dev-1',
        name: 'WP01',
        isReady: false,
        quotas: [{ planId: 'plan-1', targetRunsPerDay: 4 }],
        updatedAt: '2026-10-20T01:00:10.000Z',
      },
    ];

    const locked = applyDevicePatches(base, [
      {
        id: 'dev-1',
        lockOnly: true,
        changes: {
          name: 'STALE_NAME',
          isReady: true,
          quotas: [],
          activeRunId: 'run-123',
          activeTesterName: 'Alice',
        },
      },
    ]);

    expect(locked[0].name).toBe('WP01');
    expect(locked[0].isReady).toBe(false);
    expect(locked[0].quotas).toEqual([{ planId: 'plan-1', targetRunsPerDay: 4 }]);
    expect(locked[0].updatedAt).toBe('2026-10-20T01:00:10.000Z');
    expect(locked[0].activeRunId).toBe('run-123');
    expect(locked[0].activeTesterName).toBe('Alice');
  });

  it('mergeDevicesLists keeps newer per-device updatedAt when polling stale vs fresh snapshots', () => {
    const local: DeviceProfile[] = [
      {
        id: 'dev-1',
        name: 'WP01',
        isReady: true,
        quotas: [{ planId: 'plan-1', targetRunsPerDay: 5 }],
        updatedAt: '2026-10-20T01:00:10.000Z',
      },
      {
        id: 'dev-2',
        name: 'GM01',
        isReady: true,
        quotas: [],
        updatedAt: '2026-10-20T01:00:01.000Z',
      },
    ];
    const cloud: DeviceProfile[] = [
      {
        id: 'dev-1',
        name: 'WP01',
        isReady: true,
        quotas: [{ planId: 'plan-1', targetRunsPerDay: 2 }],
        updatedAt: '2026-10-20T01:00:05.000Z', // older than local
      },
      {
        id: 'dev-2',
        name: 'GM01',
        isReady: false,
        quotas: [{ planId: 'plan-2', targetRunsPerDay: 3 }],
        updatedAt: '2026-10-20T01:00:12.000Z', // newer than local
      },
    ];

    const merged = mergeDevicesLists(local, cloud);
    expect(merged.find(d => d.id === 'dev-1')?.quotas?.[0]?.targetRunsPerDay).toBe(5);
    expect(merged.find(d => d.id === 'dev-2')?.isReady).toBe(false);
    expect(merged.find(d => d.id === 'dev-2')?.quotas?.[0]?.targetRunsPerDay).toBe(3);
  });

  it('applyTesterPatches and mergeTestersLists preserve newer tester edits', () => {
    const base: TesterProfile[] = [{ id: 't-1', name: 'Alice', role: 'Tester' }];
    const patched = applyTesterPatches(base, [
      {
        id: 't-1',
        updatedAt: '2026-10-20T01:00:05.000Z',
        changes: { role: 'Lead Tester' },
      },
      {
        id: 't-2',
        updatedAt: '2026-10-20T01:00:06.000Z',
        changes: { id: 't-2', name: 'Bob', role: 'Mobile Tester' },
      },
    ]);
    expect(patched).toHaveLength(2);
    expect(patched.find(t => t.id === 't-1')?.role).toBe('Lead Tester');

    const merged = mergeTestersLists(patched, [
      { id: 't-1', name: 'Alice', role: 'Stale Role', updatedAt: '2026-10-20T01:00:01.000Z' },
    ]);
    expect(merged.find(t => t.id === 't-1')?.role).toBe('Lead Tester');
    expect(merged.find(t => t.id === 't-2')?.name).toBe('Bob');
  });

  it('per-field conflict resolution on devices: different fields edited on the same device both stick even when later timestamp lands first', () => {
    const legacyCloud: DeviceProfile[] = [
      { id: 'dev-1', name: 'WP01', isReady: true, quotas: [] },
    ];

    // User A edits quotas at t=1, User B toggles isReady at t=2.
    // Suppose User B's write (t=2) lands in cloud FIRST:
    const afterB = applyDevicePatches(legacyCloud, [
      {
        id: 'dev-1',
        updatedAt: '2026-10-20T01:00:02.000Z',
        fieldUpdatedAt: { isReady: '2026-10-20T01:00:02.000Z' },
        changes: {
          isReady: false,
          updatedAt: '2026-10-20T01:00:02.000Z',
        },
      },
    ]);

    // Now User A's write (t=1, earlier timestamp than B's t=2) lands SECOND:
    const afterA = applyDevicePatches(afterB, [
      {
        id: 'dev-1',
        updatedAt: '2026-10-20T01:00:01.000Z',
        fieldUpdatedAt: { quotas: '2026-10-20T01:00:01.000Z' },
        changes: {
          quotas: [{ planId: 'plan-1', targetRunsPerDay: 4 }],
          updatedAt: '2026-10-20T01:00:01.000Z',
        },
      },
    ]);

    // Both edits on dev-1 must stick!
    expect(afterA[0].isReady).toBe(false);
    expect(afterA[0].quotas).toEqual([{ planId: 'plan-1', targetRunsPerDay: 4 }]);
    expect(afterA[0].name).toBe('WP01');

    // Also verify mergeDevicesLists merges per field when polling snapshots
    const localSnapshot: DeviceProfile[] = [
      {
        id: 'dev-1',
        name: 'WP01-Renamed',
        isReady: true,
        quotas: [],
        updatedAt: '2026-10-20T01:00:01.500Z',
        fieldUpdatedAt: { name: '2026-10-20T01:00:01.500Z', isReady: '', quotas: '' },
      },
    ];
    const merged = mergeDevicesLists(afterA, localSnapshot);
    expect(merged[0].name).toBe('WP01-Renamed');
    expect(merged[0].isReady).toBe(false);
    expect(merged[0].quotas).toEqual([{ planId: 'plan-1', targetRunsPerDay: 4 }]);
  });

  it('per-field conflict resolution on devices: same field newer timestamp wins and legacy devices without fieldUpdatedAt fall back to updatedAt', () => {
    // Legacy device with updatedAt at t=5 and no fieldUpdatedAt map
    const legacyWithUpdatedAt: DeviceProfile[] = [
      {
        id: 'dev-1',
        name: 'WP01',
        isReady: false,
        quotas: [{ planId: 'plan-1', targetRunsPerDay: 5 }],
        updatedAt: '2026-10-20T01:00:05.000Z',
      },
    ];

    // Stale patch on quotas at t=3 is rejected, while newer patch on name at t=8 in another patch succeeds
    const afterStaleQuotas = applyDevicePatches(legacyWithUpdatedAt, [
      {
        id: 'dev-1',
        updatedAt: '2026-10-20T01:00:03.000Z',
        fieldUpdatedAt: { quotas: '2026-10-20T01:00:03.000Z' },
        changes: {
          quotas: [{ planId: 'plan-1', targetRunsPerDay: 1 }],
        },
      },
    ]);
    expect(afterStaleQuotas[0].quotas).toEqual([{ planId: 'plan-1', targetRunsPerDay: 5 }]);

    // Newer edit to same field (quotas at t=9) wins over t=5
    const afterNewerQuotas = applyDevicePatches(afterStaleQuotas, [
      {
        id: 'dev-1',
        updatedAt: '2026-10-20T01:00:09.000Z',
        fieldUpdatedAt: { quotas: '2026-10-20T01:00:09.000Z' },
        changes: {
          quotas: [{ planId: 'plan-1', targetRunsPerDay: 9 }],
        },
      },
    ]);
    expect(afterNewerQuotas[0].quotas).toEqual([{ planId: 'plan-1', targetRunsPerDay: 9 }]);
    expect(afterNewerQuotas[0].isReady).toBe(false);
  });

  it('per-field conflict resolution on testers: different fields (name vs role) both stick, same field newer wins, legacy testers fall back to updatedAt', () => {
    const legacyTesters: TesterProfile[] = [
      {
        id: 't-1',
        name: 'Alice',
        role: 'Tester',
        updatedAt: '2026-10-20T01:00:01.000Z',
      },
    ];

    // User B updates role at t=4 first
    const afterRole = applyTesterPatches(legacyTesters, [
      {
        id: 't-1',
        updatedAt: '2026-10-20T01:00:04.000Z',
        fieldUpdatedAt: { role: '2026-10-20T01:00:04.000Z' },
        changes: { role: 'QA Lead' },
      },
    ]);

    // User A updates name at t=3 (newer than legacy t=1, older than B's role edit at t=4)
    // and also carries a stale role at t=2 (older than B's t=4)
    const afterName = applyTesterPatches(afterRole, [
      {
        id: 't-1',
        updatedAt: '2026-10-20T01:00:03.000Z',
        fieldUpdatedAt: {
          name: '2026-10-20T01:00:03.000Z',
          role: '2026-10-20T01:00:02.000Z',
        },
        changes: { name: 'Alice Smith', role: 'Stale Role' },
      },
    ]);

    expect(afterName[0].name).toBe('Alice Smith');
    expect(afterName[0].role).toBe('QA Lead');

    // mergeTestersLists also resolves name and role independently per field
    const merged = mergeTestersLists(
      [
        {
          id: 't-1',
          name: 'Alice Cloud',
          role: 'Junior QA',
          updatedAt: '2026-10-20T01:00:10.000Z',
          fieldUpdatedAt: {
            name: '2026-10-20T01:00:10.000Z',
            role: '2026-10-20T01:00:02.000Z',
          },
        },
      ],
      [
        {
          id: 't-1',
          name: 'Alice Local',
          role: 'Senior QA',
          updatedAt: '2026-10-20T01:00:08.000Z',
          fieldUpdatedAt: {
            name: '2026-10-20T01:00:05.000Z',
            role: '2026-10-20T01:00:08.000Z',
          },
        },
      ]
    );
    expect(merged[0].name).toBe('Alice Cloud');
    expect(merged[0].role).toBe('Senior QA');
  });
});

describe('Items C, G, H: Tombstones for deleted devices, testers, bugs, and runs', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {}
  });

  it('prevents deleted devices and testers from resurrecting on merge or patch, and clears on undo', () => {
    markDeviceDeleted('dev-del');
    expect(isDeviceDeleted('dev-del')).toBe(true);

    const mergedDevs = mergeDevicesLists(
      [{ id: 'dev-1', name: 'WP01', isReady: true, quotas: [] }],
      [
        { id: 'dev-1', name: 'WP01', isReady: true, quotas: [] },
        { id: 'dev-del', name: 'GHOST', isReady: true, quotas: [] },
      ]
    );
    expect(mergedDevs.map(d => d.id)).toEqual(['dev-1']);

    unmarkDeviceDeleted('dev-del');
    expect(isDeviceDeleted('dev-del')).toBe(false);

    markTesterDeleted('tester-del');
    expect(isTesterDeleted('tester-del')).toBe(true);
    const mergedTesters = mergeTestersLists(
      [{ id: 't-1', name: 'Alice', role: 'QA' }],
      [
        { id: 't-1', name: 'Alice', role: 'QA' },
        { id: 'tester-del', name: 'Ghost', role: 'QA' },
      ]
    );
    expect(mergedTesters.map(t => t.id)).toEqual(['t-1']);
    unmarkTesterDeleted('tester-del');
    expect(isTesterDeleted('tester-del')).toBe(false);
  });

  it('tracks bug and run tombstones and clears them on undo', () => {
    markBugDeleted('bug-99');
    expect(isBugDeleted('bug-99')).toBe(true);
    unmarkBugDeleted('bug-99');
    expect(isBugDeleted('bug-99')).toBe(false);

    markTestRunDeleted('run-99');
    expect(isTestRunDeleted('run-99')).toBe(true);
    unmarkTestRunDeleted('run-99');
    expect(isTestRunDeleted('run-99')).toBe(false);
  });
});

describe('Items D, E, F: Device ID resolution, duplicate device names, and 1-to-1 lock reconciliation', () => {
  const duplicateDevices: DeviceProfile[] = [
    {
      id: 'dev-1',
      name: 'TB02',
      isReady: true,
      quotas: [{ planId: 'plan-1', targetRunsPerDay: 2 }],
    },
    {
      id: 'dev-2',
      name: 'TB02',
      isReady: true,
      quotas: [{ planId: 'plan-1', targetRunsPerDay: 2 }],
    },
    {
      id: 'dev-3',
      name: 'WP01',
      isReady: true,
      quotas: [{ planId: 'plan-1', targetRunsPerDay: 2 }],
    },
  ];

  it('detects duplicate device names (case-insensitive, trimmed)', () => {
    expect(isDeviceNameUnique('TB02', duplicateDevices)).toBe(false);
    expect(isDeviceNameUnique('wp01', duplicateDevices)).toBe(true);
    expect(hasDuplicateDeviceName(' tb02 ', duplicateDevices)).toBe(true);
    expect(hasDuplicateDeviceName('wp01', duplicateDevices, 'dev-3')).toBe(false);
    expect(hasDuplicateDeviceName('wp01', duplicateDevices, 'dev-1')).toBe(true);

    const dupIds = getDuplicateDeviceIds(duplicateDevices);
    expect(dupIds.has('dev-1')).toBe(true);
    expect(dupIds.has('dev-2')).toBe(true);
    expect(dupIds.has('dev-3')).toBe(false);
  });

  it('extracts deviceId from minted run IDs and resolves run device strictly by ID when names duplicate', () => {
    const runId = 'run-plan-1-dev-2-m1abc23';
    expect(extractDeviceIdFromRunId(runId, duplicateDevices)).toBe('dev-2');

    // Run on dev-2 with duplicate deviceName 'TB02' must resolve to 'dev-2', NEVER 'dev-1'
    const runOnDev2: TestRun = {
      id: runId,
      planId: 'plan-1',
      planName: 'Plan 1',
      deviceId: 'dev-2',
      deviceName: 'TB02',
      testerName: 'Tester B',
      status: 'in_progress',
      currentStepIndex: 0,
      results: { s1: { stepId: 's1', status: 'green', timestamp: new Date().toISOString() } },
      bugLogs: [],
      startedAt: new Date().toISOString(),
    };
    expect(resolveRunDeviceId(runOnDev2, duplicateDevices)).toBe('dev-2');

    // Ambiguous legacy run without deviceId or encoded runId and with duplicate name 'TB02' returns undefined
    const ambiguousLegacyRun: TestRun = {
      ...runOnDev2,
      id: 'run-legacy-123',
      deviceId: undefined,
    };
    expect(resolveRunDeviceId(ambiguousLegacyRun, duplicateDevices)).toBeUndefined();
  });

  it('reconcileDeviceLocks and computeTodayRunsMap lock and credit ONLY dev-2 when dev-1 and dev-2 share name TB02', () => {
    const todayIso = new Date().toISOString();
    const plans: TestPlan[] = [
      {
        id: 'plan-1',
        name: 'Plan 1',
        description: '',
        createdAt: todayIso,
        steps: [{ id: 's1', title: 'Step 1', description: '', expectedOutcome: '' }],
      },
    ];

    const liveRunOnDev2: TestRun = {
      id: 'run-plan-1-dev-2-xyz',
      planId: 'plan-1',
      planName: 'Plan 1',
      deviceId: 'dev-2',
      deviceName: 'TB02',
      testerName: 'Tester B',
      status: 'in_progress',
      currentStepIndex: 0,
      results: { s1: { stepId: 's1', status: 'green', timestamp: todayIso } },
      bugLogs: [],
      startedAt: todayIso,
    };

    const locks = reconcileDeviceLocks(duplicateDevices, [liveRunOnDev2]);
    expect(locks.has('dev-1')).toBe(false);
    expect(locks.get('dev-2')?.run.id).toBe(liveRunOnDev2.id);
    expect(locks.get('dev-2')?.testerName).toBe('Tester B');

    const completedRunOnDev2: TestRun = {
      ...liveRunOnDev2,
      status: 'completed',
      completedAt: todayIso,
    };
    const todayMap = computeTodayRunsMap([completedRunOnDev2], duplicateDevices, plans);
    expect(todayMap['dev-1']).toBeUndefined();
    expect(todayMap['dev-2']?.['plan-1']).toBe(1);
  });
});
